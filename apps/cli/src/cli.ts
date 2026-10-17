import { createPresenter } from '@hero-cloud/presentation';
import type { RenderOptions } from '@hero-cloud/presentation';
import {
  BUDGET_EMAIL_INPUT,
  HeroError,
  aiDestination,
  approvalFromChallenge,
  createAiProvider,
  isLocalAi,
  parseHeroSpec,
} from '@hero-cloud/sdk';
import type {
  AIProvider,
  AiConfig,
  ConsentScope,
  DeploymentPlan,
  Hero,
  HeroEvent,
  HeroSpec,
} from '@hero-cloud/sdk';
import type { ApprovalInbox } from '@hero-cloud/mcp';
import { parseArguments, peekRenderOptions, sourceKind } from './args.js';
import { join } from 'node:path';
import { deployerProfileText, hasProfile } from './profile.js';
import { renderText } from './render-text.js';
import { sanitizeForTerminal } from './sanitize.js';

/** Everything the CLI touches outside itself, so tests can run it without a real process. */
export interface CliIo {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  readonly columns: number | undefined;
  readonly version: string;
  readFile(path: string): Promise<string>;
  resolvePath(path: string): string;
  /** Builds the engine. `stateDirectory` is where `.hero/` lives; `profile` is a named AWS profile. */
  createHero(settings?: HeroSettings): Hero;
  readonly stdinIsTTY?: boolean;
  /** Where the person's AWS configuration file is. Hero adds a profile there only when asked. */
  readonly awsConfigPath?: string;
  /** Where the record of what was agreed to share with an AI model is kept. */
  openConsent?(path: string): {
    read(): Promise<ConsentRecord | undefined>;
    write(record: ConsentRecord): Promise<void>;
  };
  /** Opens the folder where assistants' approval requests wait for a person. */
  openInbox?(directory: string): ApprovalInbox;
  /** Serves the assistant tools over standard input and output until the assistant disconnects. */
  serveMcp?(options: {
    hero: Hero;
    roots: readonly string[];
    inboxDirectory: string;
  }): Promise<void>;
  appendFile?(path: string, text: string): Promise<void>;
  /** Asks for a secret without showing what is typed. Only used when a person is at the terminal. */
  askHidden?(question: string): Promise<string>;
  /** Asks one question and returns the answer. Only used when a person is at the terminal. */
  ask?(question: string): Promise<string>;
}

export interface HeroSettings {
  readonly stateDirectory: string;
  readonly profile?: string;
  /** The AI model the person chose and what they agreed to share with it. */
  readonly ai?: { readonly provider: AIProvider; readonly scope: ConsentScope };
}

/** What a person agreed to share, and with whom. Holds no keys and no project content. */
export interface ConsentRecord {
  readonly provider: string;
  readonly scope: ConsentScope;
  readonly grantedAt: string;
}

const JSON_SCHEMA_VERSION = 1;
/** The plan was made but has a blocking issue, so it cannot be approved yet. */
const EXIT_BLOCKED = 3;
/** The deployment exists, but the checks did not show it working. */
const EXIT_UNHEALTHY = 4;
const presenter = createPresenter();

function progressCode(event: HeroEvent): string | undefined {
  return event.type === 'phase' &&
    event.status === 'started' &&
    (event.phase === 'load' ||
      event.phase === 'analyze' ||
      event.phase === 'plan' ||
      event.phase === 'deploy' ||
      event.phase === 'verify' ||
      event.phase === 'destroy')
    ? `cli.progress.${event.phase}`
    : undefined;
}

/**
 * Runs the CLI and returns the exit code: 0 on success, 1 when the operation failed, and 2 when
 * the command line was wrong. Results go to stdout; progress and errors go to stderr, so output
 * can be piped safely.
 */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  let render: RenderOptions = peekRenderOptions(argv, io.env);
  let json = argv.includes('--json');

  const fail = (error: unknown): number => {
    const description = presenter.describeError(error, render);
    if (json) {
      const body = { schema: JSON_SCHEMA_VERSION, error: description };
      io.stderr.write(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      io.stderr.write(`${sanitizeForTerminal(description.message)}\n`);
      if (description.code === 'usage')
        io.stderr.write(`${presenter.text('cli.usage-hint', render)}\n`);
    }
    // Technical detail is opt-in, and the cause is never printed: it may hold secrets.
    if (io.env.HERO_DEBUG === '1' && error instanceof Error && error.stack !== undefined) {
      io.stderr.write(`${sanitizeForTerminal(error.stack)}\n`);
    }
    return description.code === 'usage' ? 2 : 1;
  };

  let args;
  try {
    args = parseArguments(argv, io.env);
  } catch (error) {
    return fail(error);
  }
  render = { audience: args.level, locale: args.locale };
  json = args.json;

  if (args.command === 'help') {
    io.stdout.write(`${presenter.text('cli.help', render)}\n`);
    return 0;
  }
  if (args.command === 'version') {
    io.stdout.write(`${io.version}\n`);
    return 0;
  }

  const color = args.color ?? (io.stdoutIsTTY && io.env.TERM !== 'dumb');
  const width = Math.min(Math.max(io.columns ?? 80, 40), 120);
  const settings: HeroSettings = {
    stateDirectory: io.resolvePath(args.stateDir ?? '.hero'),
    ...(args.profile === undefined ? {} : { profile: args.profile }),
  };
  const watch = (hero: Hero): void => {
    if (!io.stderrIsTTY || args.json) return;
    hero.subscribe((event) => {
      const code = progressCode(event);
      if (code !== undefined) io.stderr.write(`${presenter.text(code, render)}\n`);
      if (event.type === 'notice' && event.code === 'ai.consulted') {
        io.stderr.write(`${presenter.text('cli.ai.consulted', render, event.params)}\n`);
      }
      if (event.type === 'notice' && event.code === 'ai.unavailable') {
        io.stderr.write(`${presenter.text('cli.ai.unavailable', render, event.params)}\n`);
      }
    });
  };

  const DEFAULT_KEY_VARIABLE = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  } as const;

  /**
   * Turns `--ai ...` into a model and a decision about what may be shared. Nothing leaves the
   * machine unless the person agreed: a model on this computer needs no consent; any other needs a
   * recorded yes to this destination and scope, a prompt, or an explicit `--ai-scope`.
   */
  const resolveAi = async (): Promise<Pick<HeroSettings, 'ai'>> => {
    if (args.ai === undefined || args.noAi) return {};
    const model = args.aiModel;
    if (model === undefined)
      throw new HeroError('usage', { params: { reason: '--ai needs --ai-model <name>' } });
    const kind = args.ai as AiConfig['kind'];
    let apiKey: string | undefined;
    if (kind === 'anthropic' || kind === 'openai' || kind === 'openai-compatible') {
      const variable =
        args.aiKeyEnv ?? (kind === 'openai-compatible' ? undefined : DEFAULT_KEY_VARIABLE[kind]);
      apiKey = variable === undefined ? undefined : io.env[variable];
      if (apiKey === undefined && kind !== 'openai-compatible') {
        throw new HeroError('usage', {
          params: {
            reason: `put your key in the ${variable ?? 'environment'} variable (--ai-key-env <NAME> picks another)`,
          },
        });
      }
    }
    const config: AiConfig =
      kind === 'bedrock'
        ? {
            kind,
            model,
            region: args.region ?? 'us-east-1',
            ...(args.profile === undefined ? {} : { profile: args.profile }),
          }
        : kind === 'ollama'
          ? { kind, model, ...(args.aiBaseUrl === undefined ? {} : { baseUrl: args.aiBaseUrl }) }
          : kind === 'openai-compatible'
            ? {
                kind,
                model,
                baseUrl: args.aiBaseUrl ?? 'http://127.0.0.1:8000/v1',
                ...(apiKey === undefined ? {} : { apiKey }),
              }
            : {
                kind,
                model,
                apiKey: apiKey ?? '',
                ...(args.aiBaseUrl === undefined ? {} : { baseUrl: args.aiBaseUrl }),
              };
    const provider = createAiProvider(config);
    const scope = (args.aiScope as ConsentScope | undefined) ?? 'snippets';
    if (isLocalAi(config)) return { ai: { provider, scope } };

    const who = `${kind}:${aiDestination(config)}`;
    const consent = io.openConsent?.(join(settings.stateDirectory, 'ai-consent.json'));
    const stored = await consent?.read();
    const rank = { 'file-names': 0, snippets: 1, 'full-files': 2 } as const;
    if (stored?.provider === who && args.aiScope === undefined) {
      return { ai: { provider, scope: stored.scope } };
    }
    if (stored?.provider === who && rank[stored.scope] >= rank[scope]) {
      return { ai: { provider, scope } };
    }
    let agreed = args.aiScope !== undefined;
    if (!agreed && io.ask !== undefined && io.stdinIsTTY === true) {
      const answer = await io.ask(
        `${presenter.text('cli.ai.consent', render, {
          destination: aiDestination(config),
          what: presenter.text(`cli.ai.scope.${scope}`, render),
        })} `,
      );
      agreed = /^(y|yes|s|si|sí)$/i.test(answer.trim());
    }
    if (!agreed) {
      io.stderr.write(`${presenter.text('cli.ai.no-consent', render)}\n`);
      return {};
    }
    await consent?.write({ provider: who, scope, grantedAt: new Date().toISOString() });
    return { ai: { provider, scope } };
  };
  const show = (view: ReturnType<typeof presenter.plan>): void => {
    io.stdout.write(renderText(view, { color, width }));
  };

  /** Shows the plan, then gets the person's decision. Returns undefined when they decline. */
  const decide = async (hero: Hero, plan: DeploymentPlan) => {
    if (!args.json) show(presenter.plan(plan, render));
    if (args.approve !== undefined) {
      if (args.approve !== plan.digest) throw new HeroError('approval.digest-mismatch');
    } else {
      if (io.ask === undefined || io.stdinIsTTY !== true) {
        throw new HeroError('usage', {
          params: { reason: 'this needs a person at the terminal, or --approve <plan digest>' },
        });
      }
      const answer = await io.ask(`\n${presenter.text('cli.prompt.approve', render)} `);
      if (!/^(y|yes|s|si|sí)$/i.test(answer.trim())) {
        io.stdout.write(`${presenter.text('cli.declined', render)}\n`);
        return undefined;
      }
    }
    return approvalFromChallenge(
      await hero.requestApproval(plan),
      args.approve === undefined ? 'cli' : 'cli-flag',
    );
  };

  /**
   * A person decides about a request an assistant made. This is the only way such a request becomes
   * an approval: it needs a person at the terminal and cannot be answered with a flag.
   */
  const approveRequest = async (requestId: string): Promise<number> => {
    if (io.openInbox === undefined || io.ask === undefined || io.stdinIsTTY !== true) {
      throw new HeroError('usage', {
        params: { reason: 'approving an assistant’s request needs a person at the terminal' },
      });
    }
    const inbox = io.openInbox(join(settings.stateDirectory, 'approvals'));
    const request = await inbox.read(requestId);
    if (request === undefined) throw new HeroError('plan.unknown');
    if (Date.parse(request.challenge.expiresAt) < Date.now()) {
      io.stdout.write(`${presenter.text('cli.approve.expired', render)}\n`);
      return 1;
    }
    show(presenter.plan(request.plan, render));
    const answer = await io.ask(`\n${presenter.text('cli.prompt.approve', render)} `);
    if (!/^(y|yes|s|si|sí)$/i.test(answer.trim())) {
      await inbox.decide({ id: requestId, approved: false });
      io.stdout.write(`${presenter.text('cli.declined', render)}\n`);
      return 0;
    }
    const inputs: Record<string, string> = {};
    if (request.plan.requiredInputs.some((input) => input.name === BUDGET_EMAIL_INPUT)) {
      const email = (await io.ask(`${presenter.text('cli.prompt.budget-email', render)} `)).trim();
      if (email !== '') inputs[BUDGET_EMAIL_INPUT] = email;
    }
    await inbox.decide({
      id: requestId,
      approved: true,
      approval: approvalFromChallenge(request.challenge, 'mcp-terminal'),
      inputs,
    });
    io.stdout.write(`${presenter.text('cli.approve.recorded', render)}\n`);
    return 0;
  };

  const finish = (
    command: string,
    result: Awaited<ReturnType<Hero['outputs']>>,
    plan?: DeploymentPlan,
  ): number => {
    if (args.json) {
      const body = {
        schema: JSON_SCHEMA_VERSION,
        command,
        ...(plan === undefined ? {} : { plan }),
        result,
      };
      io.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      show(presenter.result(result, render));
    }
    return result.status === 'succeeded' ? 0 : EXIT_UNHEALTHY;
  };

  try {
    if (args.command === 'mcp') {
      if (io.serveMcp === undefined)
        throw new HeroError('provider.unavailable', { params: { reason: 'no-mcp' } });
      // Standard output belongs to the protocol: nothing else is printed there.
      await io.serveMcp({
        hero: io.createHero(settings),
        roots: (args.allow.length > 0 ? args.allow : ['.']).map((folder) => io.resolvePath(folder)),
        inboxDirectory: join(settings.stateDirectory, 'approvals'),
      });
      return 0;
    }
    if (args.command === 'approve') {
      return await approveRequest(args.source ?? '');
    }
    if (args.command === 'setup') {
      const hero = io.createHero(settings);
      watch(hero);
      const region = args.region ?? 'us-east-1';
      if (args.prepare) {
        const plan = await hero.planBootstrap({ region });
        const approval = await decide(hero, plan);
        if (approval === undefined) return 0;
        return finish('setup', await hero.deploy(plan, approval), plan);
      }
      const report = await hero.inspectSetup({
        region,
        ...(args.profile === undefined ? {} : { profile: args.profile }),
      });
      if (args.writeProfile !== undefined) {
        const path = io.awsConfigPath;
        const roleArn = report.deployerRoleArn;
        if (roleArn === undefined || args.profile === undefined || path === undefined) {
          throw new HeroError('usage', {
            params: {
              reason:
                'to add a profile, the account must be prepared and you must say which profile you sign in with (--profile <name>)',
            },
          });
        }
        const text = deployerProfileText({
          name: args.writeProfile,
          roleArn,
          sourceProfile: args.profile,
          region,
        });
        const existing = await io.readFile(path).catch(() => '');
        if (hasProfile(existing, args.writeProfile)) {
          io.stdout.write(
            `${presenter.text('cli.profile.exists', render, { name: args.writeProfile, path })}\n`,
          );
          return 0;
        }
        io.stdout.write(`\n${text}\n`);
        if (io.ask === undefined || io.appendFile === undefined || io.stdinIsTTY !== true) {
          throw new HeroError('usage', {
            params: {
              reason:
                'adding a profile needs a person at the terminal; copy the text above instead',
            },
          });
        }
        const answer = await io.ask(
          `${presenter.text('cli.prompt.write-profile', render, { path })} `,
        );
        if (!/^(y|yes|s|si|sí)$/i.test(answer.trim())) {
          io.stdout.write(`${presenter.text('cli.declined', render)}\n`);
          return 0;
        }
        await io.appendFile(
          path,
          `${existing === '' || existing.endsWith('\n') ? '' : '\n'}\n${text}`,
        );
        io.stdout.write(
          `${presenter.text('cli.profile.written', render, { name: args.writeProfile, path })}\n`,
        );
        return 0;
      }
      if (args.json) {
        io.stdout.write(
          `${JSON.stringify({ schema: JSON_SCHEMA_VERSION, command: 'setup', report }, null, 2)}\n`,
        );
      } else {
        show(presenter.setup(report, render));
      }
      return report.steps.every((step) => step.status === 'done') ? 0 : EXIT_BLOCKED;
    }
    if (args.command === 'secret') {
      const hero = io.createHero(settings);
      const name = args.secretName ?? '';
      let value = io.env[`HERO_SECRET_${name}`];
      if (value === undefined) {
        if (io.askHidden === undefined || io.stdinIsTTY !== true) {
          throw new HeroError('usage', {
            params: { reason: `give the value in HERO_SECRET_${name}, or run this in a terminal` },
          });
        }
        value = await io.askHidden(`${presenter.text('cli.prompt.secret', render, { name })} `);
      }
      const stored = await hero.setSecret(args.source ?? '', name, value);
      if (args.json) {
        io.stdout.write(
          `${JSON.stringify({ schema: JSON_SCHEMA_VERSION, command: 'secret', secret: stored }, null, 2)}\n`,
        );
      } else {
        io.stdout.write(
          `${presenter.text('cli.secret.stored', render, { name, location: stored.location })}\n`,
        );
      }
      return 0;
    }
    if (args.command === 'outputs' || args.command === 'health' || args.command === 'destroy') {
      const id = args.source ?? '';
      const hero = io.createHero(settings);
      watch(hero);
      if (args.command === 'outputs') return finish('outputs', await hero.outputs(id));
      if (args.command === 'health') {
        const health = await hero.health(id);
        if (args.json) {
          io.stdout.write(
            `${JSON.stringify({ schema: JSON_SCHEMA_VERSION, command: 'health', health }, null, 2)}\n`,
          );
        } else {
          show(presenter.health(id, health, render));
        }
        return health.status === 'healthy' ? 0 : EXIT_UNHEALTHY;
      }
      const destroyPlan = await hero.planDestroy(id);
      const approval = await decide(hero, destroyPlan);
      if (approval === undefined) return 0;
      return finish('destroy', await hero.deploy(destroyPlan, approval), destroyPlan);
    }

    const source = args.source ?? '';
    const kind = sourceKind(source, args.kind);
    const location = kind === 'git' ? source : io.resolvePath(source);

    let spec: HeroSpec | undefined;
    if (args.specFile !== undefined) {
      const parsed = parseHeroSpec(await io.readFile(io.resolvePath(args.specFile)));
      if (!parsed.ok) {
        const issues = parsed.issues.map((issue) => `${issue.path}:${issue.code}`).join(',');
        throw new HeroError('spec.invalid', { params: { issues } });
      }
      spec = parsed.spec;
    }

    const hero = io.createHero({ ...settings, ...(await resolveAi()) });
    watch(hero);
    const analysis = await hero.analyze(
      { kind, location },
      {
        noAi: args.noAi,
        ...(args.root === undefined ? {} : { root: args.root }),
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(spec === undefined ? {} : { spec }),
      },
    );

    if (args.command === 'analyze') {
      if (args.json) {
        const body = { schema: JSON_SCHEMA_VERSION, command: 'analyze', analysis };
        io.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
        return 0;
      }
      show(presenter.analysis(analysis, render));
      return 0;
    }

    const plan = await hero.plan(analysis, {
      answers: args.answers,
      offline: args.offline,
      ...(args.region === undefined ? {} : { region: args.region }),
      ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
      ...(args.name === undefined ? {} : { name: args.name }),
      // Deploying is for the account the credentials belong to, never a guess.
      ...(args.command === 'deploy' && args.accountId === undefined ? { useIdentity: true } : {}),
    });
    const blocked = plan.warnings.some((warning) => warning.severity === 'blocking');
    if (args.command === 'deploy') {
      if (blocked) {
        if (args.json) {
          io.stdout.write(
            `${JSON.stringify({ schema: JSON_SCHEMA_VERSION, command: 'deploy', analysis, plan }, null, 2)}\n`,
          );
        } else {
          show(presenter.plan(plan, render));
        }
        return EXIT_BLOCKED;
      }
      let email = args.budgetEmail ?? io.env.HERO_BUDGET_EMAIL;
      const needsEmail = plan.requiredInputs.some((input) => input.name === BUDGET_EMAIL_INPUT);
      if (needsEmail && email === undefined && io.ask !== undefined && io.stdinIsTTY === true) {
        email = (await io.ask(`${presenter.text('cli.prompt.budget-email', render)} `)).trim();
      }
      const approval = await decide(hero, plan);
      if (approval === undefined) return 0;
      // Secrets are asked for only after the plan is approved, never echoed, and go straight on.
      const secrets: Record<string, string> = {};
      for (const input of plan.requiredInputs) {
        if (input.kind !== 'secret') continue;
        let value = io.env[`HERO_SECRET_${input.name}`];
        if (value === undefined && io.askHidden !== undefined && io.stdinIsTTY === true) {
          value = await io.askHidden(
            `${presenter.text('cli.prompt.secret', render, { name: input.name })} `,
          );
        }
        if (value !== undefined && value !== '') secrets[input.name] = value;
      }
      const result = await hero.deploy(plan, approval, {
        inputs: email === undefined ? {} : { [BUDGET_EMAIL_INPUT]: email },
        secrets,
      });
      return finish('deploy', result, plan);
    }
    if (args.json) {
      const body = { schema: JSON_SCHEMA_VERSION, command: 'plan', analysis, plan };
      io.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
      return blocked ? EXIT_BLOCKED : 0;
    }
    show(presenter.plan(plan, render));
    const questions = plan.warnings
      .filter((warning) => warning.code === 'plan.open-question')
      .map((warning) => String(warning.params?.question ?? ''))
      .filter((id) => id !== '');
    if (questions.length > 0) {
      io.stdout.write(
        `\n${presenter.text('cli.hint.answer', render, { ids: questions.join(', ') })}\n`,
      );
    }
    return blocked ? EXIT_BLOCKED : 0;
  } catch (error) {
    return fail(error);
  }
}

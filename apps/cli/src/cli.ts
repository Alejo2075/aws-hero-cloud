import { createPresenter } from '@hero-cloud/presentation';
import type { RenderOptions } from '@hero-cloud/presentation';
import {
  BUDGET_EMAIL_INPUT,
  HeroError,
  approvalFromChallenge,
  parseHeroSpec,
} from '@hero-cloud/sdk';
import type { DeploymentPlan, Hero, HeroEvent, HeroSpec } from '@hero-cloud/sdk';
import { parseArguments, peekRenderOptions, sourceKind } from './args.js';
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
  /** Asks one question and returns the answer. Only used when a person is at the terminal. */
  ask?(question: string): Promise<string>;
}

export interface HeroSettings {
  readonly stateDirectory: string;
  readonly profile?: string;
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
    });
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

    const hero = io.createHero(settings);
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
      const result = await hero.deploy(plan, approval, {
        inputs: email === undefined ? {} : { [BUDGET_EMAIL_INPUT]: email },
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

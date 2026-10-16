import { createPresenter } from '@hero-cloud/presentation';
import type { RenderOptions } from '@hero-cloud/presentation';
import { HeroError, parseHeroSpec } from '@hero-cloud/sdk';
import type { Hero, HeroEvent, HeroSpec } from '@hero-cloud/sdk';
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
  createHero(): Hero;
}

const JSON_SCHEMA_VERSION = 1;
const presenter = createPresenter();

function progressCode(event: HeroEvent): string | undefined {
  return event.type === 'phase' &&
    event.status === 'started' &&
    (event.phase === 'load' || event.phase === 'analyze')
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

  try {
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

    const hero = io.createHero();
    if (io.stderrIsTTY && !args.json) {
      hero.subscribe((event) => {
        const code = progressCode(event);
        if (code !== undefined) io.stderr.write(`${presenter.text(code, render)}\n`);
      });
    }
    const analysis = await hero.analyze(
      { kind, location },
      {
        noAi: args.noAi,
        ...(args.root === undefined ? {} : { root: args.root }),
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(spec === undefined ? {} : { spec }),
      },
    );

    if (args.json) {
      const body = { schema: JSON_SCHEMA_VERSION, command: 'analyze', analysis };
      io.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
      return 0;
    }
    const color = args.color ?? (io.stdoutIsTTY && io.env.TERM !== 'dumb');
    const width = Math.min(Math.max(io.columns ?? 80, 40), 120);
    io.stdout.write(renderText(presenter.analysis(analysis, render), { color, width }));
    return 0;
  } catch (error) {
    return fail(error);
  }
}

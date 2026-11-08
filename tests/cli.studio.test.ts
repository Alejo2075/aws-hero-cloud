import { resolve } from 'node:path';
import { createHero } from '@hero-cloud/sdk';
import { describe, expect, it } from 'vitest';
import { run } from '@hero-cloud/cli';
import type { CliIo } from '@hero-cloud/cli';

function terminal(serve?: CliIo['serveStudio']) {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: { write: (t) => (out += t) },
    stderr: { write: (t) => (err += t) },
    env: { LANG: 'en_US.UTF-8' },
    stdoutIsTTY: false,
    stderrIsTTY: false,
    columns: 80,
    version: '0.0.0',
    readFile: () => Promise.reject(new Error('no files')),
    resolvePath: (p) => resolve('/work', p),
    createHero: () => createHero({}),
    ...(serve === undefined ? {} : { serveStudio: serve }),
  };
  return { io, out: () => out, err: () => err };
}

describe('hero-cloud studio', () => {
  it('serves Studio for the folders allowed, without opening the browser on request', async () => {
    let seen: Parameters<NonNullable<CliIo['serveStudio']>>[0] | undefined;
    const t = terminal((options) => {
      seen = options;
      options.announce('http://127.0.0.1:1/?code=x');
      return Promise.resolve();
    });
    const code = await run(['studio', '--no-open', '--allow', 'apps', '--locale', 'es'], t.io);
    expect(code).toBe(0);
    expect(seen?.open).toBe(false);
    expect(seen?.roots).toEqual(['/work/apps']);
    expect(seen?.locale).toBe('es');
    expect(seen?.uploadsDirectory).toMatch(/uploads$/);
    expect(t.err()).toContain('http://127.0.0.1:1/?code=x');
    expect(t.err()).toContain('Pulsa Ctrl+C');
  });

  it('allows only the current folder by default and opens the browser', async () => {
    let seen: Parameters<NonNullable<CliIo['serveStudio']>>[0] | undefined;
    const t = terminal((options) => {
      seen = options;
      return Promise.resolve();
    });
    await run(['studio'], t.io);
    expect(seen?.roots).toEqual(['/work']);
    expect(seen?.open).toBe(true);
  });

  it('takes no source', async () => {
    const t = terminal(() => Promise.resolve());
    expect(await run(['studio', 'examples/spa'], t.io)).toBe(2);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AIProvider } from '@hero-cloud/core';
import { createHero } from '@hero-cloud/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hero-report-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

const UNKNOWN = {
  'mix.exs':
    'defmodule Demo.MixProject do\n  @api_key "sk-abcdefghijklmnopqrstuvwxyz123456"\n  use Mix.Project\nend\n',
  'lib/demo.ex': 'defmodule Demo do\n  def secret_logic, do: :ok\nend\n',
  '.env': 'DATABASE_PASSWORD=hunter2-very-secret\n',
  'config/secrets.json': '{"stripe":"sk_live_abcdefghijklmnopqrstuv"}',
  'node_modules/dep/index.js': 'module.exports = 1',
};

describe('the unsupported-application report', () => {
  it('describes structure and manifests, and says nothing was recognized', async () => {
    const dir = await project(UNKNOWN);
    const report = await createHero().report({ kind: 'directory', location: dir });
    expect(report.schema).toBe(1);
    expect(report.reason).toBe('nothing-recognized');
    expect(report.files).toContain('mix.exs');
    expect(report.files).toContain('lib/demo.ex');
    expect(Object.keys(report.manifests)).toEqual(['mix.exs']);
  });

  it('leaves out secrets, dependencies and source code, and redacts what remains', async () => {
    const dir = await project(UNKNOWN);
    const report = await createHero().report({ kind: 'directory', location: dir });
    const text = JSON.stringify(report);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('sk_live_');
    expect(text).not.toContain('sk-abcdefghijklmnop');
    expect(text).not.toContain('secret_logic');
    expect(report.files.some((f) => f.includes('node_modules') || f.includes('.env'))).toBe(false);
    expect(report.redactions).toBeGreaterThan(0);
  });

  it('never contacts a model, even when one is configured and allowed', async () => {
    const dir = await project(UNKNOWN);
    let calls = 0;
    const ai: AIProvider = {
      generate: () => {
        calls += 1;
        return Promise.reject(new Error('must not be called'));
      },
    };
    const hero = createHero({ ai, aiConsent: { scope: 'full-files' } });
    await hero.report({ kind: 'directory', location: dir });
    expect(calls).toBe(0);
  });

  it('says what it did recognize when the application is known', async () => {
    const dir = await project({
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '5' },
        scripts: { start: 'node server.js' },
      }),
      'server.js': 'require("express")().listen(3000)\n',
    });
    const report = await createHero().report({ kind: 'directory', location: dir });
    expect(report.reason).not.toBe('nothing-recognized');
    expect(report.detected.length).toBeGreaterThan(0);
  });
});

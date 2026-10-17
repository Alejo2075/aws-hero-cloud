import { analyzeSnapshot } from '@hero-cloud/analyzer';
import type { ProjectSnapshot } from '@hero-cloud/core';
import { containerPlugin } from '@hero-cloud/plugin-container';
import { nodePlugin } from '@hero-cloud/plugin-node';
import { describe, expect, it } from 'vitest';
import { legacyPlugin } from './index.js';
import { parseProcfile, safeModule } from './shared.js';

function snapshot(files: Record<string, string>): ProjectSnapshot {
  const enc = new TextEncoder();
  const content = new Map(Object.entries(files).map(([p, c]) => [p, enc.encode(c)]));
  return {
    hash: 'a'.repeat(64),
    files: [...content].map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: 'b'.repeat(64),
    })),
    skipped: [],
    read: (p) => Promise.resolve(content.get(p) ?? new Uint8Array()),
    dispose: () => Promise.resolve(),
  };
}

const analyze = (files: Record<string, string>) =>
  analyzeSnapshot(snapshot(files), {
    detectors: [...nodePlugin.detectors, ...containerPlugin.detectors, ...legacyPlugin.detectors],
    name: 'demo',
  });

describe('Python', () => {
  it('asks for the start command when it cannot build a safe one, instead of guessing', async () => {
    const a = await analyze({
      'manage.py': '# django',
      'requirements.txt': 'django==5\n',
      'shop/wsgi.py': 'application = None',
    });
    expect(a.spec.services?.[0]?.start).toBeUndefined();
    expect(a.openQuestions.map((q) => q.code)).toEqual(
      expect.arrayContaining(['service.start-unknown', 'data.sqlite-persistence']),
    );
  });

  it('uses the Procfile the project wrote', async () => {
    const a = await analyze({
      'requirements.txt': 'flask\n',
      Procfile: 'web: gunicorn -w 2 --bind 0.0.0.0:$PORT site:app\n',
      'app.py': 'x',
    });
    expect(a.spec.services?.[0]?.start?.command).toBe(
      'gunicorn -w 2 --bind 0.0.0.0:$PORT site:app',
    );
    expect(a.openQuestions.map((q) => q.code)).not.toContain('service.start-unknown');
  });

  it('never puts text from a file name or a file into a command unless it is a plain module name', async () => {
    const a = await analyze({
      'requirements.txt': 'django\ngunicorn\n',
      'manage.py': '',
      'a;touch$IFS/tmp/x/wsgi.py': '',
      'shop wsgi/wsgi.py': '',
    });
    expect(JSON.stringify(a.spec)).not.toMatch(/touch|IFS|shop wsgi/);
    expect(a.spec.services?.[0]?.start).toBeUndefined();
    expect(safeModule('ok.module_1')).toBe('ok.module_1');
    for (const bad of ['a b', 'a;b', '../x', '1a', '', 'a.', '$(id)'])
      expect(safeModule(bad)).toBeUndefined();
  });

  it('finds the FastAPI app variable and the MongoDB and Redis drivers', async () => {
    const a = await analyze({
      'requirements.txt': 'fastapi\nuvicorn\npymongo\nredis\n',
      'app/main.py': 'from fastapi import FastAPI\napi = FastAPI()\n',
    });
    expect(a.spec.services?.[0]?.start?.command).toBe(
      'uvicorn app.main:api --host 0.0.0.0 --port $PORT',
    );
    expect(a.spec.data?.map((d) => d.type).sort()).toEqual(['cache', 'document']);
  });

  it('ignores a Python project that is not a web application', async () => {
    const a = await analyze({ 'requirements.txt': 'numpy\npandas\n', 'job.py': 'print(1)' });
    expect(a.spec.services).toBeUndefined();
  });
});

describe('the other languages', () => {
  it('does not mistake a PHP library or a console project for a web application', async () => {
    expect(
      (await analyze({ 'composer.json': '{"name":"x/lib"}', 'src/Lib.php': '<?php' })).spec
        .services,
    ).toBeUndefined();
    expect(
      (
        await analyze({
          'App.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
          'Program.cs': '',
        })
      ).spec.services,
    ).toBeUndefined();
    expect(
      (await analyze({ 'go.mod': 'module x', 'lib.go': 'package x' })).spec.services,
    ).toBeUndefined();
    expect(
      (await analyze({ 'pom.xml': '<project><artifactId>lib</artifactId></project>' })).spec
        .services,
    ).toBeUndefined();
  });

  it('knows a WAR package and asks for the port a Go server does not state', async () => {
    const war = await analyze({ 'pom.xml': '<project><packaging>war</packaging></project>' });
    expect(war.spec.extensions?.['x-java']).toMatchObject({ packaging: 'war' });
    const go = await analyze({
      'go.mod': 'module x',
      'main.go': 'import "net/http"\nfunc main(){ http.ListenAndServe(addr, nil) }',
    });
    expect(go.openQuestions.map((q) => q.code)).toContain('service.port-unknown');
  });

  it('asks about a file database in Rails', async () => {
    const a = await analyze({ Gemfile: 'gem "rails"\ngem "sqlite3"\n' });
    expect(a.openQuestions.map((q) => q.code)).toContain('data.sqlite-persistence');
    expect(a.spec.data).toBeUndefined();
  });
});

describe('Procfile', () => {
  it('describes a project whose language Hero does not know, and leaves known ones to their detector', async () => {
    const odd = await analyze({ Procfile: 'web: ./serve\nworker: ./work\n' });
    expect(odd.spec.services?.map((s) => [s.id, s.type])).toEqual([
      ['web', 'http'],
      ['worker', 'worker'],
    ]);
    expect(odd.openQuestions.map((q) => q.code)).toContain('service.port-unknown');
    const known = await analyze({ Procfile: 'web: gunicorn a:a', 'requirements.txt': 'flask\n' });
    expect(known.spec.services?.map((s) => s.id)).toEqual(['web']);
  });

  it('keeps only plain printable single-line commands', () => {
    const parsed = parseProcfile('web: ok --flag\nbad: rm\u0000-rf\n\nworker: ' + 'x'.repeat(600));
    expect(parsed).toEqual({ web: 'ok --flag' });
  });
});

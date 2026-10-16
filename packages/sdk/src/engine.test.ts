import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryPlanStore, approvalFromChallenge } from '@hero-cloud/core';
import type { HeroEvent } from '@hero-cloud/core';
import { samplePlan } from '@hero-cloud/core/testing';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { createHero } from './engine.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hero-sdk-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function project(): Promise<string> {
  const dir = await tempDir();
  await mkdir(join(dir, 'src'));
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'demo',
      dependencies: { express: '5' },
      scripts: { start: 'node src/index.js' },
    }),
  );
  await writeFile(join(dir, 'src', 'index.js'), "app.get('/health', h); app.listen(3000);\n");
  await writeFile(join(dir, '.env'), 'SECRET_TOKEN=do-not-leak\n');
  return dir;
}

describe('createHero().analyze', () => {
  it('analyzes a folder', async () => {
    const analysis = await createHero().analyze({ kind: 'directory', location: await project() });
    expect(analysis.spec.services?.[0]).toMatchObject({
      id: 'api',
      port: 3000,
      healthPath: '/health',
    });
    expect(analysis.skipped).toContainEqual({ path: '.env', reason: 'sensitive' });
    expect(JSON.stringify(analysis)).not.toContain('do-not-leak');
  });

  it('analyzes a ZIP of the same project and gets the same source hash', async () => {
    const dir = await project();
    const hero = createHero();
    const fromFolder = await hero.analyze({ kind: 'directory', location: dir });

    const zipPath = join(await tempDir(), 'demo.zip');
    const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
    await writeFile(
      zipPath,
      zipSync({
        'package.json': enc(
          JSON.stringify({
            name: 'demo',
            dependencies: { express: '5' },
            scripts: { start: 'node src/index.js' },
          }),
        ),
        'src/index.js': enc("app.get('/health', h); app.listen(3000);\n"),
      }),
    );
    const fromZip = await hero.analyze({ kind: 'zip', location: zipPath });
    expect(fromZip.sourceHash).toBe(fromFolder.sourceHash);
    expect(fromZip.spec).toEqual({ ...fromFolder.spec, application: { name: 'demo' } });
  });

  it('names the application from the folder when the project does not', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'index.html'), '<p>hi</p>');
    const analysis = await createHero().analyze({ kind: 'directory', location: dir });
    expect(analysis.spec.application.name).toMatch(/^hero-sdk-/);
  });

  it('refuses a source kind it has no loader for', async () => {
    await expect(createHero().analyze({ kind: 'ftp', location: 'x' })).rejects.toMatchObject({
      code: 'source.unsupported',
    });
  });

  it('accepts a custom source loader through the ports', async () => {
    const hero = createHero({
      sources: [
        {
          kind: 'memory',
          load: () =>
            Promise.resolve({
              hash: 'h'.repeat(64),
              files: [],
              skipped: [],
              read: () => Promise.reject(new Error('empty')),
              dispose: () => Promise.resolve(),
            }),
        },
      ],
    });
    const analysis = await hero.analyze({ kind: 'memory', location: 'mem' }, { name: 'custom' });
    expect(analysis.spec.application.name).toBe('custom');
    expect(analysis.sourceHash).toBe('h'.repeat(64));
  });

  describe('a spec supplied from outside the source', () => {
    it('skips analysis and is validated', async () => {
      const dir = await project();
      const spec = { version: '1', application: { name: 'chosen' } } as const;
      const analysis = await createHero().analyze({ kind: 'directory', location: dir }, { spec });
      expect(analysis.spec).toEqual(spec);
      expect(analysis.detections).toEqual([]);
      expect(analysis.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is refused when invalid', async () => {
      const dir = await project();
      const bad = {
        version: '1',
        application: { name: 'x' },
        services: [{ id: 'Bad Id' }],
      } as never;
      await expect(
        createHero().analyze({ kind: 'directory', location: dir }, { spec: bad }),
      ).rejects.toMatchObject({
        code: 'spec.invalid',
      });
    });
  });

  it('analyzes one folder of a monorepo with `root`', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'apps', 'api'), { recursive: true });
    await writeFile(
      join(dir, 'apps', 'api', 'package.json'),
      JSON.stringify({ dependencies: { express: '5' }, main: 'x.js' }),
    );
    const analysis = await createHero().analyze(
      { kind: 'directory', location: dir },
      { root: 'apps/api' },
    );
    expect(analysis.spec.services?.[0]?.id).toBe('api');
  });

  it('emits phase events and survives a faulty listener', async () => {
    const hero = createHero();
    const events: HeroEvent[] = [];
    hero.subscribe(() => {
      throw new Error('bad listener');
    });
    const stop = hero.subscribe((event) => events.push(event));
    await hero.analyze({ kind: 'directory', location: await project() });
    expect(events.map((e) => (e.type === 'phase' ? `${e.phase}:${e.status}` : e.type))).toEqual([
      'load:started',
      'load:completed',
      'analyze:started',
      'analyze:completed',
    ]);
    stop();
    await hero.analyze({ kind: 'directory', location: await project() });
    expect(events).toHaveLength(4);
  });

  it('reports a failed phase', async () => {
    const hero = createHero();
    const events: HeroEvent[] = [];
    hero.subscribe((event) => events.push(event));
    await expect(
      hero.analyze({ kind: 'directory', location: '/no/such/dir' }),
    ).rejects.toMatchObject({
      code: 'source.not-found',
    });
    expect(events.at(-1)).toMatchObject({ type: 'phase', phase: 'load', status: 'failed' });
  });
});

describe('createHero().requestApproval', () => {
  it('refuses a plan the engine did not produce (D2)', async () => {
    const hero = createHero();
    const forged = samplePlan();
    await expect(hero.requestApproval(forged)).rejects.toMatchObject({ code: 'plan.unknown' });
  });

  it('refuses a reference whose digest does not match the stored plan', async () => {
    const plans = new InMemoryPlanStore();
    const plan = samplePlan();
    await plans.put(plan);
    const hero = createHero({ plans });
    await expect(
      hero.requestApproval({ id: plan.id, digest: 'f'.repeat(64) }),
    ).rejects.toMatchObject({
      code: 'plan.tampered',
    });
  });

  it('refuses a stored plan that was altered after sealing', async () => {
    const plans = new InMemoryPlanStore();
    const plan = samplePlan();
    await plans.put({ ...plan, strategy: 'serverless' });
    const hero = createHero({ plans });
    await expect(hero.requestApproval(plan)).rejects.toMatchObject({ code: 'plan.tampered' });
  });

  it('issues a challenge for a known plan that turns into an approval', async () => {
    const plans = new InMemoryPlanStore();
    const plan = samplePlan();
    await plans.put(plan);
    const hero = createHero({ plans });
    const challenge = await hero.requestApproval({ id: plan.id, digest: plan.digest });
    expect(challenge).toMatchObject({
      planId: plan.id,
      planDigest: plan.digest,
      accountId: '123456789012',
    });
    expect(approvalFromChallenge(challenge, 'test').planDigest).toBe(plan.digest);
  });
});

describe('operations that arrive in later phases', () => {
  it('fail with an explicit coded error instead of pretending', async () => {
    const hero = createHero();
    await expect(hero.planDestroy('d')).rejects.toMatchObject({ code: 'internal.not-implemented' });
    await expect(hero.outputs('d')).rejects.toMatchObject({ code: 'internal.not-implemented' });
    await expect(hero.health('d')).rejects.toMatchObject({ code: 'internal.not-implemented' });
  });
});

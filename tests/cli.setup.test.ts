import { resolve } from 'node:path';
import { run } from '@hero-cloud/cli';
import type { CliIo } from '@hero-cloud/cli';
import type { CloudProvider, SetupReport } from '@hero-cloud/core';
import { createAwsProvider, describeBootstrap } from '@hero-cloud/provider-aws';
import { createHero } from '@hero-cloud/sdk';
import type { Hero } from '@hero-cloud/sdk';
import { describe, expect, it } from 'vitest';

const ACCOUNT = '123456789012';
const ROLE = `arn:aws:iam::${ACCOUNT}:role/hero-deployer`;
const identity = {
  account: ACCOUNT,
  principal: 'arn:aws:sts::123456789012:assumed-role/Admin/me',
  kind: 'role' as const,
};

const report = (over: Partial<SetupReport> = {}): SetupReport => ({
  region: 'us-east-1',
  identity,
  profiles: [{ name: 'work', kind: 'sso' }],
  steps: [
    { id: 'credentials', status: 'done' },
    { id: 'not-root', status: 'done' },
    { id: 'account-prepared', status: 'done' },
    { id: 'deployer-role', status: 'done' },
  ],
  deployerRoleArn: ROLE,
  next: ['use-deployer-role'],
  ...over,
});

function world(current: SetupReport) {
  const real = createAwsProvider();
  const prepared: string[] = [];
  const cloud: CloudProvider = {
    id: 'aws',
    describe: (r) => real.describe(r),
    identity: () => Promise.resolve(identity),
    inspect: () => Promise.resolve(current),
    describeBootstrap: (target) => describeBootstrap(target),
    bootstrap: (request) => {
      prepared.push(request.plan.artifactHash);
      return Promise.resolve({ deployerRoleArn: ROLE });
    },
  };
  return { hero: createHero({ cloud }), prepared };
}

function terminal(hero: Hero, answers: string[] = [], interactive = answers.length > 0) {
  let out = '';
  let err = '';
  const appended: { path: string; text: string }[] = [];
  const io: CliIo = {
    stdout: { write: (t) => (out += t) },
    stderr: { write: (t) => (err += t) },
    env: { LANG: 'en_US.UTF-8' },
    stdoutIsTTY: false,
    stderrIsTTY: false,
    columns: 80,
    version: '0.0.0',
    readFile: () => Promise.resolve('[default]\nregion = us-east-1\n'),
    resolvePath: (p) => resolve(p),
    createHero: () => hero,
    stdinIsTTY: interactive,
    ask: () => Promise.resolve(answers.shift() ?? ''),
    awsConfigPath: '/home/me/.aws/config',
    appendFile: (path, text) => {
      appended.push({ path, text });
      return Promise.resolve();
    },
  };
  return { io, out: () => out, err: () => err, appended };
}

describe('hero-cloud setup', () => {
  it('tells a person with no sign-in to make an account, honestly, at every level and language', async () => {
    const withoutIdentity: SetupReport = {
      region: 'us-east-1',
      profiles: [],
      steps: [
        { id: 'credentials', status: 'todo' },
        { id: 'not-root', status: 'blocked' },
        { id: 'account-prepared', status: 'blocked' },
        { id: 'deployer-role', status: 'blocked' },
      ],
      next: ['create-account', 'configure-sso'],
    };
    for (const level of ['simple', 'guided', 'expert']) {
      for (const locale of ['en', 'es']) {
        const { hero } = world(withoutIdentity);
        const t = terminal(hero);
        const code = await run(['setup', '--level', level, '--locale', locale], t.io);
        expect(code, `${level}/${locale}`).toBe(3);
        expect(t.out()).not.toMatch(/\{[A-Za-z]+\}|setup\.(next|step|status)/);
        expect(t.out().toLowerCase()).toMatch(/aws/);
      }
    }
    const t = terminal(world(withoutIdentity).hero);
    await run(['setup'], t.io);
    expect(t.out()).toContain('cannot make one for you');
    expect(t.out()).toContain('Hero cannot create your AWS account or pay for it');
  });

  it('exits 0 when everything is in place, and prints the report as JSON on request', async () => {
    const ready = report({ next: ['ready'] });
    const t = terminal(world(ready).hero);
    expect(await run(['setup'], t.io)).toBe(0);
    expect(t.out()).toContain('You are ready');
    const j = terminal(world(ready).hero);
    expect(await run(['setup', '--json'], j.io)).toBe(0);
    expect((JSON.parse(j.out()) as { report: SetupReport }).report.next).toEqual(['ready']);
  });

  it('prepares the account only after the person approves exactly that plan', async () => {
    const w = world(report({ steps: [], next: ['prepare-account'] }));
    const plan = await w.hero.planBootstrap();
    expect(plan).toMatchObject({ intent: 'bootstrap', target: { accountId: ACCOUNT } });
    expect(plan.changes.map((c) => c.resource.name)).toContain('hero-deployer');

    const wrong = terminal(w.hero);
    expect(await run(['setup', '--prepare', '--approve', 'a'.repeat(64)], wrong.io)).toBe(1);
    const declined = terminal(w.hero, ['n']);
    expect(await run(['setup', '--prepare'], declined.io)).toBe(0);
    expect(w.prepared).toEqual([]);
    expect(declined.out()).toContain('Preparing your AWS account');
    expect(declined.out()).toContain('What will be set up');

    const approved = terminal(w.hero);
    expect(
      await run(['setup', '--prepare', '--approve', plan.digest, '--level', 'guided'], approved.io),
    ).toBe(0);
    expect(w.prepared).toEqual([plan.artifactHash]);
    expect(approved.out()).toContain('Account preparation finished');
    expect(approved.out()).toContain(ROLE);
  });

  describe('--write-profile', () => {
    it('shows the text and adds it only when a person says yes', async () => {
      const w = world(report());
      const yes = terminal(w.hero, ['y']);
      expect(await run(['setup', '--profile', 'work', '--write-profile', 'hero'], yes.io)).toBe(0);
      expect(yes.out()).toContain(`role_arn = ${ROLE}`);
      expect(yes.appended).toHaveLength(1);
      expect(yes.appended[0]?.path).toBe('/home/me/.aws/config');
      expect(yes.appended[0]?.text).toContain('[profile hero]');
      expect(yes.appended[0]?.text).toContain('source_profile = work');
      expect(yes.appended[0]?.text).not.toMatch(/key|secret|token/i);

      const no = terminal(w.hero, ['n']);
      await run(['setup', '--profile', 'work', '--write-profile', 'hero'], no.io);
      expect(no.appended).toEqual([]);
    });

    it('does not touch a configuration that already has the profile, or write without a person', async () => {
      const w = world(report());
      const exists = terminal(w.hero, ['y']);
      const io: CliIo = {
        ...exists.io,
        readFile: () => Promise.resolve('[profile hero]\nregion = x\n'),
      };
      expect(await run(['setup', '--profile', 'work', '--write-profile', 'hero'], io)).toBe(0);
      expect(exists.appended).toEqual([]);
      expect(exists.out()).toContain('already exists');

      const script = terminal(w.hero, [], false);
      expect(await run(['setup', '--profile', 'work', '--write-profile', 'hero'], script.io)).toBe(
        2,
      );
      expect(script.appended).toEqual([]);
    });

    it('needs a prepared account, a source profile, and an ordinary name', async () => {
      const { deployerRoleArn: _unused, ...unprepared } = report();
      const t = terminal(world(unprepared).hero, ['y']);
      expect(await run(['setup', '--profile', 'work', '--write-profile', 'hero'], t.io)).toBe(2);
      const noSource = terminal(world(report()).hero, ['y']);
      expect(await run(['setup', '--write-profile', 'hero'], noSource.io)).toBe(2);
      const bad = terminal(world(report()).hero, ['y']);
      expect(await run(['setup', '--profile', 'work', '--write-profile', 'he ro'], bad.io)).toBe(2);
    });
  });
});

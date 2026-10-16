import { resolve } from 'node:path';
import type { CloudProvider, Health } from '@hero-cloud/core';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { createHero } from '@hero-cloud/sdk';
import type { Hero } from '@hero-cloud/sdk';
import { describe, expect, it } from 'vitest';
import { run } from '@hero-cloud/cli';
import type { CliIo } from '@hero-cloud/cli';

const examples = resolve(import.meta.dirname, '..', 'examples');
const SPA = resolve(examples, 'spa');
const ACCOUNT = '123456789012';

const healthy: Health = {
  status: 'healthy',
  checkedAt: '2026-01-01T00:00:00.000Z',
  components: [],
  checks: [
    {
      id: 's.r',
      component: 'website',
      kind: 'reachability',
      code: 'health.reachability',
      status: 'passed',
      target: 'd1.cloudfront.net',
      observed: { statusCode: 200, latencyMs: 5 },
    },
  ],
};

function world(over: Partial<CloudProvider> = {}) {
  const real = createAwsProvider();
  const calls: string[] = [];
  const cloud: CloudProvider = {
    id: 'aws',
    describe: (r) => real.describe(r),
    identity: () => Promise.resolve({ account: ACCOUNT, principal: 'arn:test', kind: 'role' }),
    apply: () => {
      calls.push('apply');
      return Promise.resolve({
        endpoints: [
          { kind: 'url', label: 'website', value: 'https://d1.cloudfront.net', public: true },
        ],
        resources: [],
        sensitiveOutputs: [],
        links: [],
      });
    },
    destroy: () => {
      calls.push('destroy');
      return Promise.resolve({ endpoints: [], resources: [], sensitiveOutputs: [], links: [] });
    },
    health: () => Promise.resolve(healthy),
    ...over,
  };
  const hero: Hero = createHero({ cloud });
  return { hero, calls };
}

function terminal(hero: Hero, answers: string[] = [], interactive = answers.length > 0) {
  let out = '';
  let err = '';
  const asked: string[] = [];
  const io: CliIo = {
    stdout: { write: (t) => (out += t) },
    stderr: { write: (t) => (err += t) },
    env: { LANG: 'en_US.UTF-8' },
    stdoutIsTTY: false,
    stderrIsTTY: false,
    columns: 80,
    version: '0.0.0',
    readFile: () => Promise.reject(new Error('no files')),
    resolvePath: (p) => resolve(p),
    createHero: () => hero,
    stdinIsTTY: interactive,
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(answers.shift() ?? '');
    },
  };
  return { io, out: () => out, err: () => err, asked };
}

const flags = ['--offline', '--account-id', ACCOUNT, '--budget-email', 'me@example.com'];

async function digestOf(): Promise<string> {
  const { hero } = world();
  const t = terminal(hero);
  await run(['plan', SPA, '--offline', '--account-id', ACCOUNT, '--json'], t.io);
  return (JSON.parse(t.out()) as { plan: { digest: string } }).plan.digest;
}

describe('hero-cloud deploy', () => {
  it('applies exactly the plan whose digest the script approved, and shows the result', async () => {
    const { hero, calls } = world();
    const digest = await digestOf();
    const t = terminal(hero);
    const code = await run(['deploy', SPA, ...flags, '--approve', digest], t.io);
    expect(code).toBe(0);
    expect(calls).toEqual(['apply']);
    expect(t.out()).toContain('https://d1.cloudfront.net');
    expect(t.out()).toContain('Your deployment: hero-hero-example-spa');
  });

  it('prints one JSON document with the plan and the result', async () => {
    const { hero } = world();
    const digest = await digestOf();
    const t = terminal(hero);
    expect(await run(['deploy', SPA, ...flags, '--approve', digest, '--json'], t.io)).toBe(0);
    const body = JSON.parse(t.out()) as {
      command: string;
      plan: { digest: string };
      result: { status: string };
    };
    expect(body).toMatchObject({ command: 'deploy', result: { status: 'succeeded' } });
    expect(body.plan.digest).toBe(digest);
  });

  it('refuses a digest that is not the plan, and applies nothing', async () => {
    const { hero, calls } = world();
    const t = terminal(hero);
    const code = await run(['deploy', SPA, ...flags, '--approve', 'a'.repeat(64)], t.io);
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(t.err()).not.toBe('');
  });

  it('asks a person, applies on yes, and does nothing on no', async () => {
    const yes = world();
    const a = terminal(yes.hero, ['y']);
    expect(await run(['deploy', SPA, ...flags], a.io)).toBe(0);
    expect(yes.calls).toEqual(['apply']);
    expect(a.asked[0]).toContain('Approve this plan');
    expect(a.out()).toContain('What will be created');

    const no = world();
    const b = terminal(no.hero, ['']);
    expect(await run(['deploy', SPA, ...flags], b.io)).toBe(0);
    expect(no.calls).toEqual([]);
    expect(b.out()).toContain('Nothing was changed');
  });

  it('asks for the spending-alert address when it is needed and nobody gave one', async () => {
    const { hero, calls } = world();
    const t = terminal(hero, ['me@example.com', 'y']);
    expect(await run(['deploy', SPA, '--offline', '--account-id', ACCOUNT], t.io)).toBe(0);
    expect(t.asked[0]).toContain('Email address');
    expect(calls).toEqual(['apply']);
  });

  it('needs a person or --approve; a script without either is a usage error', async () => {
    const { hero, calls } = world();
    const t = terminal(hero, [], false);
    expect(await run(['deploy', SPA, ...flags], t.io)).toBe(2);
    expect(calls).toEqual([]);
  });

  it('exits 4 when it deployed but the checks did not show it working', async () => {
    const { hero } = world({
      health: () => Promise.resolve({ ...healthy, status: 'down' }),
    });
    const digest = await digestOf();
    const t = terminal(hero);
    expect(await run(['deploy', SPA, ...flags, '--approve', digest], t.io)).toBe(4);
    expect(t.out()).toMatch(/not working yet/);
  });

  it('refuses to use the account owner', async () => {
    const { heroError } = await import('@hero-cloud/core');
    const { hero, calls } = world({
      identity: () => Promise.reject(heroError('identity.root-refused')),
    });
    const t = terminal(hero, ['y']);
    expect(await run(['deploy', SPA, '--offline', '--budget-email', 'a@b.co'], t.io)).toBe(1);
    expect(t.err()).toContain('account owner');
    expect(calls).toEqual([]);
  });
});

describe('outputs, health, and destroy', () => {
  async function deployed() {
    const w = world();
    const digest = await digestOf();
    await run(['deploy', SPA, ...flags, '--approve', digest], terminal(w.hero).io);
    return w;
  }

  it('shows the stored result, fresh health, and removes with approval', async () => {
    const w = await deployed();
    const id = 'hero-hero-example-spa';

    const outputs = terminal(w.hero);
    expect(await run(['outputs', id], outputs.io)).toBe(0);
    expect(outputs.out()).toContain('https://d1.cloudfront.net');

    const health = terminal(w.hero);
    expect(await run(['health', id, '--level', 'guided'], health.io)).toBe(0);
    expect(health.out()).toContain('Health of hero-hero-example-spa');
    expect(health.out()).toContain('features, logins, or data');

    const refused = terminal(w.hero, ['n']);
    expect(await run(['destroy', id], refused.io)).toBe(0);
    expect(w.calls).toEqual(['apply']);
    expect(refused.out()).toContain('Removing hero-example-spa');

    const removed = terminal(w.hero, ['y']);
    expect(await run(['destroy', id], removed.io)).toBe(0);
    expect(w.calls).toEqual(['apply', 'destroy']);
    expect(removed.out()).toMatch(/removed/i);
  });

  it('says clearly when the deployment is unknown', async () => {
    const { hero } = world();
    for (const command of ['outputs', 'health', 'destroy']) {
      const t = terminal(hero, ['y']);
      expect(await run([command, 'hero-nothing'], t.io)).toBe(1);
      expect(t.err()).not.toBe('');
    }
  });

  it('rejects names that are not deployment names', async () => {
    const t = terminal(world().hero);
    expect(await run(['outputs', '../etc'], t.io)).toBe(2);
    expect(await run(['health'], t.io)).toBe(2);
  });
});

describe('secrets on the command line', () => {
  const API = resolve(examples, 'api-dynamodb');

  function secretWorld() {
    const stored: { name: string; value: string }[] = [];
    const real = createAwsProvider();
    const cloud: CloudProvider = {
      id: 'aws',
      describe: (r) => real.describe(r),
      identity: () => Promise.resolve({ account: ACCOUNT, principal: 'arn:test', kind: 'role' }),
      apply: () =>
        Promise.resolve({ endpoints: [], resources: [], sensitiveOutputs: [], links: [] }),
      health: () => Promise.resolve(healthy),
    };
    const hero = createHero({
      cloud,
      secrets: {
        put: (r) => {
          stored.push({ name: r.name, value: r.value });
          return Promise.resolve({
            name: r.name,
            location: `ssm:/hero/${r.deploymentId}/${r.name}`,
          });
        },
      },
    });
    return { hero, stored };
  }

  it('asks for each secret without echoing it, only after approval, and never prints it', async () => {
    const { hero, stored } = secretWorld();
    const t = terminal(hero, ['me@example.com', 'y']);
    const hidden: string[] = [];
    const io: CliIo = {
      ...t.io,
      askHidden: (question) => {
        hidden.push(question);
        return Promise.resolve('sk_live_topsecret');
      },
    };
    const code = await run(['deploy', API, '--offline', '--account-id', ACCOUNT], io);
    expect(code).toBe(0);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toContain('API_KEY');
    expect(stored).toEqual([{ name: 'API_KEY', value: 'sk_live_topsecret' }]);
    expect(t.out() + t.err() + t.asked.join('')).not.toContain('sk_live_topsecret');
  });

  it('does not ask for secrets when the plan is declined', async () => {
    const { hero, stored } = secretWorld();
    const t = terminal(hero, ['me@example.com', 'n']);
    const io: CliIo = { ...t.io, askHidden: () => Promise.reject(new Error('must not ask')) };
    expect(await run(['deploy', API, '--offline', '--account-id', ACCOUNT], io)).toBe(0);
    expect(stored).toEqual([]);
  });

  it('takes a secret from the environment for scripts', async () => {
    const { hero, stored } = secretWorld();
    const probe = terminal(hero);
    await run(['plan', API, '--offline', '--account-id', ACCOUNT, '--json'], probe.io);
    const digest = (JSON.parse(probe.out()) as { plan: { digest: string } }).plan.digest;
    const t = terminal(hero);
    const io: CliIo = { ...t.io, env: { ...t.io.env, HERO_SECRET_API_KEY: 'from-env-value' } };
    const code = await run(
      [
        'deploy',
        API,
        '--offline',
        '--account-id',
        ACCOUNT,
        '--budget-email',
        'a@b.co',
        '--approve',
        digest,
      ],
      io,
    );
    expect(code).toBe(0);
    expect(stored).toEqual([{ name: 'API_KEY', value: 'from-env-value' }]);
    expect(t.out() + t.err()).not.toContain('from-env-value');
  });

  it('`secret` stores one later, from the environment or a hidden prompt, and prints only where', async () => {
    const { hero, stored } = secretWorld();
    const probe = terminal(hero);
    await run(['plan', API, '--offline', '--account-id', ACCOUNT, '--json'], probe.io);
    const digest = (JSON.parse(probe.out()) as { plan: { digest: string } }).plan.digest;
    const deployed = terminal(hero);
    const deployCode = await run(
      [
        'deploy',
        API,
        '--offline',
        '--account-id',
        ACCOUNT,
        '--budget-email',
        'a@b.co',
        '--approve',
        digest,
        '--json',
      ],
      deployed.io,
    );
    expect(deployCode, deployed.err()).toBe(0);
    stored.length = 0;
    const id = (JSON.parse(deployed.out()) as { result: { deploymentId: string } }).result
      .deploymentId;

    const viaEnv = terminal(hero);
    const code = await run(['secret', id, 'API_KEY'], {
      ...viaEnv.io,
      env: { ...viaEnv.io.env, HERO_SECRET_API_KEY: 'v1' },
    });
    expect(code, viaEnv.err()).toBe(0);
    expect(viaEnv.err()).toBe('');
    expect(viaEnv.out()).toContain(`ssm:/hero/${id}/API_KEY`);
    expect(viaEnv.out()).not.toContain('v1');

    const prompted = terminal(hero, [], true);
    expect(
      await run(['secret', id, 'API_KEY'], {
        ...prompted.io,
        askHidden: () => Promise.resolve('v2'),
      }),
    ).toBe(0);
    expect(stored.map((s) => s.value)).toEqual(['v1', 'v2']);

    const nobody = terminal(hero, [], false);
    expect(await run(['secret', id, 'API_KEY'], nobody.io)).toBe(2);
    expect(await run(['secret', id], nobody.io)).toBe(2);
    expect(await run(['secret', id, 'bad name'], nobody.io)).toBe(2);
  });
});

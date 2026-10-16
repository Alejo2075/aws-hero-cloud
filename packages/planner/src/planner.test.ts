import { analyzeSnapshot } from '@hero-cloud/analyzer';
import type { Analysis } from '@hero-cloud/core';
import { memorySnapshot } from '@hero-cloud/core/testing';
import { nodePlugin } from '@hero-cloud/plugin-node';
import { describe, expect, it } from 'vitest';
import { isSecretName } from './inputs.js';
import { planApplication } from './planner.js';

const pkg = (value: Record<string, unknown>): string => JSON.stringify(value);

function analyze(files: Record<string, string>): Promise<Analysis> {
  return analyzeSnapshot(memorySnapshot(files), {
    detectors: nodePlugin.detectors,
    name: 'fixture',
  });
}

const codes = (plan: ReturnType<typeof planApplication>): string[] =>
  plan.warnings.map((w) => w.code);
const blocking = (plan: ReturnType<typeof planApplication>): string[] =>
  plan.warnings
    .filter((w) => w.severity === 'blocking')
    .map((w) => `${w.code}:${JSON.stringify(w.params ?? {})}`);

const SPA = {
  'package.json': pkg({ devDependencies: { vite: '7' }, scripts: { build: 'vite build' } }),
};
const API = {
  'package.json': pkg({ dependencies: { express: '5' }, scripts: { start: 'node .' } }),
  'a.js': 'app.listen(3000)',
};

describe('strategy', () => {
  it('chooses static for a site with nothing behind it', async () => {
    const plan = planApplication({ analysis: await analyze(SPA) });
    expect(plan.strategy).toBe('static');
    expect(plan.strategyRationale[0]).toMatchObject({ code: 'strategy.static' });
    expect(plan.components.map((c) => c.kind)).toEqual(['static-site', 'budget-alert']);
    expect(blocking(plan)).toEqual([]);
  });

  it('moves up to serverless only when something needs a backend, and says what moved it', async () => {
    const plan = planApplication({
      analysis: await analyze({
        'package.json': pkg({
          dependencies: { express: '5', '@aws-sdk/lib-dynamodb': '3', passport: '1' },
          devDependencies: { vite: '7' },
          scripts: { build: 'vite build', start: 'node .' },
        }),
        'a.js': 'app.listen(3000)',
      }),
    });
    expect(plan.strategy).toBe('serverless');
    expect(plan.strategyRationale[0]).toMatchObject({ code: 'strategy.serverless' });
    expect(plan.strategyRationale[0]?.evidence).toEqual([
      'capability:authentication',
      'capability:http-service',
      'capability:key-value-data',
    ]);
    expect(plan.components.map((c) => `${c.kind}:${c.id}`)).toEqual([
      'static-site:site',
      'http-service:api',
      'key-value-table:kv',
      'identity:users',
      'budget-alert:budget',
    ]);
  });

  it('plans an API alone as serverless with the default port when none was found', async () => {
    const plan = planApplication({
      analysis: await analyze({
        'package.json': pkg({ dependencies: { express: '5' }, scripts: { start: 'node .' } }),
      }),
    });
    expect(plan.strategy).toBe('serverless');
    expect(plan.components.find((c) => c.kind === 'http-service')?.settings.port).toBe(8080);
    expect(plan.warnings.map((w) => `${w.code}:${w.severity}`)).toContain(
      'plan.open-question:warning',
    );
  });

  it('attaches the analyzer evidence to each decision', async () => {
    const plan = planApplication({ analysis: await analyze(API) });
    const service = plan.components.find((c) => c.kind === 'http-service');
    expect(service?.rationale[0]?.evidence?.some((e) => e.startsWith('dependency:express'))).toBe(
      true,
    );
  });
});

describe('what Hero cannot do yet is a blocking warning, not a guess', () => {
  it.each([
    [{ pg: '8' }, 'relational-data'],
    [{ mongoose: '8' }, 'document-data'],
    [{ ioredis: '5' }, 'cache'],
    [{ meilisearch: '1' }, 'search'],
  ])('%j needs a container', async (dependencies, capability) => {
    const plan = planApplication({
      analysis: await analyze({
        'package.json': pkg({
          dependencies: { express: '5', ...dependencies },
          scripts: { start: 'node .' },
        }),
      }),
    });
    expect(plan.strategy).toBe('container');
    expect(plan.strategyRationale[0]?.code).toBe('strategy.needs-container');
    expect(plan.components).toEqual([]);
    expect(blocking(plan)).toContain(
      `plan.unsupported-capability:{"capability":"${capability}","needs":"container"}`,
    );
  });

  it('refuses a service in another runtime', async () => {
    const analysis = {
      ...(await analyze(API)),
      spec: {
        version: '1' as const,
        application: { name: 'py' },
        services: [{ id: 'api', type: 'http' as const, runtime: 'python' }],
      },
      openQuestions: [],
    };
    const plan = planApplication({ analysis });
    expect(blocking(plan)).toContain(
      'plan.unsupported-capability:{"capability":"http-service","needs":"container"}',
    );
  });

  it('says there is nothing to deploy for an empty project', async () => {
    const plan = planApplication({ analysis: await analyze({ 'README.md': 'hi' }) });
    expect(blocking(plan)).toContain('plan.nothing-to-deploy:{}');
    expect(plan.components).toEqual([]);
  });
});

describe('open questions', () => {
  it('block the plan until answered, and advise when they are only advice', async () => {
    const plan = planApplication({
      analysis: await analyze({ 'package.json': pkg({ dependencies: { express: '5' } }) }),
    });
    expect(blocking(plan)).toContain(
      'plan.open-question:{"service":"api","question":"service.start-unknown","kind":"service.start-unknown"}',
    );
    expect(plan.warnings.find((w) => w.params?.question === 'service.port-unknown')?.severity).toBe(
      'warning',
    );
  });

  it('do not repeat what the analysis already shows (repository-spec questions)', async () => {
    const plan = planApplication({
      analysis: await analyze({ ...API, 'hero.yaml': 'version: [' }),
    });
    expect(
      plan.warnings.some((w) => String(w.params?.question).startsWith('repository-spec')),
    ).toBe(false);
  });

  it('are resolved by valid answers', async () => {
    const analysis = await analyze({ 'package.json': pkg({ dependencies: { express: '5' } }) });
    const plan = planApplication({
      analysis,
      answers: { 'service.start-unknown': 'npm run serve', 'service.port-unknown': '4000' },
    });
    expect(blocking(plan)).toEqual([]);
    expect(plan.spec.services?.[0]).toMatchObject({
      start: { command: 'npm run serve' },
      port: 4000,
    });
    expect(plan.components.find((c) => c.kind === 'http-service')?.settings).toMatchObject({
      port: 4000,
      startCommand: 'npm run serve',
    });
  });

  it('turn an upload destination into storage', async () => {
    const files = {
      'package.json': pkg({
        dependencies: { express: '5', multer: '2' },
        scripts: { start: 'node .' },
      }),
      'a.js': 'app.listen(3000)',
    };
    const object = planApplication({
      analysis: await analyze(files),
      answers: { 'storage.uploads': 'object' },
    });
    expect(object.components.map((c) => c.kind)).toContain('object-bucket');
    expect(blocking(object)).toEqual([]);
    const disk = planApplication({
      analysis: await analyze(files),
      answers: { 'storage.uploads': 'file-system' },
    });
    expect(blocking(disk)).toContain(
      'plan.unsupported-capability:{"capability":"file-system-write","needs":"container"}',
    );
  });

  it('need a schedule for a scheduled job', async () => {
    const files = {
      'package.json': pkg({ dependencies: { 'node-cron': '3' }, scripts: { start: 'node .' } }),
      'job.js': 'cron.schedule(expr, run)',
    };
    const analysis = await analyze(files);
    expect(blocking(planApplication({ analysis }))).toContain(
      'plan.open-question:{"question":"scheduled.schedule-unknown","kind":"scheduled.schedule-unknown"}',
    );
    const plan = planApplication({
      analysis,
      answers: { 'scheduled.schedule-unknown': '*/15  * * * *' },
    });
    expect(plan.components.find((c) => c.kind === 'scheduled-job')?.settings.schedule).toBe(
      '*/15 * * * *',
    );
  });

  describe('invalid answers are refused', () => {
    const cases: [string, string][] = [
      ['service.port-unknown', '0'],
      ['service.port-unknown', '70000'],
      ['service.port-unknown', '80; rm -rf /'],
      ['service.port-unknown', 'eighty'],
      ['service.start-unknown', ''],
      ['service.start-unknown', 'node .\nrm -rf /'],
      ['service.start-unknown', 'x'.repeat(300)],
      ['scheduled.schedule-unknown', 'daily'],
      ['storage.uploads', 'somewhere'],
    ];
    it.each(cases)('%s = %j', async (question, answer) => {
      const analysis = await analyze({
        'package.json': pkg({ dependencies: { express: '5', 'node-cron': '3', multer: '2' } }),
        'a.js': 'cron.schedule(expr, run)',
      });
      expect(() => planApplication({ analysis, answers: { [question]: answer } })).toThrow(
        expect.objectContaining({ code: 'plan.invalid-answer' }),
      );
    });

    it('rejects an answer to a question that does not exist (a typo is not silently ignored)', async () => {
      const analysis = await analyze(API);
      expect(() =>
        planApplication({ analysis, answers: { 'service.prot-unknown': '80' } }),
      ).toThrow(expect.objectContaining({ code: 'plan.invalid-answer' }));
    });

    it('rejects an answer to a question only a re-analysis can fix', async () => {
      const analysis = await analyze({
        'package.json': pkg({ name: 'mystery', dependencies: { lodash: '4' } }),
      });
      expect(() => planApplication({ analysis, answers: { 'app.not-recognized': 'yes' } })).toThrow(
        expect.objectContaining({ code: 'plan.invalid-answer' }),
      );
    });
  });
});

describe('required inputs', () => {
  it('lists the environment names, classifies secrets, and always asks for the budget email', async () => {
    const plan = planApplication({
      analysis: await analyze({
        ...API,
        '.env.example': 'DATABASE_URL=\nSTRIPE_SECRET_KEY=\nVITE_API_URL=\nLOG_LEVEL=\nAPI_KEY=\n',
      }),
    });
    expect(plan.requiredInputs.map((i) => `${i.name}:${i.kind}`)).toEqual([
      'API_KEY:secret',
      'DATABASE_URL:config',
      'LOG_LEVEL:config',
      'STRIPE_SECRET_KEY:secret',
      'VITE_API_URL:config',
      'BUDGET_ALERT_EMAIL:config',
    ]);
    expect(plan.warnings.find((w) => w.code === 'plan.secrets-required')?.params).toEqual({
      count: 2,
    });
  });

  it.each([
    ['API_KEY', true],
    ['STRIPE_SECRET_KEY', true],
    ['JWT_SECRET', true],
    ['DB_PASSWORD', true],
    ['GITHUB_TOKEN', true],
    ['SIGNING_KEY', true],
    ['SENTRY_DSN', true],
    ['VITE_API_KEY', false],
    ['NEXT_PUBLIC_TOKEN', false],
    ['LOG_LEVEL', false],
    ['TABLE_NAME', false],
    ['KEYBOARD_LAYOUT', false],
    ['MONKEY', false],
  ])('%s is secret: %s', (name, expected) => {
    expect(isSecretName(name)).toBe(expected);
  });
});

describe('guarantees', () => {
  it('is deterministic: the same analysis and answers give the same plan', async () => {
    const analysis = await analyze({ ...API, '.env.example': 'A=\nB_SECRET=\n' });
    expect(planApplication({ analysis })).toEqual(planApplication({ analysis }));
  });

  it('warns about public exposure and sorts blocking warnings first', async () => {
    const plan = planApplication({
      analysis: await analyze({ 'package.json': pkg({ dependencies: { express: '5' } }) }),
    });
    expect(plan.warnings[0]?.severity).toBe('blocking');
    expect(codes(plan)).toContain('plan.public-exposure');
  });

  it('never leaves a plan without a budget guardrail when it deploys something', async () => {
    for (const files of [SPA, API]) {
      const plan = planApplication({ analysis: await analyze(files) });
      expect(plan.components.some((c) => c.kind === 'budget-alert')).toBe(true);
    }
  });

  it('never carries environment values: only names', async () => {
    const plan = planApplication({
      analysis: await analyze({ ...API, '.env.example': 'A_SECRET=sk_live_123\n' }),
    });
    expect(JSON.stringify(plan)).not.toContain('sk_live_123');
  });
});

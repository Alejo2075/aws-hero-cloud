import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Component, ProviderPlanRequest } from '@hero-cloud/core';
import { describe, expect, it } from 'vitest';
import { createAwsProvider } from './provider.js';
import { awsCostLineCodes, awsResourceTypes } from './resources.js';

const component = (
  kind: Component['kind'],
  id: string,
  settings: Component['settings'] = {},
): Component => ({
  id,
  kind,
  capability: kind,
  settings: kind === 'key-value-table' ? { partitionKey: 'id', ...settings } : settings,
  rationale: [{ code: `rationale.${kind}` }],
});

const request = (
  components: Component[],
  overrides: Partial<ProviderPlanRequest> = {},
): ProviderPlanRequest => ({
  strategy: 'serverless',
  components,
  region: 'us-east-1',
  accountId: '123456789012',
  deploymentId: 'hero-shop',
  inputs: [],
  allowNetwork: false,
  ...overrides,
});

const provider = createAwsProvider();
const typesOf = (changes: readonly { resource: { type: string } }[]): string[] =>
  changes.map((c) => c.resource.type);
const detailsOf = (
  changes: readonly { resource: { type: string }; details?: unknown }[],
  type: string,
): Record<string, unknown> =>
  (changes.find((c) => c.resource.type === type)?.details ?? {}) as Record<string, unknown>;

describe('createAwsProvider().describe', () => {
  it('plans a static site as a private bucket behind an HTTPS-only CDN, with every helper listed', async () => {
    const { changes } = await provider.describe(request([component('static-site', 'site')]));
    expect(new Set(typesOf(changes))).toEqual(
      new Set([
        's3-bucket',
        's3-bucket-policy',
        'cloudfront-distribution',
        'cloudfront-access-control',
      ]),
    );
    expect(changes.filter((c) => c.resource.type === 's3-bucket')).toHaveLength(2);
    const files = changes.find(
      (c) => c.resource.type === 's3-bucket' && c.resource.name.includes('Files'),
    );
    expect(files?.details).toMatchObject({
      blockPublicAccess: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      versioning: true,
      accessLogging: true,
    });
    expect(detailsOf(changes, 'cloudfront-distribution')).toMatchObject({
      viewerProtocol: 'redirect-to-https',
      accessLogging: true,
    });
    expect(files?.rationale.map((r) => r.code)).toEqual(
      expect.arrayContaining([
        'guardrail.private-by-default',
        'guardrail.encryption',
        'guardrail.versioning',
        'rationale.static-site',
      ]),
    );
  });

  it('plans an API as an HTTP API in front of a function with its own role, policy and log groups', async () => {
    const { changes } = await provider.describe(
      request([component('http-service', 'api', { port: 3000 })]),
    );
    expect(new Set(typesOf(changes))).toEqual(
      new Set([
        'apigatewayv2-api',
        'apigatewayv2-stage',
        'apigatewayv2-integration',
        'apigatewayv2-route',
        'lambda-function',
        'lambda-permission',
        'iam-role',
        'iam-policy',
        'logs-log-group',
      ]),
    );
    expect(detailsOf(changes, 'lambda-function')).toMatchObject({ architecture: 'arm64' });
    expect(detailsOf(changes, 'lambda-function').runtime).toMatch(/^nodejs\d+\.x$/);
    expect(detailsOf(changes, 'apigatewayv2-stage')).toMatchObject({ accessLogging: true });
    for (const group of changes.filter((c) => c.resource.type === 'logs-log-group')) {
      expect(group.details).toMatchObject({ retentionDays: expect.any(Number) });
    }
  });

  it('gives a function only the permissions it needs, under the Hero boundary', async () => {
    const { changes } = await provider.describe(
      request([component('http-service', 'api'), component('key-value-table', 'orders')]),
    );
    expect(detailsOf(changes, 'iam-role')).toMatchObject({
      permissionsBoundary: true,
      trustedServices: ['lambda.amazonaws.com'],
    });
    const statements = changes
      .filter((c) => c.resource.type === 'iam-policy')
      .flatMap((c) => (c.details as { statements: { actions: string[] }[] }).statements);
    const actions = statements.flatMap((s) => s.actions);
    expect(actions.some((a) => a.startsWith('dynamodb:'))).toBe(true);
    expect(actions.some((a) => a === '*' || a === 'dynamodb:*' || a.endsWith(':*'))).toBe(false);
  });

  it('protects data: tables are on-demand with point-in-time recovery and deletion protection', async () => {
    const { changes } = await provider.describe(request([component('key-value-table', 'kv')]));
    expect(detailsOf(changes, 'dynamodb-table')).toMatchObject({
      keySchema: ['id:HASH'],
      billing: 'PAY_PER_REQUEST',
      pointInTimeRecovery: true,
      deletionProtection: true,
      onDestroy: 'keep',
    });
    expect(changes[0]?.rationale.map((r) => r.code)).toContain('guardrail.backups');
  });

  it('refuses a table without a key instead of inventing one', async () => {
    const keyless: Component = { ...component('key-value-table', 'kv'), settings: {} };
    await expect(provider.describe(request([keyless]))).rejects.toThrow();
  });

  it('plans a scheduled job with its schedule translated for AWS', async () => {
    const { changes, warnings } = await provider.describe(
      request([component('scheduled-job', 'jobs', { schedule: '*/5 * * * *' })]),
    );
    expect(detailsOf(changes, 'scheduler-schedule')).toMatchObject({
      expression: 'cron(*/5 * * * ? *)',
      state: 'ENABLED',
    });
    expect(warnings.some((w) => w.code === 'plan.unsupported-schedule')).toBe(false);
  });

  it('blocks a schedule AWS cannot express exactly, and creates no schedule', async () => {
    const { changes, warnings } = await provider.describe(
      request([component('scheduled-job', 'jobs', { schedule: '0 0 1 * 1' })]),
    );
    expect(typesOf(changes)).not.toContain('scheduler-schedule');
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'plan.unsupported-schedule', severity: 'blocking' }),
    );
  });

  it('plans a place for every input: secrets are encrypted, settings are plain, and no value is recorded', async () => {
    const { changes } = await provider.describe(
      request([component('static-site', 'site')], {
        inputs: [
          { name: 'STRIPE_SECRET', kind: 'secret' },
          { name: 'LOG_LEVEL', kind: 'config' },
        ],
      }),
    );
    const parameters = changes.filter((c) => c.resource.type === 'ssm-parameter');
    expect(parameters.map((c) => [c.resource.name, (c.details as { type: string }).type])).toEqual([
      ['LOG_LEVEL', 'String'],
      ['STRIPE_SECRET', 'SecureString'],
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/sk_(live|test)/);
  });

  it('tags every resource with the deployment so it can be found and removed exactly', async () => {
    const { changes } = await provider.describe(
      request([
        component('static-site', 'site'),
        component('http-service', 'api'),
        component('budget-alert', 'budget'),
      ]),
    );
    expect(changes.length).toBeGreaterThan(8);
    for (const change of changes) {
      expect((change.details as { tags: Record<string, string> }).tags).toEqual({
        'hero:deployment-id': 'hero-shop',
      });
      expect(change.action).toBe('create');
      expect(change.destructive).toBe(false);
      expect(change.resource.provider).toBe('aws');
    }
  });

  it('passes the AWS Solutions rules for every kind of component, alone and together', async () => {
    const kinds = [
      component('static-site', 'site'),
      component('http-service', 'api'),
      component('scheduled-job', 'jobs', { schedule: '0 * * * *' }),
      component('key-value-table', 'kv'),
      component('object-bucket', 'assets'),
      component('identity', 'users'),
      component('budget-alert', 'budget'),
    ];
    for (const one of kinds) {
      await expect(provider.describe(request([one]))).resolves.toBeDefined();
    }
    const all = await provider.describe(request(kinds));
    expect(new Set(all.changes.map((c) => c.id)).size).toBe(all.changes.length);
    for (const change of all.changes) expect(awsResourceTypes).toContain(change.resource.type);
  });

  describe('the artifact hash', () => {
    it('is stable for the same request and changes when anything that will be applied changes', async () => {
      const base = request([component('static-site', 'site')]);
      const a = (await provider.describe(base)).artifactHash;
      expect((await provider.describe(base)).artifactHash).toBe(a);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(
        (await provider.describe({ ...base, accountId: '999999999999' })).artifactHash,
      ).not.toBe(a);
      expect((await provider.describe({ ...base, region: 'eu-west-1' })).artifactHash).not.toBe(a);
      expect(
        (await provider.describe({ ...base, deploymentId: 'hero-other' })).artifactHash,
      ).not.toBe(a);
      expect(
        (await provider.describe(request([component('static-site', 'other')]))).artifactHash,
      ).not.toBe(a);
    });
  });

  describe('cost and warnings', () => {
    it('reports cost line codes it knows how to word', async () => {
      const { cost } = await provider.describe(
        request([
          component('static-site', 'site'),
          component('http-service', 'api'),
          component('key-value-table', 'kv'),
          component('object-bucket', 'assets'),
          component('identity', 'users'),
          component('scheduled-job', 'jobs', { schedule: '* * * * *' }),
        ]),
      );
      for (const l of cost.lines) expect(awsCostLineCodes).toContain(l.code);
    });

    it('warns that the estimate is a rough one when it could not use fresh prices', async () => {
      const offline = await provider.describe(request([component('static-site', 'site')]));
      expect(offline.warnings).toContainEqual({
        code: 'plan.cost-low-confidence',
        severity: 'info',
        params: { reason: 'offline', region: 'us-east-1' },
      });
      const failing = createAwsProvider({ fetchText: () => Promise.reject(new Error('down')) });
      const result = await failing.describe(
        request([component('static-site', 'site')], { allowNetwork: true }),
      );
      expect(result.cost.priceSource).toBe('built-in');
      expect(result.warnings[0]?.params).toMatchObject({ reason: 'prices-unavailable' });
    });

    it('does not warn when live prices were used', async () => {
      const dir = join(import.meta.dirname, '..', 'test-fixtures', 'pricing');
      const live = createAwsProvider({
        fetchText: async (url) =>
          readFile(join(dir, `${/aws\/([A-Za-z0-9]+)\//.exec(url)?.[1] ?? ''}.json`), 'utf8'),
      });
      const result = await live.describe(
        request([component('static-site', 'site')], { allowNetwork: true }),
      );
      expect(result.cost.priceSource).toBe('live');
      expect(result.warnings).toEqual([]);
    });
  });

  it('makes no call that needs credentials: it works with an empty environment and no network', async () => {
    const saved = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AWS_')) Reflect.deleteProperty(process.env, key);
    }
    try {
      const result = await provider.describe(request([component('http-service', 'api')]));
      expect(result.changes.length).toBeGreaterThan(0);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('falls back to a safe region if given a malformed one', async () => {
    const { changes } = await provider.describe(
      request([component('static-site', 'site')], { region: '../../x' }),
    );
    expect((changes[0]?.details as { region: string }).region).toBe('us-east-1');
  });
});

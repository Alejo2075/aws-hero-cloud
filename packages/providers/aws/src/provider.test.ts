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
  settings,
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
const types = (changes: readonly { resource: { type: string } }[]): string[] =>
  changes.map((c) => c.resource.type);

describe('createAwsProvider().describe', () => {
  it('plans a static site as a private bucket behind an HTTPS-only CDN', async () => {
    const { changes } = await provider.describe(
      request([component('static-site', 'site', { outputDirectory: 'dist' })]),
    );
    expect(types(changes)).toEqual(['s3-bucket', 'cloudfront-distribution']);
    const [bucket, cdn] = changes;
    expect(bucket?.details).toMatchObject({
      blockPublicAccess: true,
      encryption: 'SSE-S3',
      versioning: true,
    });
    expect(cdn?.details).toMatchObject({
      viewerProtocol: 'redirect-to-https',
      minimumTls: 'TLSv1.2_2021',
      outputDirectory: 'dist',
    });
    expect(bucket?.rationale.map((r) => r.code)).toEqual(
      expect.arrayContaining([
        'guardrail.private-by-default',
        'guardrail.encryption',
        'guardrail.versioning',
      ]),
    );
  });

  it('plans an API as an HTTP API in front of a function with its own role and log group', async () => {
    const { changes } = await provider.describe(
      request([component('http-service', 'api', { port: 3000, startCommand: 'npm start' })]),
    );
    expect(types(changes)).toEqual([
      'apigatewayv2-api',
      'lambda-function',
      'iam-role',
      'logs-log-group',
    ]);
    expect(changes.find((c) => c.resource.type === 'logs-log-group')?.details).toMatchObject({
      retentionDays: 30,
    });
    expect(changes.find((c) => c.resource.type === 'lambda-function')?.details).toMatchObject({
      architecture: 'arm64',
      runtime: 'nodejs22.x',
    });
  });

  it('gives a function only the permissions it needs, on this deployment, under a boundary', async () => {
    const { changes } = await provider.describe(
      request([component('http-service', 'api'), component('key-value-table', 'orders')]),
    );
    const role = changes.find((c) => c.resource.type === 'iam-role');
    const allow = (role?.details as { allow: string[]; permissionsBoundary: string }).allow;
    expect(allow).toContain('dynamodb:*:orders');
    expect(allow.some((a) => a === '*' || a.endsWith(':*:*') || a === 'dynamodb:*')).toBe(false);
    expect(role?.details).toMatchObject({ permissionsBoundary: 'hero' });
  });

  it('protects data: on-demand tables with point-in-time recovery and deletion protection', async () => {
    const { changes } = await provider.describe(request([component('key-value-table', 'kv')]));
    expect(changes[0]?.details).toMatchObject({
      billing: 'on-demand',
      pointInTimeRecovery: true,
      deletionProtection: true,
    });
    expect(changes[0]?.rationale.map((r) => r.code)).toContain('guardrail.backups');
  });

  it('plans a scheduled job with its schedule', async () => {
    const { changes } = await provider.describe(
      request([component('scheduled-job', 'jobs', { schedule: '*/5 * * * *' })]),
    );
    expect(types(changes)).toEqual([
      'scheduler-schedule',
      'lambda-function',
      'iam-role',
      'logs-log-group',
    ]);
    expect(changes[0]?.details).toMatchObject({ cron: '*/5 * * * *' });
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
    expect(changes.length).toBeGreaterThan(4);
    for (const change of changes) {
      expect((change.details as { tags: Record<string, string> }).tags).toEqual({
        'hero:deployment-id': 'hero-shop',
      });
      expect(change.action).toBe('create');
      expect(change.destructive).toBe(false);
      expect(change.resource.provider).toBe('aws');
    }
  });

  it('produces unique change ids and only known resource types', async () => {
    const { changes } = await provider.describe(
      request([
        component('static-site', 'site'),
        component('http-service', 'api'),
        component('scheduled-job', 'jobs'),
        component('key-value-table', 'kv'),
        component('object-bucket', 'assets'),
        component('identity', 'users'),
        component('budget-alert', 'budget'),
      ]),
    );
    expect(new Set(changes.map((c) => c.id)).size).toBe(changes.length);
    for (const change of changes) expect(awsResourceTypes).toContain(change.resource.type);
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
        (
          await provider.describe(
            request([component('static-site', 'site', { outputDirectory: 'build' })]),
          )
        ).artifactHash,
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

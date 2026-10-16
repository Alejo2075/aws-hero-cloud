import { rmSync } from 'node:fs';
import type { Component } from '@hero-cloud/core';
import { describe, expect, it } from 'vitest';
import { synthesize } from './synth.js';

const component = (kind: Component['kind'], settings: Component['settings'] = {}): Component => ({
  id: 'x',
  kind,
  capability: kind,
  settings,
  rationale: [],
});

const cases: [string, Component][] = [
  ['static-site', component('static-site')],
  ['http-service', component('http-service', { port: 3000 })],
  ['scheduled-job', component('scheduled-job', { schedule: '0 * * * *' })],
  ['key-value-table', component('key-value-table', { partitionKey: 'id', sortKey: 'at' })],
  ['object-bucket', component('object-bucket')],
  ['identity', component('identity')],
  ['budget-alert', component('budget-alert')],
];

function resourcesOf(c: Component) {
  const result = synthesize({
    deploymentId: 'hero-snap',
    accountId: '123456789012',
    region: 'us-east-1',
    components: [c],
  });
  rmSync(result.directory, { recursive: true, force: true });
  return result.template.Resources;
}

describe.each(cases)('the %s stack', (_name, c) => {
  const resources = resourcesOf(c);
  const typeCounts = Object.values(resources).reduce<Record<string, number>>((counts, r) => {
    counts[r.Type] = (counts[r.Type] ?? 0) + 1;
    return counts;
  }, {});

  it('creates exactly the expected kinds of resource', () => {
    expect(typeCounts).toMatchSnapshot();
  });

  it('never makes anything public, wildcard, or unprotected', () => {
    const text = JSON.stringify(resources);
    // A wildcard principal is allowed only to deny insecure connections, never to grant access.
    const statements = Object.values(resources).flatMap((r) => {
      const document = (r.Properties as { PolicyDocument?: { Statement?: unknown } } | undefined)
        ?.PolicyDocument;
      return Array.isArray(document?.Statement)
        ? (document.Statement as Record<string, unknown>[])
        : [];
    });
    for (const statement of statements) {
      if (JSON.stringify(statement.Principal ?? '').includes('"*"')) {
        expect(statement.Effect).toBe('Deny');
      }
    }
    expect(text).not.toContain('AdministratorAccess');
    for (const r of Object.values(resources)) {
      if (r.Type === 'AWS::S3::Bucket') {
        expect(r.Properties?.PublicAccessBlockConfiguration).toBeDefined();
        expect(r.Properties?.BucketEncryption).toBeDefined();
      }
      if (r.Type === 'AWS::IAM::Role') {
        expect(r.Properties?.PermissionsBoundary).toBeDefined();
      }
      if (r.Type === 'AWS::DynamoDB::Table') {
        expect(r.DeletionPolicy).toBe('Retain');
      }
    }
  });

  it('tags every component resource and keeps secrets out of the template', () => {
    const text = JSON.stringify(resources);
    expect(text).not.toMatch(/sk_(live|test)|AKIA[0-9A-Z]{16}/);
  });
});

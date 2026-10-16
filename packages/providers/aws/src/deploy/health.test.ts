import {
  CloudFormationClient,
  DescribeStackDriftDetectionStatusCommand,
  DescribeStacksCommand,
  DetectStackDriftCommand,
} from '@aws-sdk/client-cloudformation';
import type { Health, ProviderHealthRequest } from '@hero-cloud/core';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it } from 'vitest';
import { createHealthChecker, isHeroEndpoint, isSafePath } from './health.js';
import type { FetchLike } from './health.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const API = 'https://abc123.execute-api.us-east-1.amazonaws.com';
const CDN = 'https://d1abc.cloudfront.net';

const base = (over: Partial<ProviderHealthRequest> = {}): ProviderHealthRequest => ({
  deploymentId: 'hero-shop',
  region: 'us-east-1',
  accountId: '123456789012',
  endpoints: [{ kind: 'url', label: 'api', value: API, public: true }],
  components: [{ id: 'api', kind: 'http-service', healthPath: '/health' }],
  now: () => NOW,
  ...over,
});

const reply =
  (routes: Record<string, { status: number; location?: string }>): FetchLike =>
  (url) => {
    const route = routes[url] ?? { status: 404 };
    return Promise.resolve({
      status: route.status,
      headers: { get: (n) => (n === 'location' ? (route.location ?? null) : null) },
      body: null,
    });
  };

function checker(fetch: FetchLike, stack = 'CREATE_COMPLETE') {
  const cfn = mockClient(CloudFormationClient);
  cfn.on(DescribeStacksCommand).resolves({
    Stacks: [{ StackName: 'x', StackStatus: stack as never, CreationTime: new Date() }],
  });
  return {
    cfn,
    check: createHealthChecker({
      cloudFormation: new CloudFormationClient({ region: 'us-east-1' }),
      fetch,
      timeoutMs: 100,
      clock: () => 0,
      driftWaitMs: 0,
    }),
  };
}

describe('isHeroEndpoint / isSafePath', () => {
  it('accepts only addresses Hero creates', () => {
    expect(isHeroEndpoint(new URL(API), 'us-east-1')).toBe(true);
    expect(isHeroEndpoint(new URL(CDN), 'us-east-1')).toBe(true);
    for (const bad of [
      'http://d1.cloudfront.net',
      'https://evil.example.com',
      'https://169.254.169.254',
      'https://d1.cloudfront.net.evil.com',
      'https://u:p@d1.cloudfront.net',
      'https://d1.cloudfront.net:8443',
      'https://abc.execute-api.eu-west-1.amazonaws.com',
      'https://localhost',
    ]) {
      expect(isHeroEndpoint(new URL(bad), 'us-east-1'), bad).toBe(false);
    }
  });

  it('accepts paths and nothing that can name another host', () => {
    expect(isSafePath('/health')).toBe(true);
    expect(isSafePath('/a/b?x=1')).toBe(true);
    for (const bad of [
      'health',
      '//evil.com',
      '/a/../b',
      'http://x',
      '/a b',
      '/a\nb',
      '/@x',
      '/#x',
      '/\\x',
    ]) {
      expect(isSafePath(bad), bad).toBe(false);
    }
  });
});

describe('createHealthChecker', () => {
  it('reports healthy only for what was observed to work', async () => {
    const { cfn, check } = checker(
      reply({ [`${API}/`]: { status: 200 }, [`${API}/health`]: { status: 200 } }),
    );
    try {
      const health = await check(base());
      expect(health.status).toBe('healthy');
      expect(health.checkedAt).toBe(NOW.toISOString());
      expect(health.checks.map((c) => [c.kind, c.status])).toEqual([
        ['resource-state', 'passed'],
        ['reachability', 'passed'],
        ['smoke', 'passed'],
      ]);
      expect(health.checks[1]?.observed).toEqual({ statusCode: 200, latencyMs: 0 });
    } finally {
      cfn.restore();
    }
  });

  it('is degraded when the address answers but the smoke path fails, and down when nothing answers', async () => {
    const a = checker(reply({ [`${API}/`]: { status: 200 }, [`${API}/health`]: { status: 500 } }));
    try {
      const health = await a.check(base());
      expect(health.components.find((c) => c.component === 'api')?.status).toBe('degraded');
      expect(health.status).toBe('degraded');
    } finally {
      a.cfn.restore();
    }
    const b = checker(() => Promise.reject(new Error('refused')), 'ROLLBACK_COMPLETE');
    try {
      const health = await b.check(base());
      expect(health.status).toBe('down');
      expect(health.checks.find((c) => c.kind === 'reachability')?.code).toBe(
        'health.reachability.unreachable',
      );
    } finally {
      b.cfn.restore();
    }
  });

  it('refuses to follow a redirect to another host', async () => {
    const { cfn, check } = checker(
      reply({ [`${API}/`]: { status: 302, location: 'https://evil.example.com/' } }),
    );
    try {
      const health = await check(base({ components: [] }));
      expect(health.checks.find((c) => c.kind === 'reachability')).toMatchObject({
        status: 'failed',
        code: 'health.reachability.redirect-off-host',
      });
    } finally {
      cfn.restore();
    }
  });

  it('follows a redirect inside the same host', async () => {
    const { cfn, check } = checker(
      reply({ [`${API}/`]: { status: 301, location: '/home' }, [`${API}/home`]: { status: 200 } }),
    );
    try {
      const health = await check(base({ components: [] }));
      expect(health.checks.find((c) => c.kind === 'reachability')?.status).toBe('passed');
    } finally {
      cfn.restore();
    }
  });

  it('never requests an endpoint that is not Hero-created, nor an unsafe smoke path', async () => {
    const requested: string[] = [];
    const { cfn, check } = checker((url) => {
      requested.push(url);
      return Promise.resolve({ status: 200, headers: { get: () => null }, body: null });
    });
    try {
      const health = await check(
        base({
          endpoints: [
            { kind: 'url', label: 'other', value: 'https://evil.example.com', public: true },
            { kind: 'url', label: 'api', value: API, public: true },
          ],
          components: [{ id: 'api', kind: 'http-service', healthPath: '//evil.example.com' }],
        }),
      );
      expect(requested).toEqual([`${API}/`]);
      expect(health.checks.filter((c) => c.status === 'skipped').map((c) => c.id)).toEqual([
        'other.reachability',
        'api.smoke',
      ]);
    } finally {
      cfn.restore();
    }
  });

  it('is unknown, not healthy, when nothing could be checked', async () => {
    const { cfn, check } = checker(reply({}));
    cfn.on(DescribeStacksCommand).rejects(new Error('denied'));
    try {
      const health = await check(base({ endpoints: [], components: [] }));
      expect(health.checks[0]).toMatchObject({ status: 'failed', target: 'UNREACHABLE' });
      expect(health.status).toBe('down');
    } finally {
      cfn.restore();
    }
  });
});

describe('drift', () => {
  const drifting = (
    detection: { DetectionStatus: string; StackDriftStatus?: string } | Error,
    started: { StackDriftDetectionId?: string } = { StackDriftDetectionId: 'd-1' },
  ) => {
    const cfn = mockClient(CloudFormationClient);
    cfn.on(DescribeStacksCommand).resolves({
      Stacks: [{ StackName: 'x', StackStatus: 'CREATE_COMPLETE', CreationTime: new Date() }],
    });
    cfn.on(DetectStackDriftCommand).resolves(started);
    if (detection instanceof Error)
      cfn.on(DescribeStackDriftDetectionStatusCommand).rejects(detection);
    else {
      cfn.on(DescribeStackDriftDetectionStatusCommand).resolves({
        StackId: 's',
        StackDriftDetectionId: 'd-1',
        Timestamp: new Date(),
        DetectionStatus: detection.DetectionStatus as never,
        ...(detection.StackDriftStatus === undefined
          ? {}
          : { StackDriftStatus: detection.StackDriftStatus as never }),
      });
    }
    return {
      cfn,
      check: createHealthChecker({
        cloudFormation: new CloudFormationClient({ region: 'us-east-1' }),
        fetch: reply({}),
        sleep: () => Promise.resolve(),
        driftWaitMs: 2000,
      }),
    };
  };
  const drift = (health: Health) => health.checks.find((c) => c.kind === 'drift');

  it('passes only when the provider says everything is in sync', async () => {
    const { cfn, check } = drifting({
      DetectionStatus: 'DETECTION_COMPLETE',
      StackDriftStatus: 'IN_SYNC',
    });
    try {
      const h = await check(base({ endpoints: [], components: [] }));
      expect(drift(h)).toMatchObject({ code: 'health.drift', status: 'passed' });
    } finally {
      cfn.restore();
    }
  });

  it('fails when resources changed outside Hero', async () => {
    const { cfn, check } = drifting({
      DetectionStatus: 'DETECTION_COMPLETE',
      StackDriftStatus: 'DRIFTED',
    });
    try {
      const h = await check(base({ endpoints: [], components: [] }));
      expect(drift(h)).toMatchObject({ code: 'health.drift.drifted', status: 'failed' });
      expect(h.status).toBe('degraded');
    } finally {
      cfn.restore();
    }
  });

  it('is skipped, not passed, when it could not be checked', async () => {
    const cases: (() => ReturnType<typeof drifting>)[] = [
      () => drifting(new Error('AccessDenied')),
      () => drifting({ DetectionStatus: 'DETECTION_FAILED' }),
      () => drifting({ DetectionStatus: 'DETECTION_IN_PROGRESS' }),
      () => drifting({ DetectionStatus: 'DETECTION_COMPLETE', StackDriftStatus: 'NOT_CHECKED' }),
      () => drifting({ DetectionStatus: 'DETECTION_COMPLETE' }, {}),
    ];
    for (const make of cases) {
      const setup = make();
      try {
        const h = await setup.check(base({ endpoints: [], components: [] }));
        expect(drift(h)).toMatchObject({ code: 'health.drift.unavailable', status: 'skipped' });
      } finally {
        setup.cfn.restore();
      }
    }
  });
});

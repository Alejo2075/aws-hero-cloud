import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import type {
  CloudProvider,
  ComponentHealth,
  Health,
  HealthCheck,
  HealthStatus,
  ProviderHealthRequest,
} from '@hero-cloud/core';
import type { CloudFormationPort } from './outputs.js';

export type FetchLike = (
  url: string,
  init: { readonly redirect: 'manual'; readonly signal: AbortSignal; readonly method: 'GET' },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}>;

export interface HealthOptions {
  readonly cloudFormation: CloudFormationPort;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly clock?: () => number;
}

const MAX_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;

/**
 * Only addresses Hero itself creates are ever requested: a CloudFront domain, or an HTTP API in the
 * deployment's own region. Anything else, however it got into the list, is refused.
 */
export function isHeroEndpoint(url: URL, region: string): boolean {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    /^[a-z0-9]+\.cloudfront\.net$/.test(host) ||
    new RegExp(
      `^[a-z0-9]+\\.execute-api\\.${region.replace(/[^a-z0-9-]/g, '')}\\.amazonaws\\.com$`,
    ).test(host)
  );
}

/** A smoke path is a path: it starts with one slash and cannot name another host. */
export function isSafePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 200) return false;
  if (/[\\\s@#]/.test(path) || path.includes('..')) return false;
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) < 0x20 || path.charCodeAt(index) === 0x7f) return false;
  }
  return true;
}

async function drain(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  const reader = body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return;
    }
  }
}

async function request(
  start: URL,
  region: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  clock: () => number,
): Promise<{ statusCode?: number; latencyMs?: number; failure?: string }> {
  let url = start;
  const began = clock();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(url.href, {
        redirect: 'manual',
        signal: controller.signal,
        method: 'GET',
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) return { statusCode: response.status, failure: 'redirect' };
        const next = new URL(location, url);
        if (next.hostname !== url.hostname || !isHeroEndpoint(next, region)) {
          return { statusCode: response.status, failure: 'redirect-off-host' };
        }
        url = next;
        continue;
      }
      await drain(response.body);
      return { statusCode: response.status, latencyMs: clock() - began };
    } catch {
      return { failure: controller.signal.aborted ? 'timeout' : 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }
  return { failure: 'too-many-redirects' };
}

const statusOf = (checks: readonly HealthCheck[]): HealthStatus => {
  const ran = checks.filter((c) => c.status !== 'skipped');
  if (ran.length === 0) return 'unknown';
  const passed = ran.filter((c) => c.status === 'passed').length;
  return passed === ran.length ? 'healthy' : passed === 0 ? 'down' : 'degraded';
};

const WORST: readonly HealthStatus[] = ['down', 'degraded', 'unknown', 'healthy'];

/**
 * Looks at the deployment and reports what it saw: whether the stack is in a finished state,
 * whether each public address answers, and whether the smoke paths the Hero Spec named answer
 * well. It claims nothing a check did not show.
 */
export function createHealthChecker(options: HealthOptions): NonNullable<CloudProvider['health']> {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const clock = options.clock ?? (() => Date.now());

  return async (req: ProviderHealthRequest): Promise<Health> => {
    const checks: HealthCheck[] = [];
    const byComponent = new Map<string, HealthCheck[]>();
    const add = (component: string, check: HealthCheck): void => {
      checks.push(check);
      byComponent.set(component, [...(byComponent.get(component) ?? []), check]);
    };

    // resource-state: the provider says the stack is finished, not failed or rolling back.
    let stackStatus: string;
    try {
      const result = await options.cloudFormation.send(
        new DescribeStacksCommand({ StackName: req.deploymentId }),
      );
      stackStatus = result.Stacks?.[0]?.StackStatus ?? 'UNKNOWN';
    } catch {
      stackStatus = 'UNREACHABLE';
    }
    const stackOk = stackStatus === 'CREATE_COMPLETE' || stackStatus === 'UPDATE_COMPLETE';
    add('stack', {
      id: 'stack.resource-state',
      component: 'stack',
      kind: 'resource-state',
      code: 'health.resource-state',
      status: stackOk ? 'passed' : 'failed',
      target: stackStatus,
    });

    const origins = new Map<string, URL>();
    for (const endpoint of req.endpoints) {
      if (endpoint.kind !== 'url') continue;
      let url: URL;
      try {
        url = new URL(endpoint.value);
      } catch {
        continue;
      }
      if (!isHeroEndpoint(url, req.region)) {
        add(endpoint.label, {
          id: `${endpoint.label}.reachability`,
          component: endpoint.label,
          kind: 'reachability',
          code: 'health.reachability',
          status: 'skipped',
          target: url.hostname,
        });
        continue;
      }
      origins.set(endpoint.label, url);
      const seen = await request(new URL('/', url), req.region, fetchImpl, timeoutMs, clock);
      const good =
        seen.statusCode !== undefined && seen.statusCode < 500 && seen.failure === undefined;
      add(endpoint.label, {
        id: `${endpoint.label}.reachability`,
        component: endpoint.label,
        kind: 'reachability',
        code: good
          ? 'health.reachability'
          : `health.reachability.${seen.failure ?? 'server-error'}`,
        status: good ? 'passed' : 'failed',
        target: url.hostname,
        observed: {
          ...(seen.statusCode === undefined ? {} : { statusCode: seen.statusCode }),
          ...(seen.latencyMs === undefined ? {} : { latencyMs: seen.latencyMs }),
        },
      });
    }

    for (const component of req.components) {
      if (component.healthPath === undefined) continue;
      const origin = [...origins.values()][0];
      const safe = isSafePath(component.healthPath);
      const label = component.id;
      if (origin === undefined || !safe) {
        add(label, {
          id: `${label}.smoke`,
          component: label,
          kind: 'smoke',
          code: 'health.smoke',
          status: 'skipped',
          target: safe ? undefined : 'invalid-path',
        });
        continue;
      }
      const target = new URL(component.healthPath, origin);
      const seen = await request(target, req.region, fetchImpl, timeoutMs, clock);
      const good =
        seen.statusCode !== undefined && seen.statusCode < 400 && seen.failure === undefined;
      add(label, {
        id: `${label}.smoke`,
        component: label,
        kind: 'smoke',
        code: good ? 'health.smoke' : `health.smoke.${seen.failure ?? 'bad-status'}`,
        status: good ? 'passed' : 'failed',
        target: component.healthPath,
        observed: {
          ...(seen.statusCode === undefined ? {} : { statusCode: seen.statusCode }),
          ...(seen.latencyMs === undefined ? {} : { latencyMs: seen.latencyMs }),
        },
      });
    }

    const components: ComponentHealth[] = [...byComponent].map(([component, list]) => ({
      component,
      status: statusOf(list),
      checks: list.map((c) => c.id),
    }));
    const overall =
      WORST.find((status) => components.some((c) => c.status === status)) ?? 'unknown';
    return { status: overall, checkedAt: req.now().toISOString(), components, checks };
  };
}

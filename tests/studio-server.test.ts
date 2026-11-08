import { request as httpRequest } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CloudProvider, Health } from '@hero-cloud/core';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { createHero } from '@hero-cloud/sdk';
import { createLocalServer } from '@hero-cloud/server';
import type { LocalServer } from '@hero-cloud/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SPA = resolve(import.meta.dirname, '..', 'examples', 'spa');
const ACCOUNT = '123456789012';

const healthy: Health = {
  status: 'healthy',
  checkedAt: '2026-01-01T00:00:00.000Z',
  components: [],
  checks: [],
};

let applied = 0;
let temp: string;
let server: LocalServer;

function engine() {
  const real = createAwsProvider();
  const cloud: CloudProvider = {
    id: 'aws',
    describe: (r) => real.describe(r),
    identity: () => Promise.resolve({ account: ACCOUNT, principal: 'arn:test', kind: 'role' }),
    apply: () => {
      applied += 1;
      return Promise.resolve({
        endpoints: [
          { kind: 'url', label: 'website', value: 'https://d1.cloudfront.net', public: true },
        ],
        resources: [],
        sensitiveOutputs: [],
        links: [],
      });
    },
    destroy: () =>
      Promise.resolve({ endpoints: [], resources: [], sensitiveOutputs: [], links: [] }),
    health: () => Promise.resolve(healthy),
  };
  return createHero({ cloud });
}

/** A browser stand-in: keeps the cookie and the anti-forgery token the way a page would. */
async function browser(s: LocalServer) {
  const entry = await fetch(s.url, { redirect: 'manual' });
  const cookie = (entry.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${s.origin}${path}`, { headers: { cookie, ...headers } });
  const { csrf } = (await (await get('/api/session')).json()) as { csrf: string };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${s.origin}${path}`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        origin: s.origin,
        'x-hero-csrf': csrf,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { entry, cookie, csrf, get, post };
}

beforeEach(async () => {
  applied = 0;
  temp = await mkdtemp(join(tmpdir(), 'hero-studio-'));
  const assets = join(temp, 'assets');
  await import('node:fs/promises').then((fs) => fs.mkdir(assets));
  await writeFile(join(assets, 'index.html'), '<!doctype html><title>t</title>');
  await writeFile(join(assets, 'app.js'), 'export {};');
  await writeFile(join(assets, 'app.css'), 'body{}');
  server = await createLocalServer({
    hero: engine(),
    roots: [resolve(import.meta.dirname, '..', 'examples')],
    uploadsDirectory: join(temp, 'uploads'),
    assetsDirectory: assets,
    planDefaults: { offline: true },
  });
});

afterEach(async () => {
  await server.close();
  await rm(temp, { recursive: true, force: true });
});

describe('who can talk to the local server', () => {
  it('listens on the loopback address only', () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('turns away a visitor without a session', async () => {
    expect((await fetch(`${server.origin}/`)).status).toBe(401);
    expect((await fetch(`${server.origin}/api/session`)).status).toBe(401);
  });

  it('turns away a request that names another host (DNS rebinding)', async () => {
    const status = await new Promise<number>((done, fail) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: server.port, path: '/', headers: { host: 'evil.example' } },
        (response) => {
          response.resume();
          done(response.statusCode ?? 0);
        },
      );
      request.on('error', fail);
      request.end();
    });
    expect(status).toBe(421);
  });

  it('exchanges the one-time code for an HttpOnly, SameSite=Strict cookie, once', async () => {
    const first = await fetch(server.url, { redirect: 'manual' });
    expect(first.status).toBe(303);
    const cookie = first.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(first.headers.get('location')).toBe('/');
    const second = await fetch(server.url, { redirect: 'manual' });
    expect(second.status).toBe(403);
  });

  it('refuses a wrong code and an expired code', async () => {
    const wrong = await fetch(`${server.origin}/?code=nope`, { redirect: 'manual' });
    expect(wrong.status).toBe(403);
    const short = await createLocalServer({
      hero: engine(),
      roots: [],
      uploadsDirectory: join(temp, 'u2'),
      assetsDirectory: join(temp, 'assets'),
      codeTtlMs: -1,
    });
    try {
      expect((await fetch(short.url, { redirect: 'manual' })).status).toBe(403);
    } finally {
      await short.close();
    }
  });

  it('never sends permissive CORS headers and sets strict security headers', async () => {
    const b = await browser(server);
    const response = await b.get('/', { origin: 'https://evil.example' });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(response.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses writes without the anti-forgery header or from another origin', async () => {
    const b = await browser(server);
    const noToken = await b.post('/api/analyze', { path: SPA }, { 'x-hero-csrf': 'wrong' });
    expect(noToken.status).toBe(400);
    const crossSite = await b.post(
      '/api/analyze',
      { path: SPA },
      { origin: 'https://evil.example' },
    );
    expect(crossSite.status).toBe(400);
    const missingOrigin = await b.post('/api/analyze', { path: SPA }, { origin: '' });
    expect(missingOrigin.status).toBe(400);
  });

  it('serves only the three Studio files', async () => {
    const b = await browser(server);
    expect((await b.get('/')).status).toBe(200);
    expect((await b.get('/app.js')).status).toBe(200);
    expect((await b.get('/app.css')).status).toBe(200);
    expect((await b.get('/../package.json')).status).toBe(404);
    expect((await b.get('/index.html')).status).toBe(404);
  });
});

describe('what the page may ask for', () => {
  it('refuses a folder outside the allowed roots and a remote address', async () => {
    const b = await browser(server);
    const outside = await b.post('/api/analyze', { path: tmpdir() });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { error: { code: string } }).error.code).toBe(
      'source.unsafe-path',
    );
    const remote = await b.post('/api/analyze', { path: 'https://github.com/a/b' });
    expect(remote.status).toBe(400);
  });

  it('refuses an upload that is not a ZIP and keeps nothing', async () => {
    const b = await browser(server);
    const response = await fetch(`${server.origin}/api/upload`, {
      method: 'POST',
      headers: { cookie: b.cookie, origin: server.origin, 'x-hero-csrf': b.csrf },
      body: 'not a zip at all',
    });
    expect(response.status).toBe(400);
    const left = await readdir(join(temp, 'uploads')).catch(() => []);
    expect(left).toEqual([]);
  });

  it('accepts a ZIP upload and refuses one that is too large', async () => {
    const small = await createLocalServer({
      hero: engine(),
      roots: [],
      uploadsDirectory: join(temp, 'u3'),
      assetsDirectory: join(temp, 'assets'),
      maxUploadBytes: 10,
    });
    try {
      const b = await browser(small);
      const response = await fetch(`${small.origin}/api/upload`, {
        method: 'POST',
        headers: { cookie: b.cookie, origin: small.origin, 'x-hero-csrf': b.csrf },
        body: Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)]),
      });
      expect(response.status).toBe(400);
      expect(await readdir(join(temp, 'u3'))).toEqual([]);
    } finally {
      await small.close();
    }
    const b = await browser(server);
    const ok = await fetch(`${server.origin}/api/upload`, {
      method: 'POST',
      headers: { cookie: b.cookie, origin: server.origin, 'x-hero-csrf': b.csrf },
      body: Buffer.concat([Buffer.from('PK\x05\x06'), Buffer.alloc(18)]),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { uploadId: string }).uploadId).toMatch(/^up_[0-9a-f]{16}$/);
  });

  it('answers in the language and at the level asked for', async () => {
    const b = await browser(server);
    const es = (await (await b.get('/api/text?locale=es&level=simple')).json()) as {
      messages: Record<string, string>;
    };
    const en = (await (await b.get('/api/text?locale=en&level=simple')).json()) as {
      messages: Record<string, string>;
    };
    expect(es.messages.title).toBe('Hero Cloud Studio');
    expect(es.messages['approve.button']).toBe('Aprobar y desplegar');
    expect(en.messages['approve.button']).toBe('Approve and deploy');
  });
});

describe('approval from the page', () => {
  async function planned() {
    const b = await browser(server);
    const analysis = (await (await b.post('/api/analyze', { path: SPA })).json()) as {
      analysisId: string;
    };
    const plan = (await (
      await b.post('/api/plan', { analysisId: analysis.analysisId })
    ).json()) as {
      planId: string;
      digest: string;
      blocked: boolean;
      view: { sections: unknown[] };
    };
    return { b, plan };
  }

  it('reads, plans, and deploys only after the person confirms the exact plan', async () => {
    const { b, plan } = await planned();
    expect(plan.blocked).toBe(false);
    expect(plan.view.sections.length).toBeGreaterThan(0);

    const unconfirmed = await b.post('/api/deploy', {
      planId: plan.planId,
      approvedDigest: plan.digest,
    });
    expect(unconfirmed.status).toBe(400);

    const other = await b.post('/api/deploy', {
      planId: plan.planId,
      approvedDigest: 'sha256:other',
      confirmed: true,
    });
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe(
      'approval.digest-mismatch',
    );
    expect(applied).toBe(0);

    const started = await b.post('/api/deploy', {
      planId: plan.planId,
      approvedDigest: plan.digest,
      confirmed: true,
      email: 'me@example.com',
    });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    const events = await (await b.get(`/api/runs/${runId}/events`)).text();
    expect(events).toMatch(/"type":"end"/);
    const status = (await (await b.get(`/api/runs/${runId}`)).json()) as {
      state: string;
      deploymentId: string;
    };
    expect(status.state).toBe('succeeded');
    expect(applied).toBe(1);

    const health = await b.post('/api/health', { deploymentId: status.deploymentId });
    expect(health.status).toBe(200);
  });

  it('refuses a plan the engine did not produce', async () => {
    const b = await browser(server);
    const response = await b.post('/api/deploy', {
      planId: 'plan_fabricated',
      approvedDigest: 'sha256:x',
      confirmed: true,
    });
    expect(response.status).toBe(404);
    expect(applied).toBe(0);
  });
});

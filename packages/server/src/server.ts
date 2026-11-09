import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { audienceLevels, createPresenter, studioCodes } from '@hero-cloud/presentation';
import type { AudienceLevel, RenderOptions } from '@hero-cloud/presentation';
import { BUDGET_EMAIL_INPUT, HeroError, approvalFromChallenge } from '@hero-cloud/sdk';
import type {
  Analysis,
  DeploymentPlan,
  DeploymentResult,
  Hero,
  HeroEvent,
  PlanOptions,
} from '@hero-cloud/sdk';
import { parseCookies, readJson, send, sendJson } from './http.js';
import { createRootGuard } from './roots.js';

export interface LocalServerOptions {
  readonly hero: Hero;
  /** Folders (and ZIP files inside them) the browser may point Hero at. */
  readonly roots: readonly string[];
  /** Where uploaded ZIP files wait. Private to the owner. */
  readonly uploadsDirectory: string;
  /** Where Studio's built files are: `index.html`, `app.js`, and `app.css`. */
  readonly assetsDirectory: string;
  readonly version?: string;
  readonly defaultLevel?: AudienceLevel;
  readonly defaultLocale?: string;
  readonly planDefaults?: PlanOptions;
  /** 0 picks a free port. */
  readonly port?: number;
  /** How long the first-visit code stays valid. */
  readonly codeTtlMs?: number;
  readonly maxUploadBytes?: number;
}

export interface LocalServer {
  /** The address to open: it carries the one-time code, which works once. */
  readonly url: string;
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

const ASSETS: Readonly<Record<string, { file: string; type: string }>> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/hero-cloud-logo.gif': { file: 'hero-cloud-logo.gif', type: 'image/gif' },
};

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const PLAN_ID = /^[\w.:-]{1,128}$/;
const DEPLOYMENT_ID = /^[\w.:-]{1,128}$/;
const NAME = /^[A-Za-z0-9_]{1,64}$/;
const MAX_REMEMBERED = 50;

type RunState = 'running' | 'succeeded' | 'failed';

interface Run {
  readonly id: string;
  readonly render: RenderOptions;
  state: RunState;
  readonly events: object[];
  readonly watchers: Set<(event: object) => void>;
  result?: DeploymentResult;
  deploymentId?: string;
  error?: { code: string; message: string };
}

function same(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= MAX_REMEMBERED) map.delete(map.keys().next().value as string);
  map.set(key, value);
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined;

/**
 * The local server behind Studio. It is a door like the CLI: it holds no planning or AWS logic,
 * only the engine's SDK and the presenter's words. It listens on the loopback address only, hands
 * the page to the first browser that presents a one-time code, and from then on trusts nothing but
 * that browser's cookie and a matching anti-forgery header. Plans and approvals cross to the page
 * as ids and digests; the approval itself is created here, only when the person confirms.
 */
export async function createLocalServer(options: LocalServerOptions): Promise<LocalServer> {
  const { hero } = options;
  const presenter = createPresenter();
  const guard = await createRootGuard([...options.roots, options.uploadsDirectory]);
  const maxUpload = options.maxUploadBytes ?? 200_000_000;
  const code = randomBytes(24).toString('base64url');
  const codeExpires = Date.now() + (options.codeTtlMs ?? 10 * 60_000);
  let codeUsed = false;
  let session: { token: string; csrf: string } | undefined;
  let origin = '';
  let hosts: readonly string[] = [];

  const analyses = new Map<string, Analysis>();
  const plans = new Map<string, DeploymentPlan>();
  const runs = new Map<string, Run>();
  let active: Run | undefined;

  const render = (body: Record<string, unknown>): RenderOptions => {
    const level = body.level;
    const locale = body.locale;
    return {
      audience: audienceLevels.includes(level as AudienceLevel)
        ? (level as AudienceLevel)
        : (options.defaultLevel ?? 'simple'),
      locale:
        typeof locale === 'string' && LOCALE.test(locale)
          ? locale
          : (options.defaultLocale ?? 'en'),
    };
  };

  const unsafe = (reason: string): HeroError => new HeroError('usage', { params: { reason } });

  const onEvent = (event: HeroEvent): void => {
    const run = active;
    if (run === undefined) return;
    const label =
      event.type === 'phase' && event.status === 'started'
        ? presenter.text(`cli.progress.${event.phase}`, run.render)
        : undefined;
    const shaped = label === undefined || label.startsWith('cli.') ? event : { ...event, label };
    run.events.push(shaped);
    for (const watcher of run.watchers) watcher(shaped);
  };
  const unsubscribe = hero.subscribe(onEvent);

  const finish = (run: Run, patch: Partial<Run>): void => {
    Object.assign(run, patch);
    const end = { type: 'end', state: run.state };
    run.events.push(end);
    for (const watcher of run.watchers) watcher(end);
    run.watchers.clear();
    if (active === run) active = undefined;
  };

  const startDeploy = (
    plan: DeploymentPlan,
    r: RenderOptions,
    inputs: Record<string, string>,
    secrets: Record<string, string>,
  ): Run => {
    const run: Run = {
      id: `run_${randomBytes(6).toString('hex')}`,
      render: r,
      state: 'running',
      events: [],
      watchers: new Set(),
    };
    remember(runs, run.id, run);
    active = run;
    void (async () => {
      try {
        const challenge = await hero.requestApproval(plan);
        const approval = approvalFromChallenge(challenge, 'studio');
        const result = await hero.deploy(plan, approval, { inputs, secrets });
        finish(run, {
          state: result.status === 'succeeded' ? 'succeeded' : 'failed',
          result,
          deploymentId: result.deploymentId,
        });
      } catch (error) {
        const { code: errorCode, message } = presenter.describeError(error, r);
        finish(run, { state: 'failed', error: { code: errorCode, message } });
      }
    })();
    return run;
  };

  const authorize = (request: IncomingMessage): boolean => {
    if (session === undefined) return false;
    const cookie = parseCookies(request.headers.cookie).get('hero_session');
    return cookie !== undefined && same(cookie, session.token);
  };

  const guardedWrite = (request: IncomingMessage): void => {
    const header = request.headers['x-hero-csrf'];
    if (session === undefined || typeof header !== 'string' || !same(header, session.csrf)) {
      throw new HeroError('usage', { params: { reason: 'anti-forgery' } });
    }
    // Browsers always send Origin on cross-site and on same-origin writes.
    if (request.headers.origin !== origin) {
      throw new HeroError('usage', { params: { reason: 'origin' } });
    }
  };

  const sourceOf = async (body: Record<string, unknown>) => {
    const uploadId = text(body.uploadId, 64);
    if (uploadId !== undefined) {
      if (!/^up_[0-9a-f]{16}$/.test(uploadId)) throw unsafe('upload-id');
      return guard.resolve(join(options.uploadsDirectory, `${uploadId}.zip`));
    }
    const path = text(body.path, 1024);
    if (path === undefined || path === '') throw unsafe('path');
    return guard.resolve(path);
  };

  const api = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    url: URL,
  ): Promise<void> => {
    const method = request.method ?? 'GET';
    if (method !== 'GET') guardedWrite(request);

    if (method === 'GET' && path === '/api/session') {
      sendJson(response, 200, {
        csrf: session?.csrf,
        version: options.version ?? '0.0.0',
        level: options.defaultLevel ?? 'simple',
        locale: options.defaultLocale ?? 'en',
      });
      return;
    }
    if (method === 'GET' && path === '/api/text') {
      const r = render({
        level: url.searchParams.get('level'),
        locale: url.searchParams.get('locale'),
      });
      const messages: Record<string, string> = {};
      for (const key of studioCodes) messages[key] = presenter.text(`studio.${key}`, r);
      sendJson(response, 200, { messages });
      return;
    }
    if (method === 'POST' && path === '/api/upload') {
      const id = `up_${randomBytes(8).toString('hex')}`;
      await mkdir(options.uploadsDirectory, { recursive: true, mode: 0o700 });
      const file = join(options.uploadsDirectory, `${id}.zip`);
      const out = createWriteStream(file, { mode: 0o600 });
      let size = 0;
      let head = Buffer.alloc(0);
      try {
        for await (const chunk of request) {
          const buffer = chunk as Buffer;
          size += buffer.length;
          if (size > maxUpload) throw new HeroError('source.too-large');
          if (head.length < 4) head = Buffer.concat([head, buffer]).subarray(0, 4);
          if (!out.write(buffer))
            await new Promise<void>((done) =>
              out.once('drain', () => {
                done();
              }),
            );
        }
        await new Promise<void>((done, fail) =>
          out.end((e?: Error | null) => {
            if (e) fail(e);
            else done();
          }),
        );
        if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) {
          throw new HeroError('source.unsupported');
        }
      } catch (error) {
        out.destroy();
        await rm(file, { force: true });
        throw error;
      }
      sendJson(response, 200, { uploadId: id });
      return;
    }

    const body = method === 'POST' ? await readJson(request) : {};
    const r = render(body);

    if (method === 'POST' && path === '/api/analyze') {
      const source = await sourceOf(body);
      const root = text(body.root, 256);
      const name = text(body.name, 80);
      const analysis = await hero.analyze(
        { kind: source.kind, location: source.location },
        {
          noAi: true,
          ...(root === undefined || root === '' ? {} : { root }),
          ...(name === undefined || name === '' ? {} : { name }),
        },
      );
      const id = `an_${randomBytes(6).toString('hex')}`;
      remember(analyses, id, analysis);
      sendJson(response, 200, {
        analysisId: id,
        view: presenter.analysis(analysis, r),
        questions: analysis.openQuestions.map((q) => ({
          id: q.id,
          options: q.options ?? [],
          label: presenter.text(`question.${q.code}`, r, q.params),
        })),
      });
      return;
    }

    if (method === 'POST' && path === '/api/plan') {
      const analysis = analyses.get(text(body.analysisId, 64) ?? '');
      if (analysis === undefined) throw new HeroError('plan.unknown');
      const answers: Record<string, string> = {};
      if (typeof body.answers === 'object' && body.answers !== null) {
        for (const [key, value] of Object.entries(body.answers)) {
          if (typeof value === 'string' && value.length <= 256) answers[key] = value;
        }
      }
      const name = text(body.name, 80);
      const region = text(body.region, 32);
      const planOptions: PlanOptions = {
        ...options.planDefaults,
        answers,
        ...(name === undefined || name === '' ? {} : { name }),
        ...(region === undefined || region === '' ? {} : { region }),
      };
      let plan: DeploymentPlan;
      let preview = false;
      try {
        plan = await hero.plan(analysis, { ...planOptions, useIdentity: true });
      } catch (error) {
        // Without usable credentials the person still gets to read a plan; it cannot be approved.
        if (!(error instanceof HeroError) || !error.code.startsWith('identity.')) throw error;
        if (error.code === 'identity.root-refused') throw error;
        plan = await hero.plan(analysis, planOptions);
        preview = true;
      }
      remember(plans, plan.id, plan);
      sendJson(response, 200, planBody(plan, r, preview));
      return;
    }

    if (method === 'POST' && path === '/api/destroy-plan') {
      const deploymentId = text(body.deploymentId, 128);
      if (deploymentId === undefined || !DEPLOYMENT_ID.test(deploymentId)) throw unsafe('id');
      const plan = await hero.planDestroy(deploymentId);
      remember(plans, plan.id, plan);
      sendJson(response, 200, planBody(plan, r, false));
      return;
    }

    if (method === 'POST' && path === '/api/deploy') {
      const planId = text(body.planId, 128);
      const plan = planId === undefined || !PLAN_ID.test(planId) ? undefined : plans.get(planId);
      if (plan === undefined) throw new HeroError('plan.unknown');
      // The page proves the person looked at this exact plan and said yes.
      if (body.confirmed !== true) throw new HeroError('usage', { params: { reason: 'confirm' } });
      if (typeof body.approvedDigest !== 'string' || !same(body.approvedDigest, plan.digest)) {
        throw new HeroError('approval.digest-mismatch');
      }
      if (plan.warnings.some((w) => w.severity === 'blocking')) {
        throw new HeroError('plan.blocking-warning');
      }
      if (active !== undefined) throw new HeroError('deployment.locked');
      const inputs: Record<string, string> = {};
      const email = text(body.email, 254);
      if (email !== undefined && email.trim() !== '') inputs[BUDGET_EMAIL_INPUT] = email.trim();
      const secrets: Record<string, string> = {};
      if (typeof body.secrets === 'object' && body.secrets !== null) {
        for (const [key, value] of Object.entries(body.secrets)) {
          const asked = plan.requiredInputs.some((i) => i.kind === 'secret' && i.name === key);
          if (asked && NAME.test(key) && typeof value === 'string' && value !== '') {
            secrets[key] = value;
          }
        }
      }
      const run = startDeploy(plan, r, inputs, secrets);
      sendJson(response, 202, { runId: run.id });
      return;
    }

    if (method === 'POST' && path === '/api/health') {
      const deploymentId = text(body.deploymentId, 128);
      if (deploymentId === undefined || !DEPLOYMENT_ID.test(deploymentId)) throw unsafe('id');
      const health = await hero.health(deploymentId);
      sendJson(response, 200, { view: presenter.health(deploymentId, health, r) });
      return;
    }

    const runMatch = /^\/api\/runs\/(run_[0-9a-f]{12})(\/events)?$/.exec(path);
    if (method === 'GET' && runMatch !== null) {
      const run = runs.get(runMatch[1] ?? '');
      if (run === undefined) throw new HeroError('plan.unknown');
      if (runMatch[2] === undefined) {
        const view = render({
          level: url.searchParams.get('level'),
          locale: url.searchParams.get('locale'),
        });
        sendJson(response, 200, {
          state: run.state,
          view: run.result === undefined ? undefined : presenter.result(run.result, view),
          deploymentId: run.deploymentId,
          destroyed: run.result?.kind === 'removal',
          error: run.error,
        });
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'keep-alive',
      });
      const write = (event: object): void => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
        if ((event as { type?: string }).type === 'end') response.end();
      };
      for (const event of run.events) write(event);
      if (run.state === 'running') {
        run.watchers.add(write);
        response.on('close', () => run.watchers.delete(write));
      }
      return;
    }

    throw new HeroError('plan.unknown');

    function planBody(p: DeploymentPlan, opts: RenderOptions, preview: boolean) {
      return {
        planId: p.id,
        digest: p.digest,
        blocked: preview || p.warnings.some((w) => w.severity === 'blocking'),
        preview,
        destroy: p.intent === 'destroy',
        view: presenter.plan(p, opts),
        inputs: p.requiredInputs.map((i) => ({ name: i.name, kind: i.kind })),
      };
    }
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // A page on another name that points at this address (DNS rebinding) is turned away.
    if (!hosts.includes(request.headers.host ?? '')) {
      send(response, 421, 'Misdirected request', 'text/plain; charset=utf-8');
      return;
    }
    const url = new URL(request.url ?? '/', origin);
    const path = url.pathname;

    const offered = url.searchParams.get('code');
    if (path === '/' && offered !== null) {
      if (codeUsed || Date.now() > codeExpires || !same(offered, code)) {
        send(
          response,
          403,
          'This link was already used or has expired.',
          'text/plain; charset=utf-8',
        );
        return;
      }
      codeUsed = true;
      session = {
        token: randomBytes(32).toString('base64url'),
        csrf: randomBytes(24).toString('base64url'),
      };
      send(response, 303, '', 'text/plain; charset=utf-8', {
        Location: '/',
        'Set-Cookie': `hero_session=${session.token}; HttpOnly; SameSite=Strict; Path=/`,
      });
      return;
    }
    if (!authorize(request)) {
      send(
        response,
        401,
        'Open the address that hero-cloud studio printed.',
        'text/plain; charset=utf-8',
      );
      return;
    }

    try {
      if (path.startsWith('/api/')) {
        await api(request, response, path, url);
        return;
      }
      const asset = ASSETS[path];
      if (asset === undefined || request.method !== 'GET') {
        send(response, 404, 'Not found', 'text/plain; charset=utf-8');
        return;
      }
      const file = await readFile(join(options.assetsDirectory, asset.file)).catch(() => undefined);
      if (file === undefined) {
        send(response, 404, 'Not found', 'text/plain; charset=utf-8');
        return;
      }
      send(response, 200, file, asset.type);
      return;
    } catch (error) {
      const r = render({});
      const { code: errorCode, message, params } = presenter.describeError(error, r);
      const status =
        errorCode === 'deployment.locked'
          ? 409
          : errorCode === 'plan.unknown'
            ? 404
            : errorCode === 'internal.unexpected' || errorCode === 'unknown'
              ? 500
              : 400;
      if (response.headersSent) return void response.end();
      sendJson(response, status, { error: { code: errorCode, message, params } });
      return;
    }
  };

  const server: Server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, 'Error', 'text/plain; charset=utf-8');
      else response.end();
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${String(port)}`;
  hosts = [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`];

  return {
    url: `${origin}/?code=${code}`,
    origin,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        unsubscribe();
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

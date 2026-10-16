import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from '@hero-cloud/cli';
import type { CliIo } from '@hero-cloud/cli';
import { approvalFromChallenge } from '@hero-cloud/core';
import type { CloudProvider } from '@hero-cloud/core';
import { FileApprovalInbox } from '@hero-cloud/mcp';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { createHero } from '@hero-cloud/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const examples = resolve(import.meta.dirname, '..', 'examples');
const ACCOUNT = '123456789012';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

async function world() {
  const state = await mkdtemp(join(tmpdir(), 'hero-approve-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const inbox = new FileApprovalInbox(join(state, 'approvals'));
  const real = createAwsProvider();
  const cloud: CloudProvider = {
    id: 'aws',
    describe: (r) => real.describe(r),
    identity: () => Promise.resolve({ account: ACCOUNT, principal: 'arn:test', kind: 'role' }),
  };
  const hero = createHero({ cloud });
  const analysis = await hero.analyze({ kind: 'directory', location: join(examples, 'spa') });
  const plan = await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
  const challenge = await hero.requestApproval(plan);
  const requestId = await inbox.create(plan, challenge);
  return { state, inbox, plan, challenge, requestId, hero };
}

function terminal(w: Awaited<ReturnType<typeof world>>, answers: string[], interactive = true) {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: { write: (t) => (out += t) },
    stderr: { write: (t) => (err += t) },
    env: { LANG: 'en_US.UTF-8' },
    stdoutIsTTY: false,
    stderrIsTTY: false,
    columns: 80,
    version: '0.0.0',
    readFile: () => Promise.reject(new Error('no')),
    resolvePath: (p) => (p.startsWith('/') ? p : join(w.state, p)),
    createHero: () => w.hero,
    stdinIsTTY: interactive,
    ask: () => Promise.resolve(answers.shift() ?? ''),
    openInbox: () => w.inbox,
  };
  return { io, out: () => out, err: () => err };
}

describe('hero-cloud approve', () => {
  it('shows the plan to a person and records an approval only when they say yes', async () => {
    const w = await world();
    const t = terminal(w, ['y', 'me@example.com']);
    expect(await run(['approve', w.requestId, '--state-dir', w.state], t.io)).toBe(0);
    expect(t.out()).toContain('What will be created');
    const [decision] = await w.inbox.collect();
    expect(decision).toMatchObject({
      id: w.requestId,
      approved: true,
      inputs: { BUDGET_ALERT_EMAIL: 'me@example.com' },
    });
    expect(decision?.approval).toEqual(
      approvalFromChallenge(
        w.challenge,
        'mcp-terminal',
        new Date(decision?.approval?.approvedAt ?? 0),
      ),
    );
  });

  it('records a refusal when the person says no', async () => {
    const w = await world();
    const t = terminal(w, ['n']);
    expect(await run(['approve', w.requestId, '--state-dir', w.state], t.io)).toBe(0);
    expect(await w.inbox.status(w.requestId)).toBe('declined');
    expect(t.out()).toContain('Not approved');
  });

  it('cannot be answered by a script or a flag, only by a person at the terminal', async () => {
    const w = await world();
    const script = terminal(w, ['y'], false);
    expect(await run(['approve', w.requestId, '--state-dir', w.state], script.io)).toBe(2);
    const flag = terminal(w, [], false);
    expect(
      await run(
        ['approve', w.requestId, '--approve', w.plan.digest, '--state-dir', w.state],
        flag.io,
      ),
    ).toBe(2);
    expect(await w.inbox.status(w.requestId)).toBe('pending');
  });

  it('refuses a request that does not exist, that has expired, or whose name is not a request name', async () => {
    const w = await world();
    const t = terminal(w, ['y']);
    expect(await run(['approve', 'req_ffffffffffffffff', '--state-dir', w.state], t.io)).toBe(1);
    expect(await run(['approve', '../../etc/passwd'], t.io)).toBe(2);
    expect(await run(['approve'], t.io)).toBe(2);

    const stale = await w.inbox.create(w.plan, {
      ...w.challenge,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const expired = terminal(w, ['y']);
    expect(await run(['approve', stale, '--state-dir', w.state], expired.io)).toBe(1);
    expect(expired.out()).toContain('expired');
    expect(await w.inbox.status(stale)).toBe('pending');
  });
});

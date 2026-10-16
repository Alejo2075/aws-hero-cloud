import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalChallenge, DeploymentPlan } from '@hero-cloud/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { FileApprovalInbox, isRequestId } from './inbox.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function inbox() {
  const root = await mkdtemp(join(tmpdir(), 'hero-inbox-'));
  dirs.push(root);
  const directory = join(root, 'approvals');
  return { directory, inbox: new FileApprovalInbox(directory) };
}
const plan = { id: 'plan_x', digest: 'a'.repeat(64) } as DeploymentPlan;
const challenge = {
  planId: 'plan_x',
  planDigest: 'a'.repeat(64),
  accountId: '123456789012',
  region: 'us-east-1',
  nonce: 'super-secret-nonce',
  issuedAt: '',
  expiresAt: '',
} as ApprovalChallenge;

describe('FileApprovalInbox', () => {
  it('holds a request until a person decides, then reports the decision', async () => {
    const { inbox: box } = await inbox();
    const id = await box.create(plan, challenge);
    expect(isRequestId(id)).toBe(true);
    expect(await box.status(id)).toBe('pending');
    expect(await box.list()).toEqual([id]);
    expect((await box.read(id))?.plan.digest).toBe('a'.repeat(64));
    expect(await box.collect()).toEqual([]);

    await box.decide({ id, approved: true, inputs: { A: 'b' } });
    expect(await box.status(id)).toBe('approved');
    expect((await box.collect()).map((d) => d.id)).toEqual([id]);
    await box.remove(id);
    expect(await box.status(id)).toBe('missing');
    expect(await box.collect()).toEqual([]);
  });

  it('records a refusal as declined', async () => {
    const { inbox: box } = await inbox();
    const id = await box.create(plan, challenge);
    await box.decide({ id, approved: false });
    expect(await box.status(id)).toBe('declined');
  });

  it('keeps the folder and files private to the owner', async () => {
    const { directory, inbox: box } = await inbox();
    const id = await box.create(plan, challenge);
    expect((await stat(directory)).mode & 0o077).toBe(0);
    expect((await stat(join(directory, `${id}.pending.json`))).mode & 0o077).toBe(0);
  });

  it('refuses ids that are not request ids, so a name cannot leave the folder', async () => {
    const { inbox: box } = await inbox();
    for (const bad of ['../x', 'req_zz', 'req_0123456789abcde', '', 'req_0123456789abcdef/../x']) {
      expect(await box.status(bad)).toBe('missing');
      expect(await box.read(bad)).toBeUndefined();
      await expect(box.decide({ id: bad, approved: true })).rejects.toThrow();
    }
  });

  it('ignores damaged and foreign files', async () => {
    const { directory, inbox: box } = await inbox();
    const id = await box.create(plan, challenge);
    await writeFile(join(directory, `${id}.decision.json`), '{broken');
    await writeFile(join(directory, 'notes.txt'), 'x');
    await writeFile(
      join(directory, 'req_0000000000000000.decision.json'),
      JSON.stringify({ id: 'req_1111111111111111', approved: true }),
    );
    expect(await box.collect()).toEqual([]);
    expect(await box.status(id)).toBe('pending');
    expect((await readdir(directory)).length).toBeGreaterThan(0);
    expect(await readFile(join(directory, `${id}.pending.json`), 'utf8')).toContain(
      'super-secret-nonce',
    );
  });
});

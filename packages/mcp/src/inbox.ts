import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Approval, ApprovalChallenge, DeploymentPlan } from '@hero-cloud/sdk';

/**
 * Where a request for a person's approval waits, outside the AI assistant's tools. The assistant
 * can create a request and read its status. Only a person at a terminal (`hero-cloud approve`) can
 * turn it into an approval, and the assistant's tools never see the secret that approval carries.
 */
export interface PendingRequest {
  readonly id: string;
  readonly plan: DeploymentPlan;
  /** Secret: written for the approving terminal and the server only, never returned by a tool. */
  readonly challenge: ApprovalChallenge;
  readonly createdAt: string;
}

export interface Decision {
  readonly id: string;
  readonly approved: boolean;
  readonly approval?: Approval;
  /** Settings (never secrets) the person supplied while approving, such as the alert email. */
  readonly inputs?: Readonly<Record<string, string>>;
}

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'missing';

export interface ApprovalInbox {
  create(plan: DeploymentPlan, challenge: ApprovalChallenge): Promise<string>;
  /** The request a person is asked about. */
  read(id: string): Promise<PendingRequest | undefined>;
  decide(decision: Decision): Promise<void>;
  /** Decisions that have been made and not yet collected. */
  collect(): Promise<readonly Decision[]>;
  status(id: string): Promise<RequestStatus>;
  list(): Promise<readonly string[]>;
  remove(id: string): Promise<void>;
}

const ID = /^req_[0-9a-f]{16}$/;

export const isRequestId = (value: string): boolean => ID.test(value);

async function writePrivate(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** A folder of small private files: `<id>.pending.json` and `<id>.decision.json`. */
export class FileApprovalInbox implements ApprovalInbox {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  #path(id: string, part: 'pending' | 'decision'): string {
    if (!ID.test(id)) throw new Error('not a request id');
    return join(this.#directory, `${id}.${part}.json`);
  }

  async create(plan: DeploymentPlan, challenge: ApprovalChallenge): Promise<string> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const id = `req_${randomBytes(8).toString('hex')}`;
    const request: PendingRequest = { id, plan, challenge, createdAt: new Date().toISOString() };
    await writePrivate(this.#path(id, 'pending'), request);
    return id;
  }

  async read(id: string): Promise<PendingRequest | undefined> {
    if (!ID.test(id)) return undefined;
    return readJson<PendingRequest>(this.#path(id, 'pending'));
  }

  async decide(decision: Decision): Promise<void> {
    await writePrivate(this.#path(decision.id, 'decision'), decision);
  }

  async collect(): Promise<readonly Decision[]> {
    const names = await readdir(this.#directory).catch(() => [] as string[]);
    const decisions: Decision[] = [];
    for (const name of names) {
      const match = /^(req_[0-9a-f]{16})\.decision\.json$/.exec(name);
      if (match?.[1] === undefined) continue;
      const decision = await readJson<Decision>(this.#path(match[1], 'decision'));
      if (decision?.id === match[1]) decisions.push(decision);
    }
    return decisions;
  }

  async status(id: string): Promise<RequestStatus> {
    if (!ID.test(id)) return 'missing';
    const decision = await readJson<Decision>(this.#path(id, 'decision'));
    if (decision !== undefined) return decision.approved ? 'approved' : 'declined';
    return (await this.read(id)) === undefined ? 'missing' : 'pending';
  }

  async list(): Promise<readonly string[]> {
    const names = await readdir(this.#directory).catch(() => [] as string[]);
    return names
      .map((n) => /^(req_[0-9a-f]{16})\.pending\.json$/.exec(n)?.[1])
      .filter((id): id is string => id !== undefined)
      .sort();
  }

  async remove(id: string): Promise<void> {
    await rm(this.#path(id, 'decision'), { force: true });
    await rm(this.#path(id, 'pending'), { force: true });
  }
}

import { digestsEqual, sha256Hex } from '@hero-cloud/shared';
import { randomBytes } from 'node:crypto';
import { heroError } from './errors.js';
import type { DeploymentPlan } from './plan.js';

/**
 * Approval is the security boundary (D2). It is not a flag a caller can set:
 *
 * 1. The engine issues a one-time **challenge** for one sealed plan and keeps only a hash of its
 *    secret nonce.
 * 2. A door shows the plan to a person. Only when the person agrees does the door turn the
 *    challenge into an **approval**.
 * 3. `deploy` accepts an approval only if it matches a live, unused challenge for that exact plan
 *    digest, account, and region.
 *
 * A client that fabricates a plan, guesses a digest, or replays an old approval is refused. The
 * nonce travels from the engine to the door that talks to the person, and never to an AI agent.
 */

/** What the engine issues. The nonce is secret: hand it only to the door facing the person. */
export interface ApprovalChallenge {
  readonly planId: string;
  readonly planDigest: string;
  readonly accountId: string;
  readonly region: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** Proof that a person approved one specific plan. */
export interface Approval {
  readonly planId: string;
  /** Must equal `DeploymentPlan.digest`. */
  readonly planDigest: string;
  readonly accountId: string;
  readonly region: string;
  readonly nonce: string;
  /** The interface that collected the decision, e.g. `cli`, `mcp-terminal`, `host-app`. */
  readonly channel: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

/** The host application supplies this. It decides how a person sees and accepts a plan. */
export interface ApprovalHandler {
  /** Resolves with an approval only if a person agreed. `null` means they declined. */
  request(plan: DeploymentPlan, challenge: ApprovalChallenge): Promise<Approval | null>;
}

/** Stored form of a challenge: the nonce is kept only as a hash. */
export interface StoredChallenge {
  readonly planId: string;
  readonly planDigest: string;
  readonly accountId: string;
  readonly region: string;
  readonly nonceHash: string;
  readonly expiresAt: string;
}

/** Where live challenges are kept. `take` must be atomic: it returns a challenge at most once. */
export interface ChallengeStore {
  put(challenge: StoredChallenge): Promise<void>;
  take(nonceHash: string): Promise<StoredChallenge | undefined>;
}

export class InMemoryChallengeStore implements ChallengeStore {
  readonly #challenges = new Map<string, StoredChallenge>();

  put(challenge: StoredChallenge): Promise<void> {
    this.#challenges.set(challenge.nonceHash, challenge);
    return Promise.resolve();
  }

  take(nonceHash: string): Promise<StoredChallenge | undefined> {
    const found = this.#challenges.get(nonceHash);
    this.#challenges.delete(nonceHash);
    return Promise.resolve(found);
  }
}

export interface ApprovalClock {
  now(): Date;
}

export interface ApprovalServiceOptions {
  readonly store?: ChallengeStore;
  readonly clock?: ApprovalClock;
  /** How long a challenge and the approval made from it stay valid. Default 15 minutes. */
  readonly ttlMs?: number;
  readonly randomNonce?: () => string;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/** Issues challenges and verifies approvals. One instance per engine. */
export class ApprovalService {
  readonly #store: ChallengeStore;
  readonly #clock: ApprovalClock;
  readonly #ttlMs: number;
  readonly #randomNonce: () => string;

  constructor(options: ApprovalServiceOptions = {}) {
    this.#store = options.store ?? new InMemoryChallengeStore();
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#randomNonce = options.randomNonce ?? (() => randomBytes(32).toString('base64url'));
  }

  async issue(plan: DeploymentPlan): Promise<ApprovalChallenge> {
    const issued = this.#clock.now();
    const nonce = this.#randomNonce();
    const expiresAt = new Date(issued.getTime() + this.#ttlMs).toISOString();
    await this.#store.put({
      planId: plan.id,
      planDigest: plan.digest,
      accountId: plan.target.accountId,
      region: plan.target.region,
      nonceHash: sha256Hex(nonce),
      expiresAt,
    });
    return {
      planId: plan.id,
      planDigest: plan.digest,
      accountId: plan.target.accountId,
      region: plan.target.region,
      nonce,
      issuedAt: issued.toISOString(),
      expiresAt,
    };
  }

  /**
   * Checks an approval against a sealed plan and consumes its challenge. Throws a coded error when
   * anything differs; a challenge can be used once, whether or not verification succeeds.
   */
  async consume(plan: DeploymentPlan, approval: Approval): Promise<void> {
    const stored = await this.#store.take(sha256Hex(approval.nonce));
    if (stored === undefined) throw heroError('approval.unknown-challenge');

    if (this.#clock.now().getTime() > Date.parse(stored.expiresAt)) {
      throw heroError('approval.expired');
    }
    if (stored.planId !== plan.id || approval.planId !== plan.id) {
      throw heroError('approval.plan-mismatch');
    }
    if (
      !digestsEqual(stored.planDigest, plan.digest) ||
      !digestsEqual(approval.planDigest, plan.digest)
    ) {
      throw heroError('approval.digest-mismatch');
    }
    if (
      stored.accountId !== plan.target.accountId ||
      approval.accountId !== plan.target.accountId
    ) {
      throw heroError('approval.account-mismatch');
    }
    if (stored.region !== plan.target.region || approval.region !== plan.target.region) {
      throw heroError('approval.region-mismatch');
    }
  }
}

/** Turns a challenge into an approval. Call this only after a person agreed to the plan. */
export function approvalFromChallenge(
  challenge: ApprovalChallenge,
  channel: string,
  now: Date = new Date(),
): Approval {
  return {
    planId: challenge.planId,
    planDigest: challenge.planDigest,
    accountId: challenge.accountId,
    region: challenge.region,
    nonce: challenge.nonce,
    channel,
    approvedAt: now.toISOString(),
    expiresAt: challenge.expiresAt,
  };
}

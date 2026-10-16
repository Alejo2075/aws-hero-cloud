import type { HeroEvent } from '@hero-cloud/core';

/** The slice of a CDK Toolkit message Hero reads. Structural, so tests need no CDK. */
export interface ToolkitMessage {
  readonly code?: string;
  readonly level?: string;
  readonly message?: string;
  readonly defaultResponse?: unknown;
}

/**
 * The confirmation requests of the CDK Toolkit that an approval can cover:
 * `CDK_TOOLKIT_I5060` asks whether to deploy changes to IAM and security groups. The approved
 * plan already lists every such resource, so approving the plan answers it. Every other request
 * (`CDK_TOOLKIT_I5050` and anything new in a later toolkit version) is refused until Hero
 * knowingly adds it here.
 */
const COVERED_BY_APPROVAL: ReadonlySet<string> = new Set(['CDK_TOOLKIT_I5060']);

export interface GuardOptions {
  /** True once the plan being applied was approved. A guard created without it refuses everything. */
  readonly approved: boolean;
  readonly emit?: (event: HeroEvent) => void;
  /** Called with the code of each request that was refused, for the audit trail. */
  readonly onRefused?: (code: string) => void;
  readonly now?: () => Date;
}

/**
 * The Toolkit's door to the outside world. It never asks anyone anything: a confirmation is
 * answered `true` only when the approved plan covers it, otherwise `false`, so the toolkit stops.
 * Messages are turned into coded notices without their text, because toolkit text can echo
 * template values.
 */
export function createGuardedIoHost(options: GuardOptions): {
  notify(message: ToolkitMessage): Promise<void>;
  requestResponse<T>(message: ToolkitMessage & { defaultResponse: T }): Promise<T>;
} {
  return {
    notify(message) {
      if (message.code !== undefined && message.level !== 'debug' && message.level !== 'trace') {
        options.emit?.({
          type: 'notice',
          level: message.level === 'error' || message.level === 'warn' ? 'warning' : 'info',
          code: `toolkit.${message.code}`,
        });
      }
      return Promise.resolve();
    },
    requestResponse<T>(message: ToolkitMessage & { defaultResponse: T }): Promise<T> {
      const code = message.code ?? 'unknown';
      if (typeof message.defaultResponse !== 'boolean') {
        // Not a yes/no confirmation: the toolkit's own default is the only safe answer.
        return Promise.resolve(message.defaultResponse);
      }
      const allowed = options.approved && COVERED_BY_APPROVAL.has(code);
      if (!allowed) options.onRefused?.(code);
      return Promise.resolve(allowed as T);
    },
  };
}

import { heroError } from '@hero-cloud/core';
import type { AIProvider, AIRequest } from '@hero-cloud/core';

export interface AiLimits {
  /** Most calls in one run. */
  readonly maxCalls: number;
  /** Most characters of context sent in one call, after minimizing and redacting. */
  readonly maxInputChars: number;
  /** Most tokens a call may produce. Passed to the model and used to bound the cost. */
  readonly maxOutputTokens: number;
  /** Most money a run may spend, in US dollars. Local models cost nothing and set prices to 0. */
  readonly maxCostUsd: number;
  /** Price per million input and output tokens, in US dollars. */
  readonly pricePerMillionInput: number;
  readonly pricePerMillionOutput: number;
}

export const DEFAULT_LIMITS: AiLimits = {
  maxCalls: 3,
  maxInputChars: 48_000,
  maxOutputTokens: 1_500,
  maxCostUsd: 0.5,
  // Deliberately high, so an unknown model is assumed expensive rather than free.
  pricePerMillionInput: 15,
  pricePerMillionOutput: 75,
};

export interface AiUsage {
  calls: number;
  estimatedInputTokens: number;
  estimatedCostUsd: number;
}

/** About four characters to a token for English and code; rounded up so the estimate is generous. */
const tokensOf = (chars: number): number => Math.ceil(chars / 3.5);

/**
 * Wraps a model so a run can never send more, call more, or spend more than the person allowed.
 * The cost is bounded before each call: the input estimate plus the largest answer allowed.
 */
export function withLimits(
  provider: AIProvider,
  limits: Partial<AiLimits> = {},
): AIProvider & { usage(): Readonly<AiUsage> } {
  const l: AiLimits = { ...DEFAULT_LIMITS, ...limits };
  const usage: AiUsage = { calls: 0, estimatedInputTokens: 0, estimatedCostUsd: 0 };
  return {
    usage: () => ({ ...usage }),
    async generate<T>(request: AIRequest): Promise<T> {
      const chars = JSON.stringify(request.context).length;
      const refuse = (reason: string) => heroError('provider.unavailable', { reason });
      if (usage.calls >= l.maxCalls) throw refuse('ai-call-limit');
      if (chars > l.maxInputChars) throw refuse('ai-input-limit');
      const inputTokens = tokensOf(chars);
      const worstCase =
        (inputTokens * l.pricePerMillionInput + l.maxOutputTokens * l.pricePerMillionOutput) /
        1_000_000;
      if (usage.estimatedCostUsd + worstCase > l.maxCostUsd) throw refuse('ai-cost-limit');
      usage.calls += 1;
      usage.estimatedInputTokens += inputTokens;
      usage.estimatedCostUsd += worstCase;
      return provider.generate<T>(request);
    },
  };
}

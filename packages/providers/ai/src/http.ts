import { heroError } from '@hero-cloud/core';

export type Fetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface HttpOptions {
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
}

/**
 * Posts JSON and returns the parsed answer. Failures become a coded error that names only the
 * status, never the response text or the request: both could hold keys or project content.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions,
): Promise<unknown> {
  const doFetch: Fetch = options.fetch ?? ((u, init) => fetch(u, init));
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? 60_000);
  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw heroError('provider.unavailable', { reason: `ai-http-${String(response.status)}` });
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'HeroError') throw error;
    throw heroError('provider.unavailable', {
      reason: controller.signal.aborted ? 'ai-timeout' : 'ai-unreachable',
    });
  } finally {
    clearTimeout(timer);
  }
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Reads a nested value from an answer without trusting its shape. */
export function dig(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === 'number') current = Array.isArray(current) ? current[key] : undefined;
    else current = object(current)[key];
  }
  return current;
}

/** Parses the text of a model's answer as JSON, or fails with a coded error. */
export function parseAnswer(text: unknown): unknown {
  if (typeof text !== 'string')
    throw heroError('provider.unavailable', { reason: 'ai-bad-answer' });
  try {
    return JSON.parse(text);
  } catch {
    throw heroError('provider.unavailable', { reason: 'ai-bad-answer' });
  }
}

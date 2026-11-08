import type { IncomingMessage, ServerResponse } from 'node:http';
import { HeroError } from '@hero-cloud/sdk';

/** Headers on every response: nothing is cached, framed, sniffed, or loaded from elsewhere. */
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
} as const;

export function send(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
  extra: Readonly<Record<string, string | string[]>> = {},
): void {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  response.end(body);
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

/** Reads a JSON object body of at most `limit` bytes. */
export async function readJson(
  request: IncomingMessage,
  limit = 1_000_000,
): Promise<Record<string, unknown>> {
  const type = request.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new HeroError('usage', { params: { reason: 'expected-json' } });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new HeroError('usage', { params: { reason: 'body-too-large' } });
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HeroError('usage', { params: { reason: 'invalid-json' } });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HeroError('usage', { params: { reason: 'expected-object' } });
  }
  return value as Record<string, unknown>;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

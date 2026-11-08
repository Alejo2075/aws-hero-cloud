export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export class SessionEnded extends Error {}

export class ApiFailure extends Error {
  readonly code: string;
  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
  }
}

let csrf = '';

export async function startSession(): Promise<{ level: string; locale: string }> {
  const response = await fetch('/api/session');
  if (!response.ok) throw new SessionEnded();
  const body = (await response.json()) as { csrf: string; level: string; locale: string };
  csrf = body.csrf;
  return body;
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 421) throw new SessionEnded();
  const body = (await response.json().catch(() => ({}))) as T & { error?: ApiError };
  if (!response.ok) throw new ApiFailure(body.error ?? { code: 'unknown', message: '' });
  return body;
}

export const get = <T>(path: string): Promise<T> => fetch(path).then((r) => parse<T>(r));

export const post = <T>(path: string, body: unknown): Promise<T> =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hero-csrf': csrf },
    body: JSON.stringify(body),
  }).then((r) => parse<T>(r));

export const upload = (file: File): Promise<{ uploadId: string }> =>
  fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/zip', 'x-hero-csrf': csrf },
    body: file,
  }).then((r) => parse<{ uploadId: string }>(r));

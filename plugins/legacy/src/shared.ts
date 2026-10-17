import type { DetectionContext } from '@hero-cloud/plugin-sdk';

/** Plain text of a file, bounded. Everything read from a project is untrusted input. */
export const text = (context: DetectionContext, path: string, max = 256 * 1024) =>
  context.readText(path, max);

const COMMAND = /^[\x20-\x7e]{1,500}$/;
/** A module path such as `shop.wsgi` or `app.main`, never a command. */
export const MODULE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The processes a Procfile declares, as `{ web: "gunicorn app:app" }`. Printable single lines only. */
export function parseProcfile(content: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of (content ?? '').split(/\r?\n/)) {
    const match = /^([a-z][a-z0-9_-]{0,30}):\s*(.+)$/.exec(line.trim());
    const command = match?.[2]?.trim();
    if (match?.[1] !== undefined && command !== undefined && COMMAND.test(command)) {
      result[match[1]] = command;
    }
  }
  return result;
}

/** Package names (lower case, no version) from a requirements-style or manifest text. */
export function wordsOf(content: string | undefined): Set<string> {
  const names = new Set<string>();
  for (const match of (content ?? '').toLowerCase().matchAll(/[a-z0-9][a-z0-9._-]*/g)) {
    names.add(match[0]);
  }
  return names;
}

/** First port written as `:8080`, `port=8080`, or `port: 8080` next to a listen-like word. */
export function portIn(content: string, pattern: RegExp): number | undefined {
  const value = Number(pattern.exec(content)?.[1]);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined;
}

export const HEALTH_ROUTE =
  /['"](\/(?:api\/)?(?:health|healthz|healthcheck|health-check|status|ping|up|ready|actuator\/health))['"]/;

export function safeModule(value: string | undefined): string | undefined {
  return value !== undefined && MODULE.test(value) ? value : undefined;
}
export function safeVariable(value: string | undefined): string | undefined {
  return value !== undefined && VARIABLE.test(value) ? value : undefined;
}

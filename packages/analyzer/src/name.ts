const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/;

/** Turns a raw name (a package name, a folder name) into a valid Hero Spec application name. */
export function toApplicationName(raw: string | undefined, fallback = 'app'): string {
  if (raw === undefined) return fallback;
  const cleaned = raw
    .replace(/^@[^/]+\//, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 63)
    .replace(/[ ._-]+$/, '');
  return APP_NAME.test(cleaned) ? cleaned : fallback;
}

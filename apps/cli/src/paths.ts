import { join } from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Where Hero keeps downloaded public prices. A folder the person chose wins, then the platform's
 * convention for caches. Nothing secret is ever stored here.
 */
export function cacheDirectory(
  env: Environment,
  platform: NodeJS.Platform,
  home: string,
): string | undefined {
  if (env.HERO_CACHE_DIR !== undefined && env.HERO_CACHE_DIR !== '') return env.HERO_CACHE_DIR;
  if (env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME !== '') {
    return join(env.XDG_CACHE_HOME, 'hero-cloud');
  }
  if (home === '') return undefined;
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'hero-cloud');
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    return join(
      local !== undefined && local !== '' ? local : join(home, 'AppData', 'Local'),
      'hero-cloud',
      'Cache',
    );
  }
  return join(home, '.cache', 'hero-cloud');
}

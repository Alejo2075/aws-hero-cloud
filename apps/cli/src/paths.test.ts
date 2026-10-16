import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheDirectory } from './paths.js';

describe('cacheDirectory', () => {
  it('prefers a folder the person chose', () => {
    expect(
      cacheDirectory({ HERO_CACHE_DIR: '/my/cache', XDG_CACHE_HOME: '/xdg' }, 'linux', '/home/a'),
    ).toBe('/my/cache');
  });

  it('then the XDG convention', () => {
    expect(cacheDirectory({ XDG_CACHE_HOME: '/xdg' }, 'linux', '/home/a')).toBe(
      join('/xdg', 'hero-cloud'),
    );
  });

  it.each([
    ['darwin', {}, join('/home/a', 'Library', 'Caches', 'hero-cloud')],
    ['linux', {}, join('/home/a', '.cache', 'hero-cloud')],
    ['win32', { LOCALAPPDATA: 'C:\\Local' }, join('C:\\Local', 'hero-cloud', 'Cache')],
    ['win32', {}, join('/home/a', 'AppData', 'Local', 'hero-cloud', 'Cache')],
  ] as const)('on %s', (platform, env, expected) => {
    expect(cacheDirectory(env, platform, '/home/a')).toBe(expected);
  });

  it('has no cache without a home folder', () => {
    expect(cacheDirectory({}, 'linux', '')).toBeUndefined();
  });

  it('ignores empty settings', () => {
    expect(cacheDirectory({ HERO_CACHE_DIR: '', XDG_CACHE_HOME: '' }, 'linux', '/home/a')).toBe(
      join('/home/a', '.cache', 'hero-cloud'),
    );
  });
});

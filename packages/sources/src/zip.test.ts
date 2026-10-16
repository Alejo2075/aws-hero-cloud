import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import type { ZipOptions, Zippable } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DirectorySource } from './directory.js';
import { DEFAULT_LIMITS } from './policy.js';
import { SAMPLE_APP, makeTempDir, writeTree } from './testing.js';
import { ZipSource } from './zip.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

function zipFromText(files: Readonly<Record<string, string>>, prefix = ''): Zippable {
  return Object.fromEntries(
    Object.entries(files).map(([path, text]) => [`${prefix}${path}`, enc(text)]),
  );
}

/** Writes a ZIP to a temp file and returns its path. */
async function archive(
  entries: Zippable,
  options?: ZipOptions,
  patch?: (zip: Uint8Array) => Uint8Array,
) {
  const { dir, cleanup } = await makeTempDir('hero-zipfile-');
  cleanups.push(cleanup);
  const zipped = zipSync(entries, options);
  const bytes: Uint8Array = patch ? patch(zipped) : zipped;
  const path = join(dir, 'app.zip');
  await writeFile(path, bytes);
  return { path, dir };
}

let tempRoot = '';
beforeEach(async () => {
  const { dir, cleanup } = await makeTempDir('hero-ziproot-');
  tempRoot = dir;
  cleanups.push(cleanup);
});

const temps = (): Promise<string[]> => readdir(tempRoot);

const load = (path: string, limits = DEFAULT_LIMITS) =>
  new ZipSource({ limits, tempRoot }).load({ kind: 'zip', location: path });

const SYMLINK_ATTRS = (0o120777 << 16) >>> 0;

describe('ZipSource: valid archives', () => {
  it('produces the same hash as the same content loaded from a folder', async () => {
    const { path } = await archive(zipFromText(SAMPLE_APP));
    const { dir: folder, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await writeTree(folder, SAMPLE_APP);
    const fromZip = await load(path);
    const fromFolder = await new DirectorySource().load({ kind: 'directory', location: folder });
    expect(fromZip.hash).toBe(fromFolder.hash);
    expect(new TextDecoder().decode(await fromZip.read('src/index.ts'))).toBe(
      'export const answer = 42;\n',
    );
    await fromZip.dispose();
  });

  it('strips a single project root folder, like a GitHub archive', async () => {
    const { path } = await archive(zipFromText(SAMPLE_APP, 'my-app-main/'));
    const { path: flat } = await archive(zipFromText(SAMPLE_APP));
    expect((await load(path)).hash).toBe((await load(flat)).hash);
  });

  it('does not strip a folder that is not a project root', async () => {
    const { path } = await archive(zipFromText({ 'src/a.ts': 'a', 'src/b.ts': 'b' }));
    const snapshot = await load(path);
    expect(snapshot.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('leaves out dependencies, secrets, and macOS metadata, and says so', async () => {
    const { path } = await archive(
      zipFromText({
        ...SAMPLE_APP,
        'node_modules/x/index.js': 'x',
        '.env': 'TOKEN=abc',
        '.env.example': 'TOKEN=',
        '__MACOSX/._index.ts': 'x',
      }),
    );
    const snapshot = await load(path);
    const paths = snapshot.files.map((f) => f.path);
    expect(paths).toContain('.env.example');
    expect(paths).not.toContain('.env');
    expect(snapshot.skipped).toEqual(
      expect.arrayContaining([
        { path: '.env', reason: 'sensitive' },
        { path: 'node_modules', reason: 'ignored' },
        { path: '__MACOSX', reason: 'ignored' },
      ]),
    );
  });

  it('removes its temporary files when disposed', async () => {
    const before = (await temps()).length;
    const { path } = await archive(zipFromText(SAMPLE_APP));
    const snapshot = await load(path);
    expect((await temps()).length).toBe(before + 1);
    await snapshot.dispose();
    expect((await temps()).length).toBe(before);
  });
});

describe('ZipSource: malicious archives are rejected', () => {
  const rejected = async (
    entries: Zippable,
    code: string,
    options?: ZipOptions,
    patch?: (z: Uint8Array) => Uint8Array,
  ) => {
    const { path, dir } = await archive(entries, options, patch);
    const before = await temps();
    await expect(load(path)).rejects.toMatchObject({ name: 'HeroError', code });
    // Nothing is left behind, and nothing was written outside the temporary folder.
    expect(await temps()).toEqual(before);
    return dir;
  };

  it.each([
    ['parent traversal', '../evil.txt'],
    ['deep traversal', 'a/b/../../../evil.txt'],
    ['an absolute path', '/etc/cron.d/evil'],
    ['a Windows drive path', 'C:/Windows/evil.txt'],
    ['a backslash traversal', '..\\..\\evil.txt'],
    ['a backslash separator', 'dir\\file.txt'],
  ])('%s', async (_label, name) => {
    const dir = await rejected(
      { [name]: enc('x'), 'package.json': enc('{}') },
      'source.unsafe-path',
    );
    expect(existsSync(join(dir, '..', 'evil.txt'))).toBe(false);
  });

  it('a symlink entry', async () => {
    await rejected(
      { 'package.json': enc('{}'), link: [enc('/etc/passwd'), { os: 3, attrs: SYMLINK_ATTRS }] },
      'source.unsafe-path',
    );
  });

  it('a device or pipe entry', async () => {
    const fifo = (0o010644 << 16) >>> 0;
    await rejected(
      { 'package.json': enc('{}'), pipe: [enc(''), { os: 3, attrs: fifo }] },
      'source.unsafe-path',
    );
  });

  it('paths that collide on case-insensitive disks', async () => {
    await rejected(
      { 'package.json': enc('{}'), 'Readme.md': enc('a'), 'README.md': enc('b') },
      'source.unsafe-path',
    );
  });

  it('an encrypted entry', async () => {
    const flip = (zip: Uint8Array): Uint8Array => {
      const copy = zip.slice();
      const view = new DataView(copy.buffer);
      for (let i = 0; i + 46 < copy.length; i += 1) {
        if (view.getUint32(i, true) === 0x02014b50)
          view.setUint16(i + 8, view.getUint16(i + 8, true) | 1, true);
      }
      return copy;
    };
    await rejected({ 'package.json': enc('{}') }, 'source.unsupported', undefined, flip);
  });

  it('a decompression bomb', async () => {
    await rejected(
      { 'package.json': enc('{}'), 'zeros.bin': [new Uint8Array(60_000_000), { level: 9 }] },
      'source.too-large',
    );
  });

  it('too many entries', async () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}.txt`, enc('x')]));
    const { path } = await archive(many);
    await expect(load(path, { ...DEFAULT_LIMITS, maxFiles: 10 })).rejects.toMatchObject({
      code: 'source.too-many-files',
    });
  });

  it('a file or total that is too large', async () => {
    const { path } = await archive({ 'a.txt': [new Uint8Array(5000).fill(97), { level: 0 }] });
    await expect(load(path, { ...DEFAULT_LIMITS, maxFileBytes: 1000 })).rejects.toMatchObject({
      code: 'source.too-large',
    });
    await expect(load(path, { ...DEFAULT_LIMITS, maxTotalBytes: 1000 })).rejects.toMatchObject({
      code: 'source.too-large',
    });
  });

  it('a corrupted or truncated archive', async () => {
    const { dir } = await makeTempDir();
    cleanups.push(() => Promise.resolve());
    const path = join(dir, 'broken.zip');
    await writeFile(path, Buffer.from('PK\u0003\u0004 not really a zip'));
    await expect(load(path)).rejects.toMatchObject({ code: 'source.unsupported' });
  });
});

describe('ZipSource: bad locations', () => {
  it('reports a missing file or a directory', async () => {
    await expect(load('/no/such/file.zip')).rejects.toMatchObject({ code: 'source.not-found' });
    const { dir, cleanup } = await makeTempDir();
    cleanups.push(cleanup);
    await expect(load(dir)).rejects.toMatchObject({ code: 'source.not-found' });
  });
});

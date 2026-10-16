import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectorySource } from './directory.js';
import { DEFAULT_LIMITS } from './policy.js';
import { SAMPLE_APP, makeTempDir, writeTree } from './testing.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function project(files: Readonly<Record<string, string>> = SAMPLE_APP): Promise<string> {
  const { dir, cleanup } = await makeTempDir();
  cleanups.push(cleanup);
  await writeTree(dir, files);
  return dir;
}

const load = (dir: string, limits = DEFAULT_LIMITS) =>
  new DirectorySource(limits).load({ kind: 'directory', location: dir });

describe('DirectorySource', () => {
  it('indexes files with sizes and hashes, sorted by path', async () => {
    const snapshot = await load(await project());
    expect(snapshot.files.map((f) => f.path)).toEqual([
      'README.md',
      'package.json',
      'src/index.ts',
      'src/util/helper.ts',
    ]);
    expect(snapshot.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for the same content in different places and orders', async () => {
    const a = await load(await project(SAMPLE_APP));
    const reversed = Object.fromEntries(Object.entries(SAMPLE_APP).reverse());
    const b = await load(await project(reversed));
    expect(a.hash).toBe(b.hash);
  });

  it('changes the hash when content changes', async () => {
    const a = await load(await project(SAMPLE_APP));
    const b = await load(
      await project({ ...SAMPLE_APP, 'src/index.ts': 'export const answer = 43;\n' }),
    );
    expect(a.hash).not.toBe(b.hash);
  });

  it('reads file contents', async () => {
    const snapshot = await load(await project());
    const bytes = await snapshot.read('src/index.ts');
    expect(new TextDecoder().decode(bytes)).toBe('export const answer = 42;\n');
  });

  it('skips dependencies, build output, and secret-looking files, and says so', async () => {
    const dir = await project({
      ...SAMPLE_APP,
      'node_modules/lib/index.js': 'x',
      'dist/out.js': 'x',
      '.env': 'TOKEN=abc123',
      '.env.example': 'TOKEN=',
      'certs/server.pem': '-----BEGIN PRIVATE KEY-----',
    });
    const snapshot = await load(dir);
    const paths = snapshot.files.map((f) => f.path);
    expect(paths).toContain('.env.example');
    expect(paths).not.toContain('.env');
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
    expect(snapshot.skipped).toEqual(
      expect.arrayContaining([
        { path: '.env', reason: 'sensitive' },
        { path: 'certs/server.pem', reason: 'sensitive' },
        { path: 'node_modules', reason: 'ignored' },
        { path: 'dist', reason: 'ignored' },
      ]),
    );
  });

  it('never exposes the content of a secret file', async () => {
    const dir = await project({ ...SAMPLE_APP, '.env': 'TOKEN=abc123' });
    const snapshot = await load(dir);
    await expect(snapshot.read('.env')).rejects.toMatchObject({ code: 'source.unsafe-path' });
    expect(JSON.stringify(snapshot.files)).not.toContain('abc123');
  });

  describe('symlinks', () => {
    it('does not follow a symlink to a file outside the project', async () => {
      const outside = await project({ 'secret.txt': 'top secret' });
      const dir = await project();
      await symlink(join(outside, 'secret.txt'), join(dir, 'link.txt'));
      const snapshot = await load(dir);
      expect(snapshot.files.map((f) => f.path)).not.toContain('link.txt');
      expect(snapshot.skipped).toContainEqual({ path: 'link.txt', reason: 'symlink' });
    });

    it('does not follow a symlinked directory or a loop', async () => {
      const dir = await project();
      await symlink('/etc', join(dir, 'etc-link'));
      await symlink('.', join(dir, 'loop'));
      const snapshot = await load(dir);
      expect(snapshot.skipped).toEqual(
        expect.arrayContaining([
          { path: 'etc-link', reason: 'symlink' },
          { path: 'loop', reason: 'symlink' },
        ]),
      );
      expect(snapshot.files.every((f) => !f.path.startsWith('etc-link'))).toBe(true);
    });

    it('refuses to read a file swapped for a symlink after loading', async () => {
      const outside = await project({ 'secret.txt': 'top secret' });
      const dir = await project();
      const snapshot = await load(dir);
      const { rm } = await import('node:fs/promises');
      await rm(join(dir, 'src', 'index.ts'));
      await symlink(join(outside, 'secret.txt'), join(dir, 'src', 'index.ts'));
      await expect(snapshot.read('src/index.ts')).rejects.toMatchObject({
        code: 'source.unsafe-path',
      });
    });
  });

  it('refuses to read content that changed after loading', async () => {
    const dir = await project();
    const snapshot = await load(dir);
    await writeFile(join(dir, 'src', 'index.ts'), 'export const answer = 99;\n');
    await expect(snapshot.read('src/index.ts')).rejects.toMatchObject({
      code: 'source.unsafe-path',
    });
  });

  it('refuses to read a path that is not in the snapshot', async () => {
    const snapshot = await load(await project());
    await expect(snapshot.read('../etc/passwd')).rejects.toMatchObject({
      code: 'source.unsafe-path',
    });
    await expect(snapshot.read('nope.txt')).rejects.toMatchObject({ code: 'source.unsafe-path' });
  });

  it.skipIf(process.platform === 'win32')('skips named pipes and other special files', async () => {
    const dir = await project();
    execFileSync('mkfifo', [join(dir, 'pipe')]);
    const snapshot = await load(dir);
    expect(snapshot.skipped).toContainEqual({ path: 'pipe', reason: 'special' });
  });

  describe('limits', () => {
    it('rejects too many files', async () => {
      const dir = await project(SAMPLE_APP);
      await expect(load(dir, { ...DEFAULT_LIMITS, maxFiles: 2 })).rejects.toMatchObject({
        code: 'source.too-many-files',
      });
    });

    it('rejects a file that is too large', async () => {
      const dir = await project({ 'big.bin': 'x'.repeat(2000) });
      await expect(load(dir, { ...DEFAULT_LIMITS, maxFileBytes: 1000 })).rejects.toMatchObject({
        code: 'source.too-large',
      });
    });

    it('rejects a project whose total size is too large', async () => {
      const dir = await project({ 'a.txt': 'x'.repeat(600), 'b.txt': 'y'.repeat(600) });
      await expect(load(dir, { ...DEFAULT_LIMITS, maxTotalBytes: 1000 })).rejects.toMatchObject({
        code: 'source.too-large',
      });
    });

    it('rejects a tree that is too deep', async () => {
      const deep = Array.from({ length: 10 }, () => 'd').join('/');
      const dir = await project({ [`${deep}/file.txt`]: 'x' });
      await expect(load(dir, { ...DEFAULT_LIMITS, maxDepth: 5 })).rejects.toMatchObject({
        code: 'source.unsafe-path',
      });
    });

    it('stops when aborted', async () => {
      const dir = await project();
      const controller = new AbortController();
      controller.abort();
      await expect(
        new DirectorySource().load(
          { kind: 'directory', location: dir },
          { signal: controller.signal },
        ),
      ).rejects.toThrow();
    });
  });

  it('reports a missing or non-directory location', async () => {
    await expect(load('/definitely/not/here')).rejects.toMatchObject({ code: 'source.not-found' });
    const dir = await project();
    await mkdir(join(dir, 'empty'));
    const snapshot = await load(join(dir, 'empty'));
    expect(snapshot.files).toEqual([]);
    await expect(load(join(dir, 'package.json'))).rejects.toMatchObject({
      code: 'source.not-found',
    });
  });

  it('disposes safely more than once', async () => {
    const snapshot = await load(await project());
    await snapshot.dispose();
    await expect(snapshot.dispose()).resolves.toBeUndefined();
  });
});

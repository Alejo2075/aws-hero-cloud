import { execFileSync } from 'node:child_process';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectorySource } from './directory.js';
import { GitSource, parseGitLocation } from './git.js';
import { SAMPLE_APP, listTempDirs, makeTempDir, writeTree } from './testing.js';
import { ZipSource } from './zip.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const git = (cwd: string, ...args: string[]): void => {
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
    {
      cwd,
      stdio: 'ignore',
    },
  );
};

/** Creates a local repository with one commit. */
async function repository(files: Readonly<Record<string, string>> = SAMPLE_APP): Promise<string> {
  const { dir, cleanup } = await makeTempDir('hero-repo-');
  cleanups.push(cleanup);
  git(dir, 'init', '-q', '-b', 'main');
  await writeTree(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

// `file` is allowed here only so tests can use local repositories; products never enable it.
const testSource = new GitSource({ allowedSchemes: ['https', 'file'], timeoutMs: 30_000 });
const loadRepo = (dir: string, ref?: string) =>
  testSource.load({ kind: 'git', location: `file://${dir}${ref === undefined ? '' : `#${ref}`}` });

describe('parseGitLocation', () => {
  it('accepts normal HTTPS repositories and refs', () => {
    expect(parseGitLocation('https://github.com/acme/app.git').ref).toBeUndefined();
    expect(parseGitLocation('https://github.com/acme/app#v1.2.0').ref).toBe('v1.2.0');
    expect(parseGitLocation('https://gitlab.com/group/sub/app.git#feature/x').ref).toBe(
      'feature/x',
    );
  });

  it.each([
    ['plain http', 'http://github.com/acme/app'],
    ['the file scheme by default', 'file:///etc'],
    ['ssh', 'ssh://git@github.com/acme/app'],
    ['scp-like syntax', 'git@github.com:acme/app.git'],
    ['credentials in the URL', 'https://user:token@github.com/acme/app'],
    ['a username only', 'https://token@github.com/acme/app'],
    ['localhost', 'https://localhost/acme/app'],
    ['loopback', 'https://127.0.0.1/acme/app'],
    ['a private address', 'https://10.0.0.5/acme/app'],
    ['link-local metadata', 'https://169.254.169.254/latest/meta-data'],
    ['an IPv6 loopback', 'https://[::1]/acme/app'],
    ['a host without a dot', 'https://intranet/acme/app'],
    ['an internal host', 'https://git.corp.internal/acme/app'],
    ['an unusual port', 'https://github.com:8443/acme/app'],
    ['a query string', 'https://github.com/acme/app?x=1'],
    ['too short a path', 'https://github.com/acme'],
    ['an option-looking ref', 'https://github.com/acme/app#--upload-pack=evil'],
    ['a traversal ref', 'https://github.com/acme/app#a..b'],
    ['a ref with spaces', 'https://github.com/acme/app#a b'],
    ['whitespace', 'https://github.com/acme/app .git'],
    ['garbage', 'not a url'],
  ])('refuses %s', (_label, location) => {
    expect(() => parseGitLocation(location)).toThrow(
      expect.objectContaining({ code: 'source.unsupported' }),
    );
  });
});

describe('GitSource', () => {
  it('loads a repository and ignores the .git directory', async () => {
    const snapshot = await loadRepo(await repository());
    expect(snapshot.files.map((f) => f.path)).toEqual([
      'README.md',
      'package.json',
      'src/index.ts',
      'src/util/helper.ts',
    ]);
    await snapshot.dispose();
  });

  it('gives the same hash for the same content as a folder and as a ZIP', async () => {
    const repo = await repository();
    const fromGit = await loadRepo(repo);

    const { dir: folder, cleanup: cleanFolder } = await makeTempDir();
    cleanups.push(cleanFolder);
    await writeTree(folder, SAMPLE_APP);
    const fromFolder = await new DirectorySource().load({ kind: 'directory', location: folder });

    const { dir: zipDir, cleanup: cleanZip } = await makeTempDir();
    cleanups.push(cleanZip);
    const zipPath = join(zipDir, 'app.zip');
    await writeFile(
      zipPath,
      zipSync(
        Object.fromEntries(
          Object.entries(SAMPLE_APP).map(([p, t]) => [p, new TextEncoder().encode(t)]),
        ),
      ),
    );
    const fromZip = await new ZipSource().load({ kind: 'zip', location: zipPath });

    expect(fromGit.hash).toBe(fromFolder.hash);
    expect(fromZip.hash).toBe(fromFolder.hash);
  });

  it('checks out a requested branch', async () => {
    const repo = await repository();
    git(repo, 'checkout', '-q', '-b', 'feature');
    await writeTree(repo, { 'feature.txt': 'only on the branch\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'feature');
    git(repo, 'checkout', '-q', 'main');
    const snapshot = await loadRepo(repo, 'feature');
    expect(snapshot.files.map((f) => f.path)).toContain('feature.txt');
  });

  it('leaves out committed symlinks and says so', async () => {
    const { dir, cleanup } = await makeTempDir('hero-repo-');
    cleanups.push(cleanup);
    git(dir, 'init', '-q', '-b', 'main');
    await writeTree(dir, SAMPLE_APP);
    await symlink('/etc/passwd', join(dir, 'passwd-link'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'with symlink');
    const snapshot = await loadRepo(dir);
    expect(snapshot.files.map((f) => f.path)).not.toContain('passwd-link');
    expect(snapshot.skipped).toContainEqual({ path: 'passwd-link', reason: 'symlink' });
    await expect(snapshot.read('passwd-link')).rejects.toMatchObject({
      code: 'source.unsafe-path',
    });
  });

  it('does not copy hooks from the repository into the checkout', async () => {
    const repo = await repository();
    const marker = join(repo, 'hook-ran');
    await writeTree(repo, {});
    await writeFile(
      join(repo, '.git', 'hooks', 'post-checkout'),
      `#!/bin/sh\ntouch "${marker}"\n`,
      {
        mode: 0o755,
      },
    );
    await loadRepo(repo);
    await expect(import('node:fs').then((fs) => fs.existsSync(marker))).resolves.toBe(false);
  });

  it('does not fetch submodules named in .gitmodules', async () => {
    const repo = await repository({
      ...SAMPLE_APP,
      '.gitmodules': '[submodule "x"]\n\tpath = x\n\turl = file:///etc\n',
    });
    const snapshot = await loadRepo(repo);
    expect(snapshot.files.map((f) => f.path)).not.toContain('x');
  });

  it('keeps secret-looking files out of the snapshot', async () => {
    const repo = await repository({ ...SAMPLE_APP, '.env': 'TOKEN=abc123' });
    const snapshot = await loadRepo(repo);
    expect(snapshot.files.map((f) => f.path)).not.toContain('.env');
    expect(snapshot.skipped).toContainEqual({ path: '.env', reason: 'sensitive' });
  });

  it('refuses a local path when the file scheme is not enabled', async () => {
    const repo = await repository();
    await expect(
      new GitSource().load({ kind: 'git', location: `file://${repo}` }),
    ).rejects.toMatchObject({ code: 'source.unsupported' });
  });

  it('reports a repository that does not exist and cleans up', async () => {
    const before = await listTempDirs('hero-git-');
    await expect(loadRepo('/no/such/repo')).rejects.toMatchObject({ code: 'source.not-found' });
    expect(await listTempDirs('hero-git-')).toEqual(before);
  });

  it('removes its temporary files when disposed', async () => {
    const repo = await repository();
    const before = (await listTempDirs('hero-git-')).length;
    const snapshot = await loadRepo(repo);
    expect((await listTempDirs('hero-git-')).length).toBe(before + 1);
    await snapshot.dispose();
    expect((await listTempDirs('hero-git-')).length).toBe(before);
  });

  it('reports a clear error when git is missing', async () => {
    const missing = new GitSource({ gitBinary: 'definitely-not-git', allowedSchemes: ['https'] });
    await expect(
      missing.load({ kind: 'git', location: 'https://github.com/acme/app' }),
    ).rejects.toMatchObject({ code: 'source.unsupported' });
  });
});

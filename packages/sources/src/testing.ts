import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Creates a temporary directory that the test removes in `cleanup`. */
export async function makeTempDir(prefix = 'hero-test-'): Promise<{
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Writes files given as a map of relative path to text. */
export async function writeTree(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split('/'));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}

/** A small, typical application used by several tests. */
export const SAMPLE_APP: Readonly<Record<string, string>> = {
  'package.json': '{"name":"sample","scripts":{"build":"vite build"}}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'src/util/helper.ts': 'export const helper = () => 1;\n',
  'README.md': '# Sample\n',
};

/** Counts leftover temporary directories created by the sources, to prove cleanup. */
export async function listTempDirs(prefix: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  return (await readdir(tmpdir())).filter((name) => name.startsWith(prefix));
}

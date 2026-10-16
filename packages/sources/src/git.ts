import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { heroError } from '@hero-cloud/core';
import type {
  LoadOptions,
  ProjectSnapshot,
  SkippedEntry,
  SourceLoader,
  SourceRef,
} from '@hero-cloud/core';
import { DiskSnapshot, removeDirectory } from './disk-snapshot.js';
import { DEFAULT_LIMITS } from './policy.js';
import type { SourceLimits } from './policy.js';
import { scanDirectory } from './scan.js';

const run = promisify(execFile);

/** Git versions before this one have known remote-code-execution bugs in clone (CVE-2024-32002). */
const MIN_GIT_VERSION: readonly [number, number, number] = [2, 45, 1];

// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\s\u0000-\u001f]/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export type GitScheme = 'https' | 'file';

export interface GitLocation {
  readonly url: string;
  readonly ref: string | undefined;
}

function isPrivateIPv4(host: string): boolean {
  const [a = 0, b = 0] = host.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(host);
  if (version === 4) return isPrivateIPv4(host);
  if (version === 6) {
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:')
    );
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  );
}

/**
 * Parses and validates a repository location of the form `https://host/owner/repo(.git)[#ref]`.
 * Only HTTPS is accepted by default. Credentials in the URL, private or local hosts, unusual ports,
 * and refs that look like command-line options are refused.
 */
export function parseGitLocation(
  location: string,
  schemes: readonly GitScheme[] = ['https'],
): GitLocation {
  const fail = (): never => {
    throw heroError('source.unsupported', { source: 'git' });
  };
  const hashIndex = location.indexOf('#');
  const base = hashIndex === -1 ? location : location.slice(0, hashIndex);
  const ref = hashIndex === -1 ? undefined : location.slice(hashIndex + 1);

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return fail();
  }
  const scheme = url.protocol.replace(':', '');
  if (!(schemes as readonly string[]).includes(scheme)) return fail();
  if (url.username !== '' || url.password !== '') return fail();
  if (url.search !== '' || CONTROL_OR_SPACE.test(base)) return fail();

  if (scheme === 'https') {
    if (url.port !== '' && url.port !== '443') return fail();
    if (isPrivateHost(url.hostname)) return fail();
    if (url.pathname.split('/').filter(Boolean).length < 2) return fail();
  }
  if (ref !== undefined && (!REF_PATTERN.test(ref) || ref.includes('..'))) return fail();

  return { url: url.toString(), ref };
}

function parseVersion(output: string): readonly [number, number, number] | undefined {
  const match = /git version (\d+)\.(\d+)\.(\d+)/.exec(output);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(
  version: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let i = 0; i < 3; i += 1) {
    const a = version[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export interface GitSourceOptions {
  readonly limits?: SourceLimits;
  readonly timeoutMs?: number;
  /** Schemes accepted. `file` exists only so tests can use local repositories. Never enable it in a product. */
  readonly allowedSchemes?: readonly GitScheme[];
  readonly gitBinary?: string;
}

/**
 * Loads a Git repository with a shallow clone that cannot run code: no hooks, no submodules, no
 * LFS filters, no symlinks, no credential prompts, no user or system configuration, and a minimal
 * environment that carries none of the user's secrets. Committed symlinks are detected and left
 * out, exactly like symlinks in a folder.
 */
export class GitSource implements SourceLoader {
  readonly kind = 'git';
  readonly #limits: SourceLimits;
  readonly #timeoutMs: number;
  readonly #schemes: readonly GitScheme[];
  readonly #git: string;
  #versionChecked = false;

  constructor(options: GitSourceOptions = {}) {
    this.#limits = options.limits ?? DEFAULT_LIMITS;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#schemes = options.allowedSchemes ?? ['https'];
    this.#git = options.gitBinary ?? 'git';
  }

  async load(ref: SourceRef, options: LoadOptions = {}): Promise<ProjectSnapshot> {
    const location = parseGitLocation(ref.location, this.#schemes);
    await this.#ensureSafeVersion();

    const parent = await mkdtemp(join(tmpdir(), 'hero-git-'));
    const cleanup = removeDirectory(parent);
    try {
      const home = join(parent, 'home');
      const hooks = join(parent, 'no-hooks');
      const checkout = join(parent, 'repo');
      await mkdir(home);
      await mkdir(hooks);
      const emptyConfig = join(parent, 'gitconfig');
      await writeFile(emptyConfig, '');

      const env = this.#environment(home, emptyConfig);
      const hardening = this.#hardeningFlags(hooks);
      const args = [
        ...hardening,
        'clone',
        '--depth=1',
        '--no-tags',
        '--single-branch',
        '--no-recurse-submodules',
        '--template=',
        ...(location.ref === undefined ? [] : [`--branch=${location.ref}`]),
        '--',
        location.url,
        checkout,
      ];
      try {
        await run(this.#git, args, {
          env,
          cwd: parent,
          timeout: this.#timeoutMs,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (error) {
        const killed = (error as { killed?: boolean }).killed === true;
        throw heroError(killed ? 'source.timeout' : 'source.not-found', undefined, error);
      }

      const skipped: SkippedEntry[] = [];
      for (const path of await this.#symlinkPaths(checkout, env, hardening)) {
        await unlink(join(checkout, ...path.split('/'))).catch(() => undefined);
        skipped.push({ path, reason: 'symlink' });
      }
      const scan = await scanDirectory(checkout, this.#limits, options.signal);
      return new DiskSnapshot(checkout, scan.files, [...skipped, ...scan.skipped], cleanup);
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  async #ensureSafeVersion(): Promise<void> {
    if (this.#versionChecked) return;
    let output: string;
    try {
      output = (await run(this.#git, ['--version'], { timeout: 10_000, windowsHide: true })).stdout;
    } catch (error) {
      throw heroError('source.unsupported', { reason: 'git-missing' }, error);
    }
    const version = parseVersion(output);
    if (version === undefined || !isAtLeast(version, MIN_GIT_VERSION)) {
      throw heroError('source.unsupported', { reason: 'git-too-old' });
    }
    this.#versionChecked = true;
  }

  #hardeningFlags(hooksDirectory: string): string[] {
    const allowFile = this.#schemes.includes('file') ? 'always' : 'never';
    const config: readonly string[] = [
      'protocol.allow=never',
      'protocol.https.allow=always',
      `protocol.file.allow=${allowFile}`,
      'core.symlinks=false',
      `core.hooksPath=${hooksDirectory}`,
      'core.fsmonitor=false',
      'core.autocrlf=false',
      'core.protectNTFS=true',
      'core.protectHFS=true',
      'credential.helper=',
      'submodule.recurse=false',
      'transfer.fsckObjects=true',
      'fetch.fsckObjects=true',
      'filter.lfs.process=',
      'filter.lfs.smudge=',
      'filter.lfs.clean=',
      'filter.lfs.required=false',
      'http.lowSpeedLimit=1000',
      'http.lowSpeedTime=30',
    ];
    return config.flatMap((entry) => ['-c', entry]);
  }

  #environment(home: string, emptyConfig: string): NodeJS.ProcessEnv {
    const passthrough = [
      'PATH',
      'HTTPS_PROXY',
      'https_proxy',
      'NO_PROXY',
      'no_proxy',
      'SSL_CERT_FILE',
      'SYSTEMROOT',
    ];
    const env: NodeJS.ProcessEnv = {};
    for (const key of passthrough) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return {
      ...env,
      HOME: home,
      USERPROFILE: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      GIT_ALLOW_PROTOCOL: this.#schemes.join(':'),
      GIT_PROTOCOL_FROM_USER: '0',
      GIT_LFS_SKIP_SMUDGE: '1',
      LC_ALL: 'C',
    };
  }

  /** Paths committed as symlinks (mode 120000). With `core.symlinks=false` they became text files. */
  async #symlinkPaths(
    checkout: string,
    env: NodeJS.ProcessEnv,
    hardening: readonly string[],
  ): Promise<string[]> {
    const { stdout } = await run(
      this.#git,
      [...hardening, '--git-dir', join(checkout, '.git'), 'ls-files', '-s', '-z'],
      { env, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    );
    return stdout
      .split('\0')
      .filter((record) => record.startsWith('120000 '))
      .map((record) => record.slice(record.indexOf('\t') + 1));
  }
}

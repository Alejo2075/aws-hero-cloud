/**
 * What may enter a snapshot. Everything that is loaded is untrusted, so the rules are strict and
 * apply the same way to folders, ZIP files, and Git checkouts.
 */
export interface SourceLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxPathLength: number;
  readonly maxDepth: number;
}

export const DEFAULT_LIMITS: SourceLimits = {
  maxFiles: 20_000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 250 * 1024 * 1024,
  maxPathLength: 512,
  maxDepth: 40,
};

/** Directories that hold dependencies or build output, never source. */
export const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
  '.vscode',
  'vendor',
  'obj',
  '.hero',
]);

const ALLOWED_ENV_SUFFIXES = ['example', 'sample', 'template', 'dist', 'defaults'];

const SENSITIVE_BASENAMES = new Set([
  '.npmrc',
  '.yarnrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.dockercfg',
  '.htpasswd',
  'credentials.json',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
  'service-account.json',
  'terraform.tfstate',
  'terraform.tfstate.backup',
]);

const SENSITIVE_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.tfvars'];

/**
 * True for files that look like secrets: environment files with real values, private keys, token
 * files, and state files. They never enter a snapshot, so they can never be analyzed, uploaded to a
 * build, or sent to an AI. `.env.example` and friends are fine because they hold names, not values.
 */
export function isSensitivePath(path: string): boolean {
  const segments = path.split('/');
  const base = (segments[segments.length - 1] ?? '').toLowerCase();

  if (base === '.env' || base.startsWith('.env.')) {
    const suffix = base.slice('.env.'.length);
    return !(base !== '.env' && ALLOWED_ENV_SUFFIXES.includes(suffix));
  }
  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (SENSITIVE_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(?!.*\.pub$)/.test(base)) return true;
  if (segments.includes('.aws') && base === 'credentials') return true;
  if (segments.includes('.ssh') && !base.endsWith('.pub')) return true;
  return false;
}

export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

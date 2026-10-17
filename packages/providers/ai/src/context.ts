import type { Analysis, ProjectSnapshot } from '@hero-cloud/core';
import { redact } from './redact.js';

/** What the person agreed to share with the model. Each step includes the ones before it. */
export type ConsentScope = 'file-names' | 'snippets' | 'full-files';

const MAX_PATHS = 300;
const NEVER =
  /(?:^|\/)(?:\.env[^/]*|id_[a-z0-9]+|.*\.(?:pem|key|p12|pfx|jks|keystore|crt)|.*secrets?[^/]*|.*credentials?[^/]*)$/i;
const NOISE = /(?:^|\/)(?:node_modules|vendor|dist|build|\.git|__pycache__)\//;
const LOCKFILES =
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$/;
/** Files that most often say what an application is, in the order they are looked at. */
const MANIFESTS = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'go.mod',
  'Procfile',
  'Dockerfile',
  'docker-compose.yml',
  'web.config',
  'index.php',
  'app.py',
  'main.py',
  'manage.py',
  'wsgi.py',
  'server.js',
  'index.js',
  'main.go',
  'Program.cs',
];

const LIMITS = {
  snippets: { files: 8, perFile: 2_000, total: 12_000 },
  'full-files': { files: 20, perFile: 8_000, total: 40_000 },
} as const;

export interface AiContext {
  readonly application: string;
  readonly files: readonly string[];
  readonly current: {
    readonly frontend: string | null;
    readonly services: readonly {
      id: string;
      type: string;
      runtime: string;
      port: number | null;
    }[];
    readonly data: readonly { id: string; type: string; engine: string | null }[];
    readonly storage: readonly string[];
  };
  readonly openQuestions: readonly { id: string; code: string }[];
  readonly snippets: Readonly<Record<string, string>>;
}

/**
 * Builds the least the model needs, nothing more. Files that look like secrets are left out even
 * if they somehow reached the snapshot, long files are cut, and the whole thing is redacted last.
 * What it returns is exactly what is sent.
 */
export async function buildContext(
  analysis: Analysis,
  snapshot: ProjectSnapshot,
  scope: ConsentScope,
): Promise<{ context: AiContext; redactions: number }> {
  const paths = snapshot.files
    .map((f) => f.path)
    .filter((p) => !NEVER.test(p) && !NOISE.test(p) && !LOCKFILES.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1))
    .slice(0, MAX_PATHS);

  const snippets: Record<string, string> = {};
  if (scope !== 'file-names') {
    const limit = LIMITS[scope];
    const chosen: string[] = [];
    for (const name of MANIFESTS) {
      const hit = paths.find((p) => p === name || p.endsWith(`/${name}`));
      if (hit !== undefined && !chosen.includes(hit)) chosen.push(hit);
    }
    if (scope === 'full-files') {
      for (const p of paths) {
        if (chosen.length >= limit.files) break;
        if (
          /\.(?:js|mjs|ts|py|php|rb|go|java|cs|json|toml|ya?ml|xml|cfg|ini|conf)$/i.test(p) &&
          !chosen.includes(p)
        ) {
          chosen.push(p);
        }
      }
    }
    let total = 0;
    for (const p of chosen.slice(0, limit.files)) {
      const bytes = await snapshot.read(p).catch(() => new Uint8Array());
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, limit.perFile);
      if (text.includes('\u0000')) continue;
      if (total + text.length > limit.total) break;
      total += text.length;
      snippets[p] = text;
    }
  }

  const spec = analysis.spec;
  const raw: AiContext = {
    application: spec.application.name,
    files: paths,
    current: {
      frontend: spec.frontend?.framework ?? null,
      services: (spec.services ?? []).map((s) => ({
        id: s.id,
        type: s.type,
        runtime: s.runtime,
        port: s.port ?? null,
      })),
      data: (spec.data ?? []).map((d) => ({ id: d.id, type: d.type, engine: d.engine ?? null })),
      storage: (spec.storage ?? []).map((s) => s.type),
    },
    openQuestions: analysis.openQuestions.map((q) => ({ id: q.id, code: q.code })),
    snippets,
  };
  const { value, redactions } = redact(raw);
  return { context: value, redactions };
}

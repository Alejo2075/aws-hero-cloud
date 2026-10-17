import type { Analysis, ProjectSnapshot, UnsupportedReport } from '@hero-cloud/core';
import { LOCKFILES, MAX_PATHS, NEVER, NOISE } from './context.js';
import { redact } from './redact.js';

/** Files that describe what an application is made of. Source code is never included. */
const MANIFEST =
  /(?:^|\/)(?:package\.json|requirements\.txt|pyproject\.toml|Pipfile|composer\.json|pom\.xml|build\.gradle(?:\.kts)?|Gemfile|go\.mod|mix\.exs|Cargo\.toml|Procfile|Dockerfile|docker-compose\.ya?ml|web\.config|[^/]+\.(?:csproj|fsproj|sln))$/;
const MAX_MANIFESTS = 12;
const MAX_MANIFEST_CHARS = 2_000;

/**
 * Builds the description of an application Hero could not handle. It holds file paths and the
 * start of manifests, redacted last, so the person can read exactly what they would share.
 */
export async function buildUnsupportedReport(
  analysis: Analysis,
  snapshot: ProjectSnapshot,
): Promise<UnsupportedReport> {
  const files = snapshot.files
    .map((f) => f.path)
    .filter((p) => !NEVER.test(p) && !NOISE.test(p) && !LOCKFILES.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1))
    .slice(0, MAX_PATHS);

  const manifests: Record<string, string> = {};
  for (const path of files.filter((p) => MANIFEST.test(p)).slice(0, MAX_MANIFESTS)) {
    const bytes = await snapshot.read(path).catch(() => new Uint8Array());
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.includes('\u0000')) continue;
    manifests[path] = text.slice(0, MAX_MANIFEST_CHARS);
  }

  const recognized =
    (analysis.spec.services ?? []).length > 0 || analysis.spec.frontend !== undefined;
  const raw: UnsupportedReport = {
    schema: 1,
    application: analysis.spec.application.name,
    sourceHash: analysis.sourceHash,
    reason: !recognized
      ? 'nothing-recognized'
      : analysis.openQuestions.length > 0
        ? 'open-questions'
        : 'requested',
    detected: analysis.detections.map((d) => ({
      capability: d.capability,
      confidence: d.confidence,
    })),
    openQuestions: analysis.openQuestions.map((q) => q.code),
    files,
    manifests,
    redactions: 0,
  };
  const { value, redactions } = redact(raw);
  return { ...value, redactions };
}

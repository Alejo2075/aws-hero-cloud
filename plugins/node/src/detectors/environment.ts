import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { readPackageJson } from '../package-json.js';
import { sourceFiles } from '../sources.js';

const TEMPLATES = ['.env.example', '.env.sample', '.env.template', '.env.defaults'];
const TEMPLATE_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm;
const PROCESS_ENV = /process\.env\.([A-Z][A-Z0-9_]*)\b/g;
const PROCESS_ENV_INDEX = /process\.env\[\s*['"`]([A-Z][A-Z0-9_]*)['"`]\s*\]/g;
const IMPORT_META_ENV = /import\.meta\.env\.([A-Z][A-Z0-9_]*)\b/g;

/** Set by the platform or by tooling, not by the person deploying. */
const PLATFORM_PROVIDED = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'HOSTNAME',
  'CI',
  'HOME',
  'PATH',
  'PWD',
  'TZ',
  'LANG',
  'DEBUG',
  'MODE',
  'DEV',
  'PROD',
  'SSR',
  'BASE_URL',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AWS_EXECUTION_ENV',
]);

/**
 * The names of environment variables the application reads, from template files and from code.
 * Only names are collected, never values: `.env` itself never enters a snapshot.
 */
export const environmentDetector = defineDetector({
  id: 'node/environment',
  description: 'Environment variable names',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;

    const names = new Set<string>();
    const origins = new Set<string>();
    for (const file of TEMPLATES) {
      const text = await context.readText(file, 64 * 1024);
      if (text === undefined) continue;
      origins.add(`file:${file}`);
      for (const match of text.matchAll(TEMPLATE_LINE))
        if (match[1] !== undefined) names.add(match[1]);
    }
    for (const file of await sourceFiles(context)) {
      let used = false;
      for (const pattern of [PROCESS_ENV, PROCESS_ENV_INDEX, IMPORT_META_ENV]) {
        for (const match of file.text.matchAll(pattern)) {
          if (match[1] !== undefined) {
            names.add(match[1]);
            used = true;
          }
        }
      }
      if (used && origins.size < 8) origins.add(`file:${file.path}`);
    }
    for (const name of PLATFORM_PROVIDED) names.delete(name);
    if (names.size === 0) return emptyFinding;

    const sorted = [...names].sort();
    return {
      detections: [
        { capability: 'environment-variables', confidence: 0.9, evidence: [...origins].sort() },
      ],
      contributions: [{ kind: 'environment', names: sorted }],
      questions: [],
    };
  },
});

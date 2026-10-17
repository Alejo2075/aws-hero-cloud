import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type { OpenQuestion } from '@hero-cloud/core';
import { parseProcfile, text } from './shared.js';

const LANGUAGE_FILES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'go.mod',
];

/**
 * A `Procfile` says how an application runs even when its language is not one Hero recognizes.
 * `web` becomes a web service and any other process becomes a continuously running one. Projects
 * a language detector already understands are left to it.
 */
export const procfileDetector = defineDetector({
  id: 'legacy/procfile',
  description: 'Applications described only by a Procfile',
  async detect(context) {
    if (!context.has('Procfile')) return emptyFinding;
    if (
      LANGUAGE_FILES.some((f) => context.has(f)) ||
      context.files.some((f) => /\.csproj$/.test(f.path))
    ) {
      return emptyFinding;
    }
    const processes = parseProcfile(await text(context, 'Procfile', 16 * 1024));
    const contributions: Contribution[] = [];
    const questions: OpenQuestion[] = [];
    const capabilities = new Set<string>();
    for (const [name, command] of Object.entries(processes).slice(0, 5)) {
      const web = name === 'web';
      capabilities.add(web ? 'http-service' : 'process-service');
      contributions.push({
        kind: 'service',
        value: {
          id: name,
          type: web ? 'http' : name === 'worker' ? 'worker' : 'process',
          runtime: 'unknown',
          start: { command },
        },
        confidence: 0.6,
      });
      if (web)
        questions.push({
          id: 'service.port-unknown',
          code: 'service.port-unknown',
          params: { service: name },
        });
    }
    return {
      detections: [...capabilities].map((capability) => ({
        capability,
        confidence: 0.6,
        evidence: ['file:Procfile'],
      })),
      contributions,
      questions,
    };
  },
});

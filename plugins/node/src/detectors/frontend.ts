import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution, DetectionContext } from '@hero-cloud/plugin-sdk';
import { SERVER_FRAMEWORKS, hasAny } from '../frameworks.js';
import {
  dependencyEvidence,
  detectPackageManager,
  readPackageJson,
  runScript,
} from '../package-json.js';

async function firstText(
  context: DetectionContext,
  names: readonly string[],
): Promise<{ file: string; text: string } | undefined> {
  for (const file of names) {
    const text = await context.readText(file, 64 * 1024);
    if (text !== undefined) return { file, text };
  }
  return undefined;
}

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts'];
const NEXT_CONFIGS = ['next.config.mjs', 'next.config.js', 'next.config.ts', 'next.config.cjs'];
const OUT_DIR = /outDir\s*:\s*['"`]([A-Za-z0-9._/-]{1,100})['"`]/;
const NEXT_EXPORT = /output\s*:\s*['"`]export['"`]/;

/** Single-page and static front ends: Vite, React, Next.js static export, Astro, Create React App. */
export const frontendDetector = defineDetector({
  id: 'node/frontend',
  description: 'Static and single-page front ends',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;
    const { manager } = detectPackageManager(context, info);
    const build = info.scripts.build === undefined ? undefined : runScript(manager, 'build');
    const all = info.allDependencies;
    const contributions: Contribution[] = [];
    const questions = [];

    if (all.has('next')) {
      const config = await firstText(context, NEXT_CONFIGS);
      if (config !== undefined && NEXT_EXPORT.test(config.text)) {
        return {
          detections: [
            {
              capability: 'web-frontend',
              confidence: 0.95,
              evidence: [
                dependencyEvidence(info, 'next'),
                `file:${config.file}`,
                'config:output=export',
              ],
            },
          ],
          contributions: [
            {
              kind: 'frontend',
              value: {
                framework: 'next',
                ...(build === undefined ? {} : { build: { command: build, output: 'out' } }),
              },
              confidence: 0.95,
            },
          ],
          questions:
            build === undefined
              ? [{ id: 'frontend.build-missing', code: 'frontend.build-missing' }]
              : [],
        };
      }
      // A Next.js app without a static export renders on a server; the server detector handles it.
      return emptyFinding;
    }

    const evidence: string[] = [];
    let framework: string | undefined;
    let output = 'dist';
    let confidence = 0.9;

    if (all.has('vite')) {
      framework = 'vite';
      evidence.push(dependencyEvidence(info, 'vite'));
      const config = await firstText(context, VITE_CONFIGS);
      if (config !== undefined) {
        evidence.push(`file:${config.file}`);
        const outDir = OUT_DIR.exec(config.text)?.[1];
        if (outDir !== undefined && !outDir.includes('..') && !outDir.startsWith('/'))
          output = outDir;
      }
    } else if (all.has('react-scripts')) {
      framework = 'react';
      output = 'build';
      evidence.push(dependencyEvidence(info, 'react-scripts'));
    } else if (all.has('astro')) {
      framework = 'astro';
      evidence.push(dependencyEvidence(info, 'astro'));
    }
    if (framework === undefined) return emptyFinding;
    if (all.has('react')) evidence.push(dependencyEvidence(info, 'react'));

    // A server framework next to a front-end tool means the front end is a client of that server.
    if (hasAny(info.dependencies, SERVER_FRAMEWORKS.keys()) !== undefined) confidence = 0.85;
    if (build === undefined) {
      confidence = 0.6;
      questions.push({ id: 'frontend.build-missing', code: 'frontend.build-missing' });
    } else {
      contributions.push({
        kind: 'frontend',
        value: { framework, build: { command: build, output } },
        confidence,
      });
    }
    if (build === undefined) {
      contributions.push({ kind: 'frontend', value: { framework }, confidence });
    }
    return {
      detections: [{ capability: 'web-frontend', confidence, evidence }],
      contributions,
      questions,
    };
  },
});

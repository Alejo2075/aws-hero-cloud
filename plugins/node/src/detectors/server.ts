import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { OpenQuestion } from '@hero-cloud/core';
import { SERVER_FRAMEWORKS } from '../frameworks.js';
import {
  dependencyEvidence,
  detectPackageManager,
  readPackageJson,
  runScript,
  startCommand,
} from '../package-json.js';
import { sourceFiles } from '../sources.js';

const LISTEN_PORT = /\.listen\(\s*(?:\{[^}]*?port\s*:\s*)?(\d{2,5})\b/g;
const DEFAULT_PORT = /\bPORT\b\s*(?:\|\||\?\?)\s*['"`]?(\d{2,5})['"`]?/g;
const PORT_ASSIGN = /\bport\b\s*[:=]\s*['"`]?(\d{2,5})['"`]?/gi;
const HEALTH_ROUTE =
  /['"`](\/(?:api\/)?(?:health|healthz|healthcheck|health-check|status|ping|ready|readyz|live|livez))['"`]/;
const NEXT_CONFIGS = ['next.config.mjs', 'next.config.js', 'next.config.ts', 'next.config.cjs'];
const NEXT_EXPORT = /output\s*:\s*['"`]export['"`]/;
const ENTRY_CANDIDATES = [
  'server.js',
  'index.js',
  'app.js',
  'src/server.js',
  'src/index.js',
  'main.js',
];

function mostCommonPort(texts: readonly string[]): number | undefined {
  const counts = new Map<number, number>();
  for (const text of texts) {
    for (const pattern of [LISTEN_PORT, DEFAULT_PORT, PORT_ASSIGN]) {
      for (const match of text.matchAll(pattern)) {
        const port = Number(match[1]);
        if (port >= 1 && port <= 65535) counts.set(port, (counts.get(port) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

/** HTTP servers: Express, Fastify, Hono, Koa, Hapi, NestJS, and server-rendered Next.js. */
export const serverDetector = defineDetector({
  id: 'node/server',
  description: 'HTTP services, their start command, port, and health route',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;

    let framework: string | undefined;
    let evidence: string[] = [];
    for (const [dependency, name] of SERVER_FRAMEWORKS) {
      if (info.dependencies.has(dependency)) {
        framework = name;
        evidence = [dependencyEvidence(info, dependency)];
        break;
      }
    }
    if (framework === undefined && info.allDependencies.has('next')) {
      let exported = false;
      for (const file of NEXT_CONFIGS) {
        const text = await context.readText(file, 64 * 1024);
        if (text !== undefined && NEXT_EXPORT.test(text)) exported = true;
      }
      if (!exported) {
        framework = 'next-server';
        evidence = [dependencyEvidence(info, 'next'), 'config:server-rendering'];
      }
    }
    if (framework === undefined) return emptyFinding;

    const { manager } = detectPackageManager(context, info);
    const sources = await sourceFiles(context);
    const texts = sources.map((file) => file.text);
    const port = mostCommonPort(texts);
    const healthMatch = texts
      .map((text) => HEALTH_ROUTE.exec(text)?.[1])
      .find((route) => route !== undefined);

    const questions: OpenQuestion[] = [];
    let start: string | undefined;
    if (info.scripts.start !== undefined) {
      start = startCommand(manager);
      evidence.push('script:start');
    } else if (
      info.main !== undefined &&
      /^[A-Za-z0-9._/-]{1,100}$/.test(info.main) &&
      !info.main.includes('..')
    ) {
      start = `node ${info.main}`;
      evidence.push('field:main');
    } else {
      const entry = ENTRY_CANDIDATES.find((candidate) => context.has(candidate));
      if (entry !== undefined) {
        start = `node ${entry}`;
        evidence.push(`file:${entry}`);
      } else {
        questions.push({
          id: 'service.start-unknown',
          code: 'service.start-unknown',
          params: { service: 'api' },
        });
      }
    }
    if (port === undefined) {
      questions.push({
        id: 'service.port-unknown',
        code: 'service.port-unknown',
        params: { service: 'api' },
      });
    } else {
      evidence.push('source:listen-port');
    }
    if (healthMatch !== undefined) evidence.push('source:health-route');

    const confidence = start === undefined ? 0.6 : 0.9;
    return {
      detections: [{ capability: 'http-service', confidence, evidence }],
      contributions: [
        {
          kind: 'service',
          value: {
            id: 'api',
            type: 'http',
            runtime: 'nodejs',
            ...(info.scripts.build === undefined
              ? {}
              : { build: { command: runScript(manager, 'build') } }),
            ...(start === undefined ? {} : { start: { command: start } }),
            ...(port === undefined ? {} : { port }),
            ...(healthMatch === undefined ? {} : { healthPath: healthMatch }),
          },
          confidence,
        },
      ],
      questions,
    };
  },
});

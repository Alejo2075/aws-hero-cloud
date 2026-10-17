import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type { Detection, OpenQuestion } from '@hero-cloud/core';
import { HEALTH_ROUTE, parseProcfile, safeModule, safeVariable, text, wordsOf } from './shared.js';

const MANIFESTS = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg'];
const ENTRY_FILES = ['app.py', 'main.py', 'wsgi.py', 'application.py', 'server.py', 'api.py'];

/** Python web applications: Django, Flask, FastAPI, and their data drivers. */
export const pythonDetector = defineDetector({
  id: 'legacy/python',
  description: 'Python web applications',
  async detect(context) {
    const manifest = MANIFESTS.find((name) => context.has(name));
    if (manifest === undefined && !context.has('manage.py')) return emptyFinding;
    const dependencies = new Set<string>();
    for (const name of MANIFESTS)
      for (const word of wordsOf(await text(context, name))) dependencies.add(word);

    const procfile = parseProcfile(await text(context, 'Procfile', 16 * 1024));
    const framework =
      dependencies.has('django') || context.has('manage.py')
        ? 'django'
        : dependencies.has('fastapi')
          ? 'fastapi'
          : dependencies.has('flask')
            ? 'flask'
            : undefined;
    if (framework === undefined) return emptyFinding;

    const evidence = [
      context.has('manage.py') && framework === 'django'
        ? 'file:manage.py'
        : `dependency:${framework}`,
    ];
    const questions: OpenQuestion[] = [];
    let start: string | undefined = procfile.web;
    let startEvidence = start === undefined ? undefined : 'file:Procfile';

    if (start === undefined) {
      const files = context.files.map((f) => f.path);
      if (framework === 'django' && dependencies.has('gunicorn')) {
        const wsgi = files
          .map((p) => /^([A-Za-z_][A-Za-z0-9_]*)\/wsgi\.py$/.exec(p)?.[1])
          .find(Boolean);
        const module = safeModule(wsgi);
        if (module !== undefined) {
          start = `gunicorn --bind 0.0.0.0:$PORT ${module}.wsgi:application`;
          startEvidence = `file:${module}/wsgi.py`;
        }
      } else if (framework === 'fastapi' && dependencies.has('uvicorn')) {
        for (const candidate of ENTRY_FILES.concat(ENTRY_FILES.map((f) => `app/${f}`))) {
          const code = await text(context, candidate, 128 * 1024);
          const variable = safeVariable(
            /^(\w+)\s*(?::[^=\n]*)?=\s*FastAPI\(/m.exec(code ?? '')?.[1],
          );
          const module = safeModule(candidate.replace(/\.py$/, '').replaceAll('/', '.'));
          if (variable !== undefined && module !== undefined) {
            start = `uvicorn ${module}:${variable} --host 0.0.0.0 --port $PORT`;
            startEvidence = `file:${candidate}`;
            break;
          }
        }
      } else if (framework === 'flask' && dependencies.has('gunicorn')) {
        for (const candidate of ENTRY_FILES) {
          const code = await text(context, candidate, 128 * 1024);
          const variable = safeVariable(/^(\w+)\s*=\s*Flask\(/m.exec(code ?? '')?.[1]);
          const module = safeModule(candidate.replace(/\.py$/, ''));
          if (variable !== undefined && module !== undefined) {
            start = `gunicorn --bind 0.0.0.0:$PORT ${module}:${variable}`;
            startEvidence = `file:${candidate}`;
            break;
          }
        }
      }
    }
    if (start === undefined) {
      questions.push({
        id: 'service.start-unknown',
        code: 'service.start-unknown',
        params: { service: 'web' },
      });
    }

    let healthPath: string | undefined;
    for (const candidate of ENTRY_FILES.concat(ENTRY_FILES.map((f) => `app/${f}`))) {
      const code = await text(context, candidate, 128 * 1024);
      healthPath = healthPath ?? HEALTH_ROUTE.exec(code ?? '')?.[1];
    }

    const detections: Detection[] = [
      {
        capability: 'http-service',
        confidence: start === undefined ? 0.6 : 0.85,
        evidence: [...evidence, ...(startEvidence === undefined ? [] : [startEvidence])],
      },
    ];
    const contributions: Contribution[] = [
      {
        kind: 'service',
        value: {
          id: 'web',
          type: 'http',
          runtime: 'python',
          port: 8000,
          ...(start === undefined ? {} : { start: { command: start } }),
          ...(healthPath === undefined ? {} : { healthPath }),
        },
        confidence: 0.8,
      },
    ];

    const postgres = ['psycopg2', 'psycopg2-binary', 'psycopg', 'asyncpg', 'pg8000'].find((d) =>
      dependencies.has(d),
    );
    const mysql = ['mysqlclient', 'pymysql', 'mysql-connector-python', 'aiomysql'].find((d) =>
      dependencies.has(d),
    );
    if (postgres !== undefined) {
      detections.push({
        capability: 'relational-data',
        confidence: 0.9,
        evidence: [`dependency:${postgres}`],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine: 'postgres' },
        confidence: 0.9,
      });
    } else if (mysql !== undefined) {
      detections.push({
        capability: 'relational-data',
        confidence: 0.9,
        evidence: [`dependency:${mysql}`],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine: 'mysql' },
        confidence: 0.9,
      });
    } else if (framework === 'django') {
      questions.push({ id: 'data.sqlite-persistence', code: 'data.sqlite-persistence' });
    }
    if (dependencies.has('pymongo') || dependencies.has('motor')) {
      detections.push({
        capability: 'document-data',
        confidence: 0.9,
        evidence: [`dependency:${dependencies.has('pymongo') ? 'pymongo' : 'motor'}`],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'documents', type: 'document', engine: 'mongodb' },
        confidence: 0.9,
      });
    }
    if (dependencies.has('redis')) {
      detections.push({ capability: 'cache', confidence: 0.85, evidence: ['dependency:redis'] });
      contributions.push({
        kind: 'data',
        value: { id: 'cache', type: 'cache', engine: 'redis' },
        confidence: 0.85,
      });
    }
    return { detections, contributions, questions };
  },
});

import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type { Detection, OpenQuestion } from '@hero-cloud/core';
import type { DataSpec } from '@hero-cloud/specification';
import { dependencyEvidence, readPackageJson } from '../package-json.js';

interface Rule {
  readonly dependencies: readonly string[];
  readonly capability: string;
  readonly data: DataSpec;
  readonly confidence: number;
}

const RULES: readonly Rule[] = [
  {
    dependencies: [
      '@aws-sdk/client-dynamodb',
      '@aws-sdk/lib-dynamodb',
      'dynamoose',
      'dynamodb-toolbox',
    ],
    capability: 'key-value-data',
    data: { id: 'kv', type: 'key-value' },
    confidence: 0.95,
  },
  {
    dependencies: ['pg', 'postgres', 'pg-promise', '@neondatabase/serverless', '@vercel/postgres'],
    capability: 'relational-data',
    data: { id: 'database', type: 'relational', engine: 'postgres' },
    confidence: 0.92,
  },
  {
    dependencies: ['mysql', 'mysql2', '@planetscale/database'],
    capability: 'relational-data',
    data: { id: 'database', type: 'relational', engine: 'mysql' },
    confidence: 0.92,
  },
  {
    dependencies: ['better-sqlite3', 'sqlite3', 'sqlite', '@libsql/client', 'libsql'],
    capability: 'relational-data',
    data: { id: 'database', type: 'relational', engine: 'sqlite' },
    confidence: 0.9,
  },
  {
    dependencies: ['mongodb', 'mongoose'],
    capability: 'document-data',
    data: { id: 'documents', type: 'document', engine: 'mongodb' },
    confidence: 0.92,
  },
  {
    dependencies: ['redis', 'ioredis', '@upstash/redis', 'bullmq'],
    capability: 'cache',
    data: { id: 'cache', type: 'cache', engine: 'redis' },
    confidence: 0.85,
  },
  {
    dependencies: [
      '@elastic/elasticsearch',
      '@opensearch-project/opensearch',
      'meilisearch',
      'typesense',
    ],
    capability: 'search',
    data: { id: 'search', type: 'search' },
    confidence: 0.85,
  },
];

const ORMS = [
  'prisma',
  '@prisma/client',
  'typeorm',
  'sequelize',
  'knex',
  'drizzle-orm',
  'kysely',
  '@mikro-orm/core',
];
const PRISMA_PROVIDER =
  /provider\s*=\s*"(postgresql|postgres|mysql|sqlite|mongodb|sqlserver|cockroachdb)"/;

/** Databases, caches, and search engines, from drivers and ORMs. Needs, not services. */
export const dataDetector = defineDetector({
  id: 'node/data',
  description: 'Key-value, relational, document, cache, and search data',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;

    const detections: Detection[] = [];
    const contributions: Contribution[] = [];
    const questions: OpenQuestion[] = [];

    for (const rule of RULES) {
      const found = rule.dependencies.filter((name) => info.dependencies.has(name));
      if (found.length === 0) continue;
      detections.push({
        capability: rule.capability,
        confidence: rule.confidence,
        evidence: found.map((name) => dependencyEvidence(info, name)),
      });
      contributions.push({ kind: 'data', value: rule.data, confidence: rule.confidence });
      if (rule.data.engine === 'sqlite') {
        // A file database lives on disk; whether it must survive a restart is the person's call.
        questions.push({ id: 'data.sqlite-persistence', code: 'data.sqlite-persistence' });
      }
    }

    const orm = ORMS.find((name) => info.allDependencies.has(name));
    const hasRelational = contributions.some(
      (c) => c.kind === 'data' && c.value.type === 'relational',
    );
    if (orm !== undefined && !hasRelational) {
      let engine: string | undefined;
      const schema = await context.readText('prisma/schema.prisma', 256 * 1024);
      const provider = schema === undefined ? undefined : PRISMA_PROVIDER.exec(schema)?.[1];
      if (provider !== undefined && provider !== 'mongodb') {
        engine =
          provider === 'postgresql' || provider === 'cockroachdb'
            ? 'postgres'
            : provider === 'sqlserver'
              ? 'sqlserver'
              : provider;
      }
      const evidence = [
        dependencyEvidence(info, orm),
        ...(provider === undefined ? [] : ['file:prisma/schema.prisma']),
      ];
      if (engine === undefined) {
        detections.push({ capability: 'relational-data', confidence: 0.6, evidence });
        contributions.push({
          kind: 'data',
          value: { id: 'database', type: 'relational' },
          confidence: 0.6,
        });
        questions.push({
          id: 'data.engine-unknown',
          code: 'data.engine-unknown',
          params: { library: orm },
        });
      } else {
        detections.push({ capability: 'relational-data', confidence: 0.85, evidence });
        contributions.push({
          kind: 'data',
          value: { id: 'database', type: 'relational', engine },
          confidence: 0.85,
        });
      }
    }
    return { detections, contributions, questions };
  },
});

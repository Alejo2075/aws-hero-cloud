import { join, resolve } from 'node:path';
import { audienceLevels, createPresenter } from '@hero-cloud/presentation';
import type { Block, View } from '@hero-cloud/presentation';
import { createHero } from '@hero-cloud/sdk';
import { describe, expect, it } from 'vitest';

const examples = resolve(import.meta.dirname, '..', 'examples');
const presenter = createPresenter();

async function planOf(name: string) {
  const hero = createHero();
  const analysis = await hero.analyze({ kind: 'directory', location: join(examples, name) });
  return hero.plan(analysis, { accountId: '123456789012', offline: true });
}

const text = (view: View): string => {
  const block = (b: Block): string => {
    switch (b.type) {
      case 'paragraph':
      case 'callout':
      case 'code':
        return b.text;
      case 'list':
        return b.items.join('\n');
      case 'table':
        return [b.columns.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n');
    }
  };
  return [view.title, ...view.sections.flatMap((s) => [s.heading, ...s.blocks.map(block)])].join(
    '\n',
  );
};

describe('an Express app with a PostgreSQL database', () => {
  it('becomes a container with a private managed database, and is not blocked', async () => {
    const plan = await planOf('express-postgres');
    expect(plan.strategy).toBe('container');
    expect(plan.warnings.filter((w) => w.severity === 'blocking')).toEqual([]);
    const types = plan.changes.map((c) => c.resource.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'ecs-service',
        'ecs-task-definition',
        'load-balancer',
        'rds-instance',
        'cloudfront-distribution',
        'vpc',
        'ecr-repository',
        'codebuild-build',
      ]),
    );
    const database = plan.changes.find((c) => c.resource.type === 'rds-instance');
    expect(database?.details).toMatchObject({
      publiclyAccessible: false,
      storageEncrypted: true,
      backupDays: 7,
      onDestroy: 'keep',
    });
    expect(plan.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'plan.privileged-build',
        'plan.cdn-origin-http',
        'plan.single-database',
      ]),
    );
  });

  it('does not ask for the settings Hero provides, but still asks for the port it could not read', async () => {
    const plan = await planOf('express-postgres');
    expect(plan.requiredInputs.map((i) => i.name)).not.toEqual(
      expect.arrayContaining(['DB_PASSWORD']),
    );
    expect(plan.requiredInputs.map((i) => i.name)).not.toContain('DB_HOST');
    expect(plan.warnings.map((w) => w.code)).toContain('plan.open-question');
  });

  it('is an honest, low-confidence estimate that is much more than a function would cost', async () => {
    const plan = await planOf('express-postgres');
    expect(plan.cost?.confidence).toBe('low');
    expect(plan.cost?.monthlyLow).toBeGreaterThan(40);
    expect(plan.cost?.lines.map((l) => l.code)).toEqual(
      expect.arrayContaining(['load-balancer', 'container-compute', 'managed-database']),
    );
  });

  it.each(
    audienceLevels.flatMap((level) => ['en', 'es'].map((locale) => [level, locale] as const)),
  )(
    'reads in plain words at %s / %s, with the privileged build and the database stated',
    async (level, locale) => {
      const plan = await planOf('express-postgres');
      const out = text(presenter.plan(plan, { audience: level, locale }));
      expect(out).not.toMatch(/\{[A-Za-z]+\}/);
      expect(out).not.toMatch(
        /\b(?:rationale|warning|resource|capability|question|cost\.line|strategy\.name)\.[a-z]/,
      );
      expect(out).toMatch(/\$|US\$/);
      if (level !== 'simple') expect(out).toMatch(/privileg/i);
    },
  );
});

describe('an app that only ships a Dockerfile', () => {
  it('runs its own image behind the same safeguards, built from its Dockerfile', async () => {
    const plan = await planOf('dockerfile-app');
    expect(plan.strategy).toBe('container');
    expect(plan.warnings.filter((w) => w.severity === 'blocking')).toEqual([]);
    const build = plan.changes.find((c) => c.resource.type === 'codebuild-build');
    expect(build?.details).toMatchObject({
      imageBuild: 'dockerfile',
      dockerfile: 'Dockerfile',
      privileged: true,
    });
    expect(plan.changes.some((c) => c.resource.type === 'rds-instance')).toBe(false);
  });

  it('is stable: the same folder gives the same sealed plan', async () => {
    expect((await planOf('dockerfile-app')).digest).toBe((await planOf('dockerfile-app')).digest);
  });
});

describe('the simpler way still wins', () => {
  it('keeps a plain Node API serverless, with no container, database, or privileged build', async () => {
    const plan = await planOf('api-only');
    expect(plan.strategy).toBe('serverless');
    expect(plan.changes.some((c) => c.resource.type === 'ecs-service')).toBe(false);
    expect(plan.warnings.map((w) => w.code)).not.toContain('plan.privileged-build');
  });
});

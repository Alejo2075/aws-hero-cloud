import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { audienceLevels, createPresenter } from '@hero-cloud/presentation';
import type { Block, View } from '@hero-cloud/presentation';
import { createHero } from '@hero-cloud/sdk';
import { describe, expect, it } from 'vitest';

/**
 * Every example is planned through the public SDK and rendered at every level in every shipped
 * language. A word that fails to resolve (a leftover `{placeholder}` or a raw message code) means a
 * missing translation, and reading it would confuse a real person.
 */
const examples = join(import.meta.dirname, '..', 'examples');
const names = readdirSync(examples, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const presenter = createPresenter();

function textOf(view: View): string {
  const block = (b: Block): string => {
    switch (b.type) {
      case 'paragraph':
      case 'callout':
      case 'code':
        return b.text;
      case 'list':
        return b.items.join('\n');
      case 'table':
        return [b.columns.join(' | '), ...b.rows.map((row) => row.join(' | '))].join('\n');
    }
  };
  return [view.title, ...view.sections.flatMap((s) => [s.heading, ...s.blocks.map(block)])].join(
    '\n',
  );
}

describe('plans of the examples read well at every level and language', () => {
  for (const name of names) {
    it(name, async () => {
      const hero = createHero();
      const analysis = await hero.analyze({ kind: 'directory', location: join(examples, name) });
      const plan = await hero.plan(analysis, { accountId: '123456789012', offline: true });
      for (const audience of audienceLevels) {
        for (const locale of ['en', 'es']) {
          const text = textOf(presenter.plan(plan, { audience, locale }));
          const where = `${name} ${audience} ${locale}`;
          expect(text, where).not.toMatch(/\{[A-Za-z]+\}/);
          expect(text, where).not.toMatch(
            /\b(?:rationale|warning|resource|capability|question|cost\.line|strategy\.name|view|column|meta|error)\.[a-z]/,
          );
          expect(text.length, where).toBeGreaterThan(100);
          // Whatever the level, a reader is told about a blocker and about the cost.
          if (plan.warnings.some((w) => w.severity === 'blocking')) {
            expect(text, where).toMatch(
              /Before this can go online|Antes de poder ponerlo en línea/,
            );
          }
          if (plan.cost !== undefined) expect(text, where).toMatch(/\$|US\$/);
        }
      }
    });
  }

  it('shows a beginner nothing they cannot understand', async () => {
    const hero = createHero();
    const jargon =
      /\b(Lambda|DynamoDB|S3|CloudFront|API Gateway|IAM|Cognito|CloudWatch|EventBridge|ARN|SSM|arm64|nodejs|digest)\b/;
    for (const name of names) {
      const analysis = await hero.analyze({ kind: 'directory', location: join(examples, name) });
      const plan = await hero.plan(analysis, { accountId: '123456789012', offline: true });
      for (const locale of ['en', 'es']) {
        const text = textOf(presenter.plan(plan, { audience: 'simple', locale }));
        expect(text, `${name} ${locale}`).not.toMatch(jargon);
      }
    }
  });

  it('keeps the expert view complete: every change appears with its type and name', async () => {
    const hero = createHero();
    const analysis = await hero.analyze({ kind: 'directory', location: join(examples, 'spa-api') });
    const plan = await hero.plan(analysis, { accountId: '123456789012', offline: true });
    const text = textOf(presenter.plan(plan, { audience: 'expert', locale: 'en' }));
    for (const change of plan.changes) {
      expect(text).toContain(change.resource.name);
      expect(text).toContain(change.id);
    }
    expect(text).toContain(plan.digest);
  });
});

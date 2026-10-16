import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHero } from '@hero-cloud/sdk';
import { describe, expect, it } from 'vitest';

/**
 * Every example folder holds a small application and one or more `expected*.json` files. Hero
 * analyzes the folder through the public SDK and must produce exactly the recorded Hero Spec,
 * open questions, and capabilities. A change in analysis behavior shows up here as a diff.
 */
const examples = join(import.meta.dirname, '..', 'examples');

interface Expected {
  readonly root?: string;
  readonly spec: unknown;
  readonly questions: readonly string[];
  readonly capabilities?: readonly string[];
}

const cases = readdirSync(examples, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) =>
    readdirSync(join(examples, entry.name))
      .filter((file) => /^expected.*\.json$/.test(file))
      .map((file) => ({
        example: entry.name,
        file,
        expected: JSON.parse(readFileSync(join(examples, entry.name, file), 'utf8')) as Expected,
      })),
  );

describe('examples', () => {
  it('has at least the six roadmap examples', () => {
    expect(new Set(cases.map((c) => c.example)).size).toBeGreaterThanOrEqual(6);
  });

  it.each(cases.map((c) => [`${c.example}/${c.file}`, c] as const))(
    '%s',
    async (_label, { example, expected }) => {
      const hero = createHero();
      const analysis = await hero.analyze(
        { kind: 'directory', location: join(examples, example) },
        expected.root === undefined ? {} : { root: expected.root },
      );
      expect(analysis.spec).toEqual(expected.spec);
      expect(analysis.openQuestions.map((q) => q.id).sort()).toEqual(
        [...expected.questions].sort(),
      );
      if (expected.capabilities !== undefined) {
        expect([...new Set(analysis.detections.map((d) => d.capability))].sort()).toEqual(
          [...expected.capabilities].sort(),
        );
      }
      expect(analysis.aiAssisted).toBe(false);
      expect(analysis.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it('is stable: analyzing twice gives the same result', async () => {
    const hero = createHero();
    const source = { kind: 'directory', location: join(examples, 'api-dynamodb') } as const;
    expect(await hero.analyze(source)).toEqual(await hero.analyze(source));
  });
});

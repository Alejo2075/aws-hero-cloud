import { describe, expect, it } from 'vitest';
import { audienceLevels } from './audience.js';
import { en, es } from './catalogs/index.js';
import { placeholders } from './messages.js';
import type { Message } from './types.js';

/** Codes whose message is intentionally empty at some level (evidence is hidden from beginners). */
const MAY_BE_EMPTY = (code: string): boolean =>
  code.startsWith('evidence.') ||
  code === 'view.analysis.ai' ||
  code === 'view.plan.cost.confidence';

/** Codes that the simple view never renders. */
const EXPERT_OR_GUIDED_ONLY = [
  'capability.',
  'evidence.',
  'column.',
  'meta.',
  'skipped.',
  'cli.',
  'view.section.spec',
  'view.section.detections',
  'view.section.skipped',
  'view.section.details',
];

const textAt = (message: Message, level: (typeof audienceLevels)[number]): string =>
  typeof message === 'string' ? message : message[level];

describe('message catalogs', () => {
  it('define exactly the same codes in every locale', () => {
    expect(Object.keys(es.messages).sort()).toEqual(Object.keys(en.messages).sort());
  });

  for (const catalog of [en, es]) {
    describe(catalog.locale, () => {
      it('gives every level-specific message all three levels', () => {
        for (const [code, message] of Object.entries(catalog.messages)) {
          if (typeof message === 'string') continue;
          expect(Object.keys(message).sort(), code).toEqual([...audienceLevels].sort());
        }
      });

      it('has no empty message, except where hiding detail from beginners is intended', () => {
        for (const [code, message] of Object.entries(catalog.messages)) {
          for (const level of audienceLevels) {
            if (MAY_BE_EMPTY(code) && level !== 'expert') continue;
            expect(textAt(message, level).trim(), `${code} at ${level}`).not.toBe('');
          }
        }
      });

      it('uses well-formed placeholders', () => {
        for (const [code, message] of Object.entries(catalog.messages)) {
          for (const level of audienceLevels) {
            const text = textAt(message, level);
            expect(text.replace(/\{[A-Za-z0-9_.-]+\}/g, ''), `${code} at ${level}`).not.toMatch(
              /[{}]/,
            );
          }
        }
      });
    });
  }

  it('uses the same placeholders in every locale for every level', () => {
    for (const [code, message] of Object.entries(en.messages)) {
      const other = es.messages[code];
      if (other === undefined) continue;
      for (const level of audienceLevels) {
        const wanted = [...new Set(placeholders(textAt(message, level)))].sort();
        const got = [...new Set(placeholders(textAt(other, level)))].sort();
        expect(got, `${code} at ${level}`).toEqual(wanted);
      }
    }
  });

  it('keeps the simple level free of technical jargon', () => {
    const jargon =
      /\b(package\.json|dependency|dependencies|npm|pnpm|sha-?256|hash|ORM|runtime|IAM|YAML|Hero Spec|CloudFormation|API Gateway|Lambda|DynamoDB|stack|sts:)\b/i;
    for (const [code, message] of Object.entries(en.messages)) {
      // These are shown only to guided and expert readers, so jargon is expected in them.
      if (EXPERT_OR_GUIDED_ONLY.some((prefix) => code.startsWith(prefix))) continue;
      const simple = textAt(message, 'simple');
      expect(simple, `${code} (simple)`).not.toMatch(jargon);
    }
  });
});

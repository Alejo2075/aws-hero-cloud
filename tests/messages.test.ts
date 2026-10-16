import { analyzerQuestionCodes } from '@hero-cloud/analyzer';
import { errorCodes } from '@hero-cloud/core';
import { nodeQuestionCodes } from '@hero-cloud/plugin-node';
import { evidenceKinds, standardCapabilities } from '@hero-cloud/plugin-sdk';
import { audienceLevels, defaultCatalogs, presentationCodes } from '@hero-cloud/presentation';
import type { Message } from '@hero-cloud/presentation';
import { describe, expect, it } from 'vitest';

/**
 * Every code the system can emit must have words at every audience level in every shipped locale.
 * Producers (engine, analyzer, plugins) publish their codes; this test is the gate that fails the
 * build when someone adds a code and forgets its messages (ADR: levels are views, wording lives in
 * `presentation`).
 */
const REQUIRED: readonly (readonly [string, readonly string[]])[] = [
  ['error.', errorCodes],
  ['question.', [...analyzerQuestionCodes, ...nodeQuestionCodes]],
  ['capability.', standardCapabilities],
  ['evidence.', evidenceKinds],
];

const textAt = (message: Message, level: (typeof audienceLevels)[number]): string =>
  typeof message === 'string' ? message : message[level];

describe('every code has a message at every level in every locale', () => {
  for (const catalog of defaultCatalogs) {
    for (const [prefix, codes] of REQUIRED) {
      it(`${catalog.locale}: ${prefix}*`, () => {
        for (const code of codes) {
          const message = catalog.messages[`${prefix}${code}`];
          expect(message, `${catalog.locale} is missing ${prefix}${code}`).toBeDefined();
          if (message === undefined) continue;
          for (const level of audienceLevels) {
            const evidenceMayBeEmpty = prefix === 'evidence.' && level !== 'expert';
            if (!evidenceMayBeEmpty) {
              expect(
                textAt(message, level).trim(),
                `${catalog.locale} ${prefix}${code} at ${level}`,
              ).not.toBe('');
            }
          }
        }
      });
    }
  }

  it('has no message for a code that no longer exists (so catalogs do not rot)', () => {
    const known = new Set<string>([
      ...REQUIRED.flatMap(([prefix, codes]) => codes.map((code) => `${prefix}${code}`)),
      ...presentationCodes,
    ]);
    for (const catalog of defaultCatalogs) {
      for (const key of Object.keys(catalog.messages)) {
        const governed = REQUIRED.some(([prefix]) => key.startsWith(prefix));
        // `evidence.<kind>.<value>` words one specific piece of evidence of a known kind.
        const specificEvidence =
          key.startsWith('evidence.') &&
          (evidenceKinds as readonly string[]).includes(key.split('.')[1] ?? '');
        if (governed)
          expect(
            known.has(key) || specificEvidence,
            `${catalog.locale}: ${key} has no producer`,
          ).toBe(true);
      }
    }
  });
});

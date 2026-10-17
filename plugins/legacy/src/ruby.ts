import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type { Detection, OpenQuestion } from '@hero-cloud/core';
import { text } from './shared.js';

/** Ruby on Rails applications. */
export const rubyDetector = defineDetector({
  id: 'legacy/ruby',
  description: 'Ruby on Rails applications',
  async detect(context) {
    if (!context.has('Gemfile')) return emptyFinding;
    const gemfile = (await text(context, 'Gemfile', 64 * 1024)) ?? '';
    if (!/^\s*gem\s+['"]rails['"]/m.test(gemfile)) return emptyFinding;

    const detections: Detection[] = [
      { capability: 'http-service', confidence: 0.85, evidence: ['dependency:rails'] },
    ];
    const contributions: Contribution[] = [
      {
        kind: 'service',
        value: { id: 'web', type: 'http', runtime: 'ruby', port: 3000, healthPath: '/up' },
        confidence: 0.85,
      },
    ];
    const questions: OpenQuestion[] = [];
    if (/^\s*gem\s+['"]pg['"]/m.test(gemfile)) {
      detections.push({
        capability: 'relational-data',
        confidence: 0.9,
        evidence: ['dependency:pg'],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine: 'postgres' },
        confidence: 0.9,
      });
    } else if (/^\s*gem\s+['"]mysql2['"]/m.test(gemfile)) {
      detections.push({
        capability: 'relational-data',
        confidence: 0.9,
        evidence: ['dependency:mysql2'],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine: 'mysql' },
        confidence: 0.9,
      });
    } else if (/^\s*gem\s+['"]sqlite3['"]/m.test(gemfile)) {
      questions.push({ id: 'data.sqlite-persistence', code: 'data.sqlite-persistence' });
    }
    return { detections, contributions, questions };
  },
});

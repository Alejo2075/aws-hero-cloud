import { describe, expect, it } from 'vitest';
import { cronRunsPerMonth } from './cron.js';

describe('cronRunsPerMonth', () => {
  it.each([
    ['0 * * * *', 24 * 30],
    ['*/15 * * * *', 4 * 24 * 30],
    ['* * * * *', 60 * 24 * 30],
    ['0 9 * * 1', 1 * 1 * 30],
    ['0,30 8-17 * * *', 2 * 10 * 30],
    ['0 0 * * *', 30],
    ['5 4 * * *', 30],
    ['*/30 */6 * * *', 2 * 4 * 30],
  ])('counts %s as %i runs', (expression, runs) => {
    expect(cronRunsPerMonth(expression)).toBe(runs);
  });

  it.each([
    '',
    'daily',
    '0 * * *',
    '0 * * * * *',
    '60 * * * *',
    '* 24 * * *',
    '*/0 * * * *',
    '5-1 * * * *',
    '@hourly',
    'a b c d e',
  ])('cannot read %j', (expression) => {
    expect(cronRunsPerMonth(expression)).toBeUndefined();
  });
});

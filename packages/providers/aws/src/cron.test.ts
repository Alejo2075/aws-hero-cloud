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

import { toAwsCron } from './cron.js';

describe('toAwsCron', () => {
  it.each([
    ['0 * * * *', 'cron(0 * * * ? *)'],
    ['*/5 * * * *', 'cron(*/5 * * * ? *)'],
    ['30 2 * * *', 'cron(30 2 * * ? *)'],
    ['0,30 8-17 * * *', 'cron(0,30 8-17 * * ? *)'],
    ['0 9 * * 1', 'cron(0 9 ? * 2 *)'],
    ['0 9 * * 0', 'cron(0 9 ? * 1 *)'],
    ['0 9 * * 7', 'cron(0 9 ? * 1 *)'],
    ['0 9 * * 6', 'cron(0 9 ? * 7 *)'],
    ['0 9 * * 1-5', 'cron(0 9 ? * 2,3,4,5,6 *)'],
    ['0 9 * * 0,6', 'cron(0 9 ? * 1,7 *)'],
    ['0 9 1 * *', 'cron(0 9 1 * ? *)'],
    ['0 0 1 1 *', 'cron(0 0 1 1 ? *)'],
    ['0-30/10 * * * *', 'cron(0,10,20,30 * * * ? *)'],
    ['  5   4  *  *  *  ', 'cron(5 4 * * ? *)'],
  ])('converts %s', (unix, aws) => {
    expect(toAwsCron(unix)).toBe(aws);
  });

  it.each([
    ['', 'empty'],
    ['0 * * *', 'four fields'],
    ['0 * * * * *', 'six fields'],
    ['60 * * * *', 'minute out of range'],
    ['* 24 * * *', 'hour out of range'],
    ['* * 0 * *', 'day of month zero'],
    ['* * 32 * *', 'day of month out of range'],
    ['* * * 13 *', 'month out of range'],
    ['* * * * 8', 'weekday out of range'],
    ['0 9 1 * 1', 'both day fields set (Unix means either, AWS cannot)'],
    ['*/0 * * * *', 'zero step'],
    ['5-1 * * * *', 'descending range'],
    ['@daily', 'a nickname'],
    ['0 9 * * MON', 'a weekday name'],
  ])('refuses %j (%s)', (expression) => {
    expect(toAwsCron(expression)).toBeUndefined();
  });

  it('never schedules something different from what was written: every result has six fields with one ?', () => {
    for (const expression of ['0 * * * *', '0 9 * * 1', '0 9 1 * *', '*/15 */2 * * 1-5']) {
      const aws = toAwsCron(expression);
      expect(aws).toMatch(/^cron\(\S+ \S+ \S+ \S+ \S+ \*\)$/);
      expect(aws?.split('?').length).toBe(2);
    }
  });
});

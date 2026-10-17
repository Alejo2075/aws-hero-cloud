import type { Component } from '@hero-cloud/core';
import { describe, expect, it } from 'vitest';
import { estimateCost } from './cost.js';
import { awsCostLineCodes } from './resources.js';
import { builtInPriceBook } from './prices/book.js';
import type { PriceBook } from './prices/book.js';

const book = builtInPriceBook('us-east-1');
const component = (
  kind: Component['kind'],
  id: string,
  settings: Component['settings'] = {},
): Component => ({
  id,
  kind,
  capability: 'x',
  settings,
  rationale: [],
});
const cost = (components: Component[], prices: PriceBook = book) =>
  estimateCost({ components, prices });
const line = (c: ReturnType<typeof cost>, code: string) => c.lines.find((l) => l.code === code);

describe('estimateCost', () => {
  it('a static site is essentially free: the CDN allowance covers it', () => {
    const c = cost([component('static-site', 'site'), component('budget-alert', 'budget')]);
    expect(line(c, 'cdn-delivery')).toEqual({
      code: 'cdn-delivery',
      monthlyLow: 0,
      monthlyHigh: 0,
    });
    expect(c.monthlyHigh).toBeLessThan(0.1);
    expect(c.monthlyLow).toBe(0);
  });

  it('an API charges per request and nothing for the first million Lambda requests', () => {
    const c = cost([component('http-service', 'api', { port: 3000 })]);
    // 1,000,000 requests at $1 per million.
    expect(line(c, 'api-requests')?.monthlyHigh).toBe(1);
    expect(line(c, 'api-requests')?.monthlyLow).toBe(0);
    // 1,000,000 requests and 125,000 GB-seconds are both inside the Lambda allowance.
    expect(line(c, 'function-compute')?.monthlyHigh).toBe(0);
  });

  it('prices database reads and writes from the price book', () => {
    const c = cost([component('key-value-table', 'kv')]);
    // High: 1M requests x (2 reads x $0.125/M + 0.5 writes x $0.625/M) + PITR on 1 GB ($0.20) = 0.5625 + 0.2.
    expect(line(c, 'database-operations')?.monthlyHigh).toBe(0.56);
    expect(line(c, 'database-storage')?.monthlyHigh).toBe(0.2);
    // The first 25 GB of table storage are free, so only point-in-time recovery costs anything.
  });

  it('uses the prices it is given', () => {
    const doubled: PriceBook = {
      ...book,
      prices: { ...book.prices, 'apigw.http-request': book.prices['apigw.http-request'] * 2 },
    };
    expect(
      line(cost([component('http-service', 'api')], doubled), 'api-requests')?.monthlyHigh,
    ).toBe(2);
  });

  describe('scheduled jobs depend on how often they run', () => {
    it('an hourly job stays inside the free allowance', () => {
      const c = cost([component('scheduled-job', 'jobs', { schedule: '0 * * * *' })]);
      expect(line(c, 'function-compute')?.monthlyHigh).toBe(0);
    });

    it('a job that runs every minute does not', () => {
      const c = cost([component('scheduled-job', 'jobs', { schedule: '* * * * *' })]);
      // 43,200 runs x 30 s x 0.5 GB = 648,000 GB-s; 248,000 are billable at $0.0000133334.
      expect(line(c, 'function-compute')?.monthlyHigh).toBe(3.31);
    });

    it('assumes an hourly job when the schedule cannot be read', () => {
      const a = cost([component('scheduled-job', 'jobs', { schedule: 'nonsense' })]);
      const b = cost([component('scheduled-job', 'jobs', { schedule: '0 * * * *' })]);
      expect(a).toEqual(b);
    });
  });

  it('sign-in is free below the free allowance of monthly users', () => {
    expect(line(cost([component('identity', 'users')]), 'sign-in')).toEqual({
      code: 'sign-in',
      monthlyLow: 0,
      monthlyHigh: 0,
    });
  });

  it('the total is the sum of the lines, and the high end is never below the low end', () => {
    const c = cost([
      component('static-site', 'site'),
      component('http-service', 'api'),
      component('key-value-table', 'kv'),
      component('object-bucket', 'assets'),
      component('identity', 'users'),
      component('budget-alert', 'budget'),
    ]);
    const sum = (key: 'monthlyLow' | 'monthlyHigh') =>
      c.lines.reduce((total, l) => total + l[key], 0);
    expect(Math.abs(sum('monthlyHigh') - c.monthlyHigh)).toBeLessThan(0.05);
    expect(Math.abs(sum('monthlyLow') - c.monthlyLow)).toBeLessThan(0.05);
    for (const l of c.lines) expect(l.monthlyHigh).toBeGreaterThanOrEqual(l.monthlyLow);
    expect(c.monthlyHigh).toBeGreaterThan(c.monthlyLow);
    expect(c.monthlyHigh).toBeLessThan(10);
  });

  it('is deterministic and never negative', () => {
    const components = [component('http-service', 'api'), component('key-value-table', 'kv')];
    expect(cost(components)).toEqual(cost(components));
    const c = cost(components);
    for (const l of c.lines) {
      expect(l.monthlyLow).toBeGreaterThanOrEqual(0);
      expect(l.monthlyHigh).toBeGreaterThanOrEqual(0);
    }
  });

  it('states its assumptions as codes, and is honest about confidence and where prices came from', () => {
    const builtIn = cost([component('http-service', 'api')]);
    expect(builtIn.confidence).toBe('low');
    expect(builtIn.priceSource).toBe('built-in');
    expect(builtIn.assumptions.map((a) => a.code)).toEqual(
      expect.arrayContaining([
        'cost.assumption.traffic',
        'cost.assumption.free-tier',
        'cost.assumption.no-domain',
      ]),
    );
    const live: PriceBook = { ...book, source: 'live', asOf: '2026-10-15' };
    const fresh = cost([component('http-service', 'api')], live);
    expect(fresh.confidence).toBe('medium');
    expect(fresh.pricesAsOf).toBe('2026-10-15');
    // Usage can never be known beforehand, so a plan is never "high" confidence.
    expect(fresh.confidence).not.toBe('high');
  });

  it('charges nothing and says so for a plan with only a budget alert', () => {
    const c = cost([component('budget-alert', 'budget')]);
    expect(c.monthlyHigh).toBe(0);
    expect(c.lines).toEqual([]);
  });
});

describe('containers, databases, and shared files', () => {
  const prices = builtInPriceBook('us-east-1');
  const component = (
    kind: Component['kind'],
    id: string,
    settings: Component['settings'] = {},
  ): Component => ({
    id,
    kind,
    capability: kind,
    settings,
    rationale: [],
  });
  const service = component('container-service', 'api', { cpu: 256, memoryMb: 512 });
  const db = component('relational-database', 'db', { storageGb: 20 });
  const files = component('file-system', 'files');

  it('counts the load balancer, addresses, and sign-in secret once, however many pieces there are', () => {
    const one = estimateCost({ components: [service], prices });
    const lines = Object.fromEntries(one.lines.map((l) => [l.code, l]));
    expect(lines['load-balancer']?.monthlyLow).toBeGreaterThan(15);
    expect(lines['container-compute']?.monthlyLow).toBeCloseTo(7.21, 1);
    expect(lines['public-addresses']?.monthlyLow).toBeCloseTo(10.95, 1);
    expect(lines.secrets?.monthlyLow).toBe(0.4);
    const full = estimateCost({ components: [service, db, files], prices });
    const fullLines = Object.fromEntries(full.lines.map((l) => [l.code, l]));
    expect(fullLines['load-balancer']).toEqual(lines['load-balancer']);
    expect(fullLines['public-addresses']).toEqual(lines['public-addresses']);
    expect(fullLines.secrets?.monthlyLow).toBe(0.8);
    expect(fullLines['managed-database']?.monthlyLow).toBeCloseTo(11.68, 1);
    expect(fullLines['managed-database-storage']?.monthlyLow).toBe(2.3);
    expect(fullLines['shared-files']).toBeDefined();
  });

  it('is a range that costs far more than the same application as functions, and says it is a rough one', () => {
    const container = estimateCost({ components: [service, db], prices });
    expect(container.monthlyLow).toBeGreaterThan(40);
    expect(container.monthlyHigh).toBeGreaterThan(container.monthlyLow);
    expect(container.confidence).toBe('low');
    expect(container.assumptions.map((a) => a.code)).toContain('cost.assumption.container-prices');
    const serverless = estimateCost({ components: [component('http-service', 'api')], prices });
    expect(serverless.monthlyHigh).toBeLessThan(container.monthlyLow);
  });

  it('only uses cost line codes it knows how to word', () => {
    const { lines } = estimateCost({ components: [service, db, files], prices });
    for (const l of lines) expect(awsCostLineCodes).toContain(l.code);
  });
});

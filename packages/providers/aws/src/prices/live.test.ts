import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILT_IN_AS_OF, BUILT_IN_PRICES, priceKeys } from './book.js';
import { PRICE_SOURCES, loadLivePrices, loadPriceBook } from './live.js';
import type { FetchText } from './live.js';
import { builtInPriceBook } from './book.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'test-fixtures', 'pricing');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Serves the real (trimmed) AWS price files and records every URL that was asked for. */
function fixtureFetch(overrides: Record<string, string> = {}): {
  fetchText: FetchText;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchText: FetchText = async (url) => {
    urls.push(url);
    const service = /offers\/v1\.0\/aws\/([A-Za-z0-9]+)\//.exec(url)?.[1] ?? '';
    return overrides[service] ?? (await readFile(join(FIXTURES, `${service}.json`), 'utf8'));
  };
  return { fetchText, urls };
}

async function cacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hero-prices-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('loadLivePrices', () => {
  it('reads the real AWS price files and gets the same prices Hero ships built in', async () => {
    const { fetchText } = fixtureFetch();
    const book = await loadLivePrices({ region: 'us-east-1', fetchText });
    expect(book?.source).toBe('live');
    expect(book?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((book?.asOf ?? '') >= BUILT_IN_AS_OF).toBe(true);
    for (const key of priceKeys) {
      if (
        key === 'cloudfront.transfer-gb' ||
        key === 'cloudfront.https-request' ||
        key === 'logs.storage-gb'
      )
        continue;
      expect(book?.prices[key], key).toBeCloseTo(BUILT_IN_PRICES[key], 10);
    }
  });

  it('picks the standard product, never a variant with a different price', async () => {
    const book = await loadLivePrices({ region: 'us-east-1', fetchText: fixtureFetch().fetchText });
    // Infrequent-access tables charge $0.78 per million writes; replica writes are a separate product.
    expect(book?.prices['dynamodb.write-unit']).toBeCloseTo(0.000000625, 12);
    expect(book?.prices['dynamodb.read-unit']).toBeCloseTo(0.000000125, 12);
    expect(book?.prices['dynamodb.storage-gb']).toBeCloseTo(0.25, 6);
  });

  it('asks only the public AWS price host, over HTTPS, and never sends credentials', async () => {
    const { fetchText, urls } = fixtureFetch();
    await loadLivePrices({ region: 'eu-west-1', fetchText });
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/')).toBe(true);
      expect(url).toContain('/eu-west-1/index.json');
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('caches prices and reuses them while they are fresh', async () => {
    const directory = await cacheDir();
    const first = fixtureFetch();
    const now = new Date('2026-10-20T00:00:00Z');
    const live = await loadLivePrices({
      region: 'us-east-1',
      cacheDirectory: directory,
      fetchText: first.fetchText,
      now: () => now,
    });
    expect(live?.source).toBe('live');

    const second = fixtureFetch();
    const cached = await loadLivePrices({
      region: 'us-east-1',
      cacheDirectory: directory,
      fetchText: second.fetchText,
      now: () => new Date('2026-10-22T00:00:00Z'),
    });
    expect(cached?.source).toBe('cache');
    expect(second.urls).toEqual([]);
    expect(cached?.prices).toEqual(live?.prices);
  });

  it('refreshes a stale cache', async () => {
    const directory = await cacheDir();
    await loadLivePrices({
      region: 'us-east-1',
      cacheDirectory: directory,
      fetchText: fixtureFetch().fetchText,
      now: () => new Date('2026-10-01T00:00:00Z'),
    });
    const again = fixtureFetch();
    const book = await loadLivePrices({
      region: 'us-east-1',
      cacheDirectory: directory,
      fetchText: again.fetchText,
      now: () => new Date('2026-12-01T00:00:00Z'),
    });
    expect(book?.source).toBe('live');
    expect(again.urls.length).toBeGreaterThan(0);
  });

  it('ignores a corrupted or tampered cache', async () => {
    const directory = await cacheDir();
    await writeFile(join(directory, 'prices-us-east-1.json'), '{"not":"a price book"}');
    expect(
      (
        await loadLivePrices({
          region: 'us-east-1',
          cacheDirectory: directory,
          fetchText: fixtureFetch().fetchText,
        })
      )?.source,
    ).toBe('live');
    const poisoned = JSON.stringify({
      fetchedAt: new Date().toISOString(),
      asOf: '2026-10-13',
      region: 'us-east-1',
      prices: { ...BUILT_IN_PRICES, 'apigw.http-request': 999 },
    });
    await writeFile(join(directory, 'prices-us-east-1.json'), poisoned);
    const book = await loadLivePrices({
      region: 'us-east-1',
      cacheDirectory: directory,
      fetchText: fixtureFetch().fetchText,
    });
    expect(book?.source).toBe('live');
    expect(book?.prices['apigw.http-request']).toBeCloseTo(0.000001, 10);
  });

  describe('falls back instead of failing or trusting bad data', () => {
    it('when the network fails', async () => {
      const fetchText: FetchText = () => Promise.reject(new Error('offline'));
      expect(await loadLivePrices({ region: 'us-east-1', fetchText })).toBeUndefined();
    });

    it('when a file is not JSON', async () => {
      expect(
        await loadLivePrices({
          region: 'us-east-1',
          fetchText: fixtureFetch({ AWSLambda: '<html>' }).fetchText,
        }),
      ).toBeUndefined();
    });

    it('when a price is absurd', async () => {
      const real = JSON.parse(await readFile(join(FIXTURES, 'AmazonApiGateway.json'), 'utf8')) as {
        terms: {
          OnDemand: Record<
            string,
            Record<string, { priceDimensions: Record<string, { pricePerUnit: { USD: string } }> }>
          >;
        };
      };
      for (const offer of Object.values(real.terms.OnDemand)) {
        for (const term of Object.values(offer)) {
          for (const dimension of Object.values(term.priceDimensions))
            dimension.pricePerUnit.USD = '1000000';
        }
      }
      const result = await loadLivePrices({
        region: 'us-east-1',
        fetchText: fixtureFetch({ AmazonApiGateway: JSON.stringify(real) }).fetchText,
      });
      expect(result).toBeUndefined();
    });

    it('for a region name that could change the URL', async () => {
      const { fetchText, urls } = fixtureFetch();
      for (const region of [
        '../../etc',
        'us-east-1/../x',
        'US-EAST-1',
        '',
        'us east 1',
        'us-east-1\n',
      ]) {
        expect(await loadLivePrices({ region, fetchText }), region).toBeUndefined();
      }
      expect(urls).toEqual([]);
    });
  });

  it('never needs the network when it is not allowed', async () => {
    const { fetchText, urls } = fixtureFetch();
    const fallback = builtInPriceBook('us-east-1');
    const book = await loadPriceBook(
      { region: 'us-east-1', allowNetwork: false, fetchText },
      fallback,
    );
    expect(book).toBe(fallback);
    expect(urls).toEqual([]);
  });

  it('uses the built-in table when live prices cannot be had', async () => {
    const fallback = builtInPriceBook('us-east-1');
    const book = await loadPriceBook(
      {
        region: 'us-east-1',
        allowNetwork: true,
        fetchText: () => Promise.reject(new Error('down')),
      },
      fallback,
    );
    expect(book.source).toBe('built-in');
  });

  it('knows where every price comes from, exactly once', () => {
    const keys = PRICE_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

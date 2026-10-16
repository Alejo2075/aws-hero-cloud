import { describe, expect, it } from 'vitest';
import { HeroError, isHeroError } from './errors.js';

describe('HeroError', () => {
  it('carries a code and parameters, and serializes without the cause', () => {
    const error = new HeroError('source.too-large', {
      params: { limit: 10 },
      cause: new Error('secret=abc'),
    });
    expect(error.code).toBe('source.too-large');
    expect(JSON.stringify(error)).toBe('{"code":"source.too-large","params":{"limit":10}}');
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('is recognized by isHeroError', () => {
    expect(isHeroError(new HeroError('x'))).toBe(true);
    expect(isHeroError(new Error('x'))).toBe(false);
  });
});

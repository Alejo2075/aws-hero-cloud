import { describe, expect, it } from 'vitest';
import { errorCodes, heroError } from './errors.js';

describe('error codes', () => {
  it('are unique and namespaced', () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
    for (const code of errorCodes) expect(code).toMatch(/^[a-z]+\.[a-z-]+$/);
  });

  it('create typed errors without leaking the cause', () => {
    const error = heroError('source.too-large', { limit: 5 }, new Error('token=abc'));
    expect(error.code).toBe('source.too-large');
    expect(JSON.stringify(error)).not.toContain('token');
  });
});

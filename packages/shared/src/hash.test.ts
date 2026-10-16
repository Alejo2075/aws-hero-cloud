import { describe, expect, it } from 'vitest';
import { digestsEqual, sha256Hex } from './hash.js';

describe('sha256Hex', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes bytes and text identically', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(sha256Hex('abc'));
  });
});

describe('digestsEqual', () => {
  it('compares digests', () => {
    expect(digestsEqual('aa', 'aa')).toBe(true);
    expect(digestsEqual('aa', 'ab')).toBe(false);
    expect(digestsEqual('aa', 'aaa')).toBe(false);
  });
});

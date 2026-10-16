import { describe, expect, it } from 'vitest';
import { computeSnapshotHash } from './snapshot.js';

const A = { path: 'a.txt', size: 1, sha256: '1'.repeat(64) };
const B = { path: 'dir/b.txt', size: 2, sha256: '2'.repeat(64) };

describe('computeSnapshotHash', () => {
  it('does not depend on the order of the files', () => {
    expect(computeSnapshotHash([A, B])).toBe(computeSnapshotHash([B, A]));
  });

  it('changes when a path, size, or content hash changes', () => {
    const base = computeSnapshotHash([A, B]);
    expect(computeSnapshotHash([{ ...A, path: 'c.txt' }, B])).not.toBe(base);
    expect(computeSnapshotHash([{ ...A, size: 9 }, B])).not.toBe(base);
    expect(computeSnapshotHash([{ ...A, sha256: '3'.repeat(64) }, B])).not.toBe(base);
    expect(computeSnapshotHash([A])).not.toBe(base);
  });
});

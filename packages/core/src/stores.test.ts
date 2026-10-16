import { describe, expect, it } from 'vitest';
import { samplePlan } from './fixtures.js';
import { InMemoryPlanStore, InMemoryStateStore } from './stores.js';

describe('InMemoryPlanStore', () => {
  it('returns only plans it was given', async () => {
    const store = new InMemoryPlanStore();
    const plan = samplePlan();
    await store.put(plan);
    expect(await store.get(plan.id)).toEqual(plan);
    expect(await store.get('plan_unknown')).toBeUndefined();
  });
});

describe('InMemoryStateStore', () => {
  it('reads, writes, and lists', async () => {
    const store = new InMemoryStateStore();
    expect(await store.read('d1')).toBeUndefined();
    await store.write('d1', { ok: true });
    expect(await store.read('d1')).toEqual({ ok: true });
    expect(await store.list()).toEqual(['d1']);
  });
});

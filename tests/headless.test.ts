import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CloudProvider } from '@hero-cloud/core';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { createHero } from '@hero-cloud/sdk';
import { describe, expect, it } from 'vitest';
import { deployFolder } from '../examples/headless/deploy.mjs';

const folder = resolve(import.meta.dirname, '..', 'examples', 'spa');

function cloud(): { cloud: CloudProvider; applied: number[] } {
  const applied: number[] = [];
  const real = createAwsProvider();
  return {
    applied,
    cloud: {
      id: 'aws',
      describe: (request) => real.describe(request),
      identity: () =>
        Promise.resolve({ account: '123456789012', principal: 'arn:test', kind: 'role' }),
      apply: () => {
        applied.push(1);
        return Promise.resolve({ endpoints: [], resources: [], sensitiveOutputs: [], links: [] });
      },
    },
  };
}

describe('examples/headless', () => {
  it('uses nothing but the SDK', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'examples', 'headless', 'deploy.mjs'),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['@hero-cloud/sdk']);
  });

  it('deploys when the product says a person approved, and not otherwise', async () => {
    const yes = cloud();
    const done = await deployFolder(createHero({ cloud: yes.cloud }), folder, {
      approve: () => true,
      budgetEmail: 'me@example.com',
    });
    expect(done.status).not.toBe('blocked');
    expect(yes.applied).toEqual([1]);

    const no = cloud();
    const declined = await deployFolder(createHero({ cloud: no.cloud }), folder, {
      approve: () => false,
      budgetEmail: 'me@example.com',
    });
    expect(declined.status).toBe('declined');
    expect(no.applied).toEqual([]);
  });
});

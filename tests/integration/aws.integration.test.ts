import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Component } from '@hero-cloud/core';
import {
  createAwsProvider,
  createBootstrapper,
  createDeployer,
  describeBootstrap,
  getIdentity,
  synthesize,
} from '@hero-cloud/provider-aws';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Runs against a real, isolated AWS account. It is skipped unless `HERO_INTEGRATION=1` is set and
 * credentials for a sandbox account are available. Every run destroys what it creates, and the
 * account should have a budget alert. Never point this at an account that holds real data.
 */
const enabled = process.env.HERO_INTEGRATION === '1';
const region = process.env.HERO_INTEGRATION_REGION ?? 'us-east-1';

const site: Component = {
  id: 'site',
  kind: 'static-site',
  capability: 'static-site',
  settings: {},
  rationale: [],
};

describe.skipIf(!enabled)('AWS sandbox account', () => {
  const directories: string[] = [];
  afterAll(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });

  it('knows who it is and is not the account owner', async () => {
    const identity = await getIdentity({ region });
    expect(identity.account).toMatch(/^\d{12}$/);
    expect(identity.kind).not.toBe('other');
  });

  it('prepares the account, deploys a static site, and removes it again', async () => {
    const { account } = await getIdentity({ region });
    const target = { accountId: account, region };

    await createBootstrapper({ region }).run({
      ...target,
      artifactHash: describeBootstrap(target).artifactHash,
      approved: true,
    });

    const directory = mkdtempSync(join(tmpdir(), 'hero-integration-'));
    directories.push(directory);
    const assembly = synthesize(
      {
        deploymentId: `hero-it-${Date.now().toString(36)}`,
        accountId: account,
        region,
        components: [site],
      },
      directory,
    );
    const request = {
      assemblyDirectory: directory,
      artifactHash: assembly.hash,
      accountId: account,
      region,
      approved: true,
    };
    const deployer = createDeployer();
    try {
      const outcome = await deployer.deploy(request);
      expect(outcome.stackName).toBe(assembly.stackName);
    } finally {
      await deployer.destroy(request);
    }
  }, 1_800_000);

  it('plans without credentials', async () => {
    const result = await createAwsProvider().describe({
      strategy: 'static',
      components: [site],
      region,
      accountId: '123456789012',
      deploymentId: 'hero-it-plan',
      inputs: [],
      allowNetwork: false,
    });
    expect(result.changes.length).toBeGreaterThan(0);
  });
});

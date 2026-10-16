import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Component, HeroEvent } from '@hero-cloud/core';
import { afterAll, describe, expect, it } from 'vitest';
import { synthesize } from '../cdk/synth.js';
import { verifyAssembly } from './assembly.js';
import { createDeployer } from './deployer.js';
import type { DeployRequest, ToolkitPort } from './deployer.js';
import { createGuardedIoHost } from './guard.js';

const site: Component = {
  id: 'site',
  kind: 'static-site',
  capability: 'static-site',
  settings: {},
  rationale: [],
};
const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
const made: string[] = [];

function assembly() {
  const directory = mkdtempSync(join(tmpdir(), 'hero-deploy-test-'));
  made.push(directory);
  const result = synthesize(
    { deploymentId: 'hero-shop', accountId: ACCOUNT, region: REGION, components: [site] },
    directory,
  );
  return { directory, hash: result.hash, stackName: result.stackName };
}
afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

describe('the guarded IoHost', () => {
  const confirm = (code: string) => ({ code, defaultResponse: false });

  it('answers yes only to what the approved plan covers', async () => {
    const host = createGuardedIoHost({ approved: true });
    await expect(host.requestResponse(confirm('CDK_TOOLKIT_I5060'))).resolves.toBe(true);
    await expect(host.requestResponse(confirm('CDK_TOOLKIT_I5050'))).resolves.toBe(false);
    await expect(host.requestResponse(confirm('CDK_TOOLKIT_I7010'))).resolves.toBe(false);
    await expect(host.requestResponse(confirm('CDK_FUTURE_I9999'))).resolves.toBe(false);
  });

  it('answers no to everything when nothing was approved, and reports what it refused', async () => {
    const refused: string[] = [];
    const host = createGuardedIoHost({ approved: false, onRefused: (c) => refused.push(c) });
    await expect(host.requestResponse(confirm('CDK_TOOLKIT_I5060'))).resolves.toBe(false);
    expect(refused).toEqual(['CDK_TOOLKIT_I5060']);
  });

  it('leaves requests that are not yes/no on the toolkit default', async () => {
    const host = createGuardedIoHost({ approved: true });
    await expect(host.requestResponse({ code: 'CDK_X_I0001', defaultResponse: 'x' })).resolves.toBe(
      'x',
    );
  });

  it('turns messages into coded notices without their text', async () => {
    const events: HeroEvent[] = [];
    const host = createGuardedIoHost({ approved: true, emit: (e) => events.push(e) });
    await host.notify({ code: 'CDK_TOOLKIT_I5000', level: 'info', message: 'secret=hunter2' });
    await host.notify({ level: 'info', message: 'no code' });
    await host.notify({ code: 'CDK_TOOLKIT_I0001', level: 'debug', message: 'noise' });
    await host.notify({ code: 'CDK_TOOLKIT_W0001', level: 'warn', message: 'x' });
    expect(events).toEqual([
      { type: 'notice', level: 'info', code: 'toolkit.CDK_TOOLKIT_I5000' },
      { type: 'notice', level: 'warning', code: 'toolkit.CDK_TOOLKIT_W0001' },
    ]);
    expect(JSON.stringify(events)).not.toContain('hunter2');
  });
});

describe('verifyAssembly', () => {
  it('accepts the assembly that was approved', () => {
    const a = assembly();
    expect(
      verifyAssembly(a.directory, { hash: a.hash, accountId: ACCOUNT, region: REGION }),
    ).toEqual({ directory: a.directory, stackName: a.stackName });
  });

  it('refuses a changed template, another account or region, or a wrong hash', () => {
    const a = assembly();
    const ok = { hash: a.hash, accountId: ACCOUNT, region: REGION };
    expect(() => verifyAssembly(a.directory, { ...ok, accountId: '999999999999' })).toThrow();
    expect(() => verifyAssembly(a.directory, { ...ok, region: 'eu-west-1' })).toThrow();
    expect(() => verifyAssembly(a.directory, { ...ok, hash: '0'.repeat(64) })).toThrow();
    const file = join(a.directory, `${a.stackName}.template.json`);
    const template = JSON.parse(readFileSync(file, 'utf8')) as {
      Resources: Record<string, unknown>;
    };
    template.Resources.Evil = { Type: 'AWS::IAM::User' };
    writeFileSync(file, JSON.stringify(template));
    expect(() => verifyAssembly(a.directory, ok)).toThrow();
  });

  it('refuses a folder that is not an assembly', () => {
    const empty = mkdtempSync(join(tmpdir(), 'hero-deploy-empty-'));
    made.push(empty);
    expect(() =>
      verifyAssembly(empty, { hash: 'a'.repeat(64), accountId: ACCOUNT, region: REGION }),
    ).toThrow();
    appendFileSync(join(empty, 'manifest.json'), '{"artifacts":{}}');
    expect(() =>
      verifyAssembly(empty, { hash: 'a'.repeat(64), accountId: ACCOUNT, region: REGION }),
    ).toThrow();
  });
});

describe('createDeployer', () => {
  function fakeToolkit() {
    const calls: string[] = [];
    const answers: boolean[] = [];
    const toolkit: ToolkitPort = {
      fromAssemblyDirectory: (directory) => {
        calls.push(`source:${directory}`);
        return Promise.resolve({ directory });
      },
      deploy: (_source, options) => {
        calls.push(`deploy:${JSON.stringify(options.parameters)}:${String(options.rollback)}`);
        return Promise.resolve({ stacks: [{ outputs: { SiteUrl: 'https://d1.example' } }] });
      },
      diff: () => Promise.resolve({}),
      destroy: () => {
        calls.push('destroy');
        return Promise.resolve({ stacks: [{ stackExisted: true }] });
      },
    };
    return { toolkit, calls, answers };
  }

  const request = (
    a: ReturnType<typeof assembly>,
    over: Partial<DeployRequest> = {},
  ): DeployRequest => ({
    assemblyDirectory: a.directory,
    artifactHash: a.hash,
    accountId: ACCOUNT,
    region: REGION,
    approved: true,
    ...over,
  });

  it('deploys the stored assembly and returns the stack outputs', async () => {
    const a = assembly();
    const { toolkit, calls } = fakeToolkit();
    const deployer = createDeployer({ toolkit: () => Promise.resolve(toolkit) });
    const outcome = await deployer.deploy(request(a, { parameters: { P: 'v' } }));
    expect(outcome).toEqual({ stackName: a.stackName, outputs: { SiteUrl: 'https://d1.example' } });
    expect(calls).toEqual([`source:${a.directory}`, 'deploy:{"P":"v"}:true']);
  });

  it('does nothing without an approval, and nothing if the assembly is not the approved one', async () => {
    const a = assembly();
    const { toolkit, calls } = fakeToolkit();
    const deployer = createDeployer({ toolkit: () => Promise.resolve(toolkit) });
    await expect(deployer.deploy(request(a, { approved: false }))).rejects.toThrow();
    await expect(deployer.deploy(request(a, { artifactHash: 'f'.repeat(64) }))).rejects.toThrow();
    await expect(deployer.destroy(request(a, { approved: false }))).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('wraps a toolkit failure as deployment.failed, naming the stack and keeping the cause', async () => {
    const a = assembly();
    const { toolkit } = fakeToolkit();
    const failing: ToolkitPort = { ...toolkit, deploy: () => Promise.reject(new Error('boom')) };
    const deployer = createDeployer({ toolkit: () => Promise.resolve(failing) });
    await expect(deployer.deploy(request(a))).rejects.toMatchObject({
      code: 'deployment.failed',
      params: { stack: a.stackName },
    });
  });

  it('destroys through the same verified assembly', async () => {
    const a = assembly();
    const { toolkit, calls } = fakeToolkit();
    const deployer = createDeployer({ toolkit: () => Promise.resolve(toolkit) });
    await expect(deployer.destroy(request(a))).resolves.toEqual({ existed: true });
    expect(calls).toContain('destroy');
  });
});

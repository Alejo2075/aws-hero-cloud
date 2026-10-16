import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import type { StackStatus } from '@aws-sdk/client-cloudformation';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it } from 'vitest';
import { inspectSetup, profileKind, profilesFrom } from './onboarding.js';

describe('profiles', () => {
  it('are told apart by how they sign in, and nothing else is read out of them', () => {
    expect(profileKind({ sso_session: 'x' })).toBe('sso');
    expect(profileKind({ sso_start_url: 'https://x' })).toBe('sso');
    expect(profileKind({ role_arn: 'arn:aws:iam::1:role/x' })).toBe('role');
    expect(profileKind({ credential_process: 'cmd' })).toBe('process');
    expect(profileKind({ aws_access_key_id: 'AKIA', aws_secret_access_key: 'secret' })).toBe(
      'keys',
    );
    expect(profileKind({ region: 'us-east-1' })).toBe('other');

    const found = profilesFrom({
      configFile: { work: { sso_session: 's' }, default: { region: 'us-east-1' } },
      credentialsFile: {
        default: { aws_access_key_id: 'AKIAEXAMPLE', aws_secret_access_key: 'topsecret' },
      },
    });
    expect(found).toEqual([
      { name: 'default', kind: 'keys' },
      { name: 'work', kind: 'sso' },
    ]);
    expect(JSON.stringify(found)).not.toMatch(/AKIA|topsecret/);
  });
});

function identityFor(arn: string, account = '123456789012') {
  return { send: () => Promise.resolve({ Account: account, Arn: arn }) };
}

function stack(status: StackStatus, outputs: Record<string, string> = {}) {
  return {
    Stacks: [
      {
        StackName: 'x',
        StackStatus: status,
        CreationTime: new Date(),
        Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({
          OutputKey,
          OutputValue,
        })),
      },
    ],
  };
}

const none = () => Promise.resolve({ configFile: {}, credentialsFile: {} });
const withSso = () =>
  Promise.resolve({ configFile: { work: { sso_session: 's' } }, credentialsFile: {} });

async function inspect(
  over: Parameters<typeof inspectSetup>[0],
  stacks?: (name: string) => unknown,
) {
  const cfn = mockClient(CloudFormationClient);
  cfn.on(DescribeStacksCommand).callsFake((input: { StackName: string }) => {
    const result = stacks?.(input.StackName);
    if (result === undefined) throw new Error(`Stack with id ${input.StackName} does not exist`);
    return result;
  });
  try {
    return await inspectSetup({
      cloudFormation: new CloudFormationClient({ region: 'us-east-1' }),
      ...over,
    });
  } finally {
    cfn.restore();
  }
}

describe('inspectSetup', () => {
  it('sends a person with nothing to create an account and sign in with single sign-on', async () => {
    const report = await inspect({
      region: 'us-east-1',
      identityClient: { send: () => Promise.reject(new Error('no credentials')) },
      loadProfiles: none,
    });
    expect(report.identity).toBeUndefined();
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ['credentials', 'todo'],
      ['not-root', 'blocked'],
      ['account-prepared', 'blocked'],
      ['deployer-role', 'blocked'],
    ]);
    expect(report.next).toEqual(['create-account', 'configure-sso']);
  });

  it('asks a person who has a profile but is not signed in to sign in', async () => {
    const report = await inspect({
      region: 'us-east-1',
      identityClient: { send: () => Promise.reject(new Error('token expired')) },
      loadProfiles: withSso,
    });
    expect(report.next).toEqual(['sign-in']);
    expect(report.profiles).toEqual([{ name: 'work', kind: 'sso' }]);
  });

  it('reports the account owner and says to stop using it', async () => {
    const report = await inspect({
      region: 'us-east-1',
      identityClient: identityFor('arn:aws:iam::123456789012:root'),
      loadProfiles: none,
    });
    expect(report.identity).toBeUndefined();
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ['credentials', 'done'],
      ['not-root', 'todo'],
      ['account-prepared', 'blocked'],
      ['deployer-role', 'blocked'],
    ]);
    expect(report.next).toEqual(['stop-using-root']);
  });

  it('asks to prepare an account that has not been prepared', async () => {
    const report = await inspect(
      {
        region: 'us-east-1',
        identityClient: identityFor('arn:aws:sts::123456789012:assumed-role/Admin/me'),
        loadProfiles: withSso,
      },
      () => undefined,
    );
    expect(report.steps.map((s) => s.status)).toEqual(['done', 'done', 'todo', 'todo']);
    expect(report.next).toEqual(['prepare-account']);
  });

  it('points a prepared account at the deployer role until it is the one in use', async () => {
    const role = 'arn:aws:iam::123456789012:role/hero-deployer';
    const stacks = (name: string) =>
      name === 'hero-prerequisites'
        ? stack('CREATE_COMPLETE', { DeployerRoleArn: role })
        : stack('CREATE_COMPLETE');
    const before = await inspect(
      {
        region: 'us-east-1',
        identityClient: identityFor('arn:aws:sts::123456789012:assumed-role/Admin/me'),
        loadProfiles: withSso,
      },
      stacks,
    );
    expect(before.deployerRoleArn).toBe(role);
    expect(before.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(before.next).toEqual(['use-deployer-role']);

    const after = await inspect(
      {
        region: 'us-east-1',
        identityClient: identityFor('arn:aws:sts::123456789012:assumed-role/hero-deployer/hero'),
        loadProfiles: withSso,
      },
      stacks,
    );
    expect(after.next).toEqual(['ready']);
  });

  it('does not claim a step is done when it could not tell', async () => {
    const report = await inspect(
      {
        region: 'us-east-1',
        identityClient: identityFor('arn:aws:sts::123456789012:assumed-role/Admin/me'),
        loadProfiles: withSso,
      },
      () => stack('CREATE_IN_PROGRESS'),
    );
    expect(report.steps.map((s) => s.status)).toEqual(['done', 'done', 'unknown', 'unknown']);
    expect(report.next).toEqual([]);
  });
});

import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { STSClient } from '@aws-sdk/client-sts';
import { describe, expect, it } from 'vitest';
import { classifyPrincipal, getIdentity } from './identity.js';

const fake = (response: { Account?: string; Arn?: string } | Error) => ({
  send: (command: GetCallerIdentityCommand) => {
    expect(command).toBeInstanceOf(GetCallerIdentityCommand);
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  },
});

describe('classifyPrincipal', () => {
  it.each([
    ['arn:aws:iam::123456789012:root', 'root'],
    ['arn:aws:iam::123456789012:user/ana', 'user'],
    ['arn:aws:sts::123456789012:assumed-role/Admin/session', 'role'],
    ['arn:aws:iam::123456789012:role/Deploy', 'role'],
    ['arn:aws:sts::123456789012:federated-user/bob', 'federated'],
    ['arn:aws-us-gov:iam::123456789012:user/ana', 'user'],
    ['arn:aws:iam::123456789012:group/things', 'other'],
  ])('%s is %s', (arn, kind) => {
    expect(classifyPrincipal(arn)).toEqual({ account: '123456789012', kind });
  });

  it('rejects anything that is not an IAM or STS ARN', () => {
    expect(() => classifyPrincipal('not-an-arn')).toThrow();
    expect(() => classifyPrincipal('arn:aws:s3:::bucket')).toThrow();
  });
});

describe('getIdentity', () => {
  it('returns the account and principal and nothing secret', async () => {
    const identity = await getIdentity({
      client: fake({ Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/ana' }),
    });
    expect(identity).toEqual({
      account: '123456789012',
      principal: 'arn:aws:iam::123456789012:user/ana',
      kind: 'user',
    });
  });

  it('refuses the account owner', async () => {
    await expect(
      getIdentity({
        client: fake({ Account: '123456789012', Arn: 'arn:aws:iam::123456789012:root' }),
      }),
    ).rejects.toMatchObject({ code: 'identity.root-refused' });
  });

  it('turns every failure into identity.unknown without leaking the cause into params', async () => {
    const failure = await getIdentity({
      client: fake(new Error('AKIAIOSFODNN7EXAMPLE expired')),
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'identity.unknown', params: { reason: 'call-failed' } });
    expect(JSON.stringify((failure as { params: unknown }).params)).not.toContain('AKIA');
    await expect(getIdentity({ client: fake({}) })).rejects.toMatchObject({
      code: 'identity.unknown',
    });
    await expect(
      getIdentity({
        client: fake({ Account: '111111111111', Arn: 'arn:aws:iam::222222222222:user/x' }),
      }),
    ).rejects.toMatchObject({ code: 'identity.unknown' });
  });

  it('works through the real client class', async () => {
    const sts = mockClient(STSClient);
    sts
      .on(GetCallerIdentityCommand)
      .resolves({ Account: '123456789012', Arn: 'arn:aws:sts::123456789012:assumed-role/R/s' });
    try {
      await expect(getIdentity({ region: 'eu-west-1' })).resolves.toMatchObject({ kind: 'role' });
      expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(1);
    } finally {
      sts.restore();
    }
  });
});

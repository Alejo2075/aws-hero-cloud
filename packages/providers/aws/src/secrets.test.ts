import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it } from 'vitest';
import { createParameterSink } from './secrets.js';

const sink = () =>
  createParameterSink({ region: 'us-east-1', ssm: new SSMClient({ region: 'us-east-1' }) });

describe('createParameterSink', () => {
  it('stores secrets encrypted and settings plain, under the deployment path, and returns only the location', async () => {
    const ssm = mockClient(SSMClient);
    ssm.on(PutParameterCommand).resolves({});
    try {
      const secret = await sink().put({
        deploymentId: 'hero-shop',
        name: 'STRIPE_KEY',
        value: 'sk_live_x',
      });
      const config = await sink().put({
        deploymentId: 'hero-shop',
        name: 'LOG_LEVEL',
        value: 'info',
        kind: 'config',
      });
      expect(secret).toEqual({ name: 'STRIPE_KEY', location: 'ssm:/hero/hero-shop/STRIPE_KEY' });
      expect(JSON.stringify([secret, config])).not.toContain('sk_live_x');
      const inputs = ssm.commandCalls(PutParameterCommand).map((c) => c.args[0].input);
      expect(inputs[0]).toMatchObject({
        Name: '/hero/hero-shop/STRIPE_KEY',
        Type: 'SecureString',
        Overwrite: true,
      });
      expect(inputs[1]).toMatchObject({ Type: 'String' });
    } finally {
      ssm.restore();
    }
  });

  it('refuses names that could leave the deployment path, and empty or huge values, before calling AWS', async () => {
    const ssm = mockClient(SSMClient);
    try {
      for (const name of ['../x', 'a/b', '', 'a b', '1ABC', 'x'.repeat(200)]) {
        await expect(
          sink().put({ deploymentId: 'hero-shop', name, value: 'v' }),
        ).rejects.toMatchObject({
          code: 'plan.invalid-answer',
        });
      }
      await expect(
        sink().put({ deploymentId: '../other', name: 'A', value: 'v' }),
      ).rejects.toThrow();
      await expect(
        sink().put({ deploymentId: 'hero-shop', name: 'A', value: '' }),
      ).rejects.toThrow();
      await expect(
        sink().put({ deploymentId: 'hero-shop', name: 'A', value: 'x'.repeat(5000) }),
      ).rejects.toThrow();
      expect(ssm.calls()).toHaveLength(0);
    } finally {
      ssm.restore();
    }
  });

  it('never lets the value escape through an error', async () => {
    const ssm = mockClient(SSMClient);
    ssm.on(PutParameterCommand).rejects(new Error('invalid value hunter2-secret'));
    try {
      const failure = (await sink()
        .put({ deploymentId: 'hero-shop', name: 'A', value: 'hunter2-secret' })
        .catch((e: unknown) => e)) as { message: string; cause?: unknown };
      expect(failure).toMatchObject({
        code: 'deployment.failed',
        params: { step: 'store-secret', name: 'A' },
      });
      expect(JSON.stringify(failure)).not.toContain('hunter2');
      expect(failure.message).not.toContain('hunter2');
      expect(failure.cause).toBeUndefined();
    } finally {
      ssm.restore();
    }
  });
});

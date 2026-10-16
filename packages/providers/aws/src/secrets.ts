import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { heroError } from '@hero-cloud/core';
import type { SecretLocation, SecretSink } from '@hero-cloud/core';
import { parameterPath } from './cdk/names.js';

export type SsmPort = Pick<SSMClient, 'send'>;

export interface ParameterSinkOptions {
  readonly region: string;
  readonly profile?: string;
  readonly ssm?: SsmPort;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const DEPLOYMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_VALUE = 4096;

/**
 * Writes a value straight into the user's own parameter store: secrets as encrypted
 * `SecureString`s, settings as plain `String`s, under the deployment's own path. The value goes to
 * AWS and nowhere else: it is not returned, logged, put in an error, or kept. The name is checked
 * before anything is sent so it can never reach outside the deployment's path.
 */
export function createParameterSink(options: ParameterSinkOptions): SecretSink {
  const ssm: SsmPort =
    options.ssm ??
    new SSMClient({
      region: options.region,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });

  return {
    async put(request): Promise<SecretLocation> {
      if (!DEPLOYMENT.test(request.deploymentId) || !NAME.test(request.name)) {
        throw heroError('plan.invalid-answer', { question: 'secret-name' });
      }
      if (request.value.length === 0 || request.value.length > MAX_VALUE) {
        throw heroError('plan.invalid-answer', { question: 'secret-value' });
      }
      const name = `${parameterPath(request.deploymentId)}${request.name}`;
      try {
        await ssm.send(
          new PutParameterCommand({
            Name: name,
            Value: request.value,
            Type: request.kind === 'config' ? 'String' : 'SecureString',
            Overwrite: true,
            Tier: 'Standard',
          }),
        );
      } catch {
        // The cause is dropped on purpose: it could echo what was sent.
        throw heroError('deployment.failed', { step: 'store-secret', name: request.name });
      }
      return { name: request.name, location: `ssm:${name}` };
    },
  };
}

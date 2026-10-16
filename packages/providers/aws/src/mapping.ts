import type { Component, PlanChange, Rationale } from '@hero-cloud/core';
import type { AwsResourceType } from './resources.js';

const LOG_RETENTION_DAYS = 30;

interface Planned {
  readonly type: AwsResourceType;
  readonly name: string;
  readonly capability: string;
  readonly rationale: readonly Rationale[];
  readonly details: Readonly<Record<string, unknown>>;
}

const r = (code: string, evidence?: readonly string[]): Rationale =>
  evidence === undefined || evidence.length === 0 ? { code } : { code, evidence };

function logGroup(component: Component): Planned {
  return {
    type: 'logs-log-group',
    name: `${component.id}-logs`,
    capability: component.capability,
    rationale: [r('guardrail.log-retention')],
    details: { retentionDays: LOG_RETENTION_DAYS },
  };
}

function executionRole(component: Component, actions: readonly string[]): Planned {
  return {
    type: 'iam-role',
    name: `${component.id}-role`,
    capability: component.capability,
    rationale: [r('guardrail.least-privilege')],
    details: {
      trustedService: 'lambda.amazonaws.com',
      // Only what this component needs, on only the resources of this deployment.
      allow: [...actions].sort(),
      permissionsBoundary: 'hero',
    },
  };
}

/** The AWS resources that satisfy one component. Pure: the same component gives the same list. */
export function resourcesFor(component: Component, tableNames: readonly string[]): Planned[] {
  const own = component.rationale;
  switch (component.kind) {
    case 'static-site':
      return [
        {
          type: 's3-bucket',
          name: `${component.id}-files`,
          capability: component.capability,
          rationale: [
            ...own,
            r('guardrail.private-by-default'),
            r('guardrail.encryption'),
            r('guardrail.versioning'),
          ],
          details: { blockPublicAccess: true, encryption: 'SSE-S3', versioning: true },
        },
        {
          type: 'cloudfront-distribution',
          name: `${component.id}-cdn`,
          capability: component.capability,
          rationale: [...own, r('guardrail.https-only')],
          details: {
            originAccess: 'origin-access-control',
            viewerProtocol: 'redirect-to-https',
            minimumTls: 'TLSv1.2_2021',
            defaultRootObject: 'index.html',
            outputDirectory: component.settings.outputDirectory ?? '.',
          },
        },
      ];
    case 'http-service':
      return [
        {
          type: 'apigatewayv2-api',
          name: `${component.id}-api`,
          capability: component.capability,
          rationale: [...own, r('guardrail.https-only')],
          details: { protocol: 'HTTP', port: component.settings.port ?? 8080 },
        },
        {
          type: 'lambda-function',
          name: component.id,
          capability: component.capability,
          rationale: own,
          details: {
            runtime: 'nodejs22.x',
            architecture: 'arm64',
            memoryMb: 512,
            timeoutSeconds: 29,
            ...(component.settings.startCommand === undefined
              ? {}
              : { startCommand: component.settings.startCommand }),
            ...(component.settings.healthPath === undefined
              ? {}
              : { healthPath: component.settings.healthPath }),
          },
        },
        executionRole(component, [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          ...tableNames.map((t) => `dynamodb:*:${t}`),
        ]),
        logGroup(component),
      ];
    case 'scheduled-job':
      return [
        {
          type: 'scheduler-schedule',
          name: `${component.id}-schedule`,
          capability: component.capability,
          rationale: own,
          details: { cron: component.settings.schedule ?? '0 * * * *', timezone: 'UTC' },
        },
        {
          type: 'lambda-function',
          name: component.id,
          capability: component.capability,
          rationale: own,
          details: {
            runtime: 'nodejs22.x',
            architecture: 'arm64',
            memoryMb: 512,
            timeoutSeconds: 900,
            ...(component.settings.startCommand === undefined
              ? {}
              : { startCommand: component.settings.startCommand }),
          },
        },
        executionRole(component, [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          ...tableNames.map((t) => `dynamodb:*:${t}`),
        ]),
        logGroup(component),
      ];
    case 'key-value-table':
      return [
        {
          type: 'dynamodb-table',
          name: component.id,
          capability: component.capability,
          rationale: [...own, r('guardrail.backups'), r('guardrail.encryption')],
          details: {
            billing: 'on-demand',
            pointInTimeRecovery: true,
            encryption: 'AWS-owned-key',
            deletionProtection: true,
          },
        },
      ];
    case 'object-bucket':
      return [
        {
          type: 's3-bucket',
          name: component.id,
          capability: component.capability,
          rationale: [
            ...own,
            r('guardrail.private-by-default'),
            r('guardrail.encryption'),
            r('guardrail.versioning'),
          ],
          details: { blockPublicAccess: true, encryption: 'SSE-S3', versioning: true },
        },
      ];
    case 'identity':
      return [
        {
          type: 'cognito-user-pool',
          name: component.id,
          capability: component.capability,
          rationale: own,
          details: {
            signIn: component.settings.signIn ?? 'email',
            selfSignUp: component.settings.selfSignUp ?? false,
            mfa: 'optional',
          },
        },
        {
          type: 'cognito-user-pool-client',
          name: `${component.id}-client`,
          capability: component.capability,
          rationale: own,
          details: { secret: false, flows: ['authorization-code'] },
        },
      ];
    case 'budget-alert':
      return [
        {
          type: 'budgets-budget',
          name: component.id,
          capability: component.capability,
          rationale: component.rationale,
          details: {
            monthlyLimitUsd: component.settings.monthlyLimitUsd ?? 10,
            alertAtPercent: component.settings.alertAtPercent ?? 80,
          },
        },
      ];
  }
}

/** One place per input the application reads: secrets are encrypted, settings are plain. */
export function parametersFor(
  inputs: readonly { name: string; kind: 'secret' | 'config' }[],
): Planned[] {
  return [...inputs]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((input) => ({
      type: 'ssm-parameter',
      name: input.name,
      capability: 'environment-variables',
      rationale:
        input.kind === 'secret' ? [r('guardrail.secret-store'), r('guardrail.encryption')] : [],
      details: {
        type: input.kind === 'secret' ? 'SecureString' : 'String',
        value: 'supplied-at-deploy',
      },
    }));
}

export function toChange(
  planned: Planned,
  owner: string,
  region: string,
  deploymentId: string,
): PlanChange {
  return {
    id: `${owner}:${planned.type}:${planned.name}`,
    action: 'create',
    capability: planned.capability,
    resource: { provider: 'aws', type: planned.type, name: planned.name },
    destructive: false,
    rationale: planned.rationale,
    details: {
      ...planned.details,
      region,
      tags: { 'hero:deployment-id': deploymentId },
    },
  };
}

export type { Planned };

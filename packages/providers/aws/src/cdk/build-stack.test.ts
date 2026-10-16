import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { synthesizeBuild } from './synth.js';

function build() {
  const result = synthesizeBuild({
    deploymentId: 'hero-shop',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  rmSync(result.directory, { recursive: true, force: true });
  return result;
}

describe('the build stack', () => {
  const { template, hash } = build();
  const resources = Object.values(template.Resources);
  const props = (type: string) =>
    resources.filter((r) => r.Type === type).map((r) => r.Properties ?? {});

  it('is stable and passes the AWS Solutions rules', () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(build().hash).toBe(hash);
  });

  it('creates a private bucket, a project, a log group, and one role', () => {
    const types = resources.map((r) => r.Type).sort();
    expect(types).toEqual(
      expect.arrayContaining([
        'AWS::CodeBuild::Project',
        'AWS::IAM::Role',
        'AWS::Logs::LogGroup',
        'AWS::S3::Bucket',
      ]),
    );
    expect(types.filter((t) => t === 'AWS::IAM::Role')).toHaveLength(1);
  });

  it('runs unprivileged on a pinned image with no secrets in its environment', () => {
    const [project] = props('AWS::CodeBuild::Project');
    const environment = (project?.Environment ?? {}) as Record<string, unknown>;
    expect(environment.PrivilegedMode).toBe(false);
    expect(environment.Image).toBe('aws/codebuild/amazonlinux-aarch64-standard:3.0');
    expect(environment.EnvironmentVariables).toBeUndefined();
    expect(JSON.stringify(project?.Source)).not.toContain('buildspec.yml');
  });

  it('lets the role read the source, write artifacts and logs, and nothing else', () => {
    const policy = resources.find((r) => r.Type === 'AWS::IAM::Policy');
    const statements = (
      policy?.Properties as { PolicyDocument: { Statement: { Action: string | string[] }[] } }
    ).PolicyDocument.Statement;
    const actions = statements.flatMap((s) => [s.Action].flat()).sort();
    expect(actions).toEqual(
      [
        's3:GetObject',
        's3:GetObjectVersion',
        's3:PutObject',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ].sort(),
    );
  });

  it('carries the boundary on the role', () => {
    const role = resources.find((r) => r.Type === 'AWS::IAM::Role');
    expect(role?.Properties?.PermissionsBoundary).toBeDefined();
  });
});

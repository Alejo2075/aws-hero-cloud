import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, DefaultStackSynthesizer, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { heroError } from '@hero-cloud/core';
import type { Component } from '@hero-cloud/core';
import { canonicalJson, sha256Hex } from '@hero-cloud/shared';
import { BOOTSTRAP_QUALIFIER } from './names.js';
import { HeroStack } from './stack.js';

export interface SynthInput {
  readonly deploymentId: string;
  readonly region: string;
  readonly accountId: string;
  readonly components: readonly Component[];
}

/** A CloudFormation template as parsed JSON. Only the parts Hero reads are typed. */
export interface CfnTemplate {
  readonly Parameters?: Readonly<Record<string, { readonly Type: string }>>;
  readonly Resources: Readonly<Record<string, CfnResourceEntry>>;
  readonly Outputs?: Readonly<Record<string, unknown>>;
}

export interface CfnResourceEntry {
  readonly Type: string;
  readonly Properties?: Readonly<Record<string, unknown>>;
  readonly Metadata?: Readonly<Record<string, unknown>>;
  readonly DeletionPolicy?: string;
  readonly UpdateReplacePolicy?: string;
}

export interface Synthesized {
  /** The folder that holds the cloud assembly. */
  readonly directory: string;
  readonly stackName: string;
  readonly template: CfnTemplate;
  /** Hash of what will be applied: the template plus the account, region, and stack it is for. */
  readonly hash: string;
  /** Schedules that cannot be expressed exactly in AWS, so none was created. */
  readonly invalidSchedules: readonly string[];
  /** Values the deployer must supply, such as the key of each built function. */
  readonly parameters: readonly string[];
}

/** The hash of an assembly: stable for equal input, different for anything that would be applied. */
export function hashAssembly(
  stackName: string,
  template: CfnTemplate,
  accountId: string,
  region: string,
): string {
  return sha256Hex(canonicalJson({ stack: stackName, account: accountId, region, template }));
}

/**
 * Builds the infrastructure for a set of components once, validates it against the AWS Solutions
 * rules, and writes a cloud assembly. A rule violation throws, so an insecure template can never
 * reach a plan: Hero fails closed. Needs no credentials and no network.
 */
export function synthesize(input: SynthInput, outdir?: string): Synthesized {
  const directory = outdir ?? mkdtempSync(join(tmpdir(), 'hero-assembly-'));
  const app = new App({
    outdir: directory,
    analyticsReporting: false,
    treeMetadata: false,
    // New CDK apps turn these on in cdk.json. Hero builds its app in code, so it sets them here.
    context: {
      '@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy': true,
      '@aws-cdk/aws-iam:minimizePolicies': true,
      '@aws-cdk/core:checkSecretUsage': true,
      // Keeps each resource's place in the construct tree so a plan can name it readably.
      'aws:cdk:enable-path-metadata': true,
    },
  });
  const stack = new HeroStack(app, input.deploymentId, {
    env: { account: input.accountId, region: input.region },
    deploymentId: input.deploymentId,
    components: input.components,
    synthesizer: new DefaultStackSynthesizer({ qualifier: BOOTSTRAP_QUALIFIER }),
    description: `Created by Hero Cloud for ${input.deploymentId}. Safe to remove with hero-cloud destroy.`,
  });
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));

  try {
    app.synth();
  } catch (error) {
    throw heroError('internal.unexpected', { reason: 'template-validation' }, error);
  }

  const template = JSON.parse(
    readFileSync(join(directory, `${stack.stackName}.template.json`), 'utf8'),
  ) as CfnTemplate;
  return {
    directory,
    stackName: stack.stackName,
    template,
    hash: hashAssembly(stack.stackName, template, input.accountId, input.region),
    invalidSchedules: stack.invalidSchedules,
    parameters: Object.keys(template.Parameters ?? {})
      .filter((name) => name !== 'BootstrapVersion')
      .sort(),
  };
}

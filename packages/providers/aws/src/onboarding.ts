import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { isHeroError } from '@hero-cloud/core';
import type {
  CallerIdentity,
  CredentialProfile,
  ProfileKind,
  SetupNextCode,
  SetupReport,
  SetupStep,
} from '@hero-cloud/core';
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import { PREREQUISITES_STACK } from './bootstrap/policies.js';
import { TOOLKIT_STACK } from './bootstrap/bootstrapper.js';
import type { CloudFormationPort } from './deploy/outputs.js';
import { getIdentity } from './identity.js';
import type { IdentityClient } from './identity.js';

type Section = Readonly<Record<string, string | undefined>>;

/** How a profile signs in, judged from which settings it has. Values are never read out. */
export function profileKind(section: Section): ProfileKind {
  if (section.sso_session !== undefined || section.sso_start_url !== undefined) return 'sso';
  if (section.role_arn !== undefined) return 'role';
  if (section.credential_process !== undefined) return 'process';
  if (section.aws_access_key_id !== undefined) return 'keys';
  return 'other';
}

export interface ConfigFiles {
  readonly configFile: Readonly<Record<string, Section>>;
  readonly credentialsFile: Readonly<Record<string, Section>>;
}

/**
 * The profiles in a person's AWS configuration, by name and kind only. Keys, tokens, and role
 * details are not copied out of the files.
 */
export function profilesFrom(files: ConfigFiles): CredentialProfile[] {
  const names = new Set<string>([
    ...Object.keys(files.configFile),
    ...Object.keys(files.credentialsFile),
  ]);
  return [...names].sort().map((name) => ({
    name,
    kind: profileKind({ ...files.credentialsFile[name], ...files.configFile[name] }),
  }));
}

export interface InspectOptions {
  readonly region: string;
  readonly profile?: string;
  readonly identityClient?: IdentityClient;
  readonly cloudFormation?: CloudFormationPort;
  readonly loadProfiles?: () => Promise<ConfigFiles>;
  /** Called with the profile and region to get a CloudFormation client for it. */
  readonly cloudFormationFor?: (profile: string | undefined, region: string) => CloudFormationPort;
}

async function loadFiles(): Promise<ConfigFiles> {
  try {
    const files = await loadSharedConfigFiles();
    return { configFile: files.configFile, credentialsFile: files.credentialsFile };
  } catch {
    return { configFile: {}, credentialsFile: {} };
  }
}

async function stackOutputs(
  cfn: CloudFormationPort,
  name: string,
): Promise<Record<string, string> | 'missing' | 'unknown'> {
  try {
    const result = await cfn.send(new DescribeStacksCommand({ StackName: name }));
    const stack = result.Stacks?.[0];
    if (stack === undefined) return 'missing';
    if (stack.StackStatus !== 'CREATE_COMPLETE' && stack.StackStatus !== 'UPDATE_COMPLETE') {
      return 'unknown';
    }
    return Object.fromEntries(
      (stack.Outputs ?? []).flatMap((o) =>
        o.OutputKey !== undefined && o.OutputValue !== undefined
          ? [[o.OutputKey, o.OutputValue]]
          : [],
      ),
    );
  } catch (error) {
    return error instanceof Error && /does not exist/i.test(error.message) ? 'missing' : 'unknown';
  }
}

/**
 * Looks at the person's setup and says what is missing. It reads only: it asks AWS who the
 * credentials belong to and whether the account has been prepared, and lists the names of the
 * profiles in the person's configuration. The account owner is reported, never used.
 */
export async function inspectSetup(options: InspectOptions): Promise<SetupReport> {
  const profiles = profilesFrom(await (options.loadProfiles ?? loadFiles)());

  let identity: CallerIdentity | undefined;
  let rootRefused = false;
  let credentials: SetupStep['status'] = 'todo';
  try {
    identity = await getIdentity({
      region: options.region,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      ...(options.identityClient === undefined ? {} : { client: options.identityClient }),
    });
    credentials = 'done';
  } catch (error) {
    if (isHeroError(error) && error.code === 'identity.root-refused') {
      rootRefused = true;
      credentials = 'done';
    }
  }

  const steps: SetupStep[] = [
    { id: 'credentials', status: credentials },
    { id: 'not-root', status: credentials === 'todo' ? 'blocked' : rootRefused ? 'todo' : 'done' },
  ];

  let prepared: SetupStep['status'] = 'blocked';
  let deployer: SetupStep['status'] = 'blocked';
  let deployerRoleArn: string | undefined;
  if (identity !== undefined) {
    const cfn =
      options.cloudFormation ??
      options.cloudFormationFor?.(options.profile, options.region) ??
      undefined;
    if (cfn === undefined) {
      prepared = 'unknown';
      deployer = 'unknown';
    } else {
      const toolkit = await stackOutputs(cfn, TOOLKIT_STACK);
      const prerequisites = await stackOutputs(cfn, PREREQUISITES_STACK);
      prepared =
        toolkit === 'unknown' || prerequisites === 'unknown'
          ? 'unknown'
          : toolkit === 'missing' || prerequisites === 'missing'
            ? 'todo'
            : 'done';
      if (prerequisites === 'missing') deployer = 'todo';
      else if (prerequisites === 'unknown') deployer = 'unknown';
      else {
        deployerRoleArn = prerequisites.DeployerRoleArn;
        deployer = deployerRoleArn === undefined ? 'todo' : 'done';
      }
    }
  }
  steps.push(
    { id: 'account-prepared', status: prepared },
    { id: 'deployer-role', status: deployer },
  );

  const next: SetupNextCode[] = [];
  if (credentials === 'todo') {
    const usable = profiles.filter(
      (p) => p.kind === 'sso' || p.kind === 'role' || p.kind === 'keys',
    );
    next.push(usable.length === 0 ? 'create-account' : 'sign-in');
    if (usable.length === 0) next.push('configure-sso');
  } else if (rootRefused) {
    next.push('stop-using-root');
  } else if (prepared === 'todo') {
    next.push('prepare-account');
  } else if (
    deployer === 'done' &&
    identity !== undefined &&
    !identity.principal.includes('hero-deployer')
  ) {
    next.push('use-deployer-role');
  } else if (prepared === 'done') {
    next.push('ready');
  }

  return {
    region: options.region,
    ...(identity === undefined ? {} : { identity }),
    profiles,
    steps,
    ...(deployerRoleArn === undefined ? {} : { deployerRoleArn }),
    next,
  };
}

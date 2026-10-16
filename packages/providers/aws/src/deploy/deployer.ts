import { heroError } from '@hero-cloud/core';
import type { HeroEvent } from '@hero-cloud/core';
import { verifyAssembly } from './assembly.js';
import type { StackDiffLike } from './diff.js';
import { createGuardedIoHost } from './guard.js';
import type { ToolkitMessage } from './guard.js';

/** The part of the CDK Toolkit Hero uses. The real one is loaded on first use; tests pass a fake. */
export interface ToolkitPort {
  fromAssemblyDirectory(directory: string): Promise<unknown>;
  deploy(
    source: unknown,
    options: {
      readonly parameters: Readonly<Record<string, string>>;
      readonly rollback: boolean;
    },
  ): Promise<{
    readonly stacks: readonly { readonly outputs: Readonly<Record<string, string>> }[];
  }>;
  destroy(
    source: unknown,
  ): Promise<{ readonly stacks: readonly { readonly stackExisted: boolean }[] }>;
  /** What applying the assembly would change in the deployed stacks, by stack name. Read-only. */
  diff(
    source: unknown,
    options: { readonly parameters: Readonly<Record<string, string>> },
  ): Promise<Readonly<Record<string, StackDiffLike>>>;
}

export type IoHostPort = ReturnType<typeof createGuardedIoHost>;
export type ToolkitFactory = (ioHost: IoHostPort) => Promise<ToolkitPort>;

export interface DeployRequest {
  /** The stored assembly of the approved plan. */
  readonly assemblyDirectory: string;
  /** The plan's `artifactHash`. */
  readonly artifactHash: string;
  readonly accountId: string;
  readonly region: string;
  /** Values for template parameters, such as the key of each built function. Never secrets. */
  readonly parameters?: Readonly<Record<string, string>>;
  /** Whether the person approved the plan. Without it nothing is applied. */
  readonly approved: boolean;
}

export interface DeployOutcome {
  readonly stackName: string;
  readonly outputs: Readonly<Record<string, string>>;
}

export interface DeployerOptions {
  readonly toolkit?: ToolkitFactory;
  readonly profile?: string;
  readonly emit?: (event: HeroEvent) => void;
}

/** Loads the real toolkit only when something is deployed, so planning stays fast. */
function realToolkit(region: string, profile: string | undefined): ToolkitFactory {
  return async (ioHost) => {
    const { Toolkit, BaseCredentials, DiffMethod, StackSelectionStrategy, StackParameters } =
      await import('@aws-cdk/toolkit-lib');
    const toolkit = new Toolkit({
      ioHost,
      toolkitStackName: 'CDKToolkit-herocloud',
      sdkConfig: {
        baseCredentials: BaseCredentials.awsCliCompatible({
          defaultRegion: region,
          ...(profile === undefined ? {} : { profile }),
        }),
      },
    });
    const all = { strategy: StackSelectionStrategy.ALL_STACKS };
    return {
      fromAssemblyDirectory: (directory) => toolkit.fromAssemblyDirectory(directory),
      deploy: (source, options) =>
        toolkit.deploy(source as never, {
          stacks: all,
          deploymentMethod: { method: 'change-set' },
          parameters: StackParameters.exactly({ ...options.parameters }),
          rollback: options.rollback,
        }),
      destroy: (source) => toolkit.destroy(source as never, { stacks: all }),
      diff: (source, options) =>
        toolkit.diff(source as never, {
          stacks: all,
          method: DiffMethod.ChangeSet({ parameters: { ...options.parameters } }),
        }),
    };
  };
}

/**
 * Applies a stored, approved assembly. Before touching AWS it proves the assembly is the approved
 * one (hash, account, region, one stack), and it hands the toolkit a door that answers only the
 * confirmations the approval covers. It never synthesizes.
 */
export function createDeployer(options: DeployerOptions = {}): {
  deploy(request: DeployRequest): Promise<DeployOutcome>;
  destroy(request: DeployRequest): Promise<{ readonly existed: boolean }>;
} {
  const build = async (request: DeployRequest) => {
    const verified = verifyAssembly(request.assemblyDirectory, {
      hash: request.artifactHash,
      accountId: request.accountId,
      region: request.region,
    });
    const refused: string[] = [];
    const ioHost = createGuardedIoHost({
      approved: request.approved,
      ...(options.emit === undefined ? {} : { emit: options.emit }),
      onRefused: (code) => refused.push(code),
    });
    const factory = options.toolkit ?? realToolkit(request.region, options.profile);
    const toolkit = await factory(ioHost);
    const source = await toolkit.fromAssemblyDirectory(verified.directory);
    return { verified, toolkit, source, refused };
  };

  return {
    async deploy(request) {
      if (!request.approved) throw heroError('approval.unknown-challenge');
      const { verified, toolkit, source, refused } = await build(request);
      try {
        const result = await toolkit.deploy(source, {
          parameters: request.parameters ?? {},
          rollback: true,
        });
        return { stackName: verified.stackName, outputs: result.stacks[0]?.outputs ?? {} };
      } catch (error) {
        throw heroError(
          'deployment.failed',
          { stack: verified.stackName, refused: refused.join(',') },
          error,
        );
      }
    },
    async destroy(request) {
      if (!request.approved) throw heroError('approval.unknown-challenge');
      const { verified, toolkit, source } = await build(request);
      try {
        const result = await toolkit.destroy(source);
        return { existed: result.stacks.some((stack) => stack.stackExisted) };
      } catch (error) {
        throw heroError('deployment.failed', { stack: verified.stackName }, error);
      }
    },
  };
}

export type { ToolkitMessage };

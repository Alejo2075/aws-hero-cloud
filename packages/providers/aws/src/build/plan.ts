import { heroError } from '@hero-cloud/core';
import type { Component } from '@hero-cloud/core';
import { pascal } from '../cdk/names.js';

/**
 * The runtime image builds run in. Pinned so that what ran is part of the plan and the approval,
 * not whatever "latest" means on the day.
 */
export const BUILD_IMAGE = 'aws/codebuild/amazonlinux-aarch64-standard:3.0';
export const BUILD_NODE_VERSION = '22';
export const BUILD_TIMEOUT_MINUTES = 15;

/** What a person approves for one thing to build. Commands come from the analyzed project. */
export interface BuildJob {
  /** The component it builds for. */
  readonly id: string;
  readonly kind: 'static' | 'function';
  readonly installCommand: string;
  readonly buildCommand: string | undefined;
  /** For functions: the command that starts the program. Wrapped into `run.sh`. */
  readonly startCommand: string | undefined;
  /** For functions: the file that runs a scheduled job. */
  readonly jobFile: string | undefined;
  /** For static sites: the folder that holds the finished site, relative to the project. */
  readonly outputDirectory: string | undefined;
}

export interface BuildPlan {
  readonly image: string;
  readonly timeoutMinutes: number;
  readonly jobs: readonly BuildJob[];
}

/** Chooses the package manager from the lock file that is present, and never runs `latest`. */
export const INSTALL_COMMAND =
  'if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; ' +
  'elif [ -f yarn.lock ]; then corepack enable && yarn install --immutable; ' +
  'elif [ -f package-lock.json ]; then npm ci; ' +
  'else npm install; fi';

const MAX_COMMAND = 500;

/**
 * A command from the project is shown to the person and then run in their own build service, so
 * it must be a single line of printable text. Anything else is refused rather than escaped.
 */
export function assertSafeCommand(command: string): string {
  let printable = true;
  for (let index = 0; index < command.length; index += 1) {
    const code = command.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) printable = false;
  }
  if (command.length === 0 || command.length > MAX_COMMAND || !printable) {
    throw heroError('plan.invalid-answer', { question: 'build-command' });
  }
  return command;
}

/** A relative folder inside the project: no `..`, no absolute path, no odd characters. */
export function assertSafeDirectory(directory: string): string {
  if (
    !/^(?:\.|[A-Za-z0-9_@.+-]+(?:\/[A-Za-z0-9_@.+-]+)*)$/.test(directory) ||
    directory.split('/').includes('..')
  ) {
    throw heroError('plan.invalid-answer', { question: 'output-directory' });
  }
  return directory;
}

const text = (component: Component, key: string): string | undefined => {
  const value = component.settings[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** What has to be built for these components. Components that need no build are left out. */
export function buildPlanFor(components: readonly Component[]): BuildPlan {
  const jobs: BuildJob[] = [];
  for (const component of components) {
    if (component.kind === 'static-site') {
      const build = text(component, 'buildCommand');
      // A site that is already finished is shipped as it is; there is nothing to build.
      if (build === undefined) continue;
      jobs.push({
        id: component.id,
        kind: 'static',
        installCommand: INSTALL_COMMAND,
        buildCommand: assertSafeCommand(build),
        startCommand: undefined,
        jobFile: undefined,
        outputDirectory: assertSafeDirectory(text(component, 'outputDirectory') ?? '.'),
      });
    } else if (component.kind === 'http-service' || component.kind === 'scheduled-job') {
      const build = text(component, 'buildCommand');
      const start = text(component, 'startCommand');
      jobs.push({
        id: component.id,
        kind: 'function',
        installCommand: INSTALL_COMMAND,
        buildCommand: build === undefined ? undefined : assertSafeCommand(build),
        startCommand:
          component.kind === 'http-service' && start !== undefined
            ? assertSafeCommand(start)
            : undefined,
        jobFile:
          component.kind === 'scheduled-job' ? (text(component, 'entry') ?? 'job.mjs') : undefined,
        outputDirectory: undefined,
      });
    }
  }
  return { image: BUILD_IMAGE, timeoutMinutes: BUILD_TIMEOUT_MINUTES, jobs };
}

/** Where a job's result goes in the artifact bucket. */
export function artifactKey(deploymentId: string, job: BuildJob, sourceHash: string): string {
  return `artifacts/${deploymentId}/${pascal(job.id)}/${sourceHash.slice(0, 16)}.zip`;
}

/** Where the uploaded source goes. */
export function sourceKey(deploymentId: string, sourceHash: string): string {
  return `source/${deploymentId}/${sourceHash.slice(0, 16)}.zip`;
}

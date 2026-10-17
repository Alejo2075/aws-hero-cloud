import type { PlanChange } from '@hero-cloud/core';
import type { BuildPlan } from './plan.js';

/**
 * One reviewable change per build, carrying exactly what will run: the commands, the image, and
 * the time limit. These are shown at every level and are part of what the person approves.
 */
export function buildJobChanges(
  plan: BuildPlan,
  region: string,
  deploymentId: string,
): PlanChange[] {
  return plan.jobs.map((job) => ({
    id: `build:${job.id}`,
    action: 'create',
    capability: job.kind === 'static' ? 'web-frontend' : 'http-service',
    resource: { provider: 'aws', type: 'codebuild-build', name: job.id },
    destructive: false,
    rationale: [{ code: 'build.in-your-account' }],
    details: {
      image: plan.image,
      timeoutMinutes: plan.timeoutMinutes,
      installCommand: job.installCommand,
      buildCommand: job.buildCommand ?? null,
      startCommand: job.startCommand ?? null,
      outputDirectory: job.outputDirectory ?? null,
      secretsExcluded: true,
      privileged: job.kind === 'image',
      imageBuild: job.imageBuild ?? null,
      dockerfile: job.dockerfile ?? null,
      region,
      tags: { 'hero:deployment-id': deploymentId },
    },
  }));
}

import type { DeploymentPlan, DeploymentResult, Hero } from '@hero-cloud/sdk';

export interface HeadlessOptions {
  approve(plan: DeploymentPlan): boolean | Promise<boolean>;
  budgetEmail?: string | undefined;
  accountId?: string;
  region?: string;
}

export function deployFolder(
  hero: Hero,
  folder: string,
  options: HeadlessOptions,
): Promise<{ status: string; plan: DeploymentPlan; result?: DeploymentResult }>;

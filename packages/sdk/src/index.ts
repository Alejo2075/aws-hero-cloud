/**
 * The headless engine API and the single door into Hero. Interfaces and products built on Hero
 * depend on this package; they do not reach into the engine packages behind it. It has no
 * dependency on any interface, prompt, or presentation code.
 *
 * The contracts below are final in shape but not yet implemented: `createHero` arrives with the
 * engine skeleton (roadmap phase 1).
 */
export type {
  Analysis,
  AIProvider,
  AIRequest,
  AnalyzeOptions,
  Approval,
  ApprovalHandler,
  DeploymentPlan,
  DeploymentResult,
  Health,
  Hero,
  HeroEvent,
  HeroPorts,
  Logger,
  PlanOptions,
  SourceRef,
  StateStore,
} from '@hero-cloud/core';
export type { HeroSpec } from '@hero-cloud/specification';

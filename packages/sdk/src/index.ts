/**
 * The headless engine API and the single door into Hero. Interfaces and products built on Hero
 * depend on this package; they do not reach into the engine packages behind it. It has no
 * dependency on any interface, prompt, or presentation code.
 */
export { createHero } from './engine.js';
export { BUDGET_EMAIL_INPUT } from '@hero-cloud/planner';
export { aiDestination, aiKinds, createAiProvider, isLocalAi } from '@hero-cloud/provider-ai';
export type { AiConfig, AiLimits, ConsentScope } from '@hero-cloud/provider-ai';
export type { CreateHeroOptions } from './engine.js';
export {
  ApprovalService,
  HeroError,
  approvalFromChallenge,
  errorCodes,
  isHeroError,
} from '@hero-cloud/core';
export type { ErrorCode } from '@hero-cloud/core';

export type {
  Analysis,
  AIProvider,
  AIRequest,
  AnalyzeOptions,
  Approval,
  ApprovalChallenge,
  ApprovalHandler,
  PlanRef,
  OpenQuestion,
  Detection,
  ProjectSnapshot,
  SkippedEntry,
  SourceLoader,
  DeploymentPlan,
  DeployOptions,
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
export { parseHeroSpec, serializeHeroSpec, validateHeroSpec } from '@hero-cloud/specification';
export type { ParseResult, SpecIssue } from '@hero-cloud/specification';

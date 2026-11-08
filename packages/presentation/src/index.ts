export { analysisView, componentsOf, evidencePhrase } from './analysis-view.js';
export { planView } from './plan-view.js';
export { healthView, resultView } from './result-view.js';
export { setupView } from './setup-view.js';
export { audienceLevels, defaultAudienceLevel } from './audience.js';
export type { AudienceLevel } from './audience.js';
export { defaultCatalogs, en, es } from './catalogs/index.js';
export { studioCodes } from './catalogs/studio-codes.js';
export type { StudioCode } from './catalogs/studio-codes.js';
export { Messages, interpolate, localeChain, placeholders } from './messages.js';
/** Codes owned by the presentation layer itself, not by any producer. */
export const presentationCodes = [
  'error.usage',
  'error.unknown',
  'evidence.unknown',
  'cli.help',
  'cli.usage-hint',
  'cli.progress.load',
  'cli.progress.analyze',
  'cli.progress.plan',
  'cli.progress.deploy',
  'cli.progress.verify',
  'cli.progress.destroy',
  'cli.prompt.approve',
  'cli.prompt.budget-email',
  'cli.declined',
  'cli.ai.consent',
  'cli.ai.scope.file-names',
  'cli.ai.scope.snippets',
  'cli.ai.scope.full-files',
  'cli.ai.no-consent',
  'cli.ai.consulted',
  'cli.ai.unavailable',
  'cli.approve.expired',
  'cli.approve.recorded',
  'cli.prompt.write-profile',
  'cli.profile.written',
  'cli.profile.exists',
  'cli.prompt.secret',
  'cli.secret.stored',
  'cli.hint.answer',
  'cli.studio.listening',
  'cli.report.hint',
  'cli.report.note',
] as const;

export { createPresenter } from './presenter.js';
export type { ErrorDescription, Presenter, PresenterOptions } from './presenter.js';
export type {
  Block,
  Message,
  MessageCatalog,
  MessageParams,
  RenderOptions,
  Section,
  View,
} from './types.js';

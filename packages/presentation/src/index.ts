export { analysisView, componentsOf, evidencePhrase } from './analysis-view.js';
export { planView } from './plan-view.js';
export { audienceLevels, defaultAudienceLevel } from './audience.js';
export type { AudienceLevel } from './audience.js';
export { defaultCatalogs, en, es } from './catalogs/index.js';
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
  'cli.hint.answer',
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

import { HeroError } from '@hero-cloud/shared';
import type {
  Analysis,
  DeploymentPlan,
  DeploymentResult,
  Health,
  SetupReport,
} from '@hero-cloud/core';
import { analysisView } from './analysis-view.js';
import { defaultCatalogs } from './catalogs/index.js';
import { Messages } from './messages.js';
import { planView } from './plan-view.js';
import { healthView, resultView } from './result-view.js';
import { setupView } from './setup-view.js';
import type { MessageCatalog, MessageParams, RenderOptions, View } from './types.js';

export interface ErrorDescription {
  readonly code: string;
  /** A message in the reader's language and at the reader's level. */
  readonly message: string;
  readonly params: MessageParams;
}

export interface Presenter {
  analysis(analysis: Analysis, options: RenderOptions): View;
  plan(plan: DeploymentPlan, options: RenderOptions): View;
  /** Where a person stands on the way to a first deployment. */
  setup(report: SetupReport, options: RenderOptions): View;
  /** What a person needs after a deployment or a removal. */
  result(result: DeploymentResult, options: RenderOptions): View;
  /** The evidence of whether the deployment works, and its limits. */
  health(deploymentId: string, health: Health, options: RenderOptions): View;
  /** Words for any error, including ones that are not Hero's. Never exposes a cause or a stack. */
  describeError(error: unknown, options: RenderOptions): ErrorDescription;
  /** Text for a message code, for interfaces that show their own labels. */
  text(code: string, options: RenderOptions, params?: MessageParams): string;
}

export interface PresenterOptions {
  readonly catalogs?: readonly MessageCatalog[];
  readonly fallbackLocale?: string;
}

/** Creates a presenter. Pass more catalogs to add languages without changing any code. */
export function createPresenter(options: PresenterOptions = {}): Presenter {
  const messages = new Messages(
    options.catalogs ?? defaultCatalogs,
    options.fallbackLocale ?? 'en',
  );
  return {
    analysis: (analysis, render) => analysisView(analysis, render, messages),
    plan: (plan, render) => planView(plan, render, messages),
    setup: (report, render) => setupView(report, render, messages),
    result: (result, render) => resultView(result, render, messages),
    health: (id, health, render) => healthView(id, health, render, messages),
    describeError(error, render) {
      const known = error instanceof HeroError;
      const code = known ? error.code : 'unknown';
      const params = known ? error.params : {};
      const key = messages.has(`error.${code}`, 'en') ? `error.${code}` : 'error.unknown';
      return { code, message: messages.text(key, render.audience, render.locale, params), params };
    },
    text: (code, render, params) => messages.text(code, render.audience, render.locale, params),
  };
}

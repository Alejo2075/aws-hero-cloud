import { HeroError } from '@hero-cloud/shared';
import type { Analysis } from '@hero-cloud/core';
import { analysisView } from './analysis-view.js';
import { defaultCatalogs } from './catalogs/index.js';
import { Messages } from './messages.js';
import type { MessageCatalog, MessageParams, RenderOptions, View } from './types.js';

export interface ErrorDescription {
  readonly code: string;
  /** A message in the reader's language and at the reader's level. */
  readonly message: string;
  readonly params: MessageParams;
}

export interface Presenter {
  analysis(analysis: Analysis, options: RenderOptions): View;
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

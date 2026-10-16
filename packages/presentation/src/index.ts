import type { Analysis, DeploymentPlan, DeploymentResult } from '@hero-cloud/core';
import type { AudienceLevel } from './audience.js';

export * from './audience.js';

/**
 * Presentation turns structured Hero data into a document a person can read. It owns all human
 * wording, at three depths and in any locale, so planners and providers emit codes, not prose.
 *
 * A `View` is renderer-neutral. The terminal, Studio, Markdown exports, and chat replies each draw
 * the same view their own way.
 */
export type Block =
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly string[] }
  | {
      readonly type: 'table';
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: 'code'; readonly language?: string; readonly text: string }
  | {
      readonly type: 'callout';
      readonly tone: 'info' | 'warning' | 'danger';
      readonly text: string;
    };

export interface Section {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly Block[];
}

export interface View {
  readonly audience: AudienceLevel;
  readonly locale: string;
  readonly title: string;
  readonly sections: readonly Section[];
}

export interface RenderOptions {
  readonly audience: AudienceLevel;
  /** BCP 47 tag such as `en` or `es`. Falls back to `en` for missing messages. */
  readonly locale: string;
}

/**
 * Words for one locale. Keys are the codes carried by rationales, warnings, events, and next
 * steps. Each message exists per audience level; a missing deeper level falls back to the nearest
 * shallower one, but a plan never loses a destructive-change or cost notice.
 */
export interface MessageCatalog {
  readonly locale: string;
  readonly messages: Readonly<Record<string, Partial<Record<AudienceLevel, string>>>>;
}

export interface Presenter {
  analysis(analysis: Analysis, options: RenderOptions): View;
  plan(plan: DeploymentPlan, options: RenderOptions): View;
  result(result: DeploymentResult, options: RenderOptions): View;
}

import type { AudienceLevel } from './audience.js';

/**
 * Presentation turns structured Hero data into a document a person can read. It owns all human
 * wording, at three depths and in any locale, so planners and providers emit codes, not prose.
 *
 * A `View` is renderer-neutral. The terminal, a browser, Markdown exports, and chat replies each
 * draw the same view their own way.
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

export type MessageParams = Readonly<Record<string, string | number | boolean>>;

/** A message that reads the same at every level, or one with its own wording per level. */
export type Message = string | Readonly<Record<AudienceLevel, string>>;

/**
 * Words for one locale. Keys are the codes carried by rationales, warnings, questions, errors, and
 * evidence, plus the labels of the views. A test requires every known code to have a message in
 * every shipped locale and, when a message is level-specific, at all three levels.
 */
export interface MessageCatalog {
  readonly locale: string;
  readonly messages: Readonly<Record<string, Message>>;
}

import type { Analysis, Detection, OpenQuestion } from '@hero-cloud/core';
import { serializeHeroSpec } from '@hero-cloud/specification';
import type { HeroSpec } from '@hero-cloud/specification';
import type { AudienceLevel } from './audience.js';
import type { Messages } from './messages.js';
import type { Block, MessageParams, RenderOptions, Section, View } from './types.js';

interface Component {
  readonly code: string;
  readonly params: MessageParams;
  /** The capability whose detections explain this component. */
  readonly capability: string | undefined;
}

function confidenceWord(value: number): string {
  return value >= 0.85 ? 'confidence.high' : value >= 0.6 ? 'confidence.medium' : 'confidence.low';
}

const SERVICE_CAPABILITY: Record<string, string> = {
  http: 'http-service',
  scheduled: 'scheduled-job',
  process: 'process-service',
  worker: 'process-service',
};

const DATA_CAPABILITY: Record<string, string> = {
  relational: 'relational-data',
  'key-value': 'key-value-data',
  document: 'document-data',
  cache: 'cache',
  search: 'search',
};

/** Describes every part of the Hero Spec as a message code with parameters. */
export function componentsOf(spec: HeroSpec): Component[] {
  const components: Component[] = [];
  if (spec.frontend !== undefined) {
    components.push({
      code: 'component.frontend',
      params: { framework: spec.frontend.framework },
      capability: 'web-frontend',
    });
  }
  for (const service of spec.services ?? []) {
    components.push({
      code: `component.service.${service.type}`,
      params: { id: service.id, runtime: service.runtime },
      capability: SERVICE_CAPABILITY[service.type],
    });
  }
  for (const item of spec.data ?? []) {
    components.push({
      code: `component.data.${item.type}`,
      params: { id: item.id, engine: item.engine ?? '?' },
      capability: DATA_CAPABILITY[item.type],
    });
  }
  for (const item of spec.storage ?? []) {
    components.push({
      code: `component.storage.${item.type}`,
      params: { id: item.id },
      capability: item.type === 'object' ? 'object-storage' : 'file-system-write',
    });
  }
  if (spec.auth?.required === true) {
    components.push({ code: 'component.auth', params: {}, capability: 'authentication' });
  }
  if (spec.environment !== undefined && spec.environment.length > 0) {
    components.push({
      code: 'component.environment',
      params: { count: spec.environment.length, names: spec.environment.join(', ') },
      capability: 'environment-variables',
    });
  }
  return components;
}

function evidencePhrase(
  messages: Messages,
  evidence: string,
  level: AudienceLevel,
  locale: string,
): string {
  const index = evidence.indexOf(':');
  const kind = index === -1 ? 'unknown' : evidence.slice(0, index);
  const value = index === -1 ? evidence : evidence.slice(index + 1);
  const specific = `evidence.${kind}.${value}`;
  const code = messages.has(specific, 'en')
    ? specific
    : messages.has(`evidence.${kind}`, 'en')
      ? `evidence.${kind}`
      : 'evidence.unknown';
  return messages.text(code, level, locale, { value });
}

function questionText(
  messages: Messages,
  question: OpenQuestion,
  level: AudienceLevel,
  locale: string,
): string {
  const base = messages.text(`question.${question.code}`, level, locale, question.params);
  return question.options === undefined || question.options.length === 0
    ? base
    : `${base} [${question.options.join(' | ')}]`;
}

const SKIPPED_REASON: Record<string, string> = {
  sensitive: 'skipped.sensitive',
  symlink: 'skipped.symlink',
  ignored: 'skipped.ignored',
  special: 'skipped.special',
};

function paragraph(text: string): Block {
  return { type: 'paragraph', text };
}

/**
 * The same analysis, worded for the reader. `simple` avoids jargon and hides internal detail,
 * `guided` explains each part and why Hero believes it, and `expert` shows the raw detections,
 * the Hero Spec, and the hashes. Facts never change between levels; only depth does.
 */
export function analysisView(analysis: Analysis, options: RenderOptions, messages: Messages): View {
  const { audience: level, locale } = options;
  const t = (code: string, params?: MessageParams): string =>
    messages.text(code, level, locale, params);
  const name = analysis.spec.application.name;
  const components = componentsOf(analysis.spec);
  const sensitive = analysis.skipped.filter((entry) => entry.reason === 'sensitive');
  const sections: Section[] = [];

  const byCapability = new Map<string, Detection[]>();
  for (const detection of analysis.detections) {
    byCapability.set(detection.capability, [
      ...(byCapability.get(detection.capability) ?? []),
      detection,
    ]);
  }

  // ---- summary and components ------------------------------------------------------------
  const summaryBlocks: Block[] = [];
  if (components.length === 0) {
    summaryBlocks.push({ type: 'callout', tone: 'warning', text: t('view.analysis.nothing') });
  } else {
    summaryBlocks.push(paragraph(t('view.analysis.summary', { name, count: components.length })));
    summaryBlocks.push({
      type: 'list',
      items: components.map((component) => {
        const text = t(component.code, component.params);
        if (level !== 'guided' || component.capability === undefined) return text;
        const found = byCapability.get(component.capability) ?? [];
        const best = [...found].sort((a, b) => b.confidence - a.confidence)[0];
        if (best === undefined) return text;
        const because = best.evidence
          .map((entry) => evidencePhrase(messages, entry, level, locale))
          .filter((phrase) => phrase !== '')
          .join('; ');
        return `${text} (${t(confidenceWord(best.confidence))}${because === '' ? '' : `: ${because}`})`;
      }),
    });
  }
  if (level === 'expert' && analysis.aiAssisted)
    summaryBlocks.push(paragraph(t('view.analysis.ai')));
  sections.push({ id: 'summary', heading: t('view.section.summary'), blocks: summaryBlocks });

  // ---- expert: raw detections and the spec ----------------------------------------------
  if (level === 'expert') {
    sections.push({
      id: 'detections',
      heading: t('view.section.detections'),
      blocks: [
        {
          type: 'table',
          columns: [t('column.capability'), t('column.confidence'), t('column.evidence')],
          rows: analysis.detections.map((d) => [
            d.capability,
            d.confidence.toFixed(2),
            d.evidence.join(', '),
          ]),
        },
      ],
    });
    sections.push({
      id: 'spec',
      heading: t('view.section.spec'),
      blocks: [
        { type: 'code', language: 'yaml', text: serializeHeroSpec(analysis.spec).trimEnd() },
      ],
    });
  }

  // ---- questions ----------------------------------------------------------------------------
  if (analysis.openQuestions.length > 0) {
    const blocks: Block[] = [
      paragraph(t('view.questions.intro', { count: analysis.openQuestions.length })),
    ];
    if (level === 'expert') {
      blocks.push({
        type: 'table',
        columns: [t('column.id'), t('column.code'), t('column.details'), t('column.options')],
        rows: analysis.openQuestions.map((q) => [
          q.id,
          q.code,
          q.params === undefined ? '' : JSON.stringify(q.params),
          (q.options ?? []).join(', '),
        ]),
      });
    } else {
      blocks.push({
        type: 'list',
        items: analysis.openQuestions.map((q) => questionText(messages, q, level, locale)),
      });
    }
    sections.push({ id: 'questions', heading: t('view.section.questions'), blocks });
  }

  // ---- what was left out ------------------------------------------------------------------
  if (level === 'expert') {
    if (analysis.skipped.length > 0) {
      sections.push({
        id: 'skipped',
        heading: t('view.section.skipped'),
        blocks: [
          {
            type: 'table',
            columns: [t('column.path'), t('column.reason')],
            rows: analysis.skipped.map((entry) => [entry.path, entry.reason]),
          },
        ],
      });
    }
  } else if (sensitive.length > 0) {
    const blocks: Block[] = [paragraph(t('view.leftout.count', { count: sensitive.length }))];
    if (level === 'guided') {
      blocks.push({
        type: 'list',
        items: sensitive
          .slice(0, 10)
          .map((entry) => `${entry.path}: ${t(SKIPPED_REASON[entry.reason] ?? 'skipped.ignored')}`),
      });
    }
    sections.push({ id: 'left-out', heading: t('view.section.leftout'), blocks });
  }

  // ---- expert: provenance ----------------------------------------------------------------
  if (level === 'expert') {
    sections.push({
      id: 'details',
      heading: t('view.section.details'),
      blocks: [
        {
          type: 'table',
          columns: [t('column.id'), t('column.details')],
          rows: [
            [t('meta.source-hash'), analysis.sourceHash],
            [t('meta.ai-assisted'), t(analysis.aiAssisted ? 'meta.yes' : 'meta.no')],
          ],
        },
      ],
    });
  }

  return { audience: level, locale, title: t('view.analysis.title', { name }), sections };
}

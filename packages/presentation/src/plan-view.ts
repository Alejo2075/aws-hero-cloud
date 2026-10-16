import type { DeploymentPlan, PlanChange, PlanWarning, Rationale } from '@hero-cloud/core';
import type { Messages } from './messages.js';
import { evidencePhrase } from './analysis-view.js';
import type { Block, MessageParams, RenderOptions, Section, View } from './types.js';

const BASE_LOCALE = 'en';

function money(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  } catch {
    return new Intl.NumberFormat(BASE_LOCALE, { style: 'currency', currency: 'USD' }).format(value);
  }
}

const paragraph = (text: string): Block => ({ type: 'paragraph', text });

const capitalize = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The same plan, worded for the reader. Every level shows the cost, the blocking issues, and that
 * nothing is created until a person approves; the levels differ only in how much is explained.
 */
export function planView(plan: DeploymentPlan, options: RenderOptions, messages: Messages): View {
  const { audience: level, locale } = options;
  const t = (code: string, params?: MessageParams): string =>
    messages.text(code, level, locale, params);
  const has = (code: string): boolean => messages.find(code, level, locale) !== undefined;

  /** The wording that fits what the plan is for: a deployment, a removal, or preparing an account. */
  const planKey = (part: 'summary' | 'title' | 'creates'): string => {
    if (plan.intent === 'destroy') {
      return {
        summary: 'view.destroy.summary',
        title: 'view.destroy.title',
        creates: 'view.section.plan-removes',
      }[part];
    }
    if (plan.intent === 'bootstrap') {
      return {
        summary: 'view.bootstrap.summary',
        title: 'view.bootstrap.title',
        creates: 'view.section.plan-setup-creates',
      }[part];
    }
    return {
      summary: 'view.plan.summary',
      title: 'view.plan.title',
      creates: 'view.section.plan-creates',
    }[part];
  };

  const blocking = plan.warnings.filter((w) => w.severity === 'blocking');
  const advice = plan.warnings.filter((w) => w.severity !== 'blocking');

  const warningText = (warning: PlanWarning): string => {
    const params: Record<string, string | number | boolean> = { ...warning.params };
    if (warning.code === 'plan.open-question') {
      const kind = String(warning.params?.kind ?? '');
      return has(`question.${kind}`)
        ? t(`question.${kind}`, params)
        : t(`warning.${warning.code}`, params);
    }
    if (warning.code === 'plan.unsupported-capability') {
      params.capabilityName = t(`capability.${String(warning.params?.capability ?? '')}`);
      params.strategyName = t(`strategy.name.${String(warning.params?.needs ?? '')}`);
    }
    if (warning.code === 'plan.update-unverified') {
      params.reasonText = t(`update.reason.${String(warning.params?.reason ?? 'failed')}`);
    }
    if (warning.code === 'plan.cost-low-confidence') {
      params.reasonText = t(`cost.reason.${String(warning.params?.reason ?? 'offline')}`);
    }
    return t(`warning.${warning.code}`, params);
  };

  const rationaleText = (rationale: Rationale): string => {
    const text = t(`rationale.${rationale.code}`, rationale.params);
    if (level !== 'guided' || rationale.evidence === undefined || rationale.evidence.length === 0)
      return text;
    const because = rationale.evidence
      .map((entry) =>
        evidencePhrase(messages, entry, level, locale, (name) => t(`capability.${name}`)),
      )
      .filter((phrase) => phrase !== '')
      .join('; ');
    return because === '' ? text : `${text} (${because})`;
  };

  const sections: Section[] = [];
  const strategyName = t(`strategy.name.${plan.strategy}`);

  // ---- summary ---------------------------------------------------------------------------
  const summary: Block[] = [
    {
      type: 'paragraph',
      text: t(planKey('summary'), {
        name: plan.application,
        strategy: strategyName,
        account: plan.target.accountId,
        region: plan.target.region,
      }),
    },
  ];
  if (level !== 'simple') {
    summary.push({
      type: 'list',
      items: plan.strategyRationale.map(
        (reason) => `${t('view.plan.strategy-reason')}: ${rationaleText(reason)}`,
      ),
    });
  } else if (plan.strategyRationale[0] !== undefined) {
    summary.push({ type: 'paragraph', text: rationaleText(plan.strategyRationale[0]) });
  }
  summary.push(
    blocking.length === 0
      ? { type: 'callout', tone: 'info', text: t('view.plan.ready') }
      : { type: 'callout', tone: 'warning', text: t('view.plan.nothing-created') },
  );
  sections.push({ id: 'summary', heading: t('view.section.plan-summary'), blocks: summary });

  // ---- blocking --------------------------------------------------------------------------
  if (blocking.length > 0) {
    sections.push({
      id: 'blocking',
      heading: t('view.section.plan-blocking'),
      blocks: [{ type: 'list', items: blocking.map(warningText) }],
    });
  }

  // ---- what will be replaced or removed ----------------------------------------------------
  // Shown at every level: a person must always be able to see what could be lost.
  const destructive = plan.changes.filter((c) => c.destructive && c.action !== 'create');
  if (destructive.length > 0 && plan.intent !== 'destroy') {
    const blocks: Block[] = [paragraph(t('view.plan.destructive', { count: destructive.length }))];
    if (level !== 'simple') {
      blocks.push({
        type: 'list',
        items: destructive.map(
          (c) =>
            `${t(`action.${c.action}`)}: ${t(`resource.${c.resource.type}`)} [${c.resource.name}]`,
        ),
      });
    } else {
      blocks.push({
        type: 'list',
        items: [
          ...new Set(destructive.map((c) => capitalize(t(`capability.${c.capability}`)))),
        ].sort(),
      });
    }
    sections.push({
      id: 'destructive',
      heading: t('view.section.plan-destructive'),
      blocks,
    });
  }

  // ---- what will be created --------------------------------------------------------------
  if (plan.changes.length > 0) {
    if (level === 'simple') {
      const capabilities = [...new Set(plan.changes.map((c) => c.capability))]
        .filter((c) => c !== 'environment-variables')
        .sort();
      sections.push({
        id: 'creates',
        heading: t(planKey('creates')),
        blocks: [
          { type: 'list', items: capabilities.map((c) => capitalize(t(`capability.${c}`))) },
        ],
      });
    } else if (level === 'guided') {
      sections.push({
        id: 'creates',
        heading: t(planKey('creates')),
        blocks: [
          {
            type: 'list',
            items: plan.changes.map((change: PlanChange) => {
              const reasons = change.rationale
                .filter((r) => !r.code.startsWith('guardrail.') && !r.code.startsWith('input.'))
                .map(rationaleText);
              const base = `${t(`resource.${change.resource.type}`)} [${change.resource.name}]`;
              return reasons.length === 0 ? base : `${base}: ${reasons.join(' ')}`;
            }),
          },
        ],
      });
    } else {
      sections.push({
        id: 'changes',
        heading: t('view.section.plan-changes'),
        blocks: [
          {
            type: 'table',
            columns: [
              t('column.action'),
              t('column.type'),
              t('column.name'),
              t('column.destructive'),
            ],
            rows: plan.changes.map((c) => [
              t(`action.${c.action}`),
              t(`resource.${c.resource.type}`),
              c.resource.name,
              t(c.destructive ? 'meta.yes' : 'meta.no'),
            ]),
          },
        ],
      });
      sections.push({
        id: 'rationale',
        heading: t('view.section.plan-rationale'),
        blocks: [
          {
            type: 'table',
            columns: [t('column.id'), t('column.code'), t('column.evidence')],
            rows: plan.changes.flatMap((c) =>
              c.rationale.map((r) => [c.id, r.code, (r.evidence ?? []).join(', ')]),
            ),
          },
        ],
      });
      sections.push({
        id: 'details',
        heading: t('view.section.plan-details'),
        blocks: [
          {
            type: 'code',
            language: 'json',
            text: JSON.stringify(
              Object.fromEntries(plan.changes.map((c) => [c.id, c.details ?? {}])),
              null,
              2,
            ),
          },
        ],
      });
    }
  }

  // ---- safeguards (simple and guided) ----------------------------------------------------
  const guardrails = [
    ...new Set(
      plan.changes.flatMap((change) =>
        change.rationale.map((r) => r.code).filter((code) => code.startsWith('guardrail.')),
      ),
    ),
  ].sort();
  if (level !== 'expert' && guardrails.length > 0) {
    sections.push({
      id: 'safeguards',
      heading: t('view.section.plan-safeguards'),
      blocks: [{ type: 'list', items: guardrails.map((code) => t(`rationale.${code}`)) }],
    });
  }

  // ---- cost ------------------------------------------------------------------------------
  if (plan.cost !== undefined) {
    const { cost } = plan;
    const low = money(cost.monthlyLow, locale);
    const high = money(cost.monthlyHigh, locale);
    const confidence = t(`cost.confidence.${cost.confidence}`);
    const source = t(`view.plan.cost.source.${cost.priceSource}`);
    const blocks: Block[] = [
      {
        type: 'paragraph',
        text: t(cost.monthlyHigh < 1 ? 'view.plan.cost.free' : 'view.plan.cost.range', {
          low,
          high: cost.monthlyHigh < 1 ? money(1, locale) : high,
          confidence,
        }),
      },
    ];
    if (level === 'guided') {
      blocks.push({
        type: 'paragraph',
        text: t('view.plan.cost.confidence', { confidence, source, asOf: cost.pricesAsOf }),
      });
    }
    if (level !== 'simple') {
      blocks.push({
        type: 'table',
        columns: [t('column.item'), t('column.low'), t('column.high')],
        rows: cost.lines.map((line) => [
          t(`cost.line.${line.code}`),
          money(line.monthlyLow, locale),
          money(line.monthlyHigh, locale),
        ]),
      });
      blocks.push({
        type: 'list',
        items: cost.assumptions.map((a) => t(`rationale.${a.code}`, a.params)),
      });
    }
    if (level === 'expert') {
      blocks.push({
        type: 'paragraph',
        text: t('view.plan.cost.confidence', {
          confidence,
          source: cost.priceSource,
          asOf: cost.pricesAsOf,
        }),
      });
    }
    blocks.push({ type: 'paragraph', text: t('view.plan.cost.note') });
    sections.push({ id: 'cost', heading: t('view.section.plan-cost'), blocks });
  }

  // ---- warnings that do not block --------------------------------------------------------
  if (advice.length > 0) {
    sections.push({
      id: 'warnings',
      heading: t('view.section.plan-warnings'),
      blocks:
        level === 'expert'
          ? [
              {
                type: 'table',
                columns: [t('column.severity'), t('column.code'), t('column.details')],
                rows: advice.map((w) => [
                  t(`severity.${w.severity}`),
                  w.code,
                  JSON.stringify(w.params ?? {}),
                ]),
              },
            ]
          : [{ type: 'list', items: advice.map(warningText) }],
    });
  }

  // ---- inputs ----------------------------------------------------------------------------
  if (plan.requiredInputs.length > 0) {
    const secrets = plan.requiredInputs.filter((input) => input.kind === 'secret');
    const blocks: Block[] = [
      {
        type: 'paragraph',
        text: t('view.plan.inputs.count', { count: plan.requiredInputs.length }),
      },
    ];
    if (secrets.length > 0)
      blocks.push({
        type: 'paragraph',
        text: t('view.plan.inputs.secrets', { count: secrets.length }),
      });
    if (level !== 'simple') {
      blocks.push({
        type: 'table',
        columns: [t('column.name'), t('column.kind')],
        rows: plan.requiredInputs.map((input) => [input.name, t(`input.kind.${input.kind}`)]),
      });
    }
    sections.push({ id: 'inputs', heading: t('view.section.plan-inputs'), blocks });
  }

  // ---- seal (expert) ---------------------------------------------------------------------
  if (level === 'expert') {
    sections.push({
      id: 'seal',
      heading: t('view.section.plan-seal'),
      blocks: [
        {
          type: 'table',
          columns: [t('column.id'), t('column.details')],
          rows: [
            [t('meta.digest'), plan.digest],
            [t('meta.artifact'), plan.artifactHash],
            [t('meta.source'), plan.sourceHash],
            [t('meta.account'), plan.target.accountId],
            [t('meta.region'), plan.target.region],
            [t('meta.strategy'), plan.strategy],
          ],
        },
      ],
    });
  }

  if (blocking.length === 0 && level !== 'expert') {
    sections.push({
      id: 'approval',
      heading: '',
      blocks: [{ type: 'callout', tone: 'info', text: t('view.plan.nothing-created') }],
    });
  }

  return {
    audience: level,
    locale,
    title: t(planKey('title'), {
      name: plan.application,
    }),
    sections,
  };
}

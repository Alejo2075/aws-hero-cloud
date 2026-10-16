import type { DeploymentResult, Health, HealthCheck, HealthStatus } from '@hero-cloud/core';
import type { Messages } from './messages.js';
import type { Block, MessageParams, RenderOptions, Section, View } from './types.js';

function money(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  } catch {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(value);
  }
}

function when(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return (
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(date) + ' UTC'
    );
  } catch {
    return iso;
  }
}

/** The words for one check, with what was seen filled in. */
function checkText(check: HealthCheck, options: RenderOptions, messages: Messages): string {
  const params: Record<string, string | number | boolean> = {
    target: check.target ?? '',
    statusCode: check.observed?.statusCode ?? '',
    latencyMs: check.observed?.latencyMs ?? '',
  };
  return messages.text(`check.${check.code}`, options.audience, options.locale, params);
}

/**
 * The evidence that the system works, at the reader's level. Every level says what was checked and
 * what the checks cannot show, because a health check never proves more than it observed.
 */
export function healthSections(
  health: Health,
  options: RenderOptions,
  messages: Messages,
): Section[] {
  const { audience: level, locale } = options;
  const t = (code: string, params?: MessageParams): string =>
    messages.text(code, level, locale, params);
  const status = (value: HealthStatus): string => t(`view.health.status.${value}`);
  const resultWord = (check: HealthCheck): string => t(`health.check-status.${check.status}`);

  const blocks: Block[] = [
    {
      type: 'callout',
      tone: health.status === 'healthy' ? 'info' : 'warning',
      text: status(health.status),
    },
  ];
  if (level === 'simple') {
    const failed = health.checks.filter((check) => check.status === 'failed');
    if (failed.length > 0)
      blocks.push({ type: 'list', items: failed.map((c) => checkText(c, options, messages)) });
  } else if (level === 'guided') {
    blocks.push({
      type: 'list',
      items: health.checks.map((c) => `${resultWord(c)}: ${checkText(c, options, messages)}`),
    });
  } else {
    blocks.push({
      type: 'table',
      columns: [
        t('view.health.col-component'),
        t('view.health.col-check'),
        t('view.health.col-result'),
        t('view.health.col-what'),
      ],
      rows: health.checks.map((c) => [
        c.component,
        c.kind,
        resultWord(c),
        checkText(c, options, messages),
      ]),
    });
  }
  blocks.push({ type: 'paragraph', text: t('view.health.limits') });
  blocks.push({
    type: 'paragraph',
    text: t('view.health.checked-at', { time: when(health.checkedAt, locale) }),
  });
  return [{ id: 'health', heading: t('view.section.result-health'), blocks }];
}

export function healthView(
  deploymentId: string,
  health: Health,
  options: RenderOptions,
  messages: Messages,
): View {
  return {
    audience: options.audience,
    locale: options.locale,
    title: messages.text('view.health.title', options.audience, options.locale, {
      id: deploymentId,
    }),
    sections: healthSections(health, options, messages),
  };
}

/**
 * Everything a person needs after a deployment: how to reach the app, whether it works and what
 * was checked, what it costs, where to look, and what to do next. The levels differ in depth only.
 */
export function resultView(
  result: DeploymentResult,
  options: RenderOptions,
  messages: Messages,
): View {
  const { audience: level, locale } = options;
  const t = (code: string, params?: MessageParams): string =>
    messages.text(code, level, locale, params);
  const sections: Section[] = [];
  const removed = result.kind === 'removal';
  const setup = result.kind === 'setup';

  sections.push({
    id: 'summary',
    heading: t('view.section.summary'),
    blocks: [
      {
        type: 'callout',
        tone: result.status === 'succeeded' ? 'info' : 'warning',
        text:
          result.status !== 'succeeded'
            ? t(`view.result.status.${result.status}`)
            : removed
              ? t('view.result.removed')
              : setup
                ? t('view.result.setup')
                : t(`view.result.status.${result.status}`),
      },
    ],
  });

  if (!removed && !setup) {
    sections.push({
      id: 'reach',
      heading: t('view.section.result-reach'),
      blocks:
        result.endpoints.length === 0
          ? [{ type: 'paragraph', text: t('view.result.no-endpoints') }]
          : [
              {
                type: 'list',
                items: result.endpoints.map((endpoint) => {
                  const known = messages.has(`view.endpoint.${endpoint.label}`, 'en');
                  const label = known ? t(`view.endpoint.${endpoint.label}`) : endpoint.label;
                  return `${label}: ${endpoint.value}`;
                }),
              },
            ],
    });
    sections.push(...healthSections(result.health, options, messages));
  }

  if (result.cost !== undefined) {
    sections.push({
      id: 'cost',
      heading: t('view.section.result-cost'),
      blocks: [
        {
          type: 'paragraph',
          text: t('view.result.cost-line', {
            low: money(result.cost.monthlyLow, locale),
            high: money(result.cost.monthlyHigh, locale),
          }),
        },
      ],
    });
  }

  if (level !== 'simple' && result.links.length > 0) {
    sections.push({
      id: 'links',
      heading: t('view.section.result-links'),
      blocks: [
        {
          type: 'list',
          items: result.links.map((link) => {
            const known = messages.has(`view.link.${link.label}`, 'en');
            return `${known ? t(`view.link.${link.label}`) : link.label}: ${link.value}`;
          }),
        },
      ],
    });
  }

  if (level === 'expert' && result.resources.length > 0) {
    sections.push({
      id: removed ? 'kept' : 'resources',
      heading: t(removed ? 'view.section.result-kept' : 'view.section.result-resources'),
      blocks: [
        {
          type: 'table',
          columns: ['type', 'name', 'id'],
          rows: result.resources.map((r) => [r.type, r.name, r.id]),
        },
      ],
    });
  }

  if (result.sensitiveOutputs.length > 0) {
    sections.push({
      id: 'secrets',
      heading: t('view.section.result-secrets'),
      blocks: [
        {
          type: 'list',
          items: result.sensitiveOutputs.map((s) =>
            level === 'simple' ? s.name : `${s.name}: ${s.location}`,
          ),
        },
      ],
    });
  }

  if (result.nextSteps.length > 0) {
    sections.push({
      id: 'next',
      heading: t('view.section.result-next'),
      blocks: [
        {
          type: 'list',
          items: result.nextSteps.map((step) => t(`rationale.${step.code}`, step.params)),
        },
      ],
    });
  }

  return {
    audience: level,
    locale,
    title: t('view.result.title', { id: result.deploymentId }),
    sections,
  };
}

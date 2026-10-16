import type { SetupReport } from '@hero-cloud/core';
import type { Messages } from './messages.js';
import type { Block, MessageParams, RenderOptions, Section, View } from './types.js';

/**
 * Where a person stands on the way to a first deployment, and what to do next. Every level says
 * plainly that Hero cannot make or pay for an AWS account; the levels differ in how much of the
 * detail behind each step they show.
 */
export function setupView(report: SetupReport, options: RenderOptions, messages: Messages): View {
  const { audience: level, locale } = options;
  const t = (code: string, params?: MessageParams): string =>
    messages.text(code, level, locale, params);
  const sections: Section[] = [];

  const summary: Block[] = [];
  if (report.identity === undefined) {
    summary.push({ type: 'paragraph', text: t('view.setup.no-identity') });
  } else {
    summary.push({
      type: 'paragraph',
      text: t('view.setup.identity', {
        account: report.identity.account,
        principal: report.identity.principal,
        kind: report.identity.kind,
        region: report.region,
      }),
    });
  }
  summary.push({ type: 'paragraph', text: t('view.setup.honesty') });
  sections.push({ id: 'summary', heading: t('view.section.summary'), blocks: summary });

  const steps: Block[] =
    level === 'expert'
      ? [
          {
            type: 'table',
            columns: ['step', 'status'],
            rows: report.steps.map((s) => [s.id, t(`setup.status.${s.status}`)]),
          },
        ]
      : [
          {
            type: 'list',
            items: report.steps.map(
              (s) => `${t(`setup.status.${s.status}`)}: ${t(`setup.step.${s.id}`)}`,
            ),
          },
        ];
  sections.push({ id: 'steps', heading: t('view.section.setup-steps'), blocks: steps });

  if (level !== 'simple') {
    sections.push({
      id: 'profiles',
      heading: t('view.section.setup-profiles'),
      blocks:
        report.profiles.length === 0
          ? [{ type: 'paragraph', text: t('view.setup.no-profiles') }]
          : [{ type: 'list', items: report.profiles.map((p) => `${p.name} (${p.kind})`) }],
    });
  }
  if (report.deployerRoleArn !== undefined && level !== 'simple') {
    sections.push({
      id: 'role',
      heading: t('view.section.setup-steps'),
      blocks: [
        {
          type: 'paragraph',
          text: t('view.setup.deployer-role', { role: report.deployerRoleArn }),
        },
      ],
    });
  }
  if (report.next.length > 0) {
    sections.push({
      id: 'next',
      heading: t('view.section.setup-next'),
      blocks: [{ type: 'list', items: report.next.map((code) => t(`setup.next.${code}`)) }],
    });
  }
  return { audience: level, locale, title: t('view.setup.title'), sections };
}

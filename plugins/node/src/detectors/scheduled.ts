import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { SERVER_FRAMEWORKS } from '../frameworks.js';
import {
  dependencyEvidence,
  detectPackageManager,
  readPackageJson,
  startCommand,
} from '../package-json.js';
import { sourceFiles } from '../sources.js';

const SCHEDULERS = [
  'node-cron',
  'cron',
  'node-schedule',
  'croner',
  'agenda',
  'bree',
  '@breejs/later',
];

/**
 * Matches calls such as `cron.schedule('0 * * * *', ...)`, `scheduleJob(...)`, and
 * `new CronJob('0 9 * * 1', ...)`. Only a literal five-field expression is accepted; anything
 * computed is left for a person.
 */
const CRON_CALL =
  /\b(?:schedule|scheduleJob|CronJob|Cron)\s*\(\s*['"`]((?:[0-9*,/-]{1,40}\s+){4}[0-9*,/-]{1,40})['"`]/;

/** Scheduled jobs: cron libraries and a project that exists to run on a schedule. */
export const scheduledDetector = defineDetector({
  id: 'node/scheduled',
  description: 'Scheduled and background jobs',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;
    const dependency = SCHEDULERS.find((name) => info.dependencies.has(name));
    if (dependency === undefined) return emptyFinding;

    const { manager } = detectPackageManager(context, info);
    const sources = await sourceFiles(context);
    const found = sources
      .map((file) => CRON_CALL.exec(file.text)?.[1])
      .find((value) => value !== undefined);
    const schedule = found?.trim().replace(/\s+/g, ' ');
    const hasServer = [...SERVER_FRAMEWORKS.keys()].some((name) => info.dependencies.has(name));
    const confidence = hasServer ? 0.6 : 0.85;

    return {
      detections: [
        {
          capability: 'scheduled-job',
          confidence,
          evidence: [
            dependencyEvidence(info, dependency),
            ...(schedule === undefined ? [] : ['source:schedule']),
          ],
        },
      ],
      contributions: [
        {
          kind: 'service',
          value: {
            id: 'jobs',
            type: 'scheduled',
            runtime: 'nodejs',
            ...(info.scripts.start === undefined
              ? {}
              : { start: { command: startCommand(manager) } }),
            ...(schedule === undefined ? {} : { schedule }),
          },
          confidence,
        },
      ],
      // Splitting a scheduler out of a web server, and any schedule that cannot be read from the
      // code, are decisions for a person rather than guesses.
      questions: [
        ...(hasServer ? [{ id: 'scheduled.inside-server', code: 'scheduled.inside-server' }] : []),
        ...(schedule === undefined
          ? [{ id: 'scheduled.schedule-unknown', code: 'scheduled.schedule-unknown' }]
          : []),
      ],
    };
  },
});

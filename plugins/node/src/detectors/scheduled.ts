import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { SERVER_FRAMEWORKS } from '../frameworks.js';
import {
  dependencyEvidence,
  detectPackageManager,
  readPackageJson,
  startCommand,
} from '../package-json.js';

const SCHEDULERS = [
  'node-cron',
  'cron',
  'node-schedule',
  'croner',
  'agenda',
  'bree',
  '@breejs/later',
];

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
    const hasServer = [...SERVER_FRAMEWORKS.keys()].some((name) => info.dependencies.has(name));
    return {
      detections: [
        {
          capability: 'scheduled-job',
          confidence: hasServer ? 0.6 : 0.85,
          evidence: [dependencyEvidence(info, dependency)],
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
          },
          confidence: hasServer ? 0.6 : 0.85,
        },
      ],
      // When the scheduler lives inside a web server, splitting it out is a decision for a person.
      questions: hasServer
        ? [{ id: 'scheduled.inside-server', code: 'scheduled.inside-server' }]
        : [],
    };
  },
});

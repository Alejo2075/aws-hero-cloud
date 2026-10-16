import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { FRONTEND_TOOLS, SERVER_FRAMEWORKS, hasAny } from '../frameworks.js';
import { readPackageJson } from '../package-json.js';

const KNOWN = [
  ...SERVER_FRAMEWORKS.keys(),
  ...FRONTEND_TOOLS.filter((tool) => !['react', 'vue', 'svelte', '@angular/core'].includes(tool)),
  'node-cron',
  'cron',
  'node-schedule',
  'croner',
  'agenda',
  'bree',
];

/** A Node project with nothing Hero recognizes: say so, rather than guess a plan. */
export const unrecognizedDetector = defineDetector({
  id: 'node/unrecognized',
  description: 'Node projects that match no known framework',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;
    if (hasAny(info.allDependencies, KNOWN) !== undefined || info.workspaces) return emptyFinding;
    if (
      ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json'].some((file) =>
        context.has(file),
      )
    )
      return emptyFinding;

    const questions = [{ id: 'app.not-recognized', code: 'app.not-recognized' }];
    // A project with a plain start script is likely a long-running program.
    return info.scripts.start === undefined
      ? { detections: [], contributions: [], questions }
      : {
          detections: [
            { capability: 'process-service', confidence: 0.5, evidence: ['script:start'] },
          ],
          contributions: [],
          questions,
        };
  },
});

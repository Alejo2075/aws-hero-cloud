import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { SERVER_FRAMEWORKS, FRONTEND_TOOLS, hasAny } from '../frameworks.js';
import { readPackageJson } from '../package-json.js';

const MARKERS = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json', 'rush.json'];
const CONTAINERS = ['apps', 'packages', 'services', 'projects'];

/** Workspaces with several packages: asks which one to deploy instead of guessing. */
export const monorepoDetector = defineDetector({
  id: 'node/monorepo',
  description: 'Monorepos and workspaces',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;

    const marker = MARKERS.find((file) => context.has(file));
    if (marker === undefined && !info.workspaces) return emptyFinding;

    const candidates = new Set<string>();
    for (const container of CONTAINERS) {
      for (const path of context.list(`${container}/`)) {
        const parts = path.split('/');
        if (parts.length === 3 && parts[2] === 'package.json')
          candidates.add(`${parts[0]}/${parts[1]}`);
      }
    }
    const rootIsDeployable =
      hasAny(info.allDependencies, [
        ...FRONTEND_TOOLS.filter((tool) => tool !== 'react'),
        ...SERVER_FRAMEWORKS.keys(),
      ]) !== undefined;

    const evidence = [marker === undefined ? 'field:workspaces' : `file:${marker}`];
    const found = [...candidates].sort().slice(0, 20);
    return {
      detections: [{ capability: 'monorepo', confidence: 0.95, evidence }],
      contributions: [],
      questions:
        found.length > 1 && !rootIsDeployable
          ? [{ id: 'monorepo.choose-package', code: 'monorepo.choose-package', options: found }]
          : [],
    };
  },
});

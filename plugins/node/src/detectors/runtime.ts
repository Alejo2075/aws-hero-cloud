import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { detectPackageManager, readPackageJson } from '../package-json.js';

/** Names the application and records the package manager and Node version the project expects. */
export const runtimeDetector = defineDetector({
  id: 'node/runtime',
  description: 'Package manager, Node.js version, and application name',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;

    const { manager, evidence } = detectPackageManager(context, info);
    const nvmrc =
      (await context.readText('.nvmrc', 64)) ?? (await context.readText('.node-version', 64));
    const requested = nvmrc?.trim().replace(/^v/, '') || info.engines;
    const evidenceList = ['file:package.json', evidence];
    if (nvmrc !== undefined)
      evidenceList.push(context.has('.nvmrc') ? 'file:.nvmrc' : 'file:.node-version');
    if (info.engines !== undefined) evidenceList.push('field:engines.node');

    return {
      detections: [{ capability: 'node-runtime', confidence: 0.98, evidence: evidenceList }],
      contributions: [
        ...(info.name === undefined
          ? []
          : [{ kind: 'name', value: info.name, confidence: 0.6 } as const]),
        {
          kind: 'extension',
          key: 'x-node',
          value: {
            packageManager: manager,
            ...(requested === undefined || requested === ''
              ? {}
              : { nodeVersion: requested.slice(0, 40) }),
            ...(info.type === 'module' ? { moduleType: 'module' } : {}),
          },
        },
      ],
      questions: [],
    };
  },
});

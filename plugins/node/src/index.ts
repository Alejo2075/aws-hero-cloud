import { definePlugin } from '@hero-cloud/plugin-sdk';
import { authDetector } from './detectors/auth.js';
import { dataDetector } from './detectors/data.js';
import { environmentDetector } from './detectors/environment.js';
import { frontendDetector } from './detectors/frontend.js';
import { monorepoDetector } from './detectors/monorepo.js';
import { runtimeDetector } from './detectors/runtime.js';
import { scheduledDetector } from './detectors/scheduled.js';
import { serverDetector } from './detectors/server.js';
import { staticSiteDetector } from './detectors/static-site.js';
import { storageDetector } from './detectors/storage.js';
import { unrecognizedDetector } from './detectors/unrecognized.js';

/** Question codes the Node detectors can raise. Each needs a message at every audience level. */
export const nodeQuestionCodes = [
  'frontend.build-missing',
  'service.start-unknown',
  'service.port-unknown',
  'scheduled.inside-server',
  'scheduled.schedule-unknown',
  'data.sqlite-persistence',
  'data.engine-unknown',
  'data.keys-unknown',
  'data.keys-confirm',
  'storage.uploads',
  'storage.writes-to-disk',
  'monorepo.choose-package',
  'app.not-recognized',
] as const;

/** Official detectors for JavaScript and TypeScript projects. */
export const nodePlugin = definePlugin({
  id: 'node',
  detectors: [
    runtimeDetector,
    staticSiteDetector,
    frontendDetector,
    serverDetector,
    scheduledDetector,
    dataDetector,
    storageDetector,
    authDetector,
    environmentDetector,
    monorepoDetector,
    unrecognizedDetector,
  ],
});

export {
  authDetector,
  dataDetector,
  environmentDetector,
  frontendDetector,
  monorepoDetector,
  runtimeDetector,
  scheduledDetector,
  serverDetector,
  staticSiteDetector,
  storageDetector,
  unrecognizedDetector,
};

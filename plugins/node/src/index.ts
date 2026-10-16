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

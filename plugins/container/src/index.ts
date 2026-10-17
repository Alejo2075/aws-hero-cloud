import { definePlugin } from '@hero-cloud/plugin-sdk';
import { dockerfileDetector } from './dockerfile.js';

/** Question codes the container detectors can raise (all are shared with the Node detectors). */
export const containerQuestionCodes = [] as const;

/** Official detectors for applications that bring their own container image recipe. */
export const containerPlugin = definePlugin({
  id: 'container',
  detectors: [dockerfileDetector],
});

export { dockerfileDetector };

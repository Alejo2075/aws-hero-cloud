import { definePlugin } from '@hero-cloud/plugin-sdk';
import { dotnetDetector } from './dotnet.js';
import { goDetector } from './go.js';
import { javaDetector } from './java.js';
import { phpDetector } from './php.js';
import { procfileDetector } from './procfile.js';
import { pythonDetector } from './python.js';
import { rubyDetector } from './ruby.js';

/** Official detectors for applications written in languages other than JavaScript. */
export const legacyPlugin = definePlugin({
  id: 'legacy',
  detectors: [
    pythonDetector,
    phpDetector,
    javaDetector,
    dotnetDetector,
    rubyDetector,
    goDetector,
    procfileDetector,
  ],
});

export {
  dotnetDetector,
  goDetector,
  javaDetector,
  phpDetector,
  procfileDetector,
  pythonDetector,
  rubyDetector,
};

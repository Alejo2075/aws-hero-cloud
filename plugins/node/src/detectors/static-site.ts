import { defineDetector } from '@hero-cloud/plugin-sdk';

/** A plain HTML site: an `index.html` and no build tooling. */
export const staticSiteDetector = defineDetector({
  id: 'node/static-site',
  description: 'Plain HTML sites without a package.json',
  detect(context) {
    if (context.has('package.json') || !context.has('index.html')) {
      return Promise.resolve({ detections: [], contributions: [], questions: [] });
    }
    return Promise.resolve({
      detections: [
        {
          capability: 'web-frontend',
          confidence: 0.85,
          evidence: ['file:index.html', 'absent:package.json'],
        },
      ],
      contributions: [
        { kind: 'frontend', value: { framework: 'static' }, confidence: 0.85 },
        { kind: 'extension', key: 'x-static', value: { outputDirectory: '.' } },
      ],
      questions: [],
    });
  },
});

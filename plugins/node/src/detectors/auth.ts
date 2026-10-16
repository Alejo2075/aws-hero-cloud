import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { dependencyEvidence, readPackageJson } from '../package-json.js';

const STRONG = [
  '@aws-sdk/client-cognito-identity-provider',
  'amazon-cognito-identity-js',
  'aws-jwt-verify',
  '@aws-amplify/auth',
  'aws-amplify',
];
const COMMON = [
  'passport',
  'next-auth',
  '@auth/core',
  'jsonwebtoken',
  'express-session',
  'lucia',
  'better-auth',
  'jose',
];

/** Whether users sign in. A hint to plan an identity service, never an assumption of which one. */
export const authDetector = defineDetector({
  id: 'node/auth',
  description: 'Authentication libraries',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;

    const strong = STRONG.filter((name) => info.dependencies.has(name));
    const common = [
      ...COMMON,
      ...[...info.dependencies].filter((name) => name.startsWith('@clerk/')),
    ].filter((name) => info.dependencies.has(name));
    if (strong.length === 0 && common.length === 0) return emptyFinding;

    const confidence = strong.length > 0 ? 0.9 : 0.6;
    return {
      detections: [
        {
          capability: 'authentication',
          confidence,
          evidence: [...strong, ...common].map((name) => dependencyEvidence(info, name)),
        },
      ],
      contributions: [{ kind: 'auth', required: true, confidence }],
      questions: [],
    };
  },
});

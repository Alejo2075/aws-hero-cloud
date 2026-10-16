import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Detection, OpenQuestion } from '@hero-cloud/core';
import { dependencyEvidence, readPackageJson } from '../package-json.js';
import { sourceFiles } from '../sources.js';

const OBJECT_STORAGE = [
  '@aws-sdk/client-s3',
  '@aws-sdk/lib-storage',
  '@aws-sdk/s3-request-presigner',
  'aws-sdk',
];
const UPLOAD_LIBRARIES = [
  'multer',
  'formidable',
  'busboy',
  'express-fileupload',
  '@fastify/multipart',
];
const DISK_WRITE =
  /\b(?:fs|fsp|fs\/promises|promises)\.(?:writeFile|appendFile|createWriteStream)\b|\bcreateWriteStream\(/;

/** Object storage and, where uncertain, whether the application keeps files on local disk. */
export const storageDetector = defineDetector({
  id: 'node/storage',
  description: 'Object storage and file uploads',
  async detect(context) {
    const info = await readPackageJson(context);
    if (info === undefined) return emptyFinding;

    const detections: Detection[] = [];
    const questions: OpenQuestion[] = [];
    const contributions = [];

    const object = OBJECT_STORAGE.filter((name) => info.dependencies.has(name));
    if (object.length > 0) {
      detections.push({
        capability: 'object-storage',
        confidence: 0.9,
        evidence: object.map((name) => dependencyEvidence(info, name)),
      });
      contributions.push({
        kind: 'storage',
        value: { id: 'assets', type: 'object' },
        confidence: 0.9,
      } as const);
    }

    const uploads = UPLOAD_LIBRARIES.filter((name) => info.dependencies.has(name));
    if (uploads.length > 0) {
      detections.push({
        capability: 'file-uploads',
        confidence: 0.7,
        evidence: uploads.map((name) => dependencyEvidence(info, name)),
      });
      // Where uploads end up decides the design, so a person is asked instead of Hero guessing.
      if (object.length === 0)
        questions.push({
          id: 'storage.uploads',
          code: 'storage.uploads',
          options: ['object', 'file-system'],
        });
    }

    const writers = (await sourceFiles(context))
      .filter((file) => DISK_WRITE.test(file.text))
      .map((file) => file.path);
    if (writers.length > 0 && object.length === 0) {
      detections.push({
        capability: 'file-system-write',
        confidence: 0.5,
        evidence: writers.slice(0, 5).map((path) => `file:${path}`),
      });
      questions.push({ id: 'storage.writes-to-disk', code: 'storage.writes-to-disk' });
    }
    return { detections, contributions, questions };
  },
});

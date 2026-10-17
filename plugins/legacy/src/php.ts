import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type { Detection } from '@hero-cloud/core';
import { text } from './shared.js';

/** PHP applications: WordPress, Laravel, and plain PHP sites. */
export const phpDetector = defineDetector({
  id: 'legacy/php',
  description: 'PHP applications',
  async detect(context) {
    const composer = await text(context, 'composer.json', 128 * 1024);
    const requires = (name: string): boolean => (composer ?? '').includes(`"${name}"`);
    const wordpress =
      context.has('wp-config.php') ||
      context.has('wp-config-sample.php') ||
      context.has('wp-content/index.php') ||
      context.has('wp-includes/version.php');
    const laravel = context.has('artisan') && requires('laravel/framework');
    const plain = context.has('index.php') || context.has('public/index.php');
    if (!wordpress && !laravel && !plain) return emptyFinding;

    const kind = wordpress ? 'wordpress' : laravel ? 'laravel' : 'php';
    const evidence = [
      wordpress
        ? 'file:wp-config.php'
        : laravel
          ? 'dependency:laravel/framework'
          : 'file:index.php',
    ];
    const detections: Detection[] = [{ capability: 'http-service', confidence: 0.85, evidence }];
    const contributions: Contribution[] = [
      {
        kind: 'service',
        value: { id: 'web', type: 'http', runtime: 'php', port: 8080, healthPath: '/' },
        confidence: 0.85,
      },
      { kind: 'extension', key: 'x-php', value: { kind } },
    ];

    if (wordpress) {
      detections.push({
        capability: 'relational-data',
        confidence: 0.95,
        evidence: ['file:wp-config.php'],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine: 'mysql' },
        confidence: 0.95,
      });
      // Uploaded media and plugins live on disk and must survive a restart.
      detections.push({
        capability: 'file-system-write',
        confidence: 0.9,
        evidence: ['file:wp-content'],
      });
      contributions.push({
        kind: 'storage',
        value: { id: 'uploads', type: 'file-system' },
        confidence: 0.9,
      });
    } else if (laravel || requires('doctrine/dbal')) {
      const engine = /pgsql|postgres/i.test((await text(context, '.env.example', 32 * 1024)) ?? '')
        ? 'postgres'
        : 'mysql';
      detections.push({
        capability: 'relational-data',
        confidence: 0.6,
        evidence: ['dependency:laravel/framework'],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine },
        confidence: 0.6,
      });
    }
    return { detections, contributions, questions: [] };
  },
});

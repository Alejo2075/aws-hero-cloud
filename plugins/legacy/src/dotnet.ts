import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type { Detection } from '@hero-cloud/core';
import { text } from './shared.js';

/** ASP.NET Core applications. */
export const dotnetDetector = defineDetector({
  id: 'legacy/dotnet',
  description: '.NET web applications',
  async detect(context) {
    const projects = context.files
      .map((f) => f.path)
      .filter((p) => /\.csproj$/.test(p) && p.split('/').length <= 3);
    for (const project of projects.sort().slice(0, 5)) {
      const manifest = (await text(context, project, 128 * 1024)) ?? '';
      if (!/Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/.test(manifest)) continue;
      const detections: Detection[] = [
        { capability: 'http-service', confidence: 0.85, evidence: [`file:${project}`] },
      ];
      const contributions: Contribution[] = [
        {
          kind: 'service',
          value: { id: 'web', type: 'http', runtime: 'dotnet', port: 8080 },
          confidence: 0.85,
        },
      ];
      if (/Npgsql/i.test(manifest)) {
        detections.push({
          capability: 'relational-data',
          confidence: 0.9,
          evidence: ['dependency:Npgsql'],
        });
        contributions.push({
          kind: 'data',
          value: { id: 'database', type: 'relational', engine: 'postgres' },
          confidence: 0.9,
        });
      } else if (/MySql/i.test(manifest)) {
        detections.push({
          capability: 'relational-data',
          confidence: 0.9,
          evidence: ['dependency:MySql'],
        });
        contributions.push({
          kind: 'data',
          value: { id: 'database', type: 'relational', engine: 'mysql' },
          confidence: 0.9,
        });
      }
      return { detections, contributions, questions: [] };
    }
    return emptyFinding;
  },
});

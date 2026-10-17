import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type { Detection } from '@hero-cloud/core';
import { text } from './shared.js';

/** Java applications: Spring Boot and WAR packages. */
export const javaDetector = defineDetector({
  id: 'legacy/java',
  description: 'Java web applications',
  async detect(context) {
    const file = ['pom.xml', 'build.gradle', 'build.gradle.kts'].find((f) => context.has(f));
    if (file === undefined) return emptyFinding;
    const manifest = (await text(context, file, 256 * 1024)) ?? '';
    const boot = /spring-boot/i.test(manifest);
    const war =
      /<packaging>\s*war\s*<\/packaging>/i.test(manifest) ||
      /\bid\s*[('"]+war['")]+/.test(manifest);
    if (!boot && !war) return emptyFinding;

    const evidence = [boot ? `file:${file}` : 'config:packaging-war'];
    const actuator = /spring-boot-starter-actuator/.test(manifest);
    const detections: Detection[] = [{ capability: 'http-service', confidence: 0.85, evidence }];
    const contributions: Contribution[] = [
      {
        kind: 'service',
        value: {
          id: 'web',
          type: 'http',
          runtime: 'java',
          port: 8080,
          ...(actuator ? { healthPath: '/actuator/health' } : {}),
        },
        confidence: 0.85,
      },
      {
        kind: 'extension',
        key: 'x-java',
        value: { packaging: war ? 'war' : 'jar', framework: boot ? 'spring-boot' : 'servlet' },
      },
    ];
    if (/postgresql/i.test(manifest)) {
      detections.push({
        capability: 'relational-data',
        confidence: 0.9,
        evidence: ['dependency:postgresql'],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine: 'postgres' },
        confidence: 0.9,
      });
    } else if (/mysql-connector|mariadb-java-client|com\.mysql/i.test(manifest)) {
      detections.push({
        capability: 'relational-data',
        confidence: 0.9,
        evidence: ['dependency:mysql-connector'],
      });
      contributions.push({
        kind: 'data',
        value: { id: 'database', type: 'relational', engine: 'mysql' },
        confidence: 0.9,
      });
    }
    return { detections, contributions, questions: [] };
  },
});

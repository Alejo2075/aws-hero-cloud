import { analyzeSnapshot } from '@hero-cloud/analyzer';
import type { ProjectSnapshot } from '@hero-cloud/core';
import { nodePlugin } from '@hero-cloud/plugin-node';
import { describe, expect, it } from 'vitest';
import { containerPlugin } from './index.js';

function snapshot(files: Record<string, string>): ProjectSnapshot {
  const enc = new TextEncoder();
  const content = new Map(Object.entries(files).map(([p, c]) => [p, enc.encode(c)]));
  return {
    hash: 'a'.repeat(64),
    files: [...content].map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: 'b'.repeat(64),
    })),
    skipped: [],
    read: (p) => Promise.resolve(content.get(p) ?? new Uint8Array()),
    dispose: () => Promise.resolve(),
  };
}

const analyze = (files: Record<string, string>) =>
  analyzeSnapshot(snapshot(files), {
    detectors: [...nodePlugin.detectors, ...containerPlugin.detectors],
    name: 'demo',
  });

describe('dockerfileDetector', () => {
  it('turns a Dockerfile-only project into a web service on the exposed port', async () => {
    const a = await analyze({
      Dockerfile: 'FROM python:3.12\nEXPOSE 8000/tcp\nCMD ["python","app.py"]\n',
    });
    expect(a.spec.services).toEqual([
      { id: 'app', type: 'http', runtime: 'container', port: 8000 },
    ]);
    expect(a.spec.extensions).toEqual({ 'x-container': { dockerfile: 'Dockerfile' } });
    expect(a.detections.map((d) => d.capability)).toEqual(
      expect.arrayContaining(['container-image', 'http-service']),
    );
    expect(a.openQuestions).toEqual([]);
  });

  it('asks for the port when the Dockerfile does not say', async () => {
    const a = await analyze({ Dockerfile: 'FROM alpine\nCMD ["./run"]\n' });
    expect(a.spec.services?.[0]).toEqual({ id: 'app', type: 'http', runtime: 'container' });
    expect(a.openQuestions.map((q) => q.code)).toEqual(['service.port-unknown']);
  });

  it('ignores an impossible port', async () => {
    const a = await analyze({ Dockerfile: 'FROM alpine\nEXPOSE 99999\n' });
    expect(a.spec.services?.[0]?.port).toBeUndefined();
  });

  it('beside a Node project it only notes the Dockerfile and leaves the simpler way in place', async () => {
    const a = await analyze({
      Dockerfile: 'FROM node:22\nEXPOSE 3000\n',
      'package.json': JSON.stringify({
        name: 'api',
        dependencies: { express: '5' },
        scripts: { start: 'node s.js' },
      }),
      'server.js': 'app.listen(3000)',
    });
    expect(a.spec.services?.map((s) => s.runtime)).toEqual(['nodejs']);
    expect(a.spec.extensions?.['x-container']).toEqual({ dockerfile: 'Dockerfile' });
  });

  it('says nothing about a project without a Dockerfile', async () => {
    const a = await analyze({ 'index.html': '<p>hi</p>' });
    expect(a.spec.extensions?.['x-container']).toBeUndefined();
  });
});

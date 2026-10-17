import type { HeroSpec } from '@hero-cloud/specification';
import { describe, expect, it } from 'vitest';
import { applyRefinement } from './refine.js';

const empty: HeroSpec = { version: '1', application: { name: 'demo' } };
const withApi: HeroSpec = {
  ...empty,
  services: [{ id: 'api', type: 'http', runtime: 'nodejs', start: { command: 'node server.js' } }],
  data: [{ id: 'db', type: 'relational', engine: 'postgres' }],
};

describe('applyRefinement', () => {
  it('adds what is missing and says which fields it filled', () => {
    const r = applyRefinement(empty, {
      frontend: { framework: 'html' },
      services: [{ id: 'web', type: 'http', runtime: 'PHP', port: 8080, healthPath: '/up' }],
      data: [{ id: 'main', type: 'relational', engine: 'MySQL' }],
      storage: [{ id: 'files', type: 'object' }],
      auth: true,
    });
    expect(r.spec).toMatchObject({
      frontend: { framework: 'html' },
      services: [{ id: 'web', type: 'http', runtime: 'php', port: 8080, healthPath: '/up' }],
      data: [{ id: 'main', type: 'relational', engine: 'mysql' }],
      storage: [{ id: 'files', type: 'object' }],
      auth: { required: true },
    });
    expect(r.applied).toEqual(['frontend', 'services.web', 'data.main', 'storage.files', 'auth']);
    expect(r.rejected).toEqual([]);
  });

  it('never changes or removes what was found, and only fills gaps', () => {
    const r = applyRefinement(withApi, {
      services: [{ id: 'api', type: 'worker', runtime: 'python', port: 9000, healthPath: '/h' }],
      data: [{ id: 'other', type: 'relational', engine: 'oracle' }],
    });
    expect(r.spec.services).toEqual([
      {
        id: 'api',
        type: 'http',
        runtime: 'nodejs',
        start: { command: 'node server.js' },
        port: 9000,
        healthPath: '/h',
      },
    ]);
    expect(r.spec.data).toEqual(withApi.data);
    expect(r.applied).toEqual(['services.api.port', 'services.api.healthPath']);
  });

  it('does not take a key for a table, a command, or a folder, and drops unknown fields', () => {
    const r = applyRefinement(empty, {
      data: [{ id: 'kv', type: 'key-value', key: { partition: { name: 'id', type: 'string' } } }],
      frontend: { framework: 'react', outputDirectory: 'dist', build: { command: 'rm -rf /' } },
      permissions: ['iam:*'],
    });
    expect(r.spec.data).toEqual([{ id: 'kv', type: 'key-value' }]);
    expect(r.spec.frontend).toEqual({ framework: 'react' });
    expect(r.rejected).toContain('unknown-field');
  });

  it('rejects values that are not what they claim to be', () => {
    const r = applyRefinement(empty, {
      services: [
        {
          id: 'web',
          type: 'http',
          runtime: 'python',
          port: 99999,
          healthPath: 'http://x',
          schedule: '* * * * * ; rm',
        },
      ],
    });
    expect(r.rejected).toEqual([
      'services.web.port',
      'services.web.healthPath',
      'services.web.schedule',
    ]);
    expect(r.spec.services?.[0]).toEqual({ id: 'web', type: 'http', runtime: 'python' });
  });

  it('accepts a plain schedule for a scheduled job only', () => {
    const r = applyRefinement(empty, {
      services: [{ id: 'nightly', type: 'scheduled', runtime: 'python', schedule: '0 3 * * *' }],
    });
    expect(r.spec.services?.[0]?.schedule).toBe('0 3 * * *');
    const http = applyRefinement(empty, {
      services: [{ id: 'web', type: 'http', runtime: 'python', schedule: '0 3 * * *' }],
    });
    expect(http.spec.services?.[0]?.schedule).toBeUndefined();
  });

  it('gives nothing back for an answer that is not an object', () => {
    for (const answer of ['yes', null, 42, [], undefined, true]) {
      const r = applyRefinement(empty, answer);
      expect(r.spec).toEqual(empty);
      expect(r.applied).toEqual([]);
    }
  });
});

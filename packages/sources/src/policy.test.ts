import { describe, expect, it } from 'vitest';
import { isIgnoredDirectory, isSensitivePath } from './policy.js';

describe('isSensitivePath', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'apps/api/.env',
    'config/.env.staging',
    'server.pem',
    'tls/private.key',
    'cert.p12',
    'cert.pfx',
    'release.jks',
    'id_rsa',
    'home/.ssh/id_ed25519',
    '.ssh/config',
    '.npmrc',
    '.netrc',
    '.pypirc',
    '.git-credentials',
    '.aws/credentials',
    'credentials.json',
    'terraform.tfstate',
    'prod.tfvars',
    '.htpasswd',
  ])('treats %s as a secret', (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each([
    '.env.example',
    '.env.sample',
    '.env.template',
    'apps/api/.env.example',
    'src/index.ts',
    'package.json',
    'README.md',
    'id_rsa.pub',
    '.ssh/id_rsa.pub',
    'docs/environment.md',
    'src/key-value.ts',
  ])('does not treat %s as a secret', (path) => {
    expect(isSensitivePath(path)).toBe(false);
  });
});

describe('isIgnoredDirectory', () => {
  it('ignores dependencies and build output only', () => {
    for (const name of ['node_modules', '.git', 'dist', 'build', 'vendor', '.venv', '.hero']) {
      expect(isIgnoredDirectory(name)).toBe(true);
    }
    for (const name of ['src', 'lib', 'app', 'public', 'docs']) {
      expect(isIgnoredDirectory(name)).toBe(false);
    }
  });
});

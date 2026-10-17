import { describe, expect, it } from 'vitest';
import { redact, redactText } from './redact.js';

describe('redactText', () => {
  it.each([
    ['AWS access key', 'id AKIAIOSFODNN7EXAMPLE end'],
    ['OpenAI-style key', 'key sk-proj-abcdefghijklmnop1234567890'],
    ['GitHub token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['Slack token', 'xoxb-1234567890-abcdefghij'],
    ['Google key', 'AIzaSyA-abcdefghijklmnopqrstuvwxyz012345'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'],
    ['bearer header', 'Authorization: Bearer abcdefghijklmnop12345'],
    ['password in an address', 'postgres://admin:hunter2@db.example.com/app'],
    ['private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'],
  ])('removes a %s', (_name, text) => {
    const { value, redactions } = redactText(text);
    expect(redactions).toBeGreaterThan(0);
    expect(value).toContain('[redacted]');
    for (const secret of [
      'AKIAIOSFODNN7EXAMPLE',
      'abcdefghijklmnop1234567890',
      'hunter2',
      'MIIabc',
      'eyJhbGci',
      'abcdefghijklmnop12345',
    ]) {
      expect(value).not.toContain(secret);
    }
  });

  it('removes the value assigned to a secret-sounding name, in code and in JSON', () => {
    const text = [
      'const apiKey = "super-secret-value-1";',
      'DB_PASSWORD=correct horse battery',
      '"client_secret": "abc123def456"',
      'SESSION_TOKEN: xyz789',
      "stripeSecretKey = 'sk_live_whatever'",
    ].join('\n');
    const { value, redactions } = redactText(text);
    expect(redactions).toBeGreaterThanOrEqual(5);
    for (const secret of [
      'super-secret-value-1',
      'correct',
      'abc123def456',
      'xyz789',
      'sk_live_whatever',
    ]) {
      expect(value).not.toContain(secret);
    }
    expect(value).toContain('const apiKey');
    expect(value).toContain('DB_PASSWORD');
  });

  it('leaves ordinary text and code alone', () => {
    const text = 'app.listen(3000);\nconst name = "orders";\nexport default { port: 8080 };';
    expect(redactText(text)).toEqual({ value: text, redactions: 0 });
  });
});

describe('redact', () => {
  it('cleans every string in a nested value and counts what it removed', () => {
    const input = {
      files: ['a.js', 'b.js'],
      snippets: { 'config.js': 'const token = "abc-def-ghi";', note: 'fine' },
      n: 3,
    };
    const { value, redactions } = redact(input);
    expect(redactions).toBe(1);
    expect(JSON.stringify(value)).not.toContain('abc-def-ghi');
    expect(value.n).toBe(3);
    expect(value.files).toEqual(['a.js', 'b.js']);
    expect(input.snippets['config.js']).toContain('abc-def-ghi');
  });
});

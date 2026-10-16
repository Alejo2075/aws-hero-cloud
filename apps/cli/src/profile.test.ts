import { describe, expect, it } from 'vitest';
import { deployerProfileText, hasProfile, isProfileName } from './profile.js';

const base = {
  name: 'hero',
  roleArn: 'arn:aws:iam::123456789012:role/hero-deployer',
  sourceProfile: 'work',
  region: 'us-east-1',
};

describe('deployerProfileText', () => {
  it('writes a profile that assumes the deployer role through the one in use', () => {
    expect(deployerProfileText(base)).toBe(
      '[profile hero]\nrole_arn = arn:aws:iam::123456789012:role/hero-deployer\nsource_profile = work\nregion = us-east-1\n',
    );
  });

  it('refuses anything that could add lines or settings to someone else’s configuration', () => {
    for (const bad of [
      { name: 'hero]\n[profile evil' },
      { sourceProfile: 'work\nrole_arn = x' },
      { roleArn: 'arn:aws:iam::123456789012:role/x\ncredential_process = rm' },
      { roleArn: 'arn:aws:iam::123456789012:user/x' },
      { region: 'us-east-1\nx' },
      { name: '' },
    ]) {
      expect(() => deployerProfileText({ ...base, ...bad })).toThrow();
    }
  });
});

describe('hasProfile / isProfileName', () => {
  it('finds a profile by name in both config styles', () => {
    const text = '[default]\nregion = x\n\n[profile hero]\nrole_arn = y\n[profile other]\n';
    expect(hasProfile(text, 'hero')).toBe(true);
    expect(hasProfile(text, 'default')).toBe(true);
    expect(hasProfile(text, 'her')).toBe(false);
    expect(hasProfile('', 'hero')).toBe(false);
    expect(hasProfile('[profile hero]\r\nx=1', 'hero')).toBe(true);
  });

  it('accepts ordinary names only', () => {
    expect(isProfileName('hero')).toBe(true);
    expect(isProfileName('my-work_1')).toBe(true);
    for (const bad of ['', '1x', 'a b', 'a/b', 'a]', 'x'.repeat(70)])
      expect(isProfileName(bad)).toBe(false);
  });
});

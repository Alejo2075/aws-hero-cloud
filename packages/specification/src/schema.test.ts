import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { heroSpecJsonSchema } from './schema.js';
import type { heroSpecSchema } from './schema.js';
import type { HeroSpec } from './types.js';

describe('schema and public interface', () => {
  it('keeps the schema output assignable to HeroSpec', () => {
    expectTypeOf<z.output<typeof heroSpecSchema>>().toExtend<HeroSpec>();
  });
});

const SCHEMA_PATH = join(import.meta.dirname, '..', 'schema', 'hero-spec.v1.schema.json');

describe('hero-spec.v1.schema.json', () => {
  const generated = `${JSON.stringify(heroSpecJsonSchema(), null, 2)}\n`;

  it('is committed and matches the Zod schema', () => {
    if (process.env.UPDATE_SCHEMA === '1' || !existsSync(SCHEMA_PATH)) {
      mkdirSync(dirname(SCHEMA_PATH), { recursive: true });
      writeFileSync(SCHEMA_PATH, generated);
    }
    expect(readFileSync(SCHEMA_PATH, 'utf8')).toBe(generated);
  });

  it('forbids unknown properties at the root', () => {
    const schema = heroSpecJsonSchema() as { additionalProperties?: boolean; required?: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(['version', 'application']));
  });
});

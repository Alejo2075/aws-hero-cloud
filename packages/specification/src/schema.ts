import { z } from 'zod';
import { HERO_SPEC_VERSION } from './types.js';

/**
 * Runtime validation of a Hero Spec. A spec can come from the analyzer, from the user, or from a
 * repository, and only the first two are trusted, so everything is validated strictly: unknown
 * keys are rejected, strings are bounded, and commands and paths are constrained.
 */
const ID = /^[a-z][a-z0-9-]{0,62}$/;
const IDENTIFIER = /^[a-z][a-z0-9._+-]{0,40}$/;
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@/+-]{1,200}$/;
// A path, never a URL: no scheme, no host, no query, no fragment, no backslashes.
const HEALTH_PATH = /^\/(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~!$&'()*+,;=:@/%-]{0,199}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const id = z.string().regex(ID, 'spec.invalid-id');
const identifier = z.string().regex(IDENTIFIER, 'spec.invalid-identifier');
const relativePath = z.string().regex(RELATIVE_PATH, 'spec.invalid-path');

/** A single-line command. Commands are never run by the analyzer; builds run in CodeBuild. */
const command = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => !CONTROL_CHARACTERS.test(value), 'spec.invalid-command');

const commandSpec = z.strictObject({
  command,
  workingDirectory: relativePath.optional(),
});

const frontend = z.strictObject({
  framework: identifier,
  build: z
    .strictObject({
      command,
      workingDirectory: relativePath.optional(),
      output: relativePath,
    })
    .optional(),
});

const service = z.strictObject({
  id,
  type: z.enum(['http', 'worker', 'scheduled', 'process']),
  runtime: identifier,
  build: commandSpec.optional(),
  start: commandSpec.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  healthPath: z.string().regex(HEALTH_PATH, 'spec.invalid-health-path').optional(),
});

const data = z.strictObject({
  id,
  type: z.enum(['key-value', 'document', 'relational', 'cache', 'search']),
  engine: identifier.optional(),
});

const storage = z.strictObject({
  id,
  type: z.enum(['object', 'file-system']),
});

const extensionKey = z.string().regex(/^x-[a-z0-9-]{1,60}$/, 'spec.invalid-extension-key');

export const heroSpecSchema = z
  .strictObject({
    version: z.literal(HERO_SPEC_VERSION),
    application: z.strictObject({ name: z.string().regex(APP_NAME, 'spec.invalid-name') }),
    frontend: frontend.optional(),
    services: z.array(service).max(20).optional(),
    data: z.array(data).max(20).optional(),
    storage: z.array(storage).max(20).optional(),
    auth: z.strictObject({ required: z.boolean() }).optional(),
    environment: z
      .array(z.string().regex(ENV_NAME, 'spec.invalid-environment-name'))
      .max(200)
      .optional(),
    extensions: z.record(extensionKey, z.json()).optional(),
  })
  .superRefine((spec, ctx) => {
    const seen = new Map<string, string>();
    const groups: readonly (readonly [string, readonly { readonly id: string }[] | undefined])[] = [
      ['services', spec.services],
      ['data', spec.data],
      ['storage', spec.storage],
    ];
    for (const [group, items] of groups) {
      items?.forEach((item, index) => {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: 'custom',
            message: 'spec.duplicate-id',
            path: [group, index, 'id'],
          });
        }
        seen.set(item.id, group);
      });
    }
    const names = spec.environment ?? [];
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'spec.duplicate-environment-name',
        path: ['environment'],
      });
    }
  });

export type HeroSpecInput = z.input<typeof heroSpecSchema>;
export type ParsedHeroSpec = z.output<typeof heroSpecSchema>;

/** The Hero Spec as a JSON Schema document, for editors and other tools. */
export function heroSpecJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(heroSpecSchema, { target: 'draft-2020-12' });
}

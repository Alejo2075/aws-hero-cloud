import type { KeyAttribute, KeyAttributeType, TableKey } from '@hero-cloud/specification';
import type { SourceFile } from './sources.js';

/** How a key was found, from most to least certain. */
export type KeyEvidence = 'key-schema' | 'schema-definition' | 'key-usage';

export interface FoundKey {
  readonly key: TableKey;
  readonly evidence: KeyEvidence;
  /** The key was inferred from how items are read, so a person should confirm it. */
  readonly needsConfirmation: boolean;
}

const TYPES: Readonly<Record<string, KeyAttributeType>> = { S: 'string', N: 'number', B: 'binary' };
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.-]{0,254}$/;

const attribute = (name: string, type: KeyAttributeType): KeyAttribute => ({ name, type });

/** A literal `CreateTable`-style `KeySchema` and `AttributeDefinitions`. The most certain source. */
function fromKeySchema(text: string): TableKey | undefined {
  const schema = /KeySchema\s*:\s*\[([^\]]{1,600})\]/.exec(text)?.[1];
  if (schema === undefined) return undefined;
  const definitions = /AttributeDefinitions\s*:\s*\[([^\]]{1,900})\]/.exec(text)?.[1] ?? '';
  const typeOf = (name: string): KeyAttributeType => {
    const match = new RegExp(
      `AttributeName\\s*:\\s*['"\`]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]\\s*,\\s*AttributeType\\s*:\\s*['"\`]([SNB])['"\`]`,
    ).exec(definitions);
    return TYPES[match?.[1] ?? 'S'] ?? 'string';
  };
  let partition: KeyAttribute | undefined;
  let sort: KeyAttribute | undefined;
  for (const entry of schema.matchAll(
    /AttributeName\s*:\s*['"`]([^'"`]+)['"`]\s*,\s*KeyType\s*:\s*['"`](HASH|RANGE)['"`]/g,
  )) {
    const name = entry[1] ?? '';
    if (!IDENTIFIER.test(name)) return undefined;
    if (entry[2] === 'HASH') partition = attribute(name, typeOf(name));
    else sort = attribute(name, typeOf(name));
  }
  return partition === undefined
    ? undefined
    : { partition, ...(sort === undefined ? {} : { sort }) };
}

/** Dynamoose-style schemas: `id: { type: String, hashKey: true }`. */
function fromSchemaDefinition(text: string): TableKey | undefined {
  let partition: KeyAttribute | undefined;
  let sort: KeyAttribute | undefined;
  for (const match of text.matchAll(/([A-Za-z_]\w*)\s*:\s*\{([^{}]{0,200})\}/g)) {
    const [, name = '', body = ''] = match;
    const kind: KeyAttributeType = /type\s*:\s*Number/.test(body) ? 'number' : 'string';
    if (/\bhashKey\s*:\s*true/.test(body)) partition = attribute(name, kind);
    else if (/\brangeKey\s*:\s*true/.test(body)) sort = attribute(name, kind);
  }
  return partition === undefined
    ? undefined
    : { partition, ...(sort === undefined ? {} : { sort }) };
}

/** How items are addressed in calls: `Key: { id }` or `Key: { pk: a, sk: b }`. The least certain. */
function fromKeyUsage(texts: readonly string[]): TableKey | undefined {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const match of text.matchAll(/\bKey\s*:\s*\{([^{}]{1,200})\}/g)) {
      const names = [...(match[1] ?? '').matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*(?=[:,]|$)/g)]
        .map((entry) => entry[1] ?? '')
        .filter((name) => IDENTIFIER.test(name))
        .slice(0, 2);
      if (names.length > 0) counts.set(names.join(','), (counts.get(names.join(',')) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const [best, runnerUp] = ranked;
  if (best === undefined || (runnerUp !== undefined && runnerUp[1] === best[1])) return undefined;
  const [partition = '', sort] = best[0].split(',');
  return {
    partition: attribute(partition, 'string'),
    ...(sort === undefined ? {} : { sort: attribute(sort, 'string') }),
  };
}

/**
 * Finds how the application addresses its key-value table. Declared schemas are trusted; keys
 * inferred from usage are flagged for confirmation, because a table's key cannot be changed after
 * creation and a wrong guess would not match the application.
 */
export function findTableKey(sources: readonly SourceFile[]): FoundKey | undefined {
  const texts = sources.map((file) => file.text);
  for (const text of texts) {
    const key = fromKeySchema(text);
    if (key !== undefined) return { key, evidence: 'key-schema', needsConfirmation: false };
  }
  for (const text of texts) {
    const key = fromSchemaDefinition(text);
    if (key !== undefined) return { key, evidence: 'schema-definition', needsConfirmation: false };
  }
  const key = fromKeyUsage(texts);
  return key === undefined ? undefined : { key, evidence: 'key-usage', needsConfirmation: true };
}

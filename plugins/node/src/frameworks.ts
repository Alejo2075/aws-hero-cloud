/** Dependencies that identify a server framework. Looked up in runtime dependencies only. */
export const SERVER_FRAMEWORKS: ReadonlyMap<string, string> = new Map([
  ['express', 'express'],
  ['fastify', 'fastify'],
  ['hono', 'hono'],
  ['koa', 'koa'],
  ['@hapi/hapi', 'hapi'],
  ['@nestjs/core', 'nestjs'],
  ['restify', 'restify'],
]);

/** Dependencies that identify a front-end toolchain. */
export const FRONTEND_TOOLS: readonly string[] = [
  'vite',
  'next',
  'react-scripts',
  'astro',
  'react',
  'vue',
  'svelte',
  '@angular/core',
];

export function hasAny(set: ReadonlySet<string>, names: Iterable<string>): string | undefined {
  for (const name of names) if (set.has(name)) return name;
  return undefined;
}

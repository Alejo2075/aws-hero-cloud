#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHero } from '@hero-cloud/sdk';
import { run } from './cli.js';

declare const __HERO_VERSION__: string | undefined;

const code = await run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  stdoutIsTTY: process.stdout.isTTY,
  stderrIsTTY: process.stderr.isTTY,
  columns: process.stdout.columns,
  version: typeof __HERO_VERSION__ === 'string' ? __HERO_VERSION__ : '0.0.0-dev',
  readFile: (path) => readFile(path, 'utf8'),
  resolvePath: (path) => resolve(process.cwd(), path),
  createHero: () => createHero(),
});
process.exitCode = code;

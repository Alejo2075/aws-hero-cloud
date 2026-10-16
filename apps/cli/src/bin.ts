#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { isatty } from 'node:tty';
import { join, resolve } from 'node:path';
import { FileDeploymentLock, FileStateStore } from '@hero-cloud/local';
import { FileApprovalInbox, createRootGuard, serveStdio } from '@hero-cloud/mcp';
import { createHero } from '@hero-cloud/sdk';
import { run } from './cli.js';
import { readHidden } from './hidden.js';
import { cacheDirectory } from './paths.js';

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
  // `isatty` looks at the file descriptor; touching `process.stdin` would keep the process alive
  // while a parent holds the pipe open.
  stdinIsTTY: isatty(0),
  awsConfigPath: process.env.AWS_CONFIG_FILE ?? join(homedir(), '.aws', 'config'),
  appendFile: (path, text) => appendFile(path, text, { mode: 0o600 }),
  ask: async (question) => {
    const lines = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await lines.question(question);
    } finally {
      lines.close();
    }
  },
  openInbox: (directory) => new FileApprovalInbox(directory),
  serveMcp: async ({ hero, roots, inboxDirectory }) => {
    await serveStdio({
      hero,
      roots: await createRootGuard(roots),
      inbox: new FileApprovalInbox(inboxDirectory),
      version: typeof __HERO_VERSION__ === 'string' ? __HERO_VERSION__ : '0.0.0-dev',
    });
  },
  askHidden: (question) => readHidden(question, process.stdin, process.stderr),
  createHero: (settings) => {
    const cache = cacheDirectory(process.env, process.platform, homedir());
    return createHero({
      ...(cache === undefined ? {} : { cacheDirectory: cache }),
      ...(settings === undefined
        ? {}
        : {
            state: new FileStateStore(join(settings.stateDirectory, 'state')),
            locks: new FileDeploymentLock(join(settings.stateDirectory, 'locks')),
            assemblyDirectory: join(settings.stateDirectory, 'assemblies'),
            ...(settings.profile === undefined ? {} : { awsProfile: settings.profile }),
          }),
    });
  },
});
process.exitCode = code;

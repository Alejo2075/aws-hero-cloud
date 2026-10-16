import { BUILD_NODE_VERSION } from './plan.js';
import type { BuildJob } from './plan.js';

const b64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

/**
 * The single place a buildspec comes from. A `buildspec.yml` in the project is never used: the
 * build asks CodeBuild for an override, so repository content cannot change what runs beyond the
 * commands the person approved.
 *
 * Text that comes from the project (the start command) is never placed in the script as shell:
 * it is carried as base64 and written to `run.sh`, so it cannot break out of its line.
 */
export function generateBuildspec(job: BuildJob): string {
  const commands: string[] = [];
  const build: string[] = [];
  const postBuild: string[] = [];

  if (job.buildCommand !== undefined) build.push(job.buildCommand);

  let base = '.';
  let files = ['**/*'];
  if (job.kind === 'static') {
    base = job.outputDirectory ?? '.';
  } else {
    if (job.startCommand !== undefined) {
      const script = `#!/bin/sh\nexec ${job.startCommand}\n`;
      postBuild.push(`echo ${b64(script)} | base64 -d > run.sh && chmod 755 run.sh`);
    }
    if (job.jobFile !== undefined) {
      postBuild.push(
        `test -f ${JSON.stringify(job.jobFile)} || (echo "missing job file" && exit 1)`,
      );
    }
    files = ['**/*'];
  }

  commands.push(job.installCommand);
  const spec = {
    version: '0.2',
    phases: {
      install: { 'runtime-versions': { nodejs: BUILD_NODE_VERSION }, commands },
      build: { commands: build },
      post_build: { commands: postBuild },
    },
    artifacts: { files, 'base-directory': base, 'exclude-paths': '.git/**/*, **/.env*' },
  };
  return JSON.stringify(spec, null, 2);
}

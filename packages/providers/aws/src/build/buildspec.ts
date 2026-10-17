import { BUILD_NODE_VERSION, PACK_BUILDER, PACK_SHA256, PACK_VERSION } from './plan.js';
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
/**
 * The buildspec of an image build. The image is built from the project's Dockerfile or with
 * buildpacks and pushed to the repository of this deployment only; the repository address and tag
 * arrive as plain variables set by Hero, never from the project. A start command, when there is
 * one, becomes a Procfile carried as base64 like the function `run.sh`.
 */
function imageBuildspec(job: BuildJob): string {
  const login =
    'aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "${HERO_REPOSITORY_URI%%/*}"';
  const target = '"$HERO_REPOSITORY_URI:$HERO_IMAGE_TAG"';
  const build: string[] = [];
  const install: string[] = [];
  if (job.imageBuild === 'dockerfile') {
    build.push(
      `docker build --platform linux/arm64 -f ${JSON.stringify(job.dockerfile ?? 'Dockerfile')} -t ${target} .`,
    );
  } else {
    install.push(
      `curl -fsSL -o /tmp/pack.tgz https://github.com/buildpacks/pack/releases/download/v${PACK_VERSION}/pack-v${PACK_VERSION}-linux-arm64.tgz`,
      `echo "${PACK_SHA256}  /tmp/pack.tgz" | sha256sum -c -`,
      'tar -xzf /tmp/pack.tgz -C /usr/local/bin pack',
    );
    if (job.startCommand !== undefined) {
      const procfile = `web: ${job.startCommand}\n`;
      build.push(`test -f Procfile || (echo ${b64(procfile)} | base64 -d > Procfile)`);
    }
    build.push(
      `pack build ${target} --builder ${PACK_BUILDER} --trust-builder --platform linux/arm64`,
    );
  }
  return JSON.stringify(
    {
      version: '0.2',
      phases: {
        install: { commands: install },
        pre_build: { commands: [login] },
        build: { commands: build },
        post_build: { commands: [`docker push ${target}`] },
      },
    },
    null,
    2,
  );
}

export function generateBuildspec(job: BuildJob): string {
  if (job.kind === 'image') return imageBuildspec(job);
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

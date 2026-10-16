import type { DetectionContext } from '@hero-cloud/plugin-sdk';

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_PATH =
  /(?:^|\/)(?:__tests__|tests?|spec|e2e|cypress|stories|\.storybook)(?:\/|$)|\.(?:test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$/;
const MAX_FILES = 300;
const MAX_FILE_BYTES = 200 * 1024;

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

const cache = new WeakMap<DetectionContext, Promise<readonly SourceFile[]>>();

/**
 * The project's own JavaScript and TypeScript sources, excluding tests, in path order, bounded in
 * count and size. Read once per analysis and shared by every detector that needs to look at code.
 * Detectors use it to find names, ports, and routes; they never copy source text into results.
 */
export function sourceFiles(context: DetectionContext): Promise<readonly SourceFile[]> {
  let cached = cache.get(context);
  if (cached === undefined) {
    cached = (async () => {
      const paths = context.files
        .map((file) => file.path)
        .filter((path) => SOURCE_EXTENSION.test(path) && !SKIP_PATH.test(path))
        .slice(0, MAX_FILES);
      const loaded = await Promise.all(
        paths.map(async (path) => {
          const text = await context.readText(path, MAX_FILE_BYTES);
          return text === undefined ? undefined : { path, text };
        }),
      );
      return loaded.filter((file): file is SourceFile => file !== undefined);
    })();
    cache.set(context, cached);
  }
  return cached;
}

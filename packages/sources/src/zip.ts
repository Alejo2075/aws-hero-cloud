import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { heroError } from '@hero-cloud/core';
import type {
  LoadOptions,
  ProjectSnapshot,
  SkippedEntry,
  SourceLoader,
  SourceRef,
} from '@hero-cloud/core';
import yauzl from 'yauzl';
import { DiskSnapshot, removeDirectory } from './disk-snapshot.js';
import { normalizeEntryPath } from './paths.js';
import { DEFAULT_LIMITS, isIgnoredDirectory, isSensitivePath } from './policy.js';
import type { SourceLimits } from './policy.js';
import { scanDirectory } from './scan.js';

/** A ZIP whose contents inflate to more than this many times its size is treated as a bomb. */
const MAX_COMPRESSION_RATIO = 100;

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const UNIX = 3;

/** Files whose presence marks a folder as the root of a project. */
const PROJECT_MARKERS = [
  /^package\.json$/,
  /^composer\.json$/,
  /^pom\.xml$/,
  /^build\.gradle(\.kts)?$/,
  /^requirements\.txt$/,
  /^pyproject\.toml$/,
  /^Gemfile$/,
  /^go\.mod$/,
  /^Dockerfile$/,
  /^Procfile$/,
  /^hero\.ya?ml$/,
  /^index\.html$/,
  /\.(csproj|sln)$/,
];

interface PlannedEntry {
  readonly entry: yauzl.Entry;
  readonly path: string;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : heroError('internal.unexpected', undefined, value);
}

/** yauzl reports hostile file names as generic errors; keep the reason precise. */
function zipError(error: Error): Error {
  const unsafe = /relative path|absolute path|invalid characters|backslash/i.test(error.message);
  return heroError(unsafe ? 'source.unsafe-path' : 'source.unsupported', undefined, error);
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveOpen, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zipfile) => {
        if (error) reject(heroError('source.unsupported', undefined, error));
        else resolveOpen(zipfile);
      },
    );
  });
}

function readEntries(zipfile: yauzl.ZipFile, onEntry: (entry: yauzl.Entry) => void): Promise<void> {
  return new Promise((resolveRead, reject) => {
    zipfile.on('entry', (entry: yauzl.Entry) => {
      try {
        onEntry(entry);
        zipfile.readEntry();
      } catch (error) {
        zipfile.close();
        reject(asError(error));
      }
    });
    zipfile.on('end', () => {
      resolveRead();
    });
    zipfile.on('error', (error: Error) => {
      reject(zipError(error));
    });
    zipfile.readEntry();
  });
}

/** Visits entries one at a time, waiting for each async handler before reading the next entry. */
function visitEntries(
  zipfile: yauzl.ZipFile,
  handler: (entry: yauzl.Entry) => Promise<void>,
): Promise<void> {
  return new Promise((resolveVisit, reject) => {
    zipfile.on('entry', (entry: yauzl.Entry) => {
      handler(entry).then(
        () => {
          zipfile.readEntry();
        },
        (error: unknown) => {
          zipfile.close();
          reject(asError(error));
        },
      );
    });
    zipfile.on('end', () => {
      resolveVisit();
    });
    zipfile.on('error', (error: Error) => {
      reject(zipError(error));
    });
    zipfile.readEntry();
  });
}

function openStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) reject(heroError('source.unsupported', undefined, error));
      else resolveStream(stream);
    });
  });
}

/** Passes bytes through and fails if more than `limit` arrive: the declared size cannot be trusted. */
function limitBytes(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > limit) callback(heroError('source.too-large'));
      else callback(null, chunk);
    },
  });
}

function unixMode(entry: yauzl.Entry): number | undefined {
  return entry.versionMadeBy >> 8 === UNIX
    ? (entry.externalFileAttributes >>> 16) & 0xffff
    : undefined;
}

function stripCommonRoot(paths: readonly string[]): string | undefined {
  const first = paths[0]?.split('/')[0];
  if (
    first === undefined ||
    paths.some((path) => !path.includes('/') || path.split('/')[0] !== first)
  ) {
    return undefined;
  }
  const hasMarker = paths.some((path) => {
    const rest = path.slice(first.length + 1);
    return !rest.includes('/') && PROJECT_MARKERS.some((marker) => marker.test(rest));
  });
  return hasMarker ? first : undefined;
}

/**
 * Loads a ZIP archive. The whole index is validated before anything is written: no traversal, no
 * absolute paths, no symlinks or special files, no encryption, bounded entry count, declared
 * sizes, and compression ratio. Bytes are then counted as they are written, because a hostile
 * archive can lie about its sizes. Files go to a private temporary folder and are re-scanned by
 * the same code that handles plain folders.
 */
export interface ZipSourceOptions {
  readonly limits?: SourceLimits;
  /** Where temporary files go. Defaults to the system temporary folder. */
  readonly tempRoot?: string;
}

export class ZipSource implements SourceLoader {
  readonly kind = 'zip';
  readonly #limits: SourceLimits;
  readonly #tempRoot: string;

  constructor(options: ZipSourceOptions = {}) {
    this.#limits = options.limits ?? DEFAULT_LIMITS;
    this.#tempRoot = options.tempRoot ?? tmpdir();
  }

  async load(ref: SourceRef, options: LoadOptions = {}): Promise<ProjectSnapshot> {
    const limits = this.#limits;
    let archiveSize: number;
    try {
      const stats = await stat(ref.location);
      if (!stats.isFile()) throw heroError('source.not-found');
      archiveSize = stats.size;
    } catch (error) {
      throw heroError('source.not-found', undefined, error);
    }
    if (archiveSize > limits.maxTotalBytes) throw heroError('source.too-large');

    const planned = await this.#plan(ref.location, archiveSize, options.signal);

    const temp = await mkdtemp(join(this.#tempRoot, 'hero-zip-'));
    const cleanup = removeDirectory(temp);
    try {
      const skipped: SkippedEntry[] = [];
      await this.#extract(ref.location, temp, planned.files, options.signal);
      skipped.push(...planned.skipped);
      const scan = await scanDirectory(temp, limits, options.signal);
      return new DiskSnapshot(temp, scan.files, [...skipped, ...scan.skipped], cleanup);
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  /** First pass: validate every entry and decide what to extract. Writes nothing. */
  async #plan(
    location: string,
    archiveSize: number,
    signal?: AbortSignal,
  ): Promise<{ files: PlannedEntry[]; skipped: SkippedEntry[] }> {
    const limits = this.#limits;
    const zipfile = await openZip(location);
    const seen = new Set<string>();
    const candidates: PlannedEntry[] = [];
    let entryCount = 0;
    let declaredTotal = 0;

    await readEntries(zipfile, (entry) => {
      signal?.throwIfAborted();
      entryCount += 1;
      if (entryCount > limits.maxFiles * 2) throw heroError('source.too-many-files');

      const isDirectory = entry.fileName.endsWith('/');
      const path = normalizeEntryPath(entry.fileName, limits);
      if (entry.isEncrypted()) throw heroError('source.unsupported');

      const mode = unixMode(entry);
      if (mode !== undefined) {
        const type = mode & S_IFMT;
        if (type === S_IFLNK) throw heroError('source.unsafe-path');
        if (type !== 0 && type !== S_IFREG && type !== S_IFDIR)
          throw heroError('source.unsafe-path');
      }
      if (isDirectory) return;

      // Paths that differ only by case would collide on case-insensitive disks.
      const key = path.toLowerCase();
      if (seen.has(key)) throw heroError('source.unsafe-path');
      seen.add(key);

      if (entry.uncompressedSize > limits.maxFileBytes) throw heroError('source.too-large');
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > limits.maxTotalBytes) throw heroError('source.too-large');
      if (seen.size > limits.maxFiles) throw heroError('source.too-many-files');
      candidates.push({ entry, path });
    });
    zipfile.close();

    if (declaredTotal > Math.max(archiveSize, 1) * MAX_COMPRESSION_RATIO) {
      throw heroError('source.too-large', { reason: 'compression-ratio' });
    }

    const root = stripCommonRoot(candidates.map((candidate) => candidate.path));
    const skipped: SkippedEntry[] = [];
    const files: PlannedEntry[] = [];
    for (const candidate of candidates) {
      const path = root === undefined ? candidate.path : candidate.path.slice(root.length + 1);
      const segments = path.split('/');
      const ignored = segments.findIndex(
        (segment, index) =>
          index < segments.length - 1 && (isIgnoredDirectory(segment) || segment === '__MACOSX'),
      );
      if (ignored >= 0) {
        skipped.push({ path: segments.slice(0, ignored + 1).join('/'), reason: 'ignored' });
      } else if (isSensitivePath(path)) {
        skipped.push({ path, reason: 'sensitive' });
      } else {
        files.push({ entry: candidate.entry, path });
      }
    }
    const unique = new Map(skipped.map((item) => [item.path, item]));
    return { files, skipped: [...unique.values()] };
  }

  /** Second pass: write only the planned files, counting the bytes actually written. */
  async #extract(
    location: string,
    destination: string,
    files: readonly PlannedEntry[],
    signal?: AbortSignal,
  ): Promise<void> {
    const wanted = new Map(files.map((file) => [file.entry.fileName, file.path]));
    const root = resolve(destination);
    const zipfile = await openZip(location);
    try {
      await visitEntries(zipfile, async (entry) => {
        signal?.throwIfAborted();
        const path = wanted.get(entry.fileName);
        if (path === undefined) return;
        const target = resolve(root, ...path.split('/'));
        if (!target.startsWith(root + sep)) throw heroError('source.unsafe-path');
        await mkdir(dirname(target), { recursive: true });
        await pipeline(
          await openStream(zipfile, entry),
          limitBytes(entry.uncompressedSize),
          createWriteStream(target, { flags: 'wx', mode: 0o600 }),
        );
      });
    } finally {
      zipfile.close();
    }
  }
}

import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { matchesGlob, join, relative, sep } from 'node:path';

import { sanitizeTranscriptLine } from './transcript-sanitize.js';

export interface HarvestTranscriptsOptions {
  readonly home: string;
  readonly globs: readonly string[];
  readonly destination: string;
  readonly knownSecrets: Iterable<string>;
  readonly sanitizeLine?: (line: string, knownSecrets: Iterable<string>) => string;
}

export interface CapturedTranscriptHarvest {
  readonly kind: 'captured';
  readonly files: number;
  readonly bytes: number;
  readonly skipped: readonly string[];
  readonly omittedLines: number;
}

export interface FailedTranscriptHarvest {
  readonly kind: 'failed';
  readonly error: string;
}

export type TranscriptHarvestResult = CapturedTranscriptHarvest | FailedTranscriptHarvest;

function relativePosix(home: string, path: string): string {
  return relative(home, path).split(sep).join('/');
}

function isAllowed(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

async function collectTranscriptPaths(
  home: string,
  current: string,
  globs: readonly string[],
): Promise<{ readonly paths: string[]; readonly skipped: string[] }> {
  const stat = await lstat(current);
  const relativePath = relativePosix(home, current);
  if (stat.isSymbolicLink()) {
    return { paths: [], skipped: isAllowed(relativePath, globs) ? [relativePath] : [] };
  }
  if (stat.isFile()) return isAllowed(relativePath, globs) ? { paths: [current], skipped: [] } : { paths: [], skipped: [] };
  if (!stat.isDirectory()) return { paths: [], skipped: [] };

  const paths: string[] = [];
  const skipped: string[] = [];
  for (const entry of (await readdir(current)).sort()) {
    const collected = await collectTranscriptPaths(home, join(current, entry), globs);
    paths.push(...collected.paths);
    skipped.push(...collected.skipped);
  }
  return { paths, skipped };
}

function sanitizeFile(
  content: string,
  knownSecrets: Iterable<string>,
  sanitizeLine: (line: string, knownSecrets: Iterable<string>) => string,
): { readonly content: string; readonly omittedLines: number } {
  const sanitized: string[] = [];
  let omittedLines = 0;
  for (const line of content.split('\n')) {
    try {
      sanitized.push(sanitizeLine(line, knownSecrets));
    } catch {
      omittedLines += 1;
    }
  }
  return { content: sanitized.join('\n'), omittedLines };
}

/**
 * Copies only declared transcript files from a throwaway provider home. The
 * caller owns failure reporting and retirement; this routine preserves the
 * provider-relative transcript layout for the reader and retention layers.
 */
export async function harvestTranscripts(options: HarvestTranscriptsOptions): Promise<TranscriptHarvestResult> {
  try {
    await mkdir(options.destination, { recursive: true });
    const collected = await collectTranscriptPaths(options.home, options.home, options.globs);
    let files = 0;
    let bytes = 0;
    let omittedLines = 0;
    for (const source of collected.paths) {
      const relativePath = relativePosix(options.home, source);
      const sanitized = sanitizeFile(
        await readFile(source, 'utf8'),
        options.knownSecrets,
        options.sanitizeLine ?? sanitizeTranscriptLine,
      );
      const target = join(options.destination, relativePath);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, sanitized.content);
      files += 1;
      bytes += Buffer.byteLength(sanitized.content);
      omittedLines += sanitized.omittedLines;
    }
    return { kind: 'captured', files, bytes, skipped: collected.skipped, omittedLines };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** Runs normal provider-home retirement in the ADR-mandated harvest-before-remove order. */
export async function harvestThenRemove<Result>(options: {
  readonly harvest: () => Promise<Result>;
  readonly remove: () => Promise<void>;
  readonly report: (result: Result) => Promise<void> | void;
}): Promise<void> {
  try {
    const result = await options.harvest();
    await options.report(result);
  } finally {
    await options.remove();
  }
}

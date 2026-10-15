import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { matchesGlob, join, relative, sep } from 'node:path';

import { sanitizeTranscriptLine } from './transcript-sanitize.js';

export interface HarvestTranscriptsOptions {
  readonly home: string;
  readonly globs: readonly string[];
  readonly destination: string;
  readonly knownSecrets: Iterable<string>;
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
): Promise<string[]> {
  const stat = await lstat(current);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return isAllowed(relativePosix(home, current), globs) ? [current] : [];
  if (!stat.isDirectory()) return [];

  const paths: string[] = [];
  for (const entry of (await readdir(current)).sort()) {
    paths.push(...await collectTranscriptPaths(home, join(current, entry), globs));
  }
  return paths;
}

function sanitizeFile(content: string, knownSecrets: Iterable<string>): { readonly content: string; readonly omittedLines: number } {
  const lines = content.split('\n');
  const sanitized = lines.map((line) => sanitizeTranscriptLine(line, knownSecrets));
  return { content: sanitized.join('\n'), omittedLines: 0 };
}

/**
 * Copies only declared transcript files from a throwaway provider home. The
 * caller owns failure reporting and retirement; this routine preserves the
 * provider-relative transcript layout for the reader and retention layers.
 */
export async function harvestTranscripts(options: HarvestTranscriptsOptions): Promise<TranscriptHarvestResult> {
  try {
    await mkdir(options.destination, { recursive: true });
    const paths = await collectTranscriptPaths(options.home, options.home, options.globs);
    let files = 0;
    let bytes = 0;
    let omittedLines = 0;
    for (const source of paths) {
      const relativePath = relativePosix(options.home, source);
      const sanitized = sanitizeFile(await readFile(source, 'utf8'), options.knownSecrets);
      const target = join(options.destination, relativePath);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, sanitized.content);
      files += 1;
      bytes += Buffer.byteLength(sanitized.content);
      omittedLines += sanitized.omittedLines;
    }
    return { kind: 'captured', files, bytes, skipped: [], omittedLines };
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

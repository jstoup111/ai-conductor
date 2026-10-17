import * as fsp from 'node:fs/promises';
import { matchesGlob, join, relative, sep } from 'node:path';

import { sanitizeTranscriptLine } from './transcript-sanitize.js';
import { sanitizeProviderMember } from './provider-member.js';
import type { ConductorEvent, TranscriptOwnerStep } from '../../types/events.js';
import type { ConductorEventEmitter } from '../../ui/events.js';

export interface HarvestTranscriptsOptions {
  readonly home: string;
  readonly globs: readonly string[];
  readonly destination: string;
  readonly knownSecrets: Iterable<string>;
  readonly sanitizeLine?: (line: string, knownSecrets: Iterable<string>) => string;
  /** Injectable filesystem boundary for harvest-failure tests. */
  readonly fs?: TranscriptHarvestFilesystem;
}

export type TranscriptHarvestFilesystem = Pick<typeof fsp,
  'lstat' | 'mkdir' | 'readdir' | 'readFile' | 'writeFile' | 'rm'>;

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

/** Identifies where a harvested transcript came from and where it is stored. */
export interface TranscriptCaptureSource {
  readonly step: TranscriptOwnerStep;
  readonly runId: string;
  readonly attempt: number;
  readonly member?: string;
}

export type ProviderTranscriptCaptureSource = TranscriptCaptureSource & {
  readonly provider: string;
};

/** Build the one source identity shared by capture naming and retention. */
export function transcriptCaptureSource(input: TranscriptCaptureSource): TranscriptCaptureSource {
  return input;
}

/** The one naming scheme used by every self-host transcript producer. */
export function transcriptCapture(source: ProviderTranscriptCaptureSource & { readonly worktreeRoot: string }): {
  readonly path: string;
  readonly destination: string;
} {
  const name = [`${source.runId}-a${source.attempt}`, source.member === undefined ? undefined : sanitizeProviderMember(source.member), source.provider]
    .filter((part): part is string => part !== undefined).join('-');
  const path = join('.pipeline', 'transcripts', source.step, name);
  return { path, destination: join(source.worktreeRoot, path) };
}

/** Project a harvest result onto the event spine; teardown telemetry is best-effort. */
export async function emitTranscriptHarvest(
  events: ConductorEventEmitter | undefined,
  source: ProviderTranscriptCaptureSource & { readonly path: string; readonly interrupted: boolean },
  result: TranscriptHarvestResult,
): Promise<void> {
  const { interrupted, ...identityFields } = source;
  const event: ConductorEvent = result.kind === 'captured'
    ? {
        type: 'provider_transcripts_captured', ...identityFields, interrupted,
        files: result.files, bytes: result.bytes, skipped: result.skipped.length, omittedLines: result.omittedLines,
      }
    : { type: 'provider_transcripts_harvest_failed', ...identityFields, error: result.error };
  try { await events?.emit(event); } catch { /* teardown telemetry is best-effort */ }
}

function relativePosix(home: string, path: string): string {
  return relative(home, path).split(sep).join('/');
}

function isAllowed(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

async function collectTranscriptPaths(
  fs: TranscriptHarvestFilesystem,
  home: string,
  current: string,
  globs: readonly string[],
): Promise<{ readonly paths: string[]; readonly skipped: string[] }> {
  const stat = await fs.lstat(current);
  const relativePath = relativePosix(home, current);
  if (stat.isSymbolicLink()) {
    return { paths: [], skipped: isAllowed(relativePath, globs) ? [relativePath] : [] };
  }
  if (stat.isFile()) return isAllowed(relativePath, globs) ? { paths: [current], skipped: [] } : { paths: [], skipped: [] };
  if (!stat.isDirectory()) return { paths: [], skipped: [] };

  const paths: string[] = [];
  const skipped: string[] = [];
  for (const entry of (await fs.readdir(current)).sort()) {
    const collected = await collectTranscriptPaths(fs, home, join(current, entry), globs);
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
  const fs = options.fs ?? fsp;
  try {
    await fs.mkdir(options.destination, { recursive: true });
    const collected = await collectTranscriptPaths(fs, options.home, options.home, options.globs);
    let files = 0;
    let bytes = 0;
    let omittedLines = 0;
    for (const source of collected.paths) {
      const relativePath = relativePosix(options.home, source);
      let content: string;
      try {
        content = await fs.readFile(source, 'utf8');
      } catch (error) {
        if (isNotFound(error)) {
          collected.skipped.push(relativePath);
          continue;
        }
        throw error;
      }
      const sanitized = sanitizeFile(content, options.knownSecrets, options.sanitizeLine ?? sanitizeTranscriptLine);
      const target = join(options.destination, relativePath);
      await fs.mkdir(join(target, '..'), { recursive: true });
      try {
        await fs.lstat(target);
        throw new Error(`transcript destination already exists: ${relativePath}`);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      await fs.writeFile(target, sanitized.content);
      files += 1;
      bytes += Buffer.byteLength(sanitized.content);
      omittedLines += sanitized.omittedLines;
    }
    return { kind: 'captured', files, bytes, skipped: collected.skipped, omittedLines };
  } catch (error) {
    await fs.rm(options.destination, { recursive: true, force: true }).catch(() => undefined);
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
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

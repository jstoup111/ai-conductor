// halt-marker.ts — the single source of truth for the `.pipeline/HALT` marker.
//
// A HALT parks a feature for the operator: the daemon loop treats the presence
// of `.pipeline/HALT` as a stop and never advances, opens a PR, or merges past
// it. The path was previously spelled independently in the conductor, the rebase
// step, the self-host gates, and the daemon dashboard/deps/rekick modules; a
// change to how the marker is written or where it lives had to be mirrored across
// all of them. Both the constant and the best-effort writer now live here.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import {
  haltRecordPath,
  isRecordableHaltClass,
  recordHalt,
  type HaltRecordInput,
  type HaltRecordRemoteOptions,
} from './halt-record.js';
import { resolveActiveChild } from './child-cursor.js';
import type { ConductorEventEmitter } from '../ui/events.js';

/** The park-for-human marker the daemon loop treats as a stop. */
export const HALT_MARKER = '.pipeline/HALT';

/** Machine-readable sidecar classifying why a HALT was raised. */
export const HALT_CLASS_MARKER = '.pipeline/HALT.class';

/** Durable episode metadata bound to the HALT body it was written for. */
export const HALT_EPISODE_MARKER = '.pipeline/HALT.episode';

/** HALT class for a feature-authored protected-artifact violation. */
export const PROTECTED_ARTIFACT_HALT_CLASS = 'protected-artifact';

/** HALT class for an approved-plan insufficiency requiring human judgement. */
export const PLAN_GAP_HALT_CLASS = 'plan-gap';

/**
 * Classification of a HALT: `needs-human` marks are those only an operator
 * can resolve; `mechanical` marks are those the daemon may safely re-kick.
 */
export type HaltClass =
  | 'needs-human'
  | 'mechanical'
  | typeof PROTECTED_ARTIFACT_HALT_CLASS
  | typeof PLAN_GAP_HALT_CLASS;

/** Classification observed while reading a HALT sidecar. */
export type HaltDisposition = HaltClass | 'kickback-cap' | 'over-scope' | 'legacy' | 'unclassified';

/** True for a classified halt which the daemon must retain for an operator. */
export function isOperatorActionHalt(
  haltClass: HaltDisposition,
): haltClass is
  | 'needs-human'
  | typeof PROTECTED_ARTIFACT_HALT_CLASS
  | typeof PLAN_GAP_HALT_CLASS
  | 'unclassified' {
  return (
    haltClass === 'needs-human' ||
    haltClass === PROTECTED_ARTIFACT_HALT_CLASS ||
    haltClass === PLAN_GAP_HALT_CLASS ||
    haltClass === 'unclassified'
  );
}

/** True when a newly written step HALT has a class that carries its body as a reason. */
function isStepWrittenHumanHalt(
  haltClass: HaltDisposition,
): haltClass is 'needs-human' | typeof PLAN_GAP_HALT_CLASS {
  return haltClass === 'needs-human' || haltClass === PLAN_GAP_HALT_CLASS;
}

/** Outcome of a best-effort halt-marker write. */
export type HaltMarkerWriteResult =
  | { status: 'written' }
  | { status: 'partial'; writtenPath: string; path: string; reason: string }
  | { status: 'failed'; path: string; reason: string };

export type EpisodeStampWriteResult =
  | { status: 'written' }
  | { status: 'failed'; reason: string };

export type EpisodeStampReadResult =
  | { kind: 'valid'; deadlineMs: number }
  | { kind: 'invalid'; reason: 'absent' | 'malformed' | 'halt-absent' | 'digest-mismatch' };

interface EpisodeStamp {
  deadlineMs: number;
  haltDigest: string;
}

/**
 * Stamp the current HALT as episode-caused. The digest prevents a stamp from
 * being attached to a later, unrelated halt after an operator clears by hand.
 */
export async function writeEpisodeStamp(
  projectRoot: string,
  deadlineMs: number,
): Promise<EpisodeStampWriteResult> {
  const stampPath = join(projectRoot, HALT_EPISODE_MARKER);
  const tempPath = `${stampPath}.tmp`;

  try {
    const haltBody = await readFile(join(projectRoot, HALT_MARKER), 'utf8');
    const stamp: EpisodeStamp = {
      deadlineMs,
      haltDigest: haltDigest(haltBody),
    };
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(tempPath, JSON.stringify(stamp), 'utf8');
    await rename(tempPath, stampPath);
    return { status: 'written' };
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Read an episode stamp without allowing corrupt worktree state to escape. */
export async function readEpisodeStamp(projectRoot: string): Promise<EpisodeStampReadResult> {
  let contents: string;
  try {
    contents = await readFile(join(projectRoot, HALT_EPISODE_MARKER), 'utf8');
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    return errno.code === 'ENOENT'
      ? { kind: 'invalid', reason: 'absent' }
      : { kind: 'invalid', reason: 'malformed' };
  }

  let stamp: unknown;
  try {
    stamp = JSON.parse(contents);
  } catch {
    return { kind: 'invalid', reason: 'malformed' };
  }
  if (!isEpisodeStamp(stamp)) return { kind: 'invalid', reason: 'malformed' };

  let haltBody: string;
  try {
    haltBody = await readFile(join(projectRoot, HALT_MARKER), 'utf8');
  } catch {
    return { kind: 'invalid', reason: 'halt-absent' };
  }
  return haltDigest(haltBody) === stamp.haltDigest
    ? { kind: 'valid', deadlineMs: stamp.deadlineMs }
    : { kind: 'invalid', reason: 'digest-mismatch' };
}

/** Remove an episode stamp, tolerating an already-cleared sidecar. */
export async function removeEpisodeStamp(projectRoot: string): Promise<void> {
  await unlink(join(projectRoot, HALT_EPISODE_MARKER)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function haltDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function isEpisodeStamp(value: unknown): value is EpisodeStamp {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const stamp = value as Partial<EpisodeStamp>;
  return (
    typeof stamp.deadlineMs === 'number' &&
    Number.isFinite(stamp.deadlineMs) &&
    typeof stamp.haltDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(stamp.haltDigest)
  );
}

/**
 * Write `.pipeline/HALT` under `projectRoot` with `body` as its contents,
 * creating `.pipeline/` if needed. Best-effort: mkdir/write failures are
 * swallowed — the HALT is a signal to park, never itself a hard failure (a
 * failed write must not crash the finish flow). The first non-empty line of
 * `body` is the reason the daemon dashboard surfaces.
 *
 * Also best-effort write `.pipeline/HALT.class` with the class string, so
 * callers (e.g. the daemon re-kick sweep) can tell a needs-human HALT apart
 * from a mechanical one without parsing `body`.
 */
export async function writeHaltMarker(
  projectRoot: string,
  body: string,
  haltClass: HaltClass,
  events?: ConductorEventEmitter,
  recordRemote?: HaltRecordRemoteOptions,
): Promise<HaltMarkerWriteResult> {
  const markerPath = join(projectRoot, HALT_MARKER);
  const haltClassPath = join(projectRoot, HALT_CLASS_MARKER);
  const haltClassTempPath = `${haltClassPath}.tmp`;

  try {
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await unlink(haltClassPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await removeEpisodeStamp(projectRoot);
    await writeFile(markerPath, body, 'utf-8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await events?.emit({ type: 'halt_marker_write_failed', path: markerPath, reason }).catch(() => {});
    return { status: 'failed', path: markerPath, reason };
  }

  try {
    await writeFile(haltClassTempPath, haltClass, 'utf-8');
    await rename(haltClassTempPath, haltClassPath);
    await writeHaltRecord(projectRoot, body, haltClass, events, {
      ...recordRemote,
      events: recordRemote?.events ?? events,
    });
    return { status: 'written' };
  } catch (error) {
    await unlink(haltClassTempPath).catch(() => {});
    const reason = error instanceof Error ? error.message : String(error);
    await events?.emit({ type: 'halt_marker_write_failed', path: haltClassPath, reason }).catch(() => {});
    return { status: 'partial', writtenPath: markerPath, path: haltClassPath, reason };
  }
}

async function writeHaltRecord(
  projectRoot: string,
  haltBody: string,
  haltClass: HaltClass,
  events?: ConductorEventEmitter,
  recordRemote?: HaltRecordRemoteOptions,
): Promise<void> {
  if (!isRecordableHaltClass(haltClass)) return;

  const input = await haltRecordInput(projectRoot, haltBody, haltClass);
  const path = haltRecordPath(input.slug);

  try {
    const result = await recordHalt(projectRoot, input, recordRemote);
    if (result.kind === 'written') {
      await events?.emit({ type: 'halt_record_written', path, slug: input.slug, haltClass }).catch(() => {});
    } else if (result.kind === 'failed') {
      await events?.emit({ type: 'halt_record_write_failed', path, reason: result.reason }).catch(() => {});
    } else if (result.kind === 'pushFailed') {
      await events?.emit({ type: 'halt_record_push_failed', path, reason: result.reason }).catch(() => {});
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await events?.emit({ type: 'halt_record_write_failed', path, reason }).catch(() => {});
  }
}

async function haltRecordInput(
  projectRoot: string,
  haltBody: string,
  haltClass: HaltClass,
): Promise<HaltRecordInput> {
  const slug = basename(projectRoot);
  const [branch, headSha, phaseMarker, activeChild] = await Promise.all([
    gitValue(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitValue(projectRoot, ['rev-parse', 'HEAD']),
    readFile(join(projectRoot, '.pipeline', 'phase-active'), 'utf8').catch(() => ''),
    resolveActiveChild(projectRoot, slug).catch(() => ({ kind: 'no-child' } as const)),
  ]);
  const fields = new Map(
    phaseMarker.split('\n').flatMap((line) => {
      const match = /^(step|phase): (.+)$/.exec(line);
      return match ? [[match[1], match[2]]] : [];
    }),
  );

  return {
    slug,
    haltClass,
    step: fields.get('step') ?? 'unknown',
    phase: fields.get('phase') ?? 'unknown',
    branch,
    headSha,
    haltedAt: new Date().toISOString(),
    haltBody,
    ...(activeChild.kind === 'active' ? { child: activeChild.child } : {}),
  };
}

async function gitValue(projectRoot: string, args: string[]): Promise<string> {
  try {
    return (await execa('git', args, { cwd: projectRoot })).stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The identity of the `.pipeline/HALT` marker at one instant, used to tell a
 * marker written DURING an operation apart from one that was already lying
 * around before it. `.pipeline/HALT` persists across steps and across runs, so
 * presence alone proves nothing about who wrote it or when.
 */
export interface HaltMarkerSnapshot {
  present: boolean;
  mtimeMs: number;
  size: number;
}

/**
 * Capture `.pipeline/HALT`'s identity. An absent or unreadable marker resolves
 * to `{ present: false }` rather than throwing — this is only ever used to
 * compare against a later observation.
 */
export async function snapshotHaltMarker(projectRoot: string): Promise<HaltMarkerSnapshot> {
  try {
    const info = await stat(join(projectRoot, HALT_MARKER));
    return { present: true, mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return { present: false, mtimeMs: 0, size: 0 };
  }
}

/**
 * The reason from a `needs-human` HALT that appeared — or changed — since
 * `before` was captured; `null` when there is no such marker.
 *
 * This is how a HALT written by an operation itself is distinguished from a
 * stale one it merely inherited: the marker must be present now AND differ from
 * the snapshot (absent before, or a different mtime/size). It also requires the
 * `needs-human` class and a non-empty body, so a `mechanical` park, a legacy
 * marker with no sidecar, and an empty file are all ignored.
 *
 * Deliberately fails SAFE. Every ambiguous case — unreadable marker, missing
 * sidecar, a rewrite that somehow lands on an identical mtime AND size —
 * resolves to `null`, i.e. "treat it as stale", which leaves the caller's
 * pre-existing behavior untouched. A false negative costs a retry; a false
 * positive would halt a healthy run on someone else's marker.
 */
export async function readStepWrittenHaltReason(
  projectRoot: string,
  before: HaltMarkerSnapshot,
): Promise<string | null> {
  const now = await snapshotHaltMarker(projectRoot);
  if (!now.present) return null;
  const unchanged = before.present && now.mtimeMs === before.mtimeMs && now.size === before.size;
  if (unchanged) return null;
  if (!isStepWrittenHumanHalt(await readHaltClass(projectRoot))) return null;
  try {
    const body = (await readFile(join(projectRoot, HALT_MARKER), 'utf-8')).trim();
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
}

/**
 * Read and classify `.pipeline/HALT.class` under `worktreePath`. Tolerant by
 * design: a missing file, an unreadable file (permissions, missing parent
 * dir, etc.), or unrecognized content all resolve to `'unclassified'` rather
 * than throwing — callers (e.g. the daemon re-kick sweep) must never crash
 * on a HALT sidecar read.
 */
export async function readHaltClass(worktreePath: string): Promise<HaltDisposition> {
  try {
    const contents = (await readFile(join(worktreePath, HALT_CLASS_MARKER), 'utf-8')).trim();
    if (
      contents === 'needs-human' ||
      contents === 'mechanical' ||
      contents === 'legacy' ||
      contents === PROTECTED_ARTIFACT_HALT_CLASS ||
      contents === PLAN_GAP_HALT_CLASS
    ) {
      return contents;
    }
    return 'unclassified';
  } catch {
    return 'unclassified';
  }
}

/**
 * Classify a HALT for telemetry. Missing, unreadable, and invalid sidecars
 * fail closed as `unclassified`; only the migration may stamp `legacy`.
 */
export async function readHaltSidecarClassification(worktreePath: string): Promise<HaltDisposition> {
  const haltPath = join(worktreePath, HALT_MARKER);
  try {
    await stat(haltPath);
  } catch {
    return 'unclassified';
  }
  try {
    const contents = (await readFile(join(worktreePath, HALT_CLASS_MARKER), 'utf-8')).trim();
    if (
      contents === 'needs-human' ||
      contents === 'mechanical' ||
      contents === 'kickback-cap' ||
      contents === 'over-scope' ||
      contents === 'legacy' ||
      contents === PROTECTED_ARTIFACT_HALT_CLASS ||
      contents === PLAN_GAP_HALT_CLASS
    ) return contents;
    return 'unclassified';
  } catch {
    return 'unclassified';
  }
}

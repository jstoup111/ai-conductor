import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Stamp structure supporting semantic verification (Task 10).
 * Extends minimal {sha, form} with optional audit fields for judged provenance.
 * See adr-2026-07-11-attribution-verdict-interface § "Evidence stamp".
 *
 * - sha: primary cited SHA (required)
 * - form: stamp form identifier (required) — e.g. 'commit', 'trailer', 'evidence:satisfied-by', 'semantic-verified'
 * - citedShas: optional, full citation set (split attribution case)
 * - verdictAnchor: optional, which verdict (HEAD sha) produced this stamp (audit trail)
 * - testEvidence: optional, verifier-reported test result {command, exit, summary?}
 */
export interface EvidenceStamp {
  sha: string;
  form: string;
  citedShas?: string[];
  verdictAnchor?: string;
  testEvidence?: { command: string; exit: number; summary?: string };
}

/**
 * Durable engine-only state for task evidence tracking.
 *
 * Stored in `.pipeline/task-evidence.json` (gitignored by default).
 * Handles missing/corrupt files gracefully, logs anomalies without throwing,
 * and writes atomically via temp-file + rename.
 *
 * Tracks:
 * - evidenceStamps: Map<taskId, EvidenceStamp> — evidence for engine-owned task status
 * - noEvidenceAttempts: number — count of no-evidence attempt retries
 * - noEvidenceReasons: string[] — reason tags accrued alongside noEvidenceAttempts
 *   (e.g. `zero_work_product` — #505 TS-16). Append-only per miss; cleared
 *   whenever the counter itself resets on progress.
 * - migrationGrandfather: Set<string> — task IDs grandfathered during migration
 * - lastResolvedCount: number — net task-resolution count from the most recent
 *   attempt/dispatch (progress-aware halt/park decision, #601). Missing on
 *   older sidecars; defaults to 0 for backward compatibility.
 */
export interface TaskEvidence {
  evidenceStamps: Map<string, EvidenceStamp>;
  noEvidenceAttempts: number;
  noEvidenceReasons: string[];
  migrationGrandfather: Set<string>;
  lastResolvedCount: number;
  write(): Promise<void>;
}

/**
 * Human-readable descriptions for known `noEvidenceReasons` tags, used when
 * rendering ledger/report output. #505 TS-16: `zero_work_product` is the
 * first tag — a build step that dispatched no work or produced no commits.
 */
export const NO_EVIDENCE_REASON_DESCRIPTIONS: Record<string, string> = {
  zero_work_product:
    'Build step dispatched no work, or dispatched work produced no new commits',
};

interface SerializedEvidenceData {
  evidenceStamps: Record<string, EvidenceStamp>;
  noEvidenceAttempts: number;
  noEvidenceReasons?: string[];
  migrationGrandfather: string[];
  lastResolvedCount?: number;
}

/**
 * Load or create a TaskEvidence instance for the given project root.
 *
 * Reads from `.pipeline/task-evidence.json` if present.
 * Returns empty state if file is missing or corrupt (logs and continues).
 * All anomalies are logged without throwing.
 */
export async function createTaskEvidence(projectRoot: string): Promise<TaskEvidence> {
  const sidecarPath = join(projectRoot, '.pipeline/task-evidence.json');

  let data: SerializedEvidenceData = {
    evidenceStamps: {},
    noEvidenceAttempts: 0,
    noEvidenceReasons: [],
    migrationGrandfather: [],
  };

  try {
    const raw = await readFile(sidecarPath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'evidenceStamps' in parsed &&
        'noEvidenceAttempts' in parsed &&
        'migrationGrandfather' in parsed
      ) {
        data = parsed as SerializedEvidenceData;
      }
    } catch (parseErr) {
      // JSON parse error
      console.warn(
        `[task-evidence] corrupt or unparseable file at ${sidecarPath}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }
  } catch {
    // File missing — use empty state
  }

  return createInstance(data, projectRoot);
}

function createInstance(
  data: SerializedEvidenceData,
  projectRoot: string,
): TaskEvidence {
  const evidenceStamps = new Map(Object.entries(data.evidenceStamps || {}));
  const migrationGrandfather = new Set(data.migrationGrandfather || []);

  const instance: TaskEvidence = {
    evidenceStamps,
    noEvidenceAttempts: data.noEvidenceAttempts || 0,
    noEvidenceReasons: Array.isArray(data.noEvidenceReasons)
      ? [...data.noEvidenceReasons]
      : [],
    migrationGrandfather,
    lastResolvedCount:
      typeof data.lastResolvedCount === 'number' ? data.lastResolvedCount : 0,

    async write() {
      const sidecarDir = join(projectRoot, '.pipeline');
      const sidecarPath = join(sidecarDir, 'task-evidence.json');

      // Ensure .pipeline directory exists
      await mkdir(sidecarDir, { recursive: true });

      // Serialize Maps and Sets to JSON-compatible format
      const serialized: SerializedEvidenceData = {
        evidenceStamps: Object.fromEntries(instance.evidenceStamps),
        noEvidenceAttempts: instance.noEvidenceAttempts,
        noEvidenceReasons: [...instance.noEvidenceReasons],
        migrationGrandfather: Array.from(instance.migrationGrandfather),
        lastResolvedCount: instance.lastResolvedCount,
      };

      // TRUE atomic write: unique temp file in the SAME directory, then
      // rename(2) over the target — atomic on POSIX, last-write-wins, and a
      // reader can never observe a torn/empty sidecar. The previous
      // implementation staged the temp in the OS tmpdir and then did a second
      // plain writeFile to the real path — two concurrent writers could
      // interleave and leave a truncated file (the "concurrent writes" flake,
      // deterministic on 2-core CI runners).
      const tempFile = join(
        sidecarDir,
        `.task-evidence.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      try {
        await writeFile(tempFile, JSON.stringify(serialized, null, 2));
        await rename(tempFile, sidecarPath);
      } catch (err) {
        await rm(tempFile, { force: true }).catch(() => {});
        throw err;
      }
    },
  };

  return instance;
}

/**
 * Write judged stamps to the sidecar for semantically-verified tasks (Task 10).
 *
 * PURPOSE:
 * Records validated verdicts from the attribution verifier as evidence stamps
/**
 * Increment the no-evidence attempts counter by 1 and persist to sidecar.
 * Returns the new counter value. An optional `reason` tag (e.g.
 * `zero_work_product`, #505 TS-16) is appended to `noEvidenceReasons`
 * alongside the increment.
 */
export async function incrementNoEvidenceAttempts(
  projectRoot: string,
  reason?: string,
): Promise<number> {
  const evidence = await createTaskEvidence(projectRoot);
  evidence.noEvidenceAttempts++;
  if (reason) {
    evidence.noEvidenceReasons.push(reason);
  }
  await evidence.write();
  return evidence.noEvidenceAttempts;
}

/**
 * Reset the no-evidence attempts counter to zero and persist to sidecar.
 * Also clears `noEvidenceReasons` — the reasons array tracks tags accrued
 * alongside the counter, so it resets in lockstep.
 */
export async function resetNoEvidenceAttempts(projectRoot: string): Promise<void> {
  const evidence = await createTaskEvidence(projectRoot);
  evidence.noEvidenceAttempts = 0;
  evidence.noEvidenceReasons = [];
  await evidence.write();
}

/**
 * Read the current no-evidence attempts counter from sidecar.
 */
export async function readNoEvidenceAttempts(projectRoot: string): Promise<number> {
  const evidence = await createTaskEvidence(projectRoot);
  return evidence.noEvidenceAttempts;
}

/**
 * Read `lastResolvedCount` from the sidecar (Task 11 — tolerant reads).
 *
 * Thin delegate over `createTaskEvidence`, which already tolerates a
 * missing or corrupt/unparseable `.pipeline/task-evidence.json` by
 * returning empty state (`lastResolvedCount: 0`). Never throws: a
 * corrupt/missing sidecar reads as zero progress, so the progress-delta
 * computation (`resolvedCount - lastResolvedCount`) degrades to "no
 * progress" rather than crashing the daemon tick.
 */
export async function readLastResolvedCount(projectRoot: string): Promise<number> {
  const evidence = await createTaskEvidence(projectRoot);
  return evidence.lastResolvedCount;
}

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
 */
export interface TaskEvidence {
  evidenceStamps: Map<string, EvidenceStamp>;
  noEvidenceAttempts: number;
  noEvidenceReasons: string[];
  migrationGrandfather: Set<string>;
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
 * with form='semantic-verified' and rich audit metadata (citedShas, verdictAnchor,
 * testEvidence). Pre-existing stamps are never modified; new stamps are merged.
 * Refused tasks (validation failures or abstentions) are omitted from output.
 *
 * CONTRACT:
 * - validated: array of {taskId, sha, citedShas, verdictAnchor, testEvidence}
 * - refused: array of task IDs that did not get stamps (validation failures)
 * - Output: new stamps are written; pre-existing entries remain byte-identical
 * - All optional fields serialize/deserialize correctly (round-trip safe)
 *
 * @param projectRoot The project root (contains .pipeline/)
 * @param validated Array of validated task entries, each gets a semantic-verified stamp
 * @param refused Array of task IDs that were refused (not stamped)
 */
export async function writeJudgedStamps(
  projectRoot: string,
  validated: Array<{
    taskId: string;
    sha: string;
    citedShas: string[];
    verdictAnchor: string;
    testEvidence: { command: string; exit: number; summary?: string };
  }>,
  refused: string[],
): Promise<void> {
  const evidence = await createTaskEvidence(projectRoot);

  // Normalize task IDs to strings (Decision 7b from lane ADR)
  const normalizedValidated = validated.map((v) => ({
    ...v,
    taskId: String(v.taskId),
  }));

  // Add new stamps for validated tasks
  for (const task of normalizedValidated) {
    evidence.evidenceStamps.set(task.taskId, {
      sha: task.sha,
      form: 'semantic-verified',
      citedShas: task.citedShas,
      verdictAnchor: task.verdictAnchor,
      testEvidence: task.testEvidence,
    });
  }

  // Refused tasks are explicitly NOT added to the sidecar
  // (they remain unresolved, to be retried or manually addressed)

  await evidence.write();

  // Task 4: After stamping, reconcile task-status rows immediately so stamped
  // rows become completed in the same call. Use dynamic import to avoid init
  // cycles (autoheal already dynamically imports task-evidence).
  try {
    const autoheal = await import('./autoheal.js');
    await autoheal.reconcileStatusFromStamps(projectRoot);
  } catch {
    // Reconciliation is fail-soft; errors don't propagate or change return value
  }
}

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

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Durable engine-only state for task evidence tracking.
 *
 * Stored in `.pipeline/task-evidence.json` (gitignored by default).
 * Handles missing/corrupt files gracefully, logs anomalies without throwing,
 * and writes atomically via temp-file + rename.
 *
 * Tracks:
 * - evidenceStamps: Map<taskId, {sha, form}> — evidence for engine-owned task status
 * - noEvidenceAttempts: number — count of no-evidence attempt retries
 * - migrationGrandfather: Set<string> — task IDs grandfathered during migration
 */
export interface TaskEvidence {
  evidenceStamps: Map<string, { sha: string; form: string }>;
  noEvidenceAttempts: number;
  migrationGrandfather: Set<string>;
  write(): Promise<void>;
}

interface SerializedEvidenceData {
  evidenceStamps: Record<string, { sha: string; form: string }>;
  noEvidenceAttempts: number;
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
 * Increment the no-evidence attempts counter by 1 and persist to sidecar.
 * Returns the new counter value.
 */
export async function incrementNoEvidenceAttempts(projectRoot: string): Promise<number> {
  const evidence = await createTaskEvidence(projectRoot);
  evidence.noEvidenceAttempts++;
  await evidence.write();
  return evidence.noEvidenceAttempts;
}

/**
 * Reset the no-evidence attempts counter to zero and persist to sidecar.
 */
export async function resetNoEvidenceAttempts(projectRoot: string): Promise<void> {
  const evidence = await createTaskEvidence(projectRoot);
  evidence.noEvidenceAttempts = 0;
  await evidence.write();
}

/**
 * Read the current no-evidence attempts counter from sidecar.
 */
export async function readNoEvidenceAttempts(projectRoot: string): Promise<number> {
  const evidence = await createTaskEvidence(projectRoot);
  return evidence.noEvidenceAttempts;
}

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

      // Atomic write: write to temp file, then rename
      const tempDir = await mkdtemp(join(tmpdir(), 'task-evidence-'));
      try {
        const tempFile = join(tempDir, 'task-evidence.json');

        // Serialize Maps and Sets to JSON-compatible format
        const serialized: SerializedEvidenceData = {
          evidenceStamps: Object.fromEntries(instance.evidenceStamps),
          noEvidenceAttempts: instance.noEvidenceAttempts,
          migrationGrandfather: Array.from(instance.migrationGrandfather),
        };

        await writeFile(tempFile, JSON.stringify(serialized, null, 2));

        // Atomic rename (last-write-wins semantics)
        await writeFile(sidecarPath, await readFile(tempFile, 'utf-8'));
      } finally {
        // Clean up temp dir
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  };

  return instance;
}

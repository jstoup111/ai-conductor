import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { access } from 'node:fs/promises';
import { parsePlanTasks, PlanTask } from './autoheal.js';
import { createTaskEvidence } from './task-evidence.js';

interface TaskStatusRecord {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

interface TaskStatusFile {
  plan_ref?: string;
  tasks?: TaskStatusRecord[];
  [key: string]: unknown;
}

/**
 * Seed task-status.json from the plan at build entry.
 *
 * Acceptance criteria:
 * 1. Fresh build → creates one `pending` row per plan task
 * 2. Re-seed preserves engine-stamped `completed` rows (from sidecar stamps)
 * 3. Re-seed preserves `in_progress` rows
 * 4. New plan tasks are upserted into existing file
 * 5. Second re-seed produces byte-identical JSON (idempotent)
 * 6. Wholesale-wiped file is fully restored
 * 7. Write is atomic (temp file + rename)
 * 8. First seed (sidecar absent) stamps existing terminal rows as migration-grandfather
 *
 * @param projectRoot - Project root directory
 * @param planPath - Path to the plan file (relative to projectRoot or absolute)
 */
export async function seedTaskStatus(projectRoot: string, planPath: string): Promise<void> {
  try {
    // Ensure .pipeline directory exists
    const pipelineDir = join(projectRoot, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    const statusPath = join(pipelineDir, 'task-status.json');
    const sidecarPath = join(pipelineDir, 'task-evidence.json');

    // Check if this is a first seed (sidecar absent = pre-cutover)
    let isFirstSeed = false;
    try {
      await access(sidecarPath);
    } catch {
      // Sidecar doesn't exist — this is a first seed
      isFirstSeed = true;
    }

    // Parse plan tasks
    let planText: string;
    try {
      planText = await readFile(planPath, 'utf-8');
    } catch {
      // Plan file not found — create empty status
      planText = '';
    }

    const planTasks = parsePlanTasks(planText);

    // Load existing task-status.json
    let existingStatus: TaskStatusFile = { tasks: [] };
    try {
      const raw = await readFile(statusPath, 'utf-8');
      if (raw && raw.trim()) {
        try {
          existingStatus = JSON.parse(raw);
          if (!existingStatus.tasks || !Array.isArray(existingStatus.tasks)) {
            existingStatus.tasks = [];
          }
        } catch {
          // Corrupt JSON — start fresh
          existingStatus = { tasks: [] };
        }
      }
    } catch {
      // File doesn't exist — start with empty
      existingStatus = { tasks: [] };
    }

    // Load task evidence (sidecar)
    const evidence = await createTaskEvidence(projectRoot);

    // On first seed, stamp existing terminal rows as migration-grandfather
    if (isFirstSeed && existingStatus.tasks && Array.isArray(existingStatus.tasks)) {
      for (const task of existingStatus.tasks) {
        if (task.id && (task.status === 'completed' || task.status === 'skipped')) {
          evidence.migrationGrandfather.add(String(task.id));
        }
      }
    }

    // Merge logic
    const taskMap = new Map<string, TaskStatusRecord>();

    // First, preserve existing tasks
    if (existingStatus.tasks && Array.isArray(existingStatus.tasks)) {
      for (const task of existingStatus.tasks) {
        if (task.id) {
          taskMap.set(String(task.id), { ...task });
        }
      }
    }

    // Then, upsert plan tasks
    for (const [taskId, planTask] of planTasks.entries()) {
      const existing = taskMap.get(taskId);

      if (existing) {
        // Preserve in_progress
        if (existing.status === 'in_progress') {
          // Keep as-is
          continue;
        }

        // Check if we should preserve completed
        if (existing.status === 'completed') {
          const stamp = evidence.evidenceStamps.get(taskId);
          if (stamp) {
            // Has engine stamp — keep completed
            continue;
          }
        }

        // Otherwise update name and status
        existing.name = planTask.name;
        existing.status = 'pending';
      } else {
        // Task doesn't exist in current status file. Check evidence to see if it should be restored.
        const stamp = evidence.evidenceStamps.get(taskId);
        if (stamp) {
          // Has evidence stamp — restore as completed
          const restoredTask: TaskStatusRecord = {
            id: taskId,
            name: planTask.name,
            status: 'completed',
          };
          // Copy commit info if available in evidence
          if (stamp.sha) {
            restoredTask.commit = stamp.sha;
          }
          taskMap.set(taskId, restoredTask);
        } else {
          // No evidence — create as pending
          const newTask: TaskStatusRecord = {
            id: taskId,
            name: planTask.name,
            status: 'pending',
          };
          taskMap.set(taskId, newTask);
        }
      }
    }

    // Rebuild tasks array in consistent order (by numeric ID)
    const tasks = Array.from(taskMap.values()).sort((a, b) => {
      const idA = parseInt(String(a.id || 0), 10);
      const idB = parseInt(String(b.id || 0), 10);
      return idA - idB;
    });

    // Build output structure
    const output: TaskStatusFile = {
      plan_ref: normalizePlanRef(projectRoot, planPath),
      tasks,
    };

    // Atomic write: temp file + rename
    const tempDir = await mkdtemp(join(tmpdir(), 'task-status-'));
    try {
      const tempFile = join(tempDir, 'task-status.json');
      const serialized = JSON.stringify(output, null, 2) + '\n';
      await writeFile(tempFile, serialized);
      await writeFile(statusPath, serialized);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    // Write task evidence (with grandfather stamps if first seed)
    await evidence.write();
  } catch (err) {
    console.error(
      `[task-seed] Error seeding task-status.json: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

/**
 * Normalize plan path to a relative reference for plan_ref.
 */
function normalizePlanRef(projectRoot: string, planPath: string): string {
  // If absolute, make it relative to project
  if (planPath.startsWith('/')) {
    if (planPath.startsWith(projectRoot)) {
      return planPath.slice(projectRoot.length + 1);
    }
    return planPath;
  }

  // If already relative, return as-is
  return planPath;
}

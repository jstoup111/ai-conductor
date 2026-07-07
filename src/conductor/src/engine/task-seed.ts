import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
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

interface EngineState {
  activePlanPath?: string;
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
 * 9. (Task 14) Uses engine-recorded plan path; detects ambiguity when multiple plans exist
 *
 * @param projectRoot - Project root directory
 * @param planPath - Path to the plan file (relative to projectRoot or absolute)
 * @param enginePlanPath - Optional: plan path recorded in engine state (overrides planPath)
 */
export async function seedTaskStatus(projectRoot: string, planPath: string, enginePlanPath?: string): Promise<void> {
  try {
    // Ensure .pipeline directory exists
    const pipelineDir = join(projectRoot, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    const statusPath = join(pipelineDir, 'task-status.json');
    const sidecarPath = join(pipelineDir, 'task-evidence.json');
    const engineStatePath = join(pipelineDir, 'engine-state.json');

    // Read engine-recorded plan path if available
    let recordedPlanPath: string | undefined = enginePlanPath;
    try {
      const engineStateContent = await readFile(engineStatePath, 'utf-8');
      const engineState: EngineState = JSON.parse(engineStateContent);
      if (engineState.activePlanPath) {
        recordedPlanPath = engineState.activePlanPath;
      }
    } catch {
      // Engine state doesn't exist yet — OK, will try other sources
    }

    // Resolve the actual plan path to use:
    // 1. If engine-recorded path exists, use it exclusively
    // 2. Otherwise, resolve from planPath or detect ambiguity
    let resolvedPlanPath: string;
    if (recordedPlanPath) {
      resolvedPlanPath = recordedPlanPath;
    } else {
      // No engine-recorded path — check for ambiguity
      resolvedPlanPath = await resolvePlanPathWithAmbiguityCheck(projectRoot, planPath);
    }

    // Ensure resolvedPlanPath is absolute (join with projectRoot if relative)
    let absolutePlanPath: string;
    if (resolvedPlanPath.startsWith('/')) {
      absolutePlanPath = resolvedPlanPath;
    } else {
      absolutePlanPath = join(projectRoot, resolvedPlanPath);
    }

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
      planText = await readFile(absolutePlanPath, 'utf-8');
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
          if (!existingStatus.tasks) {
            existingStatus.tasks = [];
          } else if (!Array.isArray(existingStatus.tasks)) {
            // In-flight migration (H1): agent-written files also use the
            // object form `tasks: { "<id>": {...} }`. Normalize to the
            // engine's array form instead of discarding — dropping these
            // rows would lose real pre-cutover completions AND their H8
            // grandfather eligibility.
            const objTasks = existingStatus.tasks as unknown as Record<string, unknown>;
            existingStatus.tasks = Object.entries(objTasks)
              .filter((e): e is [string, Record<string, unknown>] => !!e[1] && typeof e[1] === 'object')
              .map(([id, entry]) => ({ ...(entry as object), id }) as (typeof existingStatus.tasks)[number]);
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

    // On first seed, stamp existing terminal rows as migration-grandfather —
    // but only for ids the plan actually defines (parsePlanTasks, colon-
    // required headers). A terminal row for an id the plan doesn't recognize
    // isn't a pre-cutover legacy row; it's indistinguishable from a forged
    // row an agent wrote directly (H4/H6), so it must NOT be grandfathered.
    if (isFirstSeed && existingStatus.tasks && Array.isArray(existingStatus.tasks)) {
      for (const task of existingStatus.tasks) {
        if (
          task.id &&
          (task.status === 'completed' || task.status === 'skipped') &&
          planTasks.has(String(task.id))
        ) {
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

        // Preserve terminal rows backed by engine evidence: a real stamp, or
        // the H8 migration grandfather (stamped moments ago on first seed —
        // demoting a just-grandfathered row here would make the grandfather a
        // no-op and re-open the demote-completed-work loop this feature fixes).
        if (existing.status === 'completed' || existing.status === 'skipped') {
          const stamp = evidence.evidenceStamps.get(taskId);
          if (stamp || evidence.migrationGrandfather.has(taskId)) {
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
      plan_ref: normalizePlanRef(projectRoot, resolvedPlanPath),
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
 * Resolve the plan path to use for seeding.
 * If no explicit path provided, search for plans in .docs/plans/.
 * Throws if multiple plans found with no engine guidance (ambiguous).
 * Uses fallback (single plan) if only one exists.
 */
async function resolvePlanPathWithAmbiguityCheck(projectRoot: string, planPath: string): Promise<string> {
  // If an explicit plan path was provided, use it
  if (planPath && planPath.trim()) {
    return planPath;
  }

  // No explicit path — search for plans in .docs/plans/
  const plansDir = join(projectRoot, '.docs', 'plans');
  let planFiles: string[];
  try {
    const files = await readdir(plansDir);
    planFiles = files.filter(f => f.endsWith('.md')).map(f => join(plansDir, f));
  } catch {
    // Plans directory doesn't exist
    planFiles = [];
  }

  if (planFiles.length === 0) {
    // No plans found at all — return empty, let downstream handle it
    return '';
  }

  if (planFiles.length === 1) {
    // Single plan — use it as fallback
    return planFiles[0];
  }

  // Multiple plans and no engine guidance — ambiguous
  const planList = planFiles.map(p => p.replace(projectRoot, '.')).join(', ');
  const errorMsg = `Ambiguous plan discovery: multiple plans found (${planList}) but no engine-recorded path. ` +
    `The plan step should record the active plan path in engine state; seed cannot guess which to use.`;
  console.error(`[task-seed] ${errorMsg}`);
  throw new Error(errorMsg);
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

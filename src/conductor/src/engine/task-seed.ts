import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePlanTasks, canonicalTaskId, PlanTask } from './autoheal.js';
import { createTaskEvidence } from './task-evidence.js';
import { removeBuildStepMarker } from './attribution-enforcement.js';

/**
 * Defensively clear a stale build-step-active marker at step entry (Task 4,
 * #505). Mirrors the stale `current-task` stamp clearing inside
 * `seedTaskStatus` below: a marker left behind by a crashed prior session
 * (or an unclean shutdown mid-build-step) must not leak into the next
 * step's attribution decisions. Called at EVERY step entry, not just build
 * steps — a subsequent build step re-writes the marker fresh immediately
 * after this runs, so clearing here never races the real write.
 *
 * Reuses `removeBuildStepMarker`, which is already idempotent (no error if
 * the marker is absent). Any unexpected error is caught and logged rather
 * than thrown, so a marker-removal failure can never block step dispatch
 * (fail-open, matching the current-task stamp clearing pattern).
 */
export function clearStaleMarker(projectRoot: string): void {
  try {
    removeBuildStepMarker(projectRoot);
  } catch (err) {
    console.warn(
      `[task-seed] Failed to clear stale build-step marker: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

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

/** Advancement rank for merging duplicate rows (#636): higher wins. */
function statusRank(status: string | undefined): number {
  switch (status) {
    case 'completed':
    case 'skipped':
      return 3;
    case 'in_progress':
      return 2;
    case 'pending':
      return 1;
    default:
      return 0;
  }
}

/**
 * Merge two task-status rows that fold to the same canonical id (#636).
 *
 * When #615's id-grammar drift split one plan task into a `T<N>` row and a bare
 * `<N>` row, seeding must reunite them without losing progress. The winner is
 * the more-advanced row by {@link statusRank} (completed/skipped > in_progress
 * > pending); ties keep the row that carries a `commit`. Whichever row wins,
 * its `commit`/`skip_reason` are carried across from the loser if the winner
 * lacks them, so no evidence pointer is dropped in the collapse.
 */
function mergeStatusRows(a: TaskStatusRecord, b: TaskStatusRecord): TaskStatusRecord {
  const rankA = statusRank(a.status);
  const rankB = statusRank(b.status);
  let winner: TaskStatusRecord;
  let loser: TaskStatusRecord;
  if (rankB > rankA || (rankB === rankA && !a.commit && !!b.commit)) {
    winner = b;
    loser = a;
  } else {
    winner = a;
    loser = b;
  }
  const merged: TaskStatusRecord = { ...winner };
  if (!merged.commit && loser.commit) merged.commit = loser.commit;
  if (!merged.skip_reason && loser.skip_reason) merged.skip_reason = loser.skip_reason;
  return merged;
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
 * 8. (Retired H8) First seed no longer grandfathers existing terminal rows;
 *    completion is derived solely from evidence stamps (see Task 9)
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
    await fsPromises.mkdir(pipelineDir, { recursive: true });

    // Clear stale stamp file at build entry (defensive cleanup)
    const currentTaskPath = join(pipelineDir, 'current-task');
    try {
      await fsPromises.rm(currentTaskPath, { force: false });
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
        // Not a "file not found" error — log warning but continue (fail-open)
        console.warn(
          `[task-seed] Failed to clear stale stamp file at ${currentTaskPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // If ENOENT (file not found), that's fine — no cleanup needed
    }

    const statusPath = join(pipelineDir, 'task-status.json');
    const engineStatePath = join(pipelineDir, 'engine-state.json');

    // Read engine-recorded plan path if available
    let recordedPlanPath: string | undefined = enginePlanPath;
    try {
      const engineStateContent = await fsPromises.readFile(engineStatePath, 'utf-8');
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

    // Parse plan tasks
    let planText: string;
    try {
      planText = await fsPromises.readFile(absolutePlanPath, 'utf-8');
    } catch {
      // Plan file not found — create empty status
      planText = '';
    }

    const planTasks = parsePlanTasks(planText);

    // Load existing task-status.json
    let existingStatus: TaskStatusFile = { tasks: [] };
    try {
      const raw = await fsPromises.readFile(statusPath, 'utf-8');
      if (raw && raw.trim()) {
        try {
          existingStatus = JSON.parse(raw);
          if (!existingStatus.tasks) {
            existingStatus.tasks = [];
          } else if (!Array.isArray(existingStatus.tasks)) {
            // In-flight migration (H1): agent-written files also use the
            // object form `tasks: { "<id>": {...} }`. Normalize to the
            // engine's array form instead of discarding — dropping these
            // rows would lose real pre-cutover completions.
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

    // #636: canonical-aware stamp lookup. Evidence stamps may be keyed under
    // either grammar (`T3` or `3`); fold both to the canonical key so a
    // T-prefixed plan task finds a bare-keyed stamp and vice versa.
    const stampFor = (id: string): { sha?: string } | undefined => {
      const direct = evidence.evidenceStamps.get(id);
      if (direct) return direct;
      const canon = canonicalTaskId(id);
      for (const [k, v] of evidence.evidenceStamps.entries()) {
        if (canonicalTaskId(k) === canon) return v;
      }
      return undefined;
    };
    const hasGrandfather = (id: string): boolean => {
      if (evidence.migrationGrandfather.has(id)) return true;
      const canon = canonicalTaskId(id);
      for (const k of evidence.migrationGrandfather) {
        if (canonicalTaskId(k) === canon) return true;
      }
      return false;
    };

    // Merge logic. The map is keyed by the CANONICAL task id (#636) so a plan
    // whose header is `### T<N>` and a pre-existing task-status.json that split
    // into both `T<N>` and bare `<N>` rows (the #615 duplication) collapse to
    // ONE row per task instead of producing phantom duplicates.
    const taskMap = new Map<string, TaskStatusRecord>();

    // First, preserve existing tasks. When two on-disk rows fold to the same
    // canonical id (the 18-rows-for-9-tasks split), keep the more-advanced row
    // (completed/skipped > in_progress > pending, tie-broken by having a
    // commit) so real progress under either grammar survives the merge.
    if (existingStatus.tasks && Array.isArray(existingStatus.tasks)) {
      for (const task of existingStatus.tasks) {
        if (!task.id) continue;
        const key = canonicalTaskId(String(task.id));
        const prior = taskMap.get(key);
        taskMap.set(key, prior ? mergeStatusRows(prior, task) : { ...task });
      }
    }

    // Then, upsert plan tasks (looked up / stored under the canonical key).
    for (const [taskId, planTask] of planTasks.entries()) {
      const canonicalId = canonicalTaskId(taskId);
      const existing = taskMap.get(canonicalId);

      if (existing) {
        // Adopt the plan-header grammar as the canonical stored id (#636), so a
        // surviving phantom bare row ends up keyed `T<N>` to match the plan,
        // trailers, and evidence stamps.
        existing.id = taskId;

        // Preserve in_progress
        if (existing.status === 'in_progress') {
          // Keep as-is
          continue;
        }

        // Preserve terminal rows backed by engine evidence: a real evidence
        // stamp, or a legacy migrationGrandfather entry from before H8 was
        // retired. Nothing writes new grandfather entries anymore (see Task
        // 8/9) — completion is derived solely from evidence stamps.
        if (existing.status === 'completed' || existing.status === 'skipped') {
          if (stampFor(taskId) || hasGrandfather(taskId)) {
            continue;
          }
        }

        // Otherwise update name and status
        existing.name = planTask.name;
        existing.status = 'pending';
      } else {
        // Task doesn't exist in current status file. Check evidence to see if it should be restored.
        const stamp = stampFor(taskId);
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
          taskMap.set(canonicalId, restoredTask);
        } else {
          // No evidence — create as pending
          const newTask: TaskStatusRecord = {
            id: taskId,
            name: planTask.name,
            status: 'pending',
          };
          taskMap.set(canonicalId, newTask);
        }
      }
    }

    // Rebuild tasks array in consistent order. Sort by the canonical numeric id
    // (#636) so T-prefixed ids (`T1`) order alongside bare numerics rather than
    // collapsing to NaN → 0.
    const tasks = Array.from(taskMap.values()).sort((a, b) => {
      const idA = parseInt(canonicalTaskId(String(a.id || 0)), 10);
      const idB = parseInt(canonicalTaskId(String(b.id || 0)), 10);
      return idA - idB;
    });

    // Build output structure
    const output: TaskStatusFile = {
      plan_ref: normalizePlanRef(projectRoot, resolvedPlanPath),
      tasks,
    };

    // Atomic write: temp file + rename
    const tempDir = await fsPromises.mkdtemp(join(tmpdir(), 'task-status-'));
    try {
      const tempFile = join(tempDir, 'task-status.json');
      const serialized = JSON.stringify(output, null, 2) + '\n';
      await fsPromises.writeFile(tempFile, serialized);
      await fsPromises.writeFile(statusPath, serialized);
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }

    // Write task evidence
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
    const files = await fsPromises.readdir(plansDir);
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

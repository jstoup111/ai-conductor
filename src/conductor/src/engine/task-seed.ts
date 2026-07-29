import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execa } from 'execa';
import {
  parsePlanTasks,
  canonicalTaskId,
  PlanTask,
  listCommitsWithTrailers,
  resolveOriginRef,
} from './autoheal.js';
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
 * Canonical task ids proven complete by a `Task: <id>` trailer on a commit
 * reachable on the current branch, mapped to the sha of the newest such
 * commit.
 *
 * This is the SAME evidence the build-step routing predicate already folds in
 * via `resolveTaskIds` (adr-2026-07-23-trailer-union-build-step-routing, #859)
 * — reading it here grants no new authority, it only lets a RECONSTRUCTED
 * `task-status.json` agree with the union that the engine already computes.
 *
 * Fail-soft by construction: any git error (non-repo directory, no commits,
 * detached worktree) degrades to an empty map, so a reconstruction in a
 * repo-less fixture still produces plain `pending` rows rather than throwing.
 *
 * SCOPE IS LOAD-BEARING, so this resolves the branch range itself instead of
 * letting `listCommitsWithTrailers` pick one. Called with no anchor, that
 * helper falls back to `git log -n 100 HEAD` when the origin ref or merge-base
 * cannot be resolved — a range that includes the DEFAULT BRANCH's history.
 * Task ids are per-plan and collide freely across features, so an unrelated
 * feature's `Task: 3` on the mainline would restore THIS plan's task 3 as
 * completed and the build would silently skip real work. Restoring a
 * completion is the one direction that can lose work, so this fails CLOSED:
 * no provable branch range, no restored completions, everything stays pending
 * and gets rebuilt. Redoing a task is cheap; skipping one is not.
 */
async function trailerProvenCompletions(projectRoot: string): Promise<Map<string, string>> {
  const proven = new Map<string, string>();
  try {
    const originRef = await resolveOriginRef(projectRoot);
    if (!originRef) return proven;

    const mergeBase = await execa('git', ['merge-base', originRef, 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    });
    const base =
      mergeBase.exitCode === 0 && typeof mergeBase.stdout === 'string'
        ? mergeBase.stdout.trim()
        : '';
    if (!base) return proven;

    // Passing the merge-base as the anchor keeps `listCommitsWithTrailers` on
    // its fail-closed path (`getEvidenceRange`), which yields zero commits
    // rather than widening the range when the anchor is unreachable.
    //
    // Returns newest-first (`git log` order), so the FIRST sha seen for an id
    // is the newest commit carrying it.
    for (const commit of await listCommitsWithTrailers(projectRoot, base)) {
      for (const value of commit.trailers['Task'] ?? []) {
        const canonical = canonicalTaskId(String(value).trim());
        if (!canonical) continue;
        if (!proven.has(canonical)) proven.set(canonical, commit.sha);
      }
    }
  } catch {
    // fail-soft — no trailer evidence available
  }
  return proven;
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

    // Load existing task-status.json.
    //
    // `reconstructing` records that there was NO usable prior file — missing,
    // empty, or unparseable. `.pipeline/` is gitignored and lives inside the
    // worktree, so this is exactly the state left behind when a worktree is
    // removed and recreated from its branch (CLAUDE.md "Daemon Operations
    // Safety" rule 3, #497) or when the file never got written at all (#1102).
    // In that state — and ONLY in that state — completions are re-derived from
    // `Task:` commit trailers below, so already-finished work is not redone.
    let reconstructing = true;
    let existingStatus: TaskStatusFile = { tasks: [] };
    try {
      const raw = await fsPromises.readFile(statusPath, 'utf-8');
      if (raw && raw.trim()) {
        try {
          existingStatus = JSON.parse(raw);
          reconstructing = false;
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
    // A file that parsed but carries no rows at all is materially the same
    // wipe as a missing one (the #1102 shape: `.pipeline/` present, every
    // other artifact present, no usable task rows). Treat it as a
    // reconstruction so trailer-proven completions are restored.
    if (!existingStatus.tasks || existingStatus.tasks.length === 0) {
      reconstructing = true;
    }

    // Trailer-proven completions are read ONLY when reconstructing, so an
    // ordinary re-seed keeps its existing (possibly deliberately-reverted)
    // rows untouched and pays no git cost.
    const provenCompletions = reconstructing
      ? await trailerProvenCompletions(projectRoot)
      : new Map<string, string>();

    // Load task evidence (sidecar). Task 14 (#773): no longer consulted to
    // restore/derive task-status.json rows (see the plan-task upsert loop
    // below) — loaded here only so its file continues to be maintained via
    // `evidence.write()` for telemetry/downstream consumers that still read
    // the sidecar directly (e.g. autoheal's derive step).
    const evidence = await createTaskEvidence(projectRoot);

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

        // Preserve terminal rows unconditionally (Task 10, #773): the
        // build predicate no longer cross-checks task-status.json rows
        // against the evidence ledger (the derivation engine +
        // createTaskEvidence's evidenceStamps; the derivation engine itself
        // was deleted in Task 11) — that anti-forgery check is retired, since
        // build_review's completeness rubric now independently judges the
        // real diff on every pass. A row already marked completed/skipped
        // stays that way across re-seeds regardless of whether an evidence
        // stamp exists for it.
        if (existing.status === 'completed' || existing.status === 'skipped') {
          continue;
        }

        // Otherwise update name and status
        existing.name = planTask.name;
        existing.status = 'pending';
      } else {
        // Task doesn't exist in current status file. Task 14 (#773): the
        // evidence sidecar is no longer consulted to restore/derive rows —
        // task-status.json rows are the sole source of truth (Task 10);
        // re-deriving a row FROM the evidence ledger is backwards.
        //
        // #1102 exception, and ONLY when `reconstructing` (no usable prior
        // file): a task carrying a `Task:` trailer on a commit already on this
        // branch is restored as `completed` rather than reset to `pending`, so
        // a wiped/recreated worktree does not redo finished, committed work
        // (CLAUDE.md "Daemon Operations Safety" rule 3, #497). This is a
        // RESTORE, not a grant: `resolveTaskIds` already treats the same
        // trailer as resolving the task for build-step routing
        // (adr-2026-07-23, #859), and `build_review`'s completeness rubric
        // still re-judges the real diff, so no unearned work can pass a gate
        // through this row.
        const provenSha = provenCompletions.get(canonicalId);
        const newTask: TaskStatusRecord = provenSha
          ? {
              id: taskId,
              name: planTask.name,
              status: 'completed',
              commit: provenSha,
              restored_from: 'task-trailer',
            }
          : {
              id: taskId,
              name: planTask.name,
              status: 'pending',
            };
        if (provenSha) {
          console.warn(
            `[task-seed] restored ${taskId} as completed from Task: trailer on ${provenSha.slice(0, 8)}`,
          );
        }
        taskMap.set(canonicalId, newTask);
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

    // Atomic write: SAME-DIRECTORY temp file + rename(2). The temp file must
    // share a filesystem with the target for `rename` to be atomic, so it goes
    // next to `task-status.json` rather than in `os.tmpdir()`.
    const serialized = JSON.stringify(output, null, 2) + '\n';
    const tempFile = join(
      pipelineDir,
      `.task-status.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
    );
    try {
      await fsPromises.writeFile(tempFile, serialized);
      await fsPromises.rename(tempFile, statusPath);
    } catch (err) {
      await fsPromises.rm(tempFile, { force: true }).catch(() => {});
      throw err;
    }

    // Re-read the filesystem after the repair (the #1088 property): a repair
    // OUTCOME is never authority — only what is actually on disk is. If the
    // reconstruction could not land (read-only `.pipeline/`, full disk, a
    // directory where the file should be), fail LOUDLY here rather than let a
    // build dispatch against state that silently isn't there.
    const verified = await fsPromises.readFile(statusPath, 'utf-8');
    const reread = JSON.parse(verified) as TaskStatusFile;
    if (!Array.isArray(reread.tasks) || reread.tasks.length !== tasks.length) {
      throw new Error(
        `task-status.json did not persist: expected ${tasks.length} row(s) at ` +
          `${statusPath}, re-read ${Array.isArray(reread.tasks) ? reread.tasks.length : 'a non-array'}`,
      );
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

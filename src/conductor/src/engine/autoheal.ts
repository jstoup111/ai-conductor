import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execa } from 'execa';
import { originDefaultBranch, makeGitRunner } from './rebase.js';
import { loadRewriteMap, resolveThroughMap } from './rebase-translate.js';
// Relocated shared utilities (H9 id grammar + plan-task-paths parser) — see
// plan-task-parse.ts for the rationale. Re-exported below for backward
// compatibility with existing call sites in this file and elsewhere.
import { TASK_ID_PATTERN, parsePlanTaskPaths } from './plan-task-parse.js';
export { TASK_ID_PATTERN, parsePlanTaskPaths } from './plan-task-parse.js';

// #405: near-miss derive diagnostics (path-corroboration miss, pinned-stamp
// demotion prevention) repeat on EVERY build-gate evaluation — H7 deliberately
// re-derives each pass, so a healthy long build re-warns the same
// (task, commit) pairs all build long. First occurrence is signal; repeats are
// noise. Warn once per key for the process lifetime (a daemon run); the
// verdict/audit-entry machinery is untouched — this is presentation-only.
const derivedWarningsSeen = new Set<string>();

/** Test seam: clear the warn-once memory (module state spans vitest files). */
export function resetDeriveWarnOnce(): void {
  derivedWarningsSeen.clear();
}

function warnOnce(key: string, message: string): void {
  if (derivedWarningsSeen.has(key)) return;
  derivedWarningsSeen.add(key);
  console.warn(message);
}

/**
 * True when a commit-changed file satisfies a plan-declared task path (#425).
 *
 * Exact repo-relative match, or a path-segment-anchored suffix match — plans
 * routinely write "Files likely touched" as basenames (`push-evidence.ts`) or
 * partial paths (`engine/push-evidence.ts`), while git reports repo-relative
 * paths (`src/conductor/src/engine/push-evidence.ts`). Requiring the match to
 * align at a `/` boundary keeps this evidence-grade: `trail.ts` never matches
 * `audit-trail.ts`. This is corroboration for a commit ALREADY carrying the
 * task's trailer (or matching its subject), not free-standing evidence.
 */
export function fileMatchesPlanPath(file: string, planDeclaredPath: string): boolean {
  const f = file.replace(/^\.\//, '');
  const p = planDeclaredPath.replace(/^\.\//, '');
  return f === p || f.endsWith('/' + p);
}

/**
 * Bounded immediate-parent-dir corroboration predicate (#707).
 *
 * Strips a leading `./` from both sides, then compares `dirname(file)` to
 * `dirname(planDeclaredPath)` for exact equality. No ancestor/prefix logic —
 * a file in a nested or sibling directory does not match. This is
 * intentionally narrower than `fileMatchesPlanPath`'s suffix match; it is
 * used where corroboration needs the file to sit in the exact same
 * directory as the plan-declared path, not merely share a path suffix.
 */
export function fileDirMatchesPlanPath(file: string, planDeclaredPath: string): boolean {
  const f = file.replace(/^\.\//, '');
  const p = planDeclaredPath.replace(/^\.\//, '');
  return dirname(f) === dirname(p);
}

/** Commit files that satisfy at least one of the task's plan-declared paths (#425). */
function filesOverlappingTaskPaths(files: string[], taskPaths: ReadonlySet<string>): string[] {
  return files.filter((f) => {
    for (const p of taskPaths) {
      if (fileMatchesPlanPath(f, p)) return true;
    }
    return false;
  });
}

/**
 * Branch-aware corroboration (#707): try exact/suffix overlap first; only on
 * a miss, try the bounded immediate-parent-dir overlap. Returns which branch
 * (if any) satisfied corroboration so callers can distinguish the two for
 * stamping purposes (Task 3) without re-deriving the match.
 */
function corroborationMatch(
  filesInCommit: string[],
  taskPaths: ReadonlySet<string>,
): 'exact-suffix' | 'dirname' | null {
  if (filesOverlappingTaskPaths(filesInCommit, taskPaths).length > 0) return 'exact-suffix';
  for (const f of filesInCommit) {
    for (const p of taskPaths) {
      if (fileDirMatchesPlanPath(f, p)) return 'dirname';
    }
  }
  return null;
}

// Simple logger interface for fail-closed operations
interface EvidenceRangeLogger {
  anomalies: string[];
  warnings: string[];
}

function createEvidenceRangeLogger(): EvidenceRangeLogger {
  return {
    anomalies: [],
    warnings: [],
  };
}

/**
 * Task trailer matcher with ambiguity-guarded alias support.
 *
 * Matches trailer values against a task ID, supporting both exact form (bare ID)
 * and alias form (task-N). The alias form is only accepted if it's unambiguous
 * in the plan's task namespace — i.e., if `task-${taskId}` is not also a plan
 * task ID itself (which would make it ambiguous which task was intended).
 *
 * Use case: In a plan with both `Task 7` (bare numeric) and `Task task-7`
 * (alphanumeric), a commit trailer `Task: task-7` is ambiguous. The guard
 * ensures we only match the alias when it's the only possible interpretation.
 *
 * @param trailerValues - Parsed values from a `Task:` trailer (e.g., ['7', 'task-7'])
 * @param taskId - The task ID to match against (e.g., '7')
 * @param planIds - Set of all task IDs in the plan (used to detect ambiguity)
 * @returns true if trailerValues contains taskId (exact or unambiguous alias), false otherwise
 */
export function taskTrailerMatches(trailerValues: string[], taskId: string, planIds: Set<string>): boolean {
  // Check exact match first: if taskId is in trailerValues, return true
  if (trailerValues.includes(taskId)) {
    return true;
  }

  // #636: T<N> ↔ <N> grammar alias. A plan header written `### T<N>` yields a
  // T-prefixed task id, but implementation commits (and pre-#615 machinery)
  // may carry either the T-prefixed or the bare-numeric `Task:` trailer.
  // Fold both sides to the canonical numeric key so `Task: 0` resolves a `T0`
  // task and `Task: T3` resolves a `3` task. Non-numeric ids are unaffected
  // (canonicalTaskId is a no-op for them), so this never widens matching for
  // `task-7` / `rem-adr-001`.
  const canonicalId = canonicalTaskId(taskId);
  if (trailerValues.some((v) => canonicalTaskId(v) === canonicalId)) {
    return true;
  }

  // Check guarded alias: if `task-${taskId}` is in trailerValues
  const aliasForm = `task-${taskId}`;
  if (trailerValues.includes(aliasForm)) {
    // If alias is NOT in planIds, it's safe to use (not ambiguous)
    if (!planIds.has(aliasForm)) {
      return true;
    }
    // If alias IS in planIds, it's ambiguous, return false
    return false;
  }

  // No match found
  return false;
}

/**
 * Derive task completion from git evidence. Evaluates commits since a plan
 * anchor and marks tasks complete based on trailer evidence (Task: N),
 * explicit Evidence: forms, or pinned sidecar stamps.
 *
 * Automatically:
 * - Loads the plan from planPath and extracts task IDs + file paths
 * - Resolves the plan anchor (first commit on HEAD) for the evidence range
 * - Reads git history for evidence (commits with Task: trailers, Evidence: forms)
 * - Loads and writes task-evidence.json sidecar for evidence stamps
 *
 * Evidence bar (both conditions must hold for a commit to mark a task complete):
 *  1. Commit contains Task: <id> trailer OR Evidence: satisfied-by/skipped form
 *  2. If task has file paths, commit must touch at least one (path corroboration)
 *     If task has no paths, Task: trailer alone is sufficient
 *
 * Call this function on every build-gate evaluation to derive fresh evidence.
 * Writes evidence stamps to .pipeline/task-evidence.json sidecar.
 */

export interface HealedTask {
  taskId: string;
  commit: string;
  subject: string;
  matchedFiles: string[];
}

export interface SkippedTask {
  taskId: string;
  reason: string;
}

export interface AutoHealResult {
  healed: HealedTask[];
  skipped: SkippedTask[];
}

interface TaskRecord {
  id: string;
  name?: string;
  status?: string;
  rawEntry: Record<string, unknown>;
}

interface ParsedStatus {
  parsed: Record<string, unknown>;
  tasks: TaskRecord[];
  planRef?: string;
  statusPath: string;
}

/**
 * MIGRATION-ONLY FALLBACK (ADR H5).
 *
 * This is the pre-ADR subject/path matching heuristic. It is no longer an
 * authoritative source of task completion — deriveCompletion() (trailer +
 * sidecar evidence) is the only engine-owned path that may mark a task
 * "completed" as a matter of course. attemptAutoHeal is retained solely as a
 * best-effort migration aid for pre-cutover repos that have no trailer
 * history to derive from.
 *
 * To honor H8 (seedTaskStatus demotes any "completed" row lacking a sidecar
 * evidence stamp back to "pending"), every heal performed here immediately
 * writes a corresponding task-evidence.json stamp (form: 'legacy-heal') so
 * the write it makes to task-status.json is never orphaned: it either has
 * evidence to back it up, or it must not be written at all. This closes the
 * legacy-heal -> no-stamp -> demoted-to-pending loop.
 */
export async function attemptAutoHeal(projectRoot: string): Promise<AutoHealResult> {
  const result: AutoHealResult = { healed: [], skipped: [] };
  try {
    const status = await readTaskStatus(projectRoot);
    if (!status) return result;

    const pendingTasks = status.tasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length === 0) return result;

    const commits = await listCommits(projectRoot);
    if (commits.length === 0) {
      for (const t of pendingTasks) {
        result.skipped.push({ taskId: t.id, reason: 'no git commits available' });
      }
      await writeAuditFile(projectRoot, result);
      return result;
    }

    const planPaths = await readPlanPaths(projectRoot, status.planRef);

    const { createTaskEvidence } = await import('./task-evidence.js');
    const evidence = await createTaskEvidence(projectRoot);

    for (const task of pendingTasks) {
      const match = await findMatchingCommit(projectRoot, task, commits, planPaths);
      if (!match) {
        result.skipped.push({ taskId: task.id, reason: 'no unambiguous commit match' });
        continue;
      }
      task.rawEntry.status = 'completed';
      if ('commit' in task.rawEntry || !('commit' in task.rawEntry)) {
        task.rawEntry.commit = match.commit.slice(0, 7);
      }
      // Never write status='completed' without a corresponding sidecar
      // evidence stamp (H5/H8) — stamp immediately, in the same pass, so
      // the next seedTaskStatus call sees evidence and preserves it.
      evidence.evidenceStamps.set(task.id, { sha: match.commit, form: 'legacy-heal' });
      result.healed.push({
        taskId: task.id,
        commit: match.commit.slice(0, 7),
        subject: match.subject,
        matchedFiles: match.matchedFiles,
      });
    }

    if (result.healed.length > 0) {
      await writeTaskStatus(status);
      await evidence.write();
    }
    await writeAuditFile(projectRoot, result);
    return result;
  } catch {
    return result;
  }
}

async function readTaskStatus(projectRoot: string): Promise<ParsedStatus | null> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const tasks = extractTaskRecords(root);
  if (tasks.length === 0) return null;
  const planRef = typeof root.plan_ref === 'string' ? root.plan_ref : undefined;
  return { parsed: root, tasks, planRef, statusPath };
}

function extractTaskRecords(root: Record<string, unknown>): TaskRecord[] {
  const container = 'tasks' in root ? root.tasks : root;
  if (Array.isArray(container)) {
    return container
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : String(entry.id ?? ''),
        name: typeof entry.name === 'string' ? entry.name : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        rawEntry: entry,
      }))
      .filter((t) => t.id !== '');
  }
  if (container && typeof container === 'object' && !Array.isArray(container)) {
    return Object.entries(container as Record<string, unknown>)
      .filter((e): e is [string, Record<string, unknown>] => typeof e[1] === 'object' && e[1] !== null)
      .map(([id, entry]) => ({
        id,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        rawEntry: entry,
      }));
  }
  return [];
}

async function writeTaskStatus(status: ParsedStatus): Promise<void> {
  const serialized = JSON.stringify(status.parsed, null, 2) + '\n';
  await writeFile(status.statusPath, serialized);
}

interface CommitInfo {
  sha: string;
  subject: string;
}

export interface CommitWithTrailers {
  sha: string;
  subject: string;
  trailers: Record<string, string[]>;
}

export interface EvidenceRangeResult {
  commits: CommitWithTrailers[];
  anomalies: string[];
  warnings: string[];
}

/**
 * Resolve the `origin/<default>` ref to evaluate evidence against.
 *
 * Ladder:
 *   1. `originDefaultBranch` — origin's default branch via
 *      `refs/remotes/origin/HEAD` (the authoritative source; never a guess).
 *   2. Probe `origin/main`, then `origin/master` via `rev-parse --verify`
 *      (migration aid for repos/CI checkouts that never set origin/HEAD).
 *   3. null — resolution failed; caller must fail closed, never assume `main`.
 */
async function resolveOriginRef(projectRoot: string): Promise<string | null> {
  const defaultBranch = await originDefaultBranch(makeGitRunner(projectRoot));
  if (defaultBranch) {
    return `origin/${defaultBranch}`;
  }

  for (const candidate of ['origin/main', 'origin/master']) {
    const check = await execa('git', ['rev-parse', '--verify', candidate], {
      cwd: projectRoot,
      reject: false,
    });
    if (check.exitCode === 0) return candidate;
  }

  return null;
}

/**
 * Get evidence range for a task, anchored to a plan SHA.
 *
 * Resolution ladder:
 *   1. A reachable explicit `anchor` is used as the lower bound directly.
 *   2. Otherwise, `merge-base --fork-point origin/<default> HEAD`.
 *   3. Otherwise, a plain `merge-base origin/<default> HEAD`.
 *   4. Otherwise, fail closed: zero commits + a logged anomaly.
 *
 * `origin/<default>` is derived (never hardcoded `origin/main`) via
 * `originDefaultBranch` (origin/HEAD), falling back to probing `origin/main`
 * then `origin/master`. If none resolve, this fails closed rather than
 * silently guessing `main`.
 *
 * All failures are logged but never thrown.
 *
 * @param projectRoot - Root of the git repository
 * @param anchor - Plan anchor SHA (required); commits before this are excluded
 * @returns EvidenceRangeResult with commits, anomalies, and warnings
 */
export async function getEvidenceRange(
  projectRoot: string,
  anchor: string,
): Promise<EvidenceRangeResult> {
  const logger = createEvidenceRangeLogger();
  const result: EvidenceRangeResult = {
    commits: [],
    anomalies: logger.anomalies,
    warnings: logger.warnings,
  };

  try {
    // Resolve origin's default branch ref (never a hardcoded origin/main).
    const originRef = await resolveOriginRef(projectRoot);

    if (!originRef) {
      const msg =
        'Evidence range: could not resolve origin default branch (origin/HEAD unset; origin/main and origin/master do not exist); returning zero commits (fail-closed)';
      logger.anomalies.push(msg);
      console.error(msg);
      return result;
    }

    let lowerBound: string | null = null;

    const runMergeBaseLadder = async (): Promise<string | null> => {
      // Try fork-point merge-base first, then plain merge-base.
      const forkPoint = await execa('git', ['merge-base', '--fork-point', originRef, 'HEAD'], {
        cwd: projectRoot,
        reject: false,
      });

      if (forkPoint.exitCode === 0 && forkPoint.stdout.trim()) {
        return forkPoint.stdout.trim();
      }

      const plainMergeBase = await execa('git', ['merge-base', originRef, 'HEAD'], {
        cwd: projectRoot,
        reject: false,
      });
      if (plainMergeBase.exitCode === 0 && plainMergeBase.stdout.trim()) {
        return plainMergeBase.stdout.trim();
      }

      return null;
    };

    if (anchor.trim() === '') {
      // No anchor was supplied; skip the reachability probe entirely (it
      // always fails on an empty string) and go straight to the merge-base
      // ladder without logging a spurious "unreachable" warning. Still
      // surface a routine informational line (not a warning/fault) so the
      // absence is visible rather than silent.
      const infoMsg =
        'Evidence range: no recorded anchor; deriving lower bound from merge-base ladder';
      console.info(infoMsg);

      lowerBound = await runMergeBaseLadder();
    } else {
      // First, verify that anchor is reachable
      const anchorCheck = await execa('git', ['rev-parse', '--verify', `${anchor}^{commit}`], {
        cwd: projectRoot,
        reject: false,
      });

      if (anchorCheck.exitCode === 0) {
        // Anchor is reachable, use it as lower bound
        lowerBound = anchor;
      } else {
        // Anchor is unreachable, fall back to merge-base
        const warningMsg = `Evidence range: anchor ${anchor.slice(0, 7)} is unreachable; falling back to merge-base`;
        logger.warnings.push(warningMsg);
        console.warn(warningMsg);

        lowerBound = await runMergeBaseLadder();
      }
    }

    if (!lowerBound) {
      const msg = `Evidence range: no valid lower bound resolvable against ${originRef}; returning zero commits (fail-closed)`;
      logger.anomalies.push(msg);
      console.error(msg);
      return result;
    }

    const range = `${lowerBound}..HEAD`;

    // Use %x1e (ASCII record separator) to delimit commits, since trailers can contain newlines
    const args = ['log', '--format=%H%x09%s%x00%(trailers)%x1e', range];

    const log = await execa('git', args, { cwd: projectRoot, reject: false });
    if (log.exitCode === 0 && typeof log.stdout === 'string') {
      result.commits = log.stdout
        .split('\x1e') // Split by record separator
        .map((record) => record.trim())
        .filter((record) => record.length > 0)
        .map((record) => {
          const nullIndex = record.indexOf('\x00');
          if (nullIndex < 0) return null;

          const metaPart = record.slice(0, nullIndex);
          const trailersPart = record.slice(nullIndex + 1);

          const tabIndex = metaPart.indexOf('\t');
          if (tabIndex < 0) return null;

          const sha = metaPart.slice(0, tabIndex);
          const subject = metaPart.slice(tabIndex + 1);

          const trailers = parseTrailers(trailersPart);

          return { sha, subject, trailers };
        })
        .filter((item): item is CommitWithTrailers => item !== null);
    }
  } catch (err) {
    // Catch any unexpected errors and log them
    const errMsg = `Evidence range: unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    logger.anomalies.push(errMsg);
    console.error(errMsg);
  }

  return result;
}

/**
 * List commits bounded to `origin/<default>..HEAD` when the origin default
 * branch resolves (via the same ladder as {@link getEvidenceRange}), or a
 * bounded local log (last 100 commits reachable from HEAD) when it does not
 * (e.g. no remote configured).
 */
export async function listCommits(projectRoot: string): Promise<CommitInfo[]> {
  const originRef = await resolveOriginRef(projectRoot);

  let range: string = 'HEAD';
  if (originRef) {
    const mergeBase = await execa('git', ['merge-base', originRef, 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    });

    if (mergeBase.exitCode === 0 && typeof mergeBase.stdout === 'string' && mergeBase.stdout.trim()) {
      range = `${mergeBase.stdout.trim()}..HEAD`;
    }
  }

  const args =
    range === 'HEAD'
      ? ['log', '-n', '100', '--format=%H%x09%s', 'HEAD']
      : ['log', '--format=%H%x09%s', range];

  const log = await execa('git', args, { cwd: projectRoot, reject: false });
  if (log.exitCode !== 0 || typeof log.stdout !== 'string') return [];

  return log.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      if (tab < 0) return { sha: line, subject: '' };
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

export async function listCommitsWithTrailers(
  projectRoot: string,
  anchor?: string,
): Promise<CommitWithTrailers[]> {
  // If anchor is provided, use the evidence range (fail-closed)
  if (anchor) {
    const range = await getEvidenceRange(projectRoot, anchor);
    return range.commits;
  }

  // No anchor provided: derive the origin default branch and use merge-base
  const defaultRef = await resolveOriginRef(projectRoot);
  const mergeBase = defaultRef
    ? await execa('git', ['merge-base', defaultRef, 'HEAD'], {
        cwd: projectRoot,
        reject: false,
      })
    : { exitCode: 1, stdout: '' };

  let range: string;
  if (mergeBase.exitCode === 0 && typeof mergeBase.stdout === 'string' && mergeBase.stdout.trim()) {
    range = `${mergeBase.stdout.trim()}..HEAD`;
  } else {
    range = 'HEAD';
  }

  // Use %x1e (ASCII record separator) to delimit commits, since trailers can contain newlines
  const args =
    range === 'HEAD'
      ? ['log', '-n', '100', '--format=%H%x09%s%x00%(trailers)%x1e', 'HEAD']
      : ['log', '--format=%H%x09%s%x00%(trailers)%x1e', range];

  const log = await execa('git', args, { cwd: projectRoot, reject: false });
  if (log.exitCode !== 0 || typeof log.stdout !== 'string') return [];

  return log.stdout
    .split('\x1e') // Split by record separator
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const nullIndex = record.indexOf('\x00');
      if (nullIndex < 0) return null;

      const metaPart = record.slice(0, nullIndex);
      const trailersPart = record.slice(nullIndex + 1);

      const tabIndex = metaPart.indexOf('\t');
      if (tabIndex < 0) return null;

      const sha = metaPart.slice(0, tabIndex);
      const subject = metaPart.slice(tabIndex + 1);

      const trailers = parseTrailers(trailersPart);

      return { sha, subject, trailers };
    })
    .filter((item): item is CommitWithTrailers => item !== null);
}

export interface DeriveCompletionResult {
  [taskId: string]: {
    completed: boolean;
    evidencedBy?: string;
    auditEntry?: string;
    status?: 'skipped' | 'completed';
    skipReason?: string;
  };
}

/**
 * Resolve a cited evidence-stamp sha through the rewrite map and confirm it
 * is a reachable ancestor of HEAD.
 *
 * Existence alone is too soft: a pruned/dangling sha that happens to still
 * resolve via a stale ref must not pass. A sha that was never a rewrite-map
 * key (unrelated/forged) resolves to itself via resolveThroughMap, so this
 * can never launder an off-branch citation.
 *
 * @param projectRoot - Root of the git repository
 * @param citedSha - The sha text cited in the evidence stamp (pre-rewrite)
 * @param rewriteMap - Persisted rewrite map (Task 9,
 *   adr-2026-07-12-rebase-evidence-stamp-translation.md) for translating
 *   shas moved by a sanctioned engine rebase
 * @returns The resolved sha if it exists and is an ancestor of HEAD, else null
 */
export async function stampShaReachable(
  projectRoot: string,
  citedSha: string,
  rewriteMap: Record<string, string>,
): Promise<string | null> {
  const sha = resolveThroughMap(citedSha, rewriteMap);

  // A failure to even invoke git, or a projectRoot that isn't a functioning
  // git repository at all (e.g. a stub .git dir in a test fixture), means
  // reachability is indeterminate, not refuted — fail open rather than
  // demoting on an environment/tooling hiccup unrelated to whether the cited
  // commit is actually gone from real history.
  let repoCheck;
  try {
    repoCheck = await execa('git', ['rev-parse', '--git-dir'], {
      cwd: projectRoot,
      reject: false,
    });
  } catch {
    return sha;
  }
  if (!repoCheck || typeof repoCheck.exitCode !== 'number' || repoCheck.exitCode !== 0) {
    return sha;
  }

  let shaCheck;
  try {
    shaCheck = await execa('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
      cwd: projectRoot,
      reject: false,
    });
  } catch {
    return sha;
  }
  if (!shaCheck || typeof shaCheck.exitCode !== 'number') {
    return sha;
  }

  let isAncestor = false;
  if (shaCheck.exitCode === 0) {
    const headCheck = await execa('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      reject: false,
    });
    if (headCheck.exitCode === 0) {
      const headSha = headCheck.stdout.trim();
      const ancestorCheck = await execa('git', ['merge-base', '--is-ancestor', sha, headSha], {
        cwd: projectRoot,
        reject: false,
      });
      isAncestor = ancestorCheck.exitCode === 0;
    }
  }

  if (shaCheck.exitCode === 0 && isAncestor) {
    return sha;
  }

  return null;
}

/**
 * Derive task completion from git trailers.
 * Trailer-first: checks for Task: <id> trailers in commit bodies.
 * Evidence forms: Evidence: satisfied-by <sha> and Evidence: skipped <reason>
 * Path corroboration: if task has paths, commit must touch at least one.
 * Sidecar writes: evidence stamps stored in task-evidence.json on completion.
 *
 * @param projectRoot - Root of the git repository
 * @param planPath - Path to the plan markdown file
 * @param anchor - Plan anchor SHA for evidence range
 * @param commits - CommitWithTrailers array (from listCommitsWithTrailers)
 * @param evidence - TaskEvidence instance for sidecar writes
 * @returns Map of task ID → {completed, evidencedBy?, auditEntry?, status?, skipReason?}
 */
async function deriveCompletionInternal(
  projectRoot: string,
  planPath: string,
  anchor: string,
  commits: CommitWithTrailers[],
  evidence: any, // TaskEvidence type from task-evidence.ts
): Promise<DeriveCompletionResult> {
  const result: DeriveCompletionResult = {};

  // Parse the plan to extract tasks and their file paths
  let planText: string;
  try {
    planText = await readFile(planPath, 'utf-8');
  } catch {
    return result;
  }

  // Task IDs are sourced from parsePlanTaskPaths (colon-optional header match)
  // rather than parsePlanTasks (colon-required), because plan headers written
  // as `### Task 1` (no colon/title) are valid and must still be derivable —
  // the loop body below never reads task name/paths from parsePlanTasks, only
  // the id, so parsePlanTaskPaths' more permissive header match is a safe and
  // more correct source of truth for "which task ids exist in this plan."
  const planPaths = parsePlanTaskPaths(planText);
  const planIds = new Set(planPaths.keys());

  for (const taskId of planPaths.keys()) {
    result[taskId] = { completed: false };

    // Look for Evidence: forms first (no-op commits). Scoped to THIS task:
    // the ADR's canonical no-op form is an empty commit carrying BOTH
    // `Task: <id>` and the `Evidence:` trailer — an unscoped Evidence commit
    // must never complete/skip every task in the plan.
    const evidenceCommit = commits.find((c) => {
      const taskTrailers = c.trailers['Task'] || [];
      if (!taskTrailerMatches(taskTrailers, taskId, planIds)) return false;
      const evidenceTrailers = c.trailers['Evidence'] || [];
      return evidenceTrailers.some((e) => e.startsWith(`satisfied-by `) || e.startsWith('skipped '));
    });

    if (evidenceCommit) {
      // Check for Evidence: satisfied-by form
      const satisfiedByTrailer = (evidenceCommit.trailers['Evidence'] || []).find((e) =>
        e.startsWith('satisfied-by '),
      );

      if (satisfiedByTrailer) {
        // Extract the sha from "satisfied-by <sha>" — this is the immutable
        // citation TEXT, never rewritten in place by a rebase.
        const citedSha = satisfiedByTrailer.slice('satisfied-by '.length).trim();

        // Resolve through the persisted rewrite map (Task 9,
        // adr-2026-07-12-rebase-evidence-stamp-translation.md): a sanctioned
        // engine rebase may have moved the cited commit to a new sha. A sha
        // that was never a rewrite-map key (unrelated/forged) resolves to
        // itself, so this can never launder an off-branch citation.
        const rewriteMap = await loadRewriteMap(projectRoot);
        const sha = resolveThroughMap(citedSha, rewriteMap);

        // Validate the (resolved) sha both exists AND is an ancestor of
        // HEAD — existence alone is too soft: a pruned/dangling sha that
        // happens to still resolve via a stale ref must not pass.
        const reachableSha = await stampShaReachable(projectRoot, citedSha, rewriteMap);

        if (reachableSha) {
          // Valid sha: mark task completed
          result[taskId].completed = true;
          result[taskId].evidencedBy = reachableSha;
          result[taskId].status = 'completed';
          evidence.evidenceStamps.set(taskId, {
            sha: reachableSha,
            form: 'evidence:satisfied-by',
          });
          continue;
        }

        // Dangling sha: log audit entry, but do NOT terminally reject the
        // task (#548/#535 stale-SHA variant) — fall through to trailer-based
        // derivation below, which may find another satisfying candidate.
        result[taskId].auditEntry = `Task ${taskId}: Evidence: satisfied-by ${sha.slice(0, 7)} is dangling (unreachable SHA)`;
        console.warn(
          `[autoheal] Task ${taskId}: dangling satisfied-by sha ${sha.slice(0, 7)}`,
        );
      } else {
        // Check for Evidence: skipped form
        const skippedTrailer = (evidenceCommit.trailers['Evidence'] || []).find((e) =>
          e.startsWith('skipped '),
        );

        if (skippedTrailer) {
          // Extract the reason from "skipped <reason>"
          const reason = skippedTrailer.slice('skipped '.length).trim();
          result[taskId].status = 'skipped';
          result[taskId].skipReason = reason;
          result[taskId].completed = false;
          evidence.evidenceStamps.set(taskId, {
            sha: evidenceCommit.sha,
            form: 'evidence:skipped',
          });
          continue;
        }
      }
    }

    // Collect ALL commits carrying a matching Task: <taskId> trailer (#548).
    // A single-candidate `find` here (newest-first git order) let a follow-up
    // commit — e.g. a test-fix reusing the trailer — shadow an earlier
    // feature commit that DOES overlap the plan's declared paths, terminally
    // rejecting an evidenced task. Correct semantics: a task is corroborated
    // if ANY reachable trailered commit satisfies the path check.
    const matchingCommits = commits.filter((c) => {
      const taskTrailers = c.trailers['Task'] || [];
      return taskTrailerMatches(taskTrailers, taskId, planIds);
    });

    if (matchingCommits.length === 0) {
      // No current evidence found; check if task has a pinned evidence stamp in sidecar
      if (evidence.evidenceStamps.has(taskId)) {
        const stamp = evidence.evidenceStamps.get(taskId);
        const pinRewriteMap = await loadRewriteMap(projectRoot);
        const reachableSha = stamp
          ? await stampShaReachable(projectRoot, stamp.sha, pinRewriteMap)
          : null;

        if (reachableSha) {
          // Task was previously completed and evidenced, and the cited
          // commit is still reachable (or was rewrite-translated to a
          // reachable one): preserve that status to prevent demotion.
          result[taskId].completed = true;
          result[taskId].status = 'completed';
          result[taskId].evidencedBy = reachableSha;
          warnOnce(
            `${projectRoot}:demotion:${taskId}:${stamp?.sha ?? ''}`,
            `[autoheal] Task ${taskId}: no current evidence in history but sidecar has evidence stamp (pinned completed); preventing demotion`,
          );
          continue;
        }

        // Stamp's cited commit is gone and was never rewrite-translated to a
        // reachable sha — do NOT pin. Demote loudly so the task re-runs
        // instead of wedging into an uncreditable-undemotable state (#766).
        const demotionEntry = `Task ${taskId}: sidecar stamp cites unreachable commit ${stamp?.sha.slice(0, 7)} (no rebase translation); demoted`;
        result[taskId].auditEntry = result[taskId].auditEntry
          ? `${result[taskId].auditEntry}; ${demotionEntry}`
          : demotionEntry;
        warnOnce(
          `${projectRoot}:unreachable-demotion:${taskId}:${stamp?.sha ?? ''}`,
          `[autoheal] Task ${taskId}: sidecar evidence stamp cites unreachable commit ${stamp?.sha.slice(0, 7)}; demoting (task will re-run)`,
        );
        continue;
      }
      continue;
    }

    const taskPaths = planPaths.get(taskId);
    const hasPlanFiles = !!(taskPaths && taskPaths.size > 0);

    // Iterate the candidate SET (newest first). Accept the first candidate
    // that satisfies: non-empty AND (no declared plan paths OR path overlap).
    // Empty candidates are skipped, not terminal: an empty diff also covers
    // the stale/unreachable-SHA variant (#535 adjacent) because
    // filesForCommit returns [] when git cannot resolve the sha — such
    // candidates must never mask a reachable satisfying one.
    let satisfyingSha: string | null = null;
    let satisfyingForm: string = 'trailer';
    let newestNonEmpty: { sha: string; files: string[] } | null = null;
    let dirnameSha: string | null = null;
    for (const candidate of matchingCommits) {
      const filesInCommit = await filesForCommit(projectRoot, candidate.sha);
      if (filesInCommit.length === 0) continue;
      if (!newestNonEmpty) newestNonEmpty = { sha: candidate.sha, files: filesInCommit };

      if (!hasPlanFiles) {
        // Task has no specific paths; trailer alone is enough
        satisfyingSha = candidate.sha;
        satisfyingForm = 'trailer';
        break;
      }

      const match = corroborationMatch(filesInCommit, taskPaths!);
      if (match === 'exact-suffix') {
        // Exact/suffix matches always outrank a dirname match — scan the
        // full candidate set for one before settling for the weaker form.
        satisfyingSha = candidate.sha;
        satisfyingForm = 'trailer';
        break;
      }
      if (match === 'dirname' && !dirnameSha) {
        // Remember the first (newest) dirname hit, but keep scanning the
        // rest of the candidate set for a stronger exact-suffix match.
        dirnameSha = candidate.sha;
      }
    }

    if (!satisfyingSha && dirnameSha) {
      satisfyingSha = dirnameSha;
      satisfyingForm = 'trailer-dirname';
    }

    if (satisfyingSha) {
      result[taskId].completed = true;
      result[taskId].status = 'completed';
      result[taskId].evidencedBy = satisfyingSha;
      evidence.evidenceStamps.set(taskId, { sha: satisfyingSha, form: satisfyingForm });
      continue;
    }

    if (!newestNonEmpty) {
      // Every candidate was empty (or unreachable): trailer-only empty
      // commits without an Evidence: form do not complete tasks. Append to
      // (never overwrite) an earlier audit entry — e.g. a dangling
      // satisfied-by note from the fall-through above.
      const emptyEntry = `Task ${taskId}: empty commit with Task: trailer but no Evidence: form (incomplete)`;
      result[taskId].auditEntry = result[taskId].auditEntry
        ? `${result[taskId].auditEntry}; ${emptyEntry}`
        : emptyEntry;
      continue;
    }

    // No candidate overlapped: a semantic-verified evidence stamp (judge
    // lane) outranks the trailer/path-overlap heuristic — the judge has
    // already confirmed intent against the actual diff.
    const stamp = evidence.evidenceStamps.get(taskId);
    if (stamp?.form === 'semantic-verified') {
      result[taskId].completed = true;
      result[taskId].status = 'completed';
      result[taskId].evidencedBy = stamp.sha;
      continue;
    }

    // Path mismatch across ALL candidates: log audit entry (report the
    // newest non-empty candidate, as before), appending to — never
    // overwriting — any earlier entry (e.g. dangling satisfied-by note)
    const mismatchEntry = `Task ${taskId}: trailer found but no path overlap. Commit ${newestNonEmpty.sha.slice(0, 7)} touched [${newestNonEmpty.files.slice(0, 3).join(', ')}...] but expected paths like [${Array.from(taskPaths!).slice(0, 3).join(', ')}...]`;
    result[taskId].auditEntry = result[taskId].auditEntry
      ? `${result[taskId].auditEntry}; ${mismatchEntry}`
      : mismatchEntry;
    warnOnce(
      `${projectRoot}:pathcorr:${taskId}:${newestNonEmpty.sha}`,
      `[autoheal] Path corroboration failed for task ${taskId}: trailer ${newestNonEmpty.sha.slice(0, 7)} has no overlap with plan paths`,
    );
  }

  // Write evidence to sidecar
  await evidence.write();

  return result;
}

/**
 * PUBLIC API: Derive task completion from git evidence.
 *
 * Two call forms, one behavior:
 *  - `deriveCompletion(root, planPath)` — gate/engine form: resolves the plan
 *    anchor, evidence-range commits, and the sidecar itself (H7 per-gate
 *    derive), then derives.
 *  - `deriveCompletion(root, planPath, anchor, commits, evidence)` — explicit
 *    form (tests, hook feedback path): callers supply the pieces.
 *
 * Returns the FULL per-task map — an entry for EVERY plan task, including
 * incomplete (`completed: false`), audit entries for near-misses, and
 * `status: 'skipped'` rows from `Evidence: skipped` no-op commits. Callers
 * that only care about positives filter on `.completed`; discarding the
 * negative/skip information here is what previously hid H5's skip form from
 * the write-back entirely.
 */
export async function deriveCompletion(
  projectRoot: string,
  planPath: string,
  anchorArg?: string,
  commitsArg?: CommitWithTrailers[],
  evidenceArg?: { evidenceStamps: Map<string, { sha: string; form: string }>; write(): Promise<void> },
): Promise<DeriveCompletionResult> {
  // No explicit anchor: pass '' to getEvidenceRange so its resolution ladder
  // (rung 1: explicit anchor, rung 2+: branch base derivation) determines
  // the evidence range boundary. Previously this shelled out to git log to
  // find the repo's first (genesis) commit and used that as the anchor,
  // which meant every gate evaluation saw the FULL repo history instead of
  // just the current branch's commits (#456).
  const anchor = anchorArg ?? '';

  const commits = commitsArg ?? (await getEvidenceRange(projectRoot, anchor)).commits;

  let evidence = evidenceArg;
  if (!evidence) {
    const { createTaskEvidence } = await import('./task-evidence.js');
    evidence = await createTaskEvidence(projectRoot);
  }

  return deriveCompletionInternal(projectRoot, planPath, anchor, commits, evidence);
}

/**
 * Apply a deriveCompletion() result to .pipeline/task-status.json.
 *
 * This is the write-back half of the engine-owned task-status contract: derive
 * only computes fresh completion from git evidence + the task-evidence sidecar
 * (evidence stamping happens inside deriveCompletion itself); this function is
 * what actually flips a still-"pending" row to "completed" on disk so the build
 * gate's raw-row check (CUSTOM_COMPLETION_PREDICATES.build) sees it.
 *
 * After processing derived hits on pending rows, reconciles non-terminal rows
 * (in_progress, pending) that have evidence stamps from prior passes. This ensures
 * stamped rows are never missed (issue #526).
 *
 * Returns an AutoHealResult (healed/skipped) so callers can keep emitting the
 * existing `auto_heal` event shape without caring that the underlying engine
 * (attemptAutoHeal's commit-matching heuristic vs. deriveCompletion's trailer/
 * evidence derivation) changed.
 */
export async function applyDerivedCompletion(
  projectRoot: string,
  derived: DeriveCompletionResult,
): Promise<AutoHealResult> {
  const result: AutoHealResult = { healed: [], skipped: [] };
  try {
    const status = await readTaskStatus(projectRoot);
    if (!status) return result;

    const pendingTasks = status.tasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length > 0) {
      let wroteAnything = false;
      for (const task of pendingTasks) {
        const hit = derived[task.id];
        if (hit?.status === 'skipped') {
          // H5: `Evidence: skipped <reason>` no-op commits mark the row skipped
          // (gate-acceptable) — previously dropped entirely by the write-back,
          // leaving skip-evidenced tasks pending forever.
          task.rawEntry.status = 'skipped';
          if (hit.skipReason) task.rawEntry.skip_reason = hit.skipReason;
          wroteAnything = true;
          continue;
        }
        if (!hit?.completed) {
          result.skipped.push({ taskId: task.id, reason: 'no derived evidence' });
          continue;
        }
        task.rawEntry.status = 'completed';
        if (hit.evidencedBy) {
          task.rawEntry.commit = hit.evidencedBy.slice(0, 7);
        }
        wroteAnything = true;
        result.healed.push({
          taskId: task.id,
          commit: hit.evidencedBy ? hit.evidencedBy.slice(0, 7) : '',
          subject: '',
          matchedFiles: [],
        });
      }

      if (wroteAnything) {
        await writeTaskStatus(status);
      }
    }

    // After processing derived hits, reconcile rows with evidence stamps (#526).
    // This handles in_progress and other non-terminal rows that have stamps
    // from prior passes and would otherwise be missed.
    try {
      const reconcileResult = await reconcileStatusFromStamps(projectRoot);
      // Add reconciled task IDs to the auto_heal result
      for (const taskId of reconcileResult.synced) {
        result.healed.push({
          taskId,
          commit: '',
          subject: '',
          matchedFiles: [],
        });
      }
    } catch {
      // reconcileStatusFromStamps is fail-soft, but in case it throws,
      // catch and continue without disturbing the result
    }

    await writeAuditFile(projectRoot, result);
    return result;
  } catch {
    return result;
  }
}

export function parseTrailers(trailerText: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  if (!trailerText || trailerText.trim().length === 0) {
    return result;
  }

  const lines = trailerText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "Key: value" format (with space after colon)
    // Keys must be alphanumeric, hyphens allowed
    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2];

    // Only capture Task and Evidence trailers
    if (key !== 'Task' && key !== 'Evidence') continue;

    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(value);
  }

  return result;
}

export async function filesForCommit(projectRoot: string, sha: string): Promise<string[]> {
  const out = await execa('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', sha], {
    cwd: projectRoot,
    reject: false,
  });
  if (out.exitCode !== 0 || typeof out.stdout !== 'string') return [];
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readPlanPaths(
  projectRoot: string,
  planRef: string | undefined,
): Promise<Map<string, Set<string>>> {
  const empty = new Map<string, Set<string>>();
  if (!planRef) return empty;
  const planPath = resolvePlanPath(projectRoot, planRef);
  let text: string;
  try {
    text = await readFile(planPath, 'utf-8');
  } catch {
    return empty;
  }
  return parsePlanTaskPaths(text);
}

function resolvePlanPath(projectRoot: string, planRef: string): string {
  const trimmed = planRef.trim();
  const withExt = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (withExt.startsWith('/')) return withExt;
  if (withExt.startsWith('.docs/') || withExt.startsWith('./')) {
    return join(projectRoot, withExt);
  }
  return join(projectRoot, '.docs/plans', withExt);
}

const PATH_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yml|yaml|sh|rb|py|go|rs|html|css|scss|vue|toml)$/i;
const BACKTICK_TOKEN = /`([^`\s]+)`/g;

/**
 * Canonical task-id key (#636).
 *
 * Folds a leading `T`/`t` that is immediately followed by a digit down to the
 * bare numeric form, so a plan's `### T<N>` header, a `Task: T<N>` commit
 * trailer, an evidence stamp keyed `T<N>`, and a bare `<N>` row/trailer all
 * resolve to ONE task. Non-T ids (`task-7`, `rem-adr-001`, `A8`) and a bare
 * `T`/`Task` word (no following digit) are returned unchanged — the fold is
 * scoped to the `T<digits>` shorthand only.
 *
 * This is the alias seam that repairs the #615 id-grammar drift: #615 widened
 * the header regex to accept `### T<N> —` but normalized it to a bare number,
 * stranding the T-prefixed rows/trailers/stamps that predate it (the #417
 * evidence-gate id-grammar class). The parsers now emit the id AS WRITTEN
 * (keeping the T), and every comparison seam folds through this function so
 * both grammars match the same task.
 */
export function canonicalTaskId(id: string): string {
  return id.replace(/^[Tt](?=\d)/, '');
}

/**
 * Fast-feedback, single-commit evidence check (ADR post-landing amendment:
 * post-commit-derive-feedback.sh invokes this via the `derive-feedback`
 * CLI dispatch instead of a bare bash regex). Advisory only — never writes
 * task-status.json or the evidence sidecar; a plain read-only check of
 * whether the given commit carries a `Task: <id>` trailer matching the H9
 * grammar, with a path-fallback: if the commit has no Task trailer at all,
 * check whether its changed files overlap any task's plan-declared paths
 * (best-effort; plan may not exist yet, e.g. very early in a project).
 */
export async function checkCommitEvidence(
  projectRoot: string,
  sha: string,
  planPath?: string,
): Promise<{ evidenced: boolean; taskId?: string; reason: 'trailer' | 'path-fallback' | 'none' }> {
  const show = await execa('git', ['show', '-s', '--format=%B', sha], {
    cwd: projectRoot,
    reject: false,
  });
  const message = show.exitCode === 0 && typeof show.stdout === 'string' ? show.stdout : '';
  const taskTrailerLine = message
    .split('\n')
    .find((l) => new RegExp(`^Task: (${TASK_ID_PATTERN})$`).test(l.trim()));

  if (taskTrailerLine) {
    const match = taskTrailerLine.trim().match(new RegExp(`^Task: (${TASK_ID_PATTERN})$`));
    return { evidenced: true, taskId: match?.[1], reason: 'trailer' };
  }

  // Path-fallback: no Task trailer present. If a plan is available, see
  // whether this commit's changed files overlap any task's declared paths —
  // that still counts as (weak) evidence for fast feedback purposes.
  if (planPath) {
    try {
      const planText = await readFile(planPath, 'utf-8');
      const planPaths = parsePlanTaskPaths(planText);
      const changedFiles = await filesForCommit(projectRoot, sha);
      for (const [taskId, paths] of planPaths.entries()) {
        const overlap = filesOverlappingTaskPaths(changedFiles, paths);
        if (overlap.length > 0) {
          return { evidenced: true, taskId, reason: 'path-fallback' };
        }
      }
    } catch {
      // No plan yet, or unreadable — fall through to "none".
    }
  }

  return { evidenced: false, reason: 'none' };
}

export interface PlanTask {
  name: string;
  paths: string[];
}

export function parsePlanTasks(text: string): Map<string, PlanTask> {
  const result = new Map<string, PlanTask>();
  const lines = text.split('\n');
  let currentTaskId: string | null = null;

  // Match: ### Task ID: Title (or ### Task ID — Title with em/en-dash), or
  // the bare `### T<N> — Title` shorthand (no "Task" word — a real plan,
  // `2026-07-12-rtk-hook-preservation.md`, used this form with ids starting
  // at T0, and it parsed to zero tasks under the old "Task"-only regex →
  // false `empty/missing plan` auto-park of a completed build, #578).
  // Supports numeric (1, 18, 100), dotted (1.2), alphanumeric with separators (task_1, rem-adr-001)
  // Terminator accepts a colon or a whitespace-preceded em-dash/en-dash separator
  // (the authoring convention: `### Task N — Title`)
  // The T<N> alternative captures WITH the leading `T` (`### T1` → `T1`, not
  // `1`) so the emitted id matches the plan header verbatim and the
  // pre-existing T-prefixed task-status rows / `Task: T<N>` trailers / evidence
  // stamps (#636). Cross-grammar matching (`Task: 1` ↔ `T1`) is handled at the
  // comparison seams via canonicalTaskId, not by mangling the id here.
  const taskHeader = new RegExp(
    `^#{1,6}\\s+(?:Task\\s+(${TASK_ID_PATTERN})|(T\\d[A-Za-z0-9._-]*))(?::\\s+|\\s+[—–]\\s+)(.+)$`,
  );

  for (const line of lines) {
    const headerMatch = line.match(taskHeader);
    if (headerMatch) {
      const id = headerMatch[1] ?? headerMatch[2];
      const name = headerMatch[3].trim();
      currentTaskId = id;
      result.set(id, { name, paths: [] });
      continue;
    }

    if (!currentTaskId) continue;

    // Extract paths from backtick-delimited tokens
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_TOKEN.exec(line)) !== null) {
      const token = m[1];
      if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
      const normalized = token.replace(/^\.\//, '');
      if (!normalized || normalized.startsWith('-')) continue;
      const task = result.get(currentTaskId);
      if (task && !task.paths.includes(normalized)) {
        task.paths.push(normalized);
      }
    }
  }

  return result;
}

// `**Verify-only:** yes` marker line (verify-only-prove-closed-task-evidence
// plan, Task 1). Exact-match "yes" (case-insensitive) only — "maybe", empty,
// or any other value is fail-closed false, same as an absent marker.
const VERIFY_ONLY_LINE = /^\s*(?:[-*]\s+)?\*\*Verify-only\s*:?\s*\*\*\s*:?\s*(.*)$/i;

// `**Type:**` marker line (no-diff-task-evidence-stamp plan, Task 2). Union
// semantics with VERIFY_ONLY_LINE: a task is verify-only-eligible if EITHER
// marker is present. The value is split on `+` into tokens; only an exact
// (trimmed, case-insensitive) token match of "verification" counts — a
// substring match would false-positive on values like "verification-only" or
// "preverification", so this stays fail-closed.
const TYPE_LINE = /^\s*(?:[-*]\s+)?\*\*Type\s*:?\s*\*\*\s*:?\s*(.*)$/i;

/**
 * Parses per-task-block verify-only-eligibility markers
 * (verify-only-prove-closed-task-evidence plan, Task 1; extended by
 * no-diff-task-evidence-stamp plan, Task 2). A task is eligible (`true`) if
 * EITHER: its block has a `**Verify-only:** yes` marker (exact-match "yes",
 * case-insensitive; "maybe", empty, or missing resolve to false), OR its
 * block has a `**Type:**` line whose `+`-split values include the exact
 * token "verification" (case-insensitive). A standalone sibling of
 * `parsePlanTaskPaths` — it does NOT alter that function's existing
 * `Map<string, Set<string>>` shape/behavior, so every current consumer is
 * unaffected.
 */
export function parsePlanTaskVerifyOnly(text: string): Map<string, boolean> {
  const taskHeader =
    /^#{1,6}\s+(?:Task\s+([A-Za-z0-9._,\s-]+?)(?::|\s[—–])|Task\s+([A-Za-z._,-]*\d[A-Za-z0-9._,-]*)\s*$|(T\d[A-Za-z0-9._,\s-]*?)(?::|\s[—–])|(T\d[A-Za-z0-9._,-]*)\s*$)/;

  const result = new Map<string, boolean>();
  let currentIds: string[] = [];

  for (const line of text.split('\n')) {
    const headerMatch = line.match(taskHeader);
    if (headerMatch) {
      currentIds = expandTaskIds(
        headerMatch[1] ?? headerMatch[2] ?? headerMatch[3] ?? headerMatch[4],
      );
      for (const id of currentIds) {
        if (!result.has(id)) result.set(id, false);
      }
      continue;
    }
    if (currentIds.length === 0) continue;

    const verifyOnlyMatch = line.match(VERIFY_ONLY_LINE);
    if (verifyOnlyMatch) {
      const isYes = verifyOnlyMatch[1].trim().toLowerCase() === 'yes';
      if (isYes) {
        for (const id of currentIds) result.set(id, true);
      }
    }

    const typeMatch = line.match(TYPE_LINE);
    if (typeMatch) {
      const tokens = typeMatch[1].split('+').map((token) => token.trim().toLowerCase());
      if (tokens.includes('verification')) {
        for (const id of currentIds) result.set(id, true);
      }
    }
  }

  return result;
}

function expandTaskIds(raw: string): string[] {
  const ids: string[] = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;

    // Try numeric range expansion only for numeric ids (e.g., 1-3)
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let n = start; n <= end; n++) ids.push(String(n));
    } else if (new RegExp(`^${TASK_ID_PATTERN}$`).test(trimmed)) {
      // Accept any id matching the TASK_ID_PATTERN (numeric, dotted, hyphenated, underscore)
      ids.push(trimmed);
    }
  }
  return ids;
}

interface CommitMatch {
  commit: string;
  subject: string;
  matchedFiles: string[];
}

async function findMatchingCommit(
  projectRoot: string,
  task: TaskRecord,
  commits: CommitInfo[],
  planPaths: Map<string, Set<string>>,
): Promise<CommitMatch | null> {
  const taskPaths = planPaths.get(task.id);
  const hasPlanFiles = !!(taskPaths && taskPaths.size > 0);

  for (const commit of commits) {
    const { idMatch, nameMatch } = matchSubject(commit.subject, task);
    if (!idMatch && !nameMatch) continue;

    if (!hasPlanFiles) {
      if (!(idMatch && nameMatch)) continue;
      return { commit: commit.sha, subject: commit.subject, matchedFiles: [] };
    }

    const files = await filesForCommit(projectRoot, commit.sha);
    const overlap = filesOverlappingTaskPaths(files, taskPaths!);
    if (overlap.length === 0) continue;
    return { commit: commit.sha, subject: commit.subject, matchedFiles: overlap };
  }

  return null;
}

function matchSubject(subject: string, task: TaskRecord): { idMatch: boolean; nameMatch: boolean } {
  // #636: canonicalize the id before prefixing `T`/`#`, so a T-prefixed row id
  // (`T1`) yields a `T1` subject probe rather than `TT1`. Both the raw and the
  // canonical form are accepted, so `### T1`-derived rows and bare `1` rows
  // both match a `T1`/`#1` mention in the subject line.
  const canonicalId = canonicalTaskId(task.id);
  const idRe = new RegExp(`(?:^|[^0-9A-Za-z])(?:T${escapeRegex(canonicalId)}|#${escapeRegex(canonicalId)})(?![0-9A-Za-z])`);
  const idMatch = idRe.test(subject);

  let nameMatch = false;
  if (task.name && task.name.trim().length > 0) {
    const name = task.name.trim();
    if (name.length < 12) {
      const wordRe = new RegExp(`(?:^|\\W)${escapeRegex(name)}(?:\\W|$)`, 'i');
      nameMatch = wordRe.test(subject);
    } else {
      nameMatch = subject.toLowerCase().includes(name.toLowerCase());
    }
  }
  return { idMatch, nameMatch };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeAuditFile(projectRoot: string, result: AutoHealResult): Promise<void> {
  const dir = join(projectRoot, '.pipeline', 'audit-trail');
  await mkdir(dir, { recursive: true }).catch(() => {});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `autoheal-${stamp}.json`);
  await writeFile(path, JSON.stringify(result, null, 2) + '\n').catch(() => {});
}

/**
 * Synchronize non-terminal rows in task-status.json with evidence stamps.
 *
 * For each task with an evidence stamp in .pipeline/task-evidence.json:
 * - If the row status is NOT terminal (completed/skipped): advance to completed
 * - Set row.commit to the 7-char short SHA from the stamp
 * - Terminal rows (completed/skipped) are left byte-identical, never touched
 * - Rows without evidence stamps are never touched
 *
 * Orphan stamp handling (Task 2):
 * - Stamps with no matching row are tracked but never create rows
 * - Each orphan stamp ID emits exactly ONE console.warn with prefix "[task-evidence]"
 *
 * Missing/corrupt file safety (Task 2):
 * - Wraps body in try-catch, returns empty results on error (fail-soft)
 * - No exceptions thrown; operates fail-closed on missing/corrupt files
 *
 * Returns synced task IDs and orphanStamps (stamp IDs with no matching row).
 * Only writes to disk if something changed.
 *
 * Task: 1, 2 (evidence-stamp sync + orphan handling + safety)
 */
export async function reconcileStatusFromStamps(
  projectRoot: string,
): Promise<{ synced: string[]; orphanStamps: string[] }> {
  const result = { synced: [] as string[], orphanStamps: [] as string[] };

  try {
    // Load current task-status.json
    const status = await readTaskStatus(projectRoot);
    if (!status) return result;

    // Load evidence stamps
    const { createTaskEvidence } = await import('./task-evidence.js');
    const evidence = await createTaskEvidence(projectRoot);

    if (evidence.evidenceStamps.size === 0) return result;

    let wroteAnything = false;
    const stampIdsWithMatches = new Set<string>();

    // For each evidence stamp, try to advance the matching task row
    for (const [taskId, stamp] of evidence.evidenceStamps.entries()) {
      // Find the matching task row. #636: match under the canonical id fold so
      // a bare-keyed stamp (`3`) advances a T-prefixed row (`T3`) and vice
      // versa — the two grammars name the same task.
      const canonicalStampId = canonicalTaskId(taskId);
      const task =
        status.tasks.find((t) => t.id === taskId) ??
        status.tasks.find((t) => canonicalTaskId(t.id) === canonicalStampId);
      if (!task) continue; // No row for this stamp — will be tracked as orphan later

      stampIdsWithMatches.add(taskId);

      // Skip terminal rows (never touch them)
      if (task.status === 'completed' || task.status === 'skipped') continue;

      // Advance non-terminal row to completed
      task.rawEntry.status = 'completed';

      // Set commit to the 7-char short SHA
      if (stamp.sha) {
        task.rawEntry.commit = stamp.sha.slice(0, 7);
      }

      // Report the matched ROW id (the plan-grammar id) so callers surface the
      // canonical task, not the stamp's incidental grammar.
      result.synced.push(task.id);
      wroteAnything = true;
    }

    // Track orphan stamps (stamps with no matching row)
    for (const stampId of evidence.evidenceStamps.keys()) {
      if (!stampIdsWithMatches.has(stampId)) {
        result.orphanStamps.push(stampId);
        console.warn(`[task-evidence] stamp for unknown task id ${stampId}`);
      }
    }

    // Only write if something changed
    if (wroteAnything) {
      await writeTaskStatus(status);
    }

    return result;
  } catch {
    // Fail-soft: log error and return empty results without throwing
    return result;
  }
}

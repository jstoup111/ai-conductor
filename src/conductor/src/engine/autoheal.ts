import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execa } from 'execa';
import { originDefaultBranch, makeGitRunner } from './rebase.js';
// Relocated shared utilities (H9 id grammar + plan-task-paths parser) — see
// plan-task-parse.ts for the rationale. Task 1's temporary re-export here was
// dropped (feature #773, Task 11): the only remaining consumers were the now-
// deleted derivation engine and its tests; all other callers import directly
// from plan-task-parse.ts.
import { TASK_ID_PATTERN, parsePlanTaskPaths } from './plan-task-parse.js';

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


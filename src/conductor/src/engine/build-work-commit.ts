import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { withDaemonCoAuthorTrailer } from './bot-co-author.js';
import { commitEngineChangeWhenStacked } from './guarded-engine-commit.js';
import { TASK_ID_PATTERN } from './plan-task-parse.js';
import type { GitRunner } from './pr-labels.js';
import { isProtectedArtifactPath } from './protected-artifact-seal.js';
import { normalizeTasks } from './task-progress.js';

export interface UncommittedBuildWorkCommitInput {
  projectRoot: string;
  git: GitRunner;
  /** Dirty paths as the completion probe reported them (porcelain, renames by destination). */
  paths: readonly string[];
  attempt: number;
  /** Feature slug; a feature with durable stacked-child state commits through the restack fence. */
  slug?: string;
}

/**
 * The outcome of the engine's attempt to preserve a settled BUILD attempt's
 * uncommitted work. `taskIds` is the attribution the commit carried (or would
 * have carried), so a failure record still names the tasks involved.
 */
export type UncommittedBuildWorkCommitResult =
  { kind: 'committed'; sha: string; taskIds: string[] } | { kind: 'failed'; reason: string; taskIds: string[] };

export const ENGINE_BUILD_COMMIT_FAILURE_PREFIX = 'engine commit of uncommitted BUILD work failed:';

const TASK_ID = new RegExp(`^${TASK_ID_PATTERN}$`);

/**
 * The tasks a settled BUILD attempt was working, as the builder itself
 * declared them: the `.pipeline/current-task` stamp written by `task start`,
 * plus every `in_progress` row in `.pipeline/task-status.json`. The engine
 * never infers attribution from touched paths — a guessed trailer would
 * resolve a task nobody finished, and an unattributed commit merely leaves
 * the task pending for the next attempt (adr-2026-08-03 D10).
 */
export async function resolveActiveBuildTaskIds(projectRoot: string): Promise<string[]> {
  const ids: string[] = [];
  const stamped = await readFile(join(projectRoot, '.pipeline', 'current-task'), 'utf8')
    .then((raw) => raw.trim())
    .catch(() => '');
  if (stamped && TASK_ID.test(stamped)) ids.push(stamped);

  const status = await readFile(join(projectRoot, '.pipeline', 'task-status.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => undefined);
  for (const task of normalizeTasks(status)) {
    if (task.status !== 'in_progress' || task.id === undefined) continue;
    if (!TASK_ID.test(task.id) || ids.includes(task.id)) continue;
    ids.push(task.id);
  }
  return ids;
}

function failureText(error: unknown): string {
  if (error && typeof error === 'object') {
    const { stderr, shortMessage, message } = error as { stderr?: unknown; shortMessage?: unknown; message?: unknown };
    for (const candidate of [stderr, shortMessage, message]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return String(error);
}

/**
 * Commit the work a `completed` BUILD attempt left in its worktree, under the
 * same gates a builder's own `git commit` faces: no `--force` add, no
 * `--no-verify`, no engine-commit hook exemption. Run state under `.pipeline/`
 * is never staged, and a protected DECIDE artifact refuses the whole commit
 * rather than being smuggled past the pre-commit seal. The commit preserves
 * work; it asserts nothing — downstream gates re-verify independently.
 */
export async function commitUncommittedBuildWork(
  input: UncommittedBuildWorkCommitInput,
): Promise<UncommittedBuildWorkCommitResult> {
  const taskIds = await resolveActiveBuildTaskIds(input.projectRoot);
  const fail = (reason: string): UncommittedBuildWorkCommitResult => ({
    kind: 'failed',
    reason: `${ENGINE_BUILD_COMMIT_FAILURE_PREFIX} ${reason}`,
    taskIds,
  });

  const committable = input.paths.filter((path) => path !== '.pipeline' && !path.startsWith('.pipeline/'));
  if (committable.length === 0) return fail('every uncommitted path is run state under .pipeline/');
  const protectedPaths = committable.filter(isProtectedArtifactPath);
  if (protectedPaths.length > 0) {
    return fail(`protected artifact path(s) cannot be committed by BUILD: ${protectedPaths.join(', ')}`);
  }

  const noun = committable.length === 1 ? 'path' : 'paths';
  const message = withDaemonCoAuthorTrailer(
    [
      `build: commit work left uncommitted by BUILD attempt ${input.attempt}`,
      '',
      `Engine-owned commit of ${committable.length} ${noun} the settled build attempt did not commit.`,
      'Downstream gates re-verify this work independently; the commit preserves it, nothing more.',
      ...(taskIds.length === 0 ? [] : ['', ...taskIds.map((id) => `Task: ${id}`)]),
    ].join('\n'),
  );

  // A feature that has entered the durable stacked-child lifecycle must not
  // race a restack move; its commit goes through the journal-fenced helper.
  if (input.slug !== undefined) {
    const guarded = await commitEngineChangeWhenStacked({
      worktree: input.projectRoot,
      slug: input.slug,
      pathspec: committable,
      message,
    });
    if (guarded !== undefined) {
      if (guarded.kind === 'written') return { kind: 'committed', sha: guarded.sha, taskIds };
      if (guarded.kind === 'noop') return fail('the dirty paths staged no change');
      return fail(guarded.reason);
    }
  }

  const run = async (args: string[]): Promise<string> => (await input.git(args, { cwd: input.projectRoot })).stdout;
  try {
    await run(['add', '--', ...committable]);
  } catch (error) {
    return fail(`git add: ${failureText(error)}`);
  }
  try {
    await run(['commit', '-m', message]);
  } catch (error) {
    return fail(failureText(error));
  }
  let sha: string;
  try {
    sha = (await run(['rev-parse', '--verify', 'HEAD'])).trim();
  } catch (error) {
    return fail(`commit landed but HEAD is unreadable: ${failureText(error)}`);
  }
  return { kind: 'committed', sha, taskIds };
}

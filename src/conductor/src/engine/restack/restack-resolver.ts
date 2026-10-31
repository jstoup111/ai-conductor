import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  conflictedFiles,
  makeGitRunner,
  resolveRebaseConflicts,
  type GitRunner,
  type RebaseOutcome,
  type RebaseResolver,
  type ResolutionContext,
} from '../rebase.js';
import type { ChildRange, CommitSha } from './restack-types.js';
import { parseCommitSha } from './restack-types.js';
import type { CommitterStamp } from './restack-replay.js';
import {
  carryNewestHaltRecord,
  isHaltRecordOnlyCommit,
  mapOmittedHaltRecordCommits,
} from './halt-record-bookkeeping.js';

/** Resolver dispatch receives the same immutable identity as every Git child. */
export interface RestackResolutionContext extends ResolutionContext {
  readonly environment: NodeJS.ProcessEnv;
}

export type RestackResolver = (context: RestackResolutionContext) => ReturnType<RebaseResolver>;

export interface ResolveRestackConflictOptions {
  /** Feature worktree that owns the git directory and the gitignored resolver home. */
  readonly worktree: string;
  readonly range: ChildRange;
  readonly newParent: CommitSha;
  readonly stamp: CommitterStamp;
  /** Commits introduced by the advance; patch-equivalent candidates are omitted. */
  readonly comparisonCommits?: readonly CommitSha[];
  /** Enables deterministic handling of this feature's halt-record bookkeeping. */
  readonly haltRecordSlug?: string;
  readonly resolver: RestackResolver;
  readonly cap: number;
  /** Rooted at the feature worktree; used only for the add/remove/prune operations. */
  readonly git?: GitRunner;
}

export interface RestackConflictResolution {
  readonly outcome: RebaseOutcome;
  /** The temporary detached HEAD after an accepted replay. */
  readonly tip: CommitSha | undefined;
  /** Rebase's old-to-new correspondence, captured by its post-rewrite list. */
  readonly rewrites: ReadonlyMap<CommitSha, CommitSha>;
  /** The engine-written todo's pick candidates, in replay order. */
  readonly candidates: readonly CommitSha[];
}

function requiredSha(raw: string, context: string): CommitSha {
  const sha = parseCommitSha(raw.trim());
  if (!sha) throw new Error(`${context} did not return a full Git object name`);
  return sha;
}

function committerEnvironment(stamp: CommitterStamp): NodeJS.ProcessEnv {
  return {
    GIT_COMMITTER_NAME: stamp.name,
    GIT_COMMITTER_EMAIL: stamp.email,
    GIT_COMMITTER_DATE: stamp.date,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function patchId(git: GitRunner, commit: CommitSha): Promise<string | undefined> {
  const patch = await git(['show', '--format=', '--no-ext-diff', commit]);
  if (patch.exitCode !== 0) throw new Error(`could not read patch for ${commit}: ${patch.stderr}`);
  const result = await git(['patch-id', '--stable'], { input: patch.stdout });
  if (result.exitCode !== 0) throw new Error(`could not compute patch-id for ${commit}: ${result.stderr}`);
  return result.stdout.trim().split('\n').find(Boolean)?.split(/\s+/, 1)[0];
}

/** The non-merge candidate selection shared semantically with plumbing replay. */
async function replayCandidates(
  git: GitRunner,
  range: ChildRange,
  comparisonCommits: readonly CommitSha[],
  haltRecordSlug: string | undefined,
): Promise<CommitSha[]> {
  const compared = new Set<string>();
  for (const commit of comparisonCommits) {
    const id = await patchId(git, commit);
    if (id !== undefined) compared.add(id);
  }
  const listed = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (listed.exitCode !== 0) throw new Error(`could not list restack range: ${listed.stderr}`);
  const candidates: CommitSha[] = [];
  for (const raw of listed.stdout.split('\n').filter(Boolean)) {
    const commit = requiredSha(raw, 'restack replay candidate');
    if (haltRecordSlug !== undefined && await isHaltRecordOnlyCommit(commit, haltRecordSlug, git)) continue;
    // Empty commits have no patch-id and deliberately remain candidates.
    if (!compared.has(await patchId(git, commit) ?? '')) candidates.push(commit);
  }
  return candidates;
}

async function readRewrites(path: string): Promise<Map<CommitSha, CommitSha>> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return new Map();
  }
  const rewrites = new Map<CommitSha, CommitSha>();
  for (const line of content.split('\n')) {
    const [oldRaw, newRaw, extra] = line.trim().split(/\s+/);
    if (!oldRaw || !newRaw || extra) continue;
    const oldSha = parseCommitSha(oldRaw);
    const newSha = parseCommitSha(newRaw);
    if (oldSha && newSha) rewrites.set(oldSha, newSha);
  }
  return rewrites;
}

async function candidateSubjects(git: GitRunner, candidates: readonly CommitSha[]): Promise<string[]> {
  const subjects: string[] = [];
  for (const candidate of candidates) {
    const result = await git(['show', '-s', '--format=%s', candidate]);
    if (result.exitCode !== 0 || result.stdout.trim() === '') {
      throw new Error(`could not read restack replay subject for ${candidate}`);
    }
    subjects.push(result.stdout.trim());
  }
  return subjects;
}

/**
 * Resolve one restack child's conflict off-worktree. No branch or conductor ref
 * is checked out or moved: the only mutable checkout is the detached temporary
 * worktree, which is reaped on every terminal path.
 */
export async function resolveRestackConflict(options: ResolveRestackConflictOptions): Promise<RestackConflictResolution> {
  const runGit = options.git ?? makeGitRunner(options.worktree);
  const resolveRoot = join(options.worktree, '.pipeline', 'restack', 'resolve');
  await mkdir(resolveRoot, { recursive: true });
  const temporaryWorktree = await mkdtemp(join(resolveRoot, 'child-'));
  // Helper files live beside the checkout, never inside it: writing into the
  // detached worktree (for example its own ignore file) would modify a tracked
  // path and make `git rebase` refuse to start.
  const helpers = await mkdtemp(join(resolveRoot, 'helpers-'));
  const identity = committerEnvironment(options.stamp);
  const todoPath = join(helpers, 'rebase-todo');
  const sequenceEditorPath = join(helpers, 'sequence-editor');
  const rewritePath = join(helpers, 'rewritten-list');
  const hooksPath = join(helpers, 'hooks');
  const attributesPath = join(helpers, 'attributes');
  let added = false;

  try {
    const candidates = await replayCandidates(runGit, options.range, options.comparisonCommits ?? [], options.haltRecordSlug);
    const addedResult = await runGit(['worktree', 'add', '--detach', temporaryWorktree, options.range.oldTip], { env: identity });
    if (addedResult.exitCode !== 0) throw new Error(`could not add restack resolver worktree: ${addedResult.stderr}`);
    added = true;

    const todo = candidates.map((commit) => `pick ${commit}\n`).join('');
    await writeFile(todoPath, todo);
    await writeFile(sequenceEditorPath, `#!/bin/sh\ncp ${shellQuote(todoPath)} "$1"\n`);
    await chmod(sequenceEditorPath, 0o700);
    await mkdir(hooksPath);
    await writeFile(join(hooksPath, 'post-rewrite'), `#!/bin/sh\ncat > ${shellQuote(rewritePath)}\n`);
    await chmod(join(hooksPath, 'post-rewrite'), 0o700);

    if (options.haltRecordSlug !== undefined) {
      await writeFile(attributesPath, `${`.docs/halted/${options.haltRecordSlug}.md`} merge=conductor-halt-record\n`);
    }
    const environment: NodeJS.ProcessEnv = {
      ...identity,
      GIT_SEQUENCE_EDITOR: sequenceEditorPath,
      GIT_EDITOR: 'true',
      // A resolver-specific hook captures Git's rewritten list without adding
      // non-pick instructions to the engine-owned todo.
      GIT_CONFIG_COUNT: options.haltRecordSlug === undefined ? '1' : '3',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: hooksPath,
      ...(options.haltRecordSlug === undefined ? {} : {
        GIT_CONFIG_KEY_1: 'core.attributesFile',
        GIT_CONFIG_VALUE_1: attributesPath,
        GIT_CONFIG_KEY_2: 'merge.conductor-halt-record.driver',
        GIT_CONFIG_VALUE_2: 'true',
      }),
    };
    const nativeTemporaryGit = makeGitRunner(temporaryWorktree);
    // Every call rooted in the detached checkout, including rebase-state
    // inspection around a resolver's --continue, carries the journal stamp.
    const tempGit: GitRunner = (args, opts) => nativeTemporaryGit(args, {
      ...opts,
      env: { ...environment, ...opts?.env },
    });
    const resolved = async (outcome: RebaseOutcome): Promise<RestackConflictResolution> => {
      const rewrites = await readRewrites(rewritePath);
      // Git may reap a detached resolver checkout as the final rebase action.
      // post-rewrite is therefore the durable authority for its resulting tip.
      let tip = [...rewrites.values()].at(-1) ?? options.newParent;
      if (options.haltRecordSlug !== undefined) {
        const carried = await carryNewestHaltRecord(options.range, options.newParent, options.haltRecordSlug, tip, options.stamp, runGit);
        tip = carried.tip;
        await mapOmittedHaltRecordCommits(options.range, options.haltRecordSlug, options.newParent, tip, rewrites, runGit);
      }
      return { outcome, tip, rewrites, candidates };
    };
    const started = await tempGit(['rebase', '-i', '--onto', options.newParent, options.range.oldParent], { env: environment });
    if (started.exitCode === 0) {
      return resolved({ kind: 'noop' });
    }

    const conflicts = await conflictedFiles(tempGit);
    const outcome = await resolveRebaseConflicts(
      tempGit,
      temporaryWorktree,
      {
        kind: 'conflict_halt',
        conflicts,
        reason: started.stderr || 'restack resolver rebase failed',
        expectedSubjects: await candidateSubjects(tempGit, candidates),
      },
      async (context) => options.resolver({ ...context, environment }),
      options.cap,
    );
    if (outcome.kind === 'changed' || outcome.kind === 'noop') return resolved(outcome);
    return { outcome, tip: undefined, rewrites: await readRewrites(rewritePath), candidates };
  } finally {
    try {
      if (added) {
        try {
          await runGit(['worktree', 'remove', '--force', temporaryWorktree], { env: identity });
        } finally {
          await runGit(['worktree', 'prune'], { env: identity });
        }
      } else {
        await rm(temporaryWorktree, { recursive: true, force: true });
        await runGit(['worktree', 'prune'], { env: identity });
      }
    } finally {
      await rm(helpers, { recursive: true, force: true });
    }
  }
}

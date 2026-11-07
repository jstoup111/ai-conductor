import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  classifyReplayMerge,
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
import { missingCandidateSubjects, rewritesByUniqueSubject } from './restack-conflict-record.js';

export interface FlattenedHandoff {
  /** Commits suitable for the resolver's engine-authored pick todo. */
  readonly todo: readonly CommitSha[];
  /** A linear, old-parent-rooted representation of the original first-parent range. */
  readonly tip: CommitSha;
  /** Todo commits whose subjects must survive a settled resolver replay. */
  readonly candidates: readonly CommitSha[];
  readonly audit: {
    readonly flattenedMerges: readonly CommitSha[];
    readonly ancestryOnlyMerges: readonly CommitSha[];
    readonly sideLineageCount: number;
  };
}

export interface BuildFlattenedHandoffOptions {
  readonly comparisonCommits?: readonly CommitSha[];
  readonly haltRecordSlug?: string;
}

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
  /** Whether the range owns this feature's halt record after carried-merge normalization. */
  readonly haltRecordOwned?: boolean;
  /** An operator answer recorded for this child range, when it still matches. */
  readonly operatorDecision?: { answer: string; commit: string; paths: readonly string[] };
  readonly resolver: RestackResolver;
  readonly cap: number;
  /** Rooted at the feature worktree; used only for the add/remove/prune operations. */
  readonly git?: GitRunner;
  /** Test seam for the Git runner rooted at the detached resolver checkout. */
  readonly temporaryGit?: (worktree: string) => GitRunner;
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

async function commitTree(git: GitRunner, commit: CommitSha): Promise<CommitSha> {
  const result = await git(['rev-parse', `${commit}^{tree}`]);
  if (result.exitCode !== 0) throw new Error(`could not read tree for ${commit}: ${result.stderr}`);
  return requiredSha(result.stdout, `tree for ${commit}`);
}

async function commitParents(git: GitRunner, commit: CommitSha): Promise<readonly CommitSha[]> {
  const result = await git(['rev-list', '--parents', '-n', '1', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read parents for ${commit}: ${result.stderr}`);
  return result.stdout.trim().split(/\s+/).slice(1).map((value) => requiredSha(value, `parent for ${commit}`));
}

async function commitAuthor(git: GitRunner, commit: CommitSha): Promise<{ name: string; email: string; date: string }> {
  const result = await git(['show', '-s', '--format=%an%x00%ae%x00%aI', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read author for ${commit}: ${result.stderr}`);
  const [name, email, date, extra] = result.stdout.split('\0');
  if (!name || !email || !date || extra !== undefined) throw new Error(`could not parse author for ${commit}`);
  return { name, email, date: date.trim() };
}

async function commitMessage(git: GitRunner, commit: CommitSha): Promise<string> {
  const result = await git(['show', '-s', '--format=%B', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read message for ${commit}: ${result.stderr}`);
  return result.stdout;
}

async function sideLineageCount(git: GitRunner, firstParent: CommitSha, secondParent: CommitSha): Promise<number> {
  const result = await git(['rev-list', `${firstParent}..${secondParent}`]);
  if (result.exitCode !== 0) throw new Error(`could not list side lineage for ${secondParent}: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean).length;
}

async function writeLinearCommit(
  git: GitRunner,
  tree: CommitSha,
  parent: CommitSha,
  source: CommitSha,
  message: string | undefined = undefined,
): Promise<CommitSha> {
  const [author, renderedMessage] = await Promise.all([commitAuthor(git, source), message === undefined ? commitMessage(git, source) : message]);
  const result = await git(['commit-tree', tree, '-p', parent], {
    input: renderedMessage,
    env: {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_AUTHOR_DATE: author.date,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_COMMITTER_DATE: author.date,
    },
  });
  if (result.exitCode !== 0) throw new Error(`could not write flattened hand-off commit for ${source}: ${result.stderr}`);
  return requiredSha(result.stdout, `flattened hand-off commit for ${source}`);
}

async function flattenedMergeIsCarried(git: GitRunner, parent: CommitSha, newParent: CommitSha, flattened: CommitSha): Promise<boolean> {
  const [merged, newParentTree] = await Promise.all([
    git(['merge-tree', '--write-tree', '--merge-base', parent, newParent, flattened]),
    commitTree(git, newParent),
  ]);
  return merged.exitCode === 0 && merged.stdout.trim() === newParentTree;
}

/**
 * Builds a linear, old-parent-rooted hand-off for resolver replay. The chain
 * retains every first-parent tree, while the todo selects only commits whose
 * patches still need a user-visible pick.
 */
export async function buildFlattenedHandoff(
  range: ChildRange,
  newParent: CommitSha,
  git: GitRunner,
  options: BuildFlattenedHandoffOptions = {},
): Promise<FlattenedHandoff> {
  const comparedPatchIds = new Set<string>();
  for (const comparison of options.comparisonCommits ?? []) {
    const id = await patchId(git, comparison);
    if (id !== undefined) comparedPatchIds.add(id);
  }
  const listed = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (listed.exitCode !== 0) throw new Error(`could not list restack range: ${listed.stderr}`);
  const todo: CommitSha[] = [];
  const candidates: CommitSha[] = [];
  const flattenedMerges: CommitSha[] = [];
  const ancestryOnlyMerges: CommitSha[] = [];
  let sideLineageCountTotal = 0;
  let accumulator = range.oldParent;

  for (const raw of listed.stdout.split('\n').filter(Boolean)) {
    const commit = requiredSha(raw, 'flattened hand-off range entry');
    const parents = await commitParents(git, commit);
    if (parents.length < 2) {
      accumulator = await writeLinearCommit(git, await commitTree(git, commit), accumulator, commit);
      const omitted = (options.haltRecordSlug !== undefined && await isHaltRecordOnlyCommit(commit, options.haltRecordSlug, git))
        || comparedPatchIds.has(await patchId(git, commit) ?? '');
      if (!omitted) {
        todo.push(commit);
        candidates.push(commit);
      }
      continue;
    }

    const merge = await classifyReplayMerge(git, commit, newParent, 'stacked');
    sideLineageCountTotal += await sideLineageCount(
      git,
      requiredSha(merge.firstParent, `first parent for ${commit}`),
      requiredSha(merge.secondParent, `second parent for ${commit}`),
    );
    if (merge.kind === 'ancestry-only') {
      // For an ancestry-only merge its recorded tree is the automatic tree.
      accumulator = await writeLinearCommit(git, requiredSha(merge.mergeTree, `automatic tree for ${commit}`), accumulator, commit);
      ancestryOnlyMerges.push(commit);
      continue;
    }
    if (merge.kind === 'q-carried') {
      accumulator = await writeLinearCommit(git, requiredSha(merge.autoTree, `automatic tree for ${commit}`), accumulator, commit);
    } else {
      flattenedMerges.push(commit);
    }
    const flattenedParent = accumulator;
    const flattened = await writeLinearCommit(
      git,
      requiredSha(merge.mergeTree, `merge tree for ${commit}`),
      accumulator,
      commit,
      `${await commitMessage(git, commit)}\nFlattened-merge: ${commit}\n`,
    );
    accumulator = flattened;
    if (!(await flattenedMergeIsCarried(git, flattenedParent, newParent, flattened))) {
      todo.push(flattened);
      candidates.push(flattened);
    }
  }
  return {
    todo,
    tip: accumulator,
    candidates,
    audit: { flattenedMerges, ancestryOnlyMerges, sideLineageCount: sideLineageCountTotal },
  };
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

export async function replayCandidateSubjects(git: GitRunner, candidates: readonly CommitSha[]): Promise<string[]> {
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
    // An empty engine-authored todo has no resolver work to settle. Its only
    // valid result is the supplied replay parent; never ask Git to run an
    // empty interactive rebase, which reports a synthetic failure.
    if (candidates.length === 0) {
      const rewrites = new Map<CommitSha, CommitSha>();
      let tip = options.newParent;
      if (options.haltRecordSlug !== undefined) {
        const carried = await carryNewestHaltRecord(options.range, options.newParent, options.haltRecordSlug, tip, options.stamp, options.haltRecordOwned, runGit);
        tip = carried.tip;
        await mapOmittedHaltRecordCommits(options.range, options.haltRecordSlug, options.newParent, tip, rewrites, runGit);
      }
      return { outcome: { kind: 'noop' }, tip, rewrites, candidates };
    }
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
    const nativeTemporaryGit = options.temporaryGit?.(temporaryWorktree) ?? makeGitRunner(temporaryWorktree);
    // Every call rooted in the detached checkout, including rebase-state
    // inspection around a resolver's --continue, carries the journal stamp.
    const tempGit: GitRunner = (args, opts) => nativeTemporaryGit(args, {
      ...opts,
      env: { ...environment, ...opts?.env },
    });
    const resolved = async (
      outcome: RebaseOutcome,
      capturedTip: CommitSha | undefined = undefined,
    ): Promise<RestackConflictResolution> => {
      const rewrites = await readRewrites(rewritePath);
      // The settled checkout is the same authority FR-8 and FR-9 inspected.
      // The hook list survives a lost checkout, but never overrides its HEAD.
      const head = capturedTip === undefined ? await tempGit(['rev-parse', 'HEAD']) : undefined;
      const settledTip = capturedTip ?? (head?.exitCode === 0 ? parseCommitSha(head.stdout.trim()) : undefined);
      const rewrittenTip = [...rewrites.values()].at(-1);
      if (settledTip === undefined && rewrittenTip === undefined && candidates.length > 0) {
        return {
          outcome: {
            kind: 'conflict_halt',
            conflicts: [],
            reason: `restack resolver finished child ${options.range.child} without a readable settled tip`,
          },
          tip: undefined,
          rewrites,
          candidates,
        };
      }
      let tip = settledTip ?? rewrittenTip ?? options.newParent;
      const candidateSubjects = await replayCandidateSubjects(runGit, candidates);
      const missingSubjects = await missingCandidateSubjects(runGit, options.newParent, tip, candidateSubjects);
      if (missingSubjects.length > 0) {
        return {
          outcome: {
            kind: 'conflict_halt',
            conflicts: [],
            reason: `restack resolver finished child ${options.range.child} without candidate subjects: ${missingSubjects.join(', ')}`,
          },
          tip: undefined,
          rewrites,
          candidates,
        };
      }
      if (rewrites.size === 0 && candidates.length > 0) {
        const rebuilt = await rewritesByUniqueSubject(
          runGit,
          `${options.range.oldParent}..${options.range.oldTip}`,
          `${options.newParent}..${tip}`,
          candidateSubjects,
        );
        for (const [original, replacement] of rebuilt) rewrites.set(original, replacement);
      }
      if (options.haltRecordSlug !== undefined) {
        const carried = await carryNewestHaltRecord(options.range, options.newParent, options.haltRecordSlug, tip, options.stamp, options.haltRecordOwned, runGit);
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
    let resolverSettledTip: CommitSha | undefined;
    const outcome = await resolveRebaseConflicts(
      tempGit,
      temporaryWorktree,
      {
        kind: 'conflict_halt',
        conflicts,
        reason: started.stderr || 'restack resolver rebase failed',
        expectedSubjects: await replayCandidateSubjects(tempGit, candidates),
      },
      async (context) => {
        const result = await options.resolver({
          ...context,
          environment,
          ...(options.operatorDecision === undefined ? {} : { operatorDecision: options.operatorDecision }),
        });
        if (result.resolved) {
          const head = await tempGit(['rev-parse', 'HEAD']);
          resolverSettledTip = head.exitCode === 0 ? parseCommitSha(head.stdout.trim()) : undefined;
        }
        return result;
      },
      options.cap,
    );
    if (outcome.kind === 'changed' || outcome.kind === 'noop') return resolved(outcome, resolverSettledTip);
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

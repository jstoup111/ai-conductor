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
  mapOmittedHaltRecordCommits,
} from './halt-record-bookkeeping.js';
import { selectReplayCandidates } from './restack-replay-candidates.js';
import { missingCandidateSubjects, rewritesByUniqueSubject, writeConflictRecord } from './restack-conflict-record.js';
import type { StoredRestackJournal } from './restack-journal.js';
import {
  buildFlattenedHandoff as buildFlattenedHandoffImpl,
  replayCandidateSubjects,
  type FlattenedHandoff,
} from './restack-flattened-handoff.js';
export { replayCandidateSubjects } from './restack-flattened-handoff.js';
export type { FlattenedHandoff } from './restack-flattened-handoff.js';

export async function buildFlattenedHandoff(
  range: ChildRange,
  newParent: CommitSha,
  git: GitRunner,
  options: Omit<import('./restack-flattened-handoff.js').BuildFlattenedHandoffOptions, 'classifyMerge'> = {},
): Promise<FlattenedHandoff> {
  return buildFlattenedHandoffImpl(range, newParent, git, { ...options, classifyMerge: classifyReplayMerge });
}

interface HaltRecordedRestackConflictOptions {
  readonly worktree: string;
  readonly slug: string;
  readonly journal: StoredRestackJournal;
  readonly range: ChildRange;
  readonly replayParent: CommitSha;
  readonly candidateSubjects: readonly string[];
  readonly commit: CommitSha;
  readonly paths: readonly string[];
  readonly detail: string;
  readonly events?: import('../conductor-event-emitter.js').ConductorEventEmitter;
  readonly git: GitRunner;
  readonly writeHalt: (worktree: string, child: ChildRange['child'], detail: string, events?: import('../conductor-event-emitter.js').ConductorEventEmitter, recipe?: {
    readonly slug: string; readonly opId: string; readonly oldTip: CommitSha; readonly newParent: CommitSha; readonly oldParent: CommitSha; readonly startingTip?: CommitSha;
  }) => Promise<unknown>;
}

async function rangeHasMergeForHalt(git: GitRunner, range: ChildRange): Promise<boolean> {
  const result = await git(['rev-list', '--min-parents=2', `${range.oldParent}..${range.oldTip}`]);
  if (result.exitCode !== 0) throw new Error(`could not inspect restack range for merges: ${result.stderr}`);
  return result.stdout.trim() !== '';
}

/** Persist the conflict context before writing its matching operator halt. */
export async function haltRecordedRestackConflict(options: HaltRecordedRestackConflictOptions): Promise<void> {
  const { journal, range } = options;
  let recordFailure = '';
  let flattenedTip: CommitSha | undefined;
  try {
    let candidateSubjects = options.candidateSubjects;
    if (await rangeHasMergeForHalt(options.git, range)) {
      const handoff = await buildFlattenedHandoff(range, options.replayParent, options.git);
      candidateSubjects = await replayCandidateSubjects(options.git, handoff.candidates);
      flattenedTip = handoff.tip;
    }
    const tree = await options.git(['rev-parse', '--verify', `${options.replayParent}^{tree}`]);
    const replayParentTree = tree.exitCode === 0 ? parseCommitSha(tree.stdout.trim()) : undefined;
    if (!replayParentTree) throw new Error('cannot read replay parent tree');
    const written = await writeConflictRecord(options.worktree, options.slug, {
      opId: journal.journal.opId, child: range.child, oldParent: range.oldParent, oldTip: range.oldTip,
      newParent: options.replayParent, newParentTree: replayParentTree, candidateSubjects,
      commit: options.commit, paths: options.paths, ...(flattenedTip === undefined ? {} : { flattenedTip }),
    }, { git: options.git });
    if (written.kind !== 'updated') recordFailure = `\nconflict record write failed: ${written.kind}`;
  } catch (error) {
    recordFailure = `\nconflict record write failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  await options.writeHalt(options.worktree, range.child, `${options.detail}${recordFailure}`, options.events, {
    slug: options.slug, opId: journal.journal.opId, oldTip: range.oldTip, newParent: options.replayParent, oldParent: range.oldParent,
    ...(flattenedTip === undefined ? {} : { startingTip: flattenedTip }),
  });
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
  /** Merge decisions made while constructing a flattened resolver hand-off. */
  readonly audit?: FlattenedHandoff['audit'];
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

async function rangeHasMerge(git: GitRunner, range: ChildRange): Promise<boolean> {
  const result = await git(['rev-list', '--min-parents=2', `${range.oldParent}..${range.oldTip}`]);
  if (result.exitCode !== 0) throw new Error(`could not inspect restack range for merges: ${result.stderr}`);
  return result.stdout.trim() !== '';
}

function translateFlattenedRewrites(
  rewrites: ReadonlyMap<CommitSha, CommitSha>,
  flattenedMergesByCommit: ReadonlyMap<CommitSha, CommitSha>,
): Map<CommitSha, CommitSha> {
  const translated = new Map<CommitSha, CommitSha>();
  for (const [original, replacement] of rewrites) {
    translated.set(flattenedMergesByCommit.get(original) ?? original, replacement);
  }
  return translated;
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
    const handoff = await rangeHasMerge(runGit, options.range)
      ? await buildFlattenedHandoff(options.range, options.newParent, runGit, {
        comparisonCommits: options.comparisonCommits,
        haltRecordSlug: options.haltRecordSlug,
      })
      : undefined;
    const candidates = handoff?.candidates ?? await selectReplayCandidates(runGit, options.range, options.comparisonCommits, options.haltRecordSlug);
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
      return { outcome: { kind: 'noop' }, tip, rewrites, candidates, ...(handoff === undefined ? {} : { audit: handoff.audit }) };
    }
    const addedResult = await runGit(['worktree', 'add', '--detach', temporaryWorktree, handoff?.tip ?? options.range.oldTip], { env: identity });
    if (addedResult.exitCode !== 0) throw new Error(`could not add restack resolver worktree: ${addedResult.stderr}`);
    added = true;

    const todo = (handoff?.todo ?? candidates).map((commit) => `pick ${commit}\n`).join('');
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
      let rewrites = await readRewrites(rewritePath);
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
          rewrites: translateFlattenedRewrites(rewrites, handoff?.flattenedMergesByCommit ?? new Map()),
          candidates,
          ...(handoff === undefined ? {} : { audit: handoff.audit }),
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
          rewrites: translateFlattenedRewrites(rewrites, handoff?.flattenedMergesByCommit ?? new Map()),
          candidates,
          ...(handoff === undefined ? {} : { audit: handoff.audit }),
        };
      }
      if (rewrites.size === 0 && candidates.length > 0) {
        const rebuilt = await rewritesByUniqueSubject(
          runGit,
          `${options.range.oldParent}..${handoff?.tip ?? options.range.oldTip}`,
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
      rewrites = translateFlattenedRewrites(rewrites, handoff?.flattenedMergesByCommit ?? new Map());
      return { outcome, tip, rewrites, candidates, ...(handoff === undefined ? {} : { audit: handoff.audit }) };
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
    return {
      outcome,
      tip: undefined,
      rewrites: translateFlattenedRewrites(await readRewrites(rewritePath), handoff?.flattenedMergesByCommit ?? new Map()),
      candidates,
      ...(handoff === undefined ? {} : { audit: handoff.audit }),
    };
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

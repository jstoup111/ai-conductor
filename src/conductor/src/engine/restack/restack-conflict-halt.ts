import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import type { GitRunner } from '../rebase.js';
import { writeConflictRecord } from './restack-conflict-record.js';
import { type StoredRestackJournal } from './restack-journal.js';
import { haltRestackConflict } from './restack-move.js';
import type { ChildRange, CommitSha } from './restack-types.js';

interface HaltRecordedRestackConflictOptions {
  readonly worktree: string;
  readonly slug: string;
  readonly journal: StoredRestackJournal;
  readonly range: ChildRange;
  /** The parent and tree used by the failed replay, not the range's old parent. */
  readonly replayParent: CommitSha;
  readonly replayParentTree?: CommitSha;
  /** Subjects preserve the resolver's ordered replay todo in the durable hand-off. */
  readonly candidateSubjects: readonly string[];
  readonly commit: CommitSha;
  readonly paths: readonly string[];
  readonly detail: string;
  readonly events?: ConductorEventEmitter;
  readonly git: GitRunner;
}

/**
 * Persist feature-repair conflict context, then write the matching operator
 * halt. Executor and recovery both arrive here only after their journal has
 * been aborted and the conflict occurrence has been emitted.
 */
export async function haltRecordedRestackConflict(options: HaltRecordedRestackConflictOptions): Promise<void> {
  const { journal, range } = options;
  let recordFailure = '';
  if (journal.journal.cause === 'feature-repair') {
    try {
      if (!options.replayParentTree) throw new Error('cannot read replay parent tree');
      const written = await writeConflictRecord(options.worktree, options.slug, {
        opId: journal.journal.opId,
        child: range.child,
        oldParent: range.oldParent,
        oldTip: range.oldTip,
        newParent: options.replayParent,
        newParentTree: options.replayParentTree,
        candidateSubjects: options.candidateSubjects,
        commit: options.commit,
        paths: options.paths,
      }, { git: options.git });
      if (written.kind !== 'updated') recordFailure = `\nconflict record write failed: ${written.kind}`;
    } catch (error) {
      recordFailure = `\nconflict record write failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  await haltRestackConflict(options.worktree, range.child, `${options.detail}${recordFailure}`, options.events,
    journal.journal.cause === 'feature-repair'
      ? {
        slug: options.slug,
        opId: journal.journal.opId,
        oldTip: range.oldTip,
        newParent: options.replayParent,
        oldParent: range.oldParent,
      }
      : undefined);
}

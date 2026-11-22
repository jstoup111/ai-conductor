import type { ChildId } from './child-context.js';
import type { RemediationCaseRecord, RemediationCaseStoreReadResult } from './remediation-case-store.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConductorEvent } from '../types/events.js';
import type { ConductorEventEmitter } from './conductor-event-emitter.js';

export type BuildStallStaleCitation =
  | {
      readonly kind: 'stale';
      readonly caseId: string;
      readonly ownerChild: ChildId;
      readonly state: 'resolved' | 'foreign';
    }
  | { readonly kind: 'not-stale' };

export interface BuildStallStaleCitationInput {
  readonly question: string | null | undefined;
  readonly activeChild: ChildId;
  readonly caseStores: ReadonlyMap<ChildId, RemediationCaseStoreReadResult>;
}

interface CitedCase {
  readonly case: RemediationCaseRecord;
  readonly ownerChild: ChildId;
}

/**
 * Determines whether a BUILD stall only repeats remediation work already
 * settled or owned by another child. Case ids are the sole citation grammar:
 * question prose is never parsed or interpreted.
 */
export function classifyBuildStallStaleCitation(input: BuildStallStaleCitationInput): BuildStallStaleCitation {
  if (!input.question) return { kind: 'not-stale' };

  const citedCases: CitedCase[] = [];
  for (const [child, result] of input.caseStores) {
    if (!result.ok) return { kind: 'not-stale' };
    for (const record of result.state.cases) {
      if (input.question.includes(record.id)) citedCases.push({ case: record, ownerChild: child });
    }
  }

  if (
    citedCases.length === 0 ||
    citedCases.some(({ case: record, ownerChild }) => ownerChild === input.activeChild && record.resolution === 'open')
  ) {
    return { kind: 'not-stale' };
  }

  const cited = citedCases[0]!;
  return {
    kind: 'stale',
    caseId: cited.case.id,
    ownerChild: cited.ownerChild,
    state: cited.case.resolution === 'resolved' ? 'resolved' : 'foreign',
  };
}

export type RecordBuildStallStaleCitationResult =
  { readonly kind: 'recorded'; readonly attempt: number } | { readonly kind: 'persist-failed' };

/** The BUILD loop's one-time routing decision for a stale-citation record. */
export type BuildStallStaleCitationOutcome =
  | { readonly kind: 'fall-through' }
  | { readonly kind: 'retry'; readonly hint: string }
  | { readonly kind: 'halt'; readonly haltClass: 'mechanical' | 'needs-human'; readonly detail: string };

export function buildStallStaleCitationOutcome(
  citation: Exclude<BuildStallStaleCitation, { kind: 'not-stale' }>,
  recorded: RecordBuildStallStaleCitationResult,
): BuildStallStaleCitationOutcome {
  // ai-conductor:session-command-context=operator-only
  if (recorded.kind === 'persist-failed') {
    return {
      kind: 'halt',
      haltClass: 'needs-human',
      detail: 'Unable to record stale citation; use ai-conductor halt clear after checking the event spine.',
    };
  }
  if (recorded.attempt >= 3) {
    return {
      kind: 'halt',
      haltClass: recorded.attempt >= 4 ? 'needs-human' : 'mechanical',
      detail: `Stale citation ${citation.caseId} is ${citation.state === 'resolved' ? `settled by child ${citation.ownerChild}` : `owned by child ${citation.ownerChild}`}; use ai-conductor halt clear after reviewing the stale citation.`,
    };
  }
  // /ai-conductor:session-command-context
  return {
    kind: 'retry',
    hint: `Case ${citation.caseId} is ${citation.state === 'resolved' ? `settled by child ${citation.ownerChild}` : `owned by child ${citation.ownerChild}`} and is not this session's work.`,
  };
}

/**
 * The event log, rather than process memory, bounds stale-citation retries so
 * a daemon re-kick preserves the count.  Only an uninterrupted run for the
 * same case and resolved-task count contributes to the next attempt.
 */
export async function recordBuildStallStaleCitation(
  projectRoot: string,
  events: ConductorEventEmitter,
  citation: Exclude<BuildStallStaleCitation, { kind: 'not-stale' }>,
  activeChild: ChildId,
  resolvedTasks: number,
): Promise<RecordBuildStallStaleCitationResult> {
  let attempt = 1;
  try {
    const text = await readFile(join(projectRoot, '.pipeline/events.jsonl'), 'utf8');
    for (const line of text.trim().split('\n').reverse()) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        typeof event !== 'object' ||
        event === null ||
        (event as { type?: unknown }).type !== 'build_stall_stale_citation'
      )
        continue;
      const prior = event as Partial<Extract<ConductorEvent, { type: 'build_stall_stale_citation' }>>;
      if (
        prior.caseId !== citation.caseId ||
        prior.resolvedTasks !== resolvedTasks ||
        prior.stalledChild !== activeChild
      )
        break;
      attempt++;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { kind: 'persist-failed' };
  }
  try {
    // emitOrThrow reaches every live subscriber (including the audit trail)
    // and its composition-owned EventPersister. Unlike emit(), it reports a
    // durable write failure so the caller can halt rather than lose the bound.
    await events.emitOrThrow({
      type: 'build_stall_stale_citation',
      caseId: citation.caseId,
      stalledChild: activeChild,
      ownerChild: citation.ownerChild,
      state: citation.state,
      resolvedTasks,
      attempt,
    });
    return { kind: 'recorded', attempt };
  } catch {
    return { kind: 'persist-failed' };
  }
}

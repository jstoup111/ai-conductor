import {
  readRefreshLedger,
  routedMemberAboveCommentMarker,
  type RoutedHostCommentTarget,
  type RoutedMemberAboveCommentTarget,
} from './stack-refresh-ledger.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { readRouteRecord } from './routing/route-record-reader.js';
import { assertNever, parseRevalidationQueueRecord, type RouteRecord } from './routing/route-types.js';
import type { RouteKind } from '../types/routing.js';

export interface RenderHostCommentInput {
  readonly worktree: string;
  readonly slug: string;
  readonly target: RoutedHostCommentTarget;
  readonly git?: GitRunner;
}

export type RenderHostCommentResult =
  | { readonly kind: 'body'; readonly body: string }
  | { readonly kind: 'retryable' };

export interface RenderMemberAboveCommentInput {
  readonly worktree: string;
  readonly slug: string;
  readonly target: RoutedMemberAboveCommentTarget;
  readonly git?: GitRunner;
}

/**
 * Render the durable context for an audit-route host refresh.  Every input is
 * read before a body is exposed so callers never post a partial explanation.
 */
export async function renderHostComment(input: RenderHostCommentInput): Promise<RenderHostCommentResult> {
  const git = input.git ?? makeGitRunner(input.worktree);

  try {
    const storedLedger = await readRefreshLedger(input.worktree, input.slug, { git });
    if (storedLedger.kind !== 'ledger') return { kind: 'retryable' };

    const round = storedLedger.ledger.rounds.find((entry) => entry.roundId === input.target.roundId);
    if (!round) return { kind: 'retryable' };

    const host = Object.values(storedLedger.ledger.members)
      .find((member) => member.position === round.host);
    if (!host || host.pr !== input.target.pr) return { kind: 'retryable' };

    const storedRecord = await readRouteRecord(git, input.slug, input.target.roundId);
    if (storedRecord.kind !== 'record' || storedRecord.record.kind !== round.kind) return { kind: 'retryable' };

    const allocation = storedRecord.record.allocation[round.host];
    if (!allocation) return { kind: 'retryable' };

    const commits = await git(['log', '--format=%s', `${host.publishedTip}..${host.recordedTip}`]);
    if (commits.exitCode !== 0) return { kind: 'retryable' };

    const headline = await renderRoundHeadline(round.kind, storedRecord.record, host.position, git);
    if (headline === undefined) return { kind: 'retryable' };

    const lines = [
      headline,
      '',
      'Commits included:',
      ...commits.stdout.split('\n').map((subject) => subject.trim()).filter(Boolean).map((subject) => `- ${subject}`),
    ];

    const items = storedRecord.record.items.filter((item) => item.host === round.host);
    if (items.length > 0) {
      lines.push('', 'Audit findings addressed:');
      for (const item of items) {
        const reason = stripRoutedFixMarkers(item.reason);
        const rationale = item.rationale === undefined ? undefined : stripRoutedFixMarkers(item.rationale);
        lines.push(`- ${stripRoutedFixMarkers(item.findingId)}: ${reason}${rationale ? ` — ${rationale}` : ''}`);
      }
    }

    if (allocation.retryHint) lines.push('', `Retry hint: ${allocation.retryHint}`);

    if (storedRecord.record.pendingAsBuiltFindings?.length) {
      lines.push('', 'Pending as-built findings:');
      for (const finding of storedRecord.record.pendingAsBuiltFindings) {
        lines.push(`- ${stripRoutedFixMarkers(finding.summary)} — ${stripRoutedFixMarkers(finding.governingClause)}`);
      }
    }

    if (input.target.rebaseOnly.length > 0) {
      lines.push('', 'Rebased without diff change:');
      for (const pr of input.target.rebaseOnly) lines.push(`- PR #${pr} was rebased with no diff change.`);
    }

    lines.push('', round.marker);
    return { kind: 'body', body: lines.join('\n') };
  } catch {
    return { kind: 'retryable' };
  }
}

/** Render the comment for a member whose own replay changed its reviewable diff. */
export async function renderMemberAboveComment(input: RenderMemberAboveCommentInput): Promise<RenderHostCommentResult> {
  const { hostPr, newTip, pr } = input.target;
  return {
    kind: 'body',
    body: [
      `This PR's diff changed while carrying the routed fix from #${hostPr}.`,
      '',
      routedMemberAboveCommentMarker({ pr, hostPr, newTip }),
    ].join('\n'),
  };
}

async function renderRoundHeadline(
  kind: RouteKind,
  record: RouteRecord,
  host: number,
  git: GitRunner,
): Promise<string | undefined> {
  switch (kind) {
    case 'audit':
      return 'The routed audit fix has been published.';
    case 'operator':
      return record.operator === undefined
        ? undefined
        : `An operator-requested repair has been published. Reason: ${record.operator.reason} Operator: ${record.operator.operator}`;
    case 'revalidate': {
      const revalidation = record.entry?.host === host ? record.entry.revalidation : undefined;
      if (revalidation === undefined) return undefined;
      const queueBlob = await git(['cat-file', '-p', revalidation.queueBlob]);
      const queue = queueBlob.exitCode === 0 ? parseRevalidationQueueRecord(queueBlob.stdout) : undefined;
      const entry = queue?.generation === revalidation.generation
        ? queue.entries.find((candidate) => candidate.child === host && candidate.closureSha === revalidation.closureSha)
        : undefined;
      return entry === undefined || entry.gates.length === 0
        ? undefined
        : `A re-validation repair landed after ${entry.gates.join(', ')}.`;
    }
  }
  return assertNever(kind);
}

function stripRoutedFixMarkers(text: string): string {
  return text
    .replace(/<!--\s*conductor:routed-fix:[\s\S]*?-->/g, '')
    .replace(/<!--\s*conductor:routed-fix:[^\n]*/g, '')
    .trim();
}

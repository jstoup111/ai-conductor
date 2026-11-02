import {
  readRefreshLedger,
  type RoutedHostCommentTarget,
} from './stack-refresh-ledger.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { readRouteRecord } from './routing/route-record-reader.js';

export interface RenderHostCommentInput {
  readonly worktree: string;
  readonly slug: string;
  readonly target: RoutedHostCommentTarget;
  readonly git?: GitRunner;
}

export type RenderHostCommentResult =
  | { readonly kind: 'body'; readonly body: string }
  | { readonly kind: 'retryable' };

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
    if (!round || round.kind !== 'audit') return { kind: 'retryable' };

    const host = Object.values(storedLedger.ledger.members)
      .find((member) => member.position === round.host);
    if (!host || host.pr !== input.target.pr) return { kind: 'retryable' };

    const storedRecord = await readRouteRecord(git, input.slug, input.target.roundId);
    if (storedRecord.kind !== 'record' || storedRecord.record.kind !== 'audit') return { kind: 'retryable' };

    const allocation = storedRecord.record.allocation[round.host];
    if (!allocation) return { kind: 'retryable' };

    const commits = await git(['log', '--format=%s', `${host.publishedTip}..${host.recordedTip}`]);
    if (commits.exitCode !== 0) return { kind: 'retryable' };

    const lines = [
      'The routed audit fix has been published.',
      '',
      'Commits included:',
      ...commits.stdout.split('\n').map((subject) => subject.trim()).filter(Boolean).map((subject) => `- ${subject}`),
    ];

    const items = storedRecord.record.items.filter((item) => item.host === round.host);
    if (items.length > 0) {
      lines.push('', 'Audit findings addressed:');
      for (const item of items) {
        lines.push(`- ${item.findingId}: ${item.reason}${item.rationale ? ` — ${item.rationale}` : ''}`);
      }
    }

    if (allocation.retryHint) lines.push('', `Retry hint: ${allocation.retryHint}`);

    if (storedRecord.record.pendingAsBuiltFindings?.length) {
      lines.push('', 'Pending as-built findings:');
      for (const finding of storedRecord.record.pendingAsBuiltFindings) {
        lines.push(`- ${finding.summary} — ${finding.governingClause}`);
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

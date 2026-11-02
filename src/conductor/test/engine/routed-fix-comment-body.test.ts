// Covers: task:12
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { type GitRunner } from '../../src/engine/rebase.js';
import { renderHostComment } from '../../src/engine/routed-fix-comment.js';
import { type RouteRecord, parseRoundId } from '../../src/engine/routing/route-types.js';
import { refreshLedgerRefFor, routeRecordRefFor } from '../../src/engine/routing/routing-refs.js';
import { type RefreshLedger, type RoutedHostCommentTarget } from '../../src/engine/stack-refresh-ledger.js';
import type { CommitSha } from '../../src/engine/restack/restack-types.js';

const host = parseChildId(1)!;
const r7 = parseRoundId('r7')!;
const sha = (character: string): CommitSha => character.repeat(40) as CommitSha;
const publishedTip = sha('1');
const recordedTip = sha('2');
const routeBlob = sha('a');
const ledgerBlob = sha('b');
const marker = '<!-- conductor:routed-fix:r7:101 -->';

const target: RoutedHostCommentTarget = {
  kind: 'host',
  pr: 101,
  roundId: r7,
  rebaseOnly: [102, 103],
};

function routeRecord(pendingAsBuiltFindings: RouteRecord['pendingAsBuiltFindings'] = []): RouteRecord {
  return {
    roundId: r7,
    kind: 'audit',
    phase: 'closed',
    items: [{
      findingId: 'AUD-17',
      kind: 'audit',
      owner: host,
      host,
      reason: 'the host owns the shared renderer',
      rationale: 'the repair changes the renderer used by every child',
      fallback: [host],
    }],
    allocation: {
      [host]: {
        remTaskIds: ['rem-audit-17'],
        blockBodies: ['repair the routed audit finding'],
        retryHint: 'Preserve the existing child approval while fixing the renderer.',
      },
    },
    hosts: { [host]: 'done' },
    currentHostIndex: 0,
    receipt: { laps: {}, growth: 0, taskless: {}, echo: {}, acks: {} },
    sealedAuthored: 1,
    pendingAsBuiltFindings,
    outbox: [],
  };
}

function ledger(): RefreshLedger {
  return {
    version: 1,
    members: {
      'feat/c1/demo': { position: host, pr: 101, publishedTip, recordedTip },
    },
    rounds: [{ roundId: r7, kind: 'audit', host, marker }],
    aboveOwed: [],
    posted: [],
  };
}

function gitFor(record: RouteRecord): GitRunner {
  return async (args) => {
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1);
      if (ref === routeRecordRefFor('demo', r7)) return { exitCode: 0, stdout: `${routeBlob}\n`, stderr: '' };
      if (ref === refreshLedgerRefFor('demo')) return { exitCode: 0, stdout: `${ledgerBlob}\n`, stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'cat-file') {
      if (args.at(-1) === routeBlob) return { exitCode: 0, stdout: JSON.stringify(record), stderr: '' };
      if (args.at(-1) === ledgerBlob) return { exitCode: 0, stdout: JSON.stringify(ledger()), stderr: '' };
    }
    if (args[0] === 'log') {
      expect(args).toContain(`${publishedTip}..${recordedTip}`);
      return { exitCode: 0, stdout: 'fix: preserve reviewer approval\ntest: cover the refreshed route\n', stderr: '' };
    }
    throw new Error(`unexpected Git call: ${args.join(' ')}`);
  };
}

describe('renderHostComment for routed audit rounds', () => {
  it('lists new commit subjects, the audit item placement and rationale, and the host retry hint', async () => {
    const result = await renderHostComment({ worktree: '/unused', slug: 'demo', target, git: gitFor(routeRecord()) });

    expect(result).toMatchObject({ kind: 'body' });
    if (result.kind !== 'body') throw new Error('expected a rendered comment body');
    expect(result.body).toContain('fix: preserve reviewer approval');
    expect(result.body).toContain('test: cover the refreshed route');
    expect(result.body).toContain('AUD-17');
    expect(result.body).toContain('the host owns the shared renderer');
    expect(result.body).toContain('the repair changes the renderer used by every child');
    expect(result.body).toContain('Preserve the existing child approval while fixing the renderer.');
  });

  it('includes pending as-built finding summaries and their governing clauses', async () => {
    const result = await renderHostComment({
      worktree: '/unused',
      slug: 'demo',
      target,
      git: gitFor(routeRecord([{
        gate: 'architecture_review_as_built',
        finding: 'AB-4',
        class: 'REMEDIABLE',
        governingClause: 'adr-routed-stack decision 7',
        summary: 'The published refresh must retain the audit reason.',
        outcome: 'remediated',
      }])),
    });

    expect(result).toMatchObject({ kind: 'body' });
    if (result.kind !== 'body') throw new Error('expected a rendered comment body');
    expect(result.body).toContain('The published refresh must retain the audit reason.');
    expect(result.body).toContain('adr-routed-stack decision 7');
  });

  it('names every rebase-only PR as rebased without a diff change and writes one marker', async () => {
    const result = await renderHostComment({ worktree: '/unused', slug: 'demo', target, git: gitFor(routeRecord()) });

    expect(result).toMatchObject({ kind: 'body' });
    if (result.kind !== 'body') throw new Error('expected a rendered comment body');
    expect(result.body).toMatch(/PR #102[^\n]*rebased[^\n]*no diff change/i);
    expect(result.body).toMatch(/PR #103[^\n]*rebased[^\n]*no diff change/i);
    expect(result.body.split(marker)).toHaveLength(2);
  });
});

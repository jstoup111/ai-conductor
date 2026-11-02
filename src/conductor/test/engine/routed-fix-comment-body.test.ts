// Covers: task:12, task:13
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { type GitRunner } from '../../src/engine/rebase.js';
import { renderHostComment, renderMemberAboveComment } from '../../src/engine/routed-fix-comment.js';
import { type RouteRecord, parseRoundId } from '../../src/engine/routing/route-types.js';
import { refreshLedgerRefFor, routeRecordRefFor } from '../../src/engine/routing/routing-refs.js';
import {
  type RefreshLedger,
  type RoutedHostCommentTarget,
  type RoutedMemberAboveCommentTarget,
} from '../../src/engine/stack-refresh-ledger.js';
import type { CommitSha } from '../../src/engine/restack/restack-types.js';

const host = parseChildId(1)!;
const r7 = parseRoundId('r7')!;
const sha = (character: string): CommitSha => character.repeat(40) as CommitSha;
const publishedTip = sha('1');
const recordedTip = sha('2');
const routeBlob = sha('a');
const ledgerBlob = sha('b');
const revalidationQueueBlob = sha('c');
const marker = '<!-- conductor:routed-fix:r7:101 -->';
const aboveMarker = `<!-- conductor:routed-refresh:${recordedTip}:102 -->`;

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

function ledger(options: {
  readonly kind?: RouteRecord['kind'];
  readonly aboveOwed?: RefreshLedger['aboveOwed'];
} = {}): RefreshLedger {
  return {
    version: 1,
    members: {
      'feat/c1/demo': { position: host, pr: 101, publishedTip, recordedTip },
    },
    rounds: [{ roundId: r7, kind: options.kind ?? 'audit', host, marker }],
    aboveOwed: options.aboveOwed ?? [],
    posted: [],
  };
}

function revalidationQueue() {
  return {
    generation: 1,
    entries: [{
      child: host,
      position: host,
      closureSha: sha('d'),
      gates: ['test_suite'],
      replay: { oldParent: sha('e'), newParent: sha('f') },
      state: 'queued',
    }],
    outbox: [],
  };
}

function gitFor(record: RouteRecord, refreshLedger = ledger({ kind: record.kind })): GitRunner {
  return async (args) => {
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1);
      if (ref === routeRecordRefFor('demo', r7)) return { exitCode: 0, stdout: `${routeBlob}\n`, stderr: '' };
      if (ref === refreshLedgerRefFor('demo')) return { exitCode: 0, stdout: `${ledgerBlob}\n`, stderr: '' };
      return { exitCode: 1, stdout: '', stderr: '' };
    }
    if (args[0] === 'cat-file') {
      if (args.at(-1) === routeBlob) return { exitCode: 0, stdout: JSON.stringify(record), stderr: '' };
      if (args.at(-1) === ledgerBlob) return { exitCode: 0, stdout: JSON.stringify(refreshLedger), stderr: '' };
      if (args.at(-1) === revalidationQueueBlob) return { exitCode: 0, stdout: JSON.stringify(revalidationQueue()), stderr: '' };
    }
    if (args[0] === 'log') {
      expect(args).toContain(`${publishedTip}..${recordedTip}`);
      return { exitCode: 0, stdout: 'fix: preserve reviewer approval\ntest: cover the refreshed route\n', stderr: '' };
    }
    throw new Error(`unexpected Git call: ${args.join(' ')}`);
  };
}

function operatorRouteRecord(): RouteRecord {
  return {
    ...routeRecord(),
    kind: 'operator',
    items: [],
    operator: {
      origin: 'land',
      reason: 'The landing owner requested a focused repair.',
      operator: 'operator@example.test',
      entryStep: 'test_suite',
      carried: [],
      otherTips: { 'feat/c1/demo': recordedTip },
      priorRegion: {
        statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' },
        verdicts: {},
      },
    },
  };
}

function revalidateRouteRecord(): RouteRecord {
  return {
    ...routeRecord(),
    kind: 'revalidate',
    items: [{
      findingId: 'REVALIDATE-TEST-SUITE',
      kind: 'revalidate',
      owner: host,
      host,
      reason: 'test_suite',
      fallback: [host],
    }],
    entry: {
      host,
      pinnedBase: sha('d'),
      tree: sha('e'),
      revalidation: { queueBlob: revalidationQueueBlob, generation: 1, closureSha: sha('d') },
    },
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
    expect(result.body.split(marker)).toHaveLength(2);
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
    expect(result.body.split(marker)).toHaveLength(2);
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

describe('renderHostComment for operator and revalidate rounds', () => {
  it('lists newly published commits, the operator reason, and operator identity', async () => {
    const result = await renderHostComment({
      worktree: '/unused', slug: 'demo', target, git: gitFor(operatorRouteRecord()),
    });

    expect(result).toMatchObject({ kind: 'body' });
    if (result.kind !== 'body') throw new Error('expected a rendered comment body');
    expect(result.body).toContain('fix: preserve reviewer approval');
    expect(result.body).toContain('The landing owner requested a focused repair.');
    expect(result.body).toContain('operator@example.test');
    expect(result.body.split(marker)).toHaveLength(2);
  });

  it('says a re-validation repair landed and names the gate', async () => {
    const result = await renderHostComment({
      worktree: '/unused', slug: 'demo', target, git: gitFor(revalidateRouteRecord()),
    });

    expect(result).toMatchObject({ kind: 'body' });
    if (result.kind !== 'body') throw new Error('expected a rendered comment body');
    expect(result.body).toMatch(/re-validation repair landed/i);
    expect(result.body).toContain('test_suite');
    expect(result.body.split(marker)).toHaveLength(2);
  });
});

describe('renderMemberAboveComment', () => {
  it('describes the changed carried diff, links the host PR, and writes one marker', async () => {
    const member: RoutedMemberAboveCommentTarget = {
      kind: 'member-above', pr: 102, hostPr: 101, newTip: recordedTip,
    };

    const result = await renderMemberAboveComment({
      worktree: '/unused', slug: 'demo', target: member, git: gitFor(routeRecord()),
    });

    expect(result).toMatchObject({ kind: 'body' });
    if (result.kind !== 'body') throw new Error('expected a rendered comment body');
    expect(result.body).toMatch(/diff changed while carrying/i);
    expect(result.body).toContain('#101');
    expect(result.body.split(aboveMarker)).toHaveLength(2);
  });
});

describe('renderHostComment safety', () => {
  it('returns retryable without a body when the route record is unreadable', async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === 'rev-parse') {
        const ref = args.at(-1);
        if (ref === routeRecordRefFor('demo', r7)) return { exitCode: 0, stdout: `${routeBlob}\n`, stderr: '' };
        if (ref === refreshLedgerRefFor('demo')) return { exitCode: 0, stdout: `${ledgerBlob}\n`, stderr: '' };
      }
      if (args[0] === 'cat-file' && args.at(-1) === routeBlob) return { exitCode: 0, stdout: '{', stderr: '' };
      if (args[0] === 'cat-file' && args.at(-1) === ledgerBlob) return { exitCode: 0, stdout: JSON.stringify(ledger()), stderr: '' };
      throw new Error(`unexpected Git call: ${args.join(' ')}`);
    };

    await expect(renderHostComment({ worktree: '/unused', slug: 'demo', target, git })).resolves.toEqual({ kind: 'retryable' });
  });

  it('renders a placement code without a rationale and strips stale finding markers', async () => {
    const record: RouteRecord = {
      ...routeRecord(),
      items: [{
        findingId: 'AUD-18 <!-- conductor:routed-fix:r2:998 -->', kind: 'audit', owner: host, host,
        reason: 'PLACEMENT-CODE <!-- conductor:routed-fix:r1:999 -->',
        fallback: [host],
      }],
      pendingAsBuiltFindings: [{
        gate: 'architecture_review_as_built', finding: 'AB-5', class: 'REMEDIABLE', outcome: 'remediated',
        summary: 'Pending <!-- conductor:routed-fix:r3:997 -->',
        governingClause: 'Clause <!-- conductor:routed-fix:r4:996 -->',
      }],
    };

    const result = await renderHostComment({ worktree: '/unused', slug: 'demo', target, git: gitFor(record) });

    expect(result).toMatchObject({ kind: 'body' });
    if (result.kind !== 'body') throw new Error('expected a rendered comment body');
    expect(result.body).toContain('AUD-18');
    expect(result.body).toContain('PLACEMENT-CODE');
    expect(result.body).not.toContain('r1:999');
    expect(result.body).not.toContain('r2:998');
    expect(result.body).not.toContain('r3:997');
    expect(result.body).not.toContain('r4:996');
    expect(result.body).not.toContain('PLACEMENT-CODE —');
    expect(result.body.split(marker)).toHaveLength(2);
  });
});

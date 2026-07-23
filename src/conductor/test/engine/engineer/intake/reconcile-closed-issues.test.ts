// reconcileClosedIssues — brain sweep that forgets ledger entries whose
// backing GitHub issue is closed, and removes the matching inbox envelope.
// Task 10 of intake-claim-closed-issue-guard-and-brain-sweep plan.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../../src/engine/engineer/intake/queue.js';
import { reconcileClosedIssues } from '../../../../src/engine/engineer/intake/reconcile-closed-issues.js';
import type { Envelope } from '../../../../src/engine/engineer/intake/port.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reconcile-closed-issues-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function envelope(id: string, sourceRef: string): Envelope {
  return {
    id,
    source: 'github-issues',
    sourceRef,
    text: `idea for ${sourceRef}`,
    status: 'pending',
    receivedAt: `2026-07-2${id}T00:00:00.000Z`,
  };
}

describe('reconcileClosedIssues', () => {
  it('forgets pending github-issues ledger entries whose issue is closed, and removes their inbox envelope', async () => {
    const ledger = createLedger(join(dir, 'ledger.json'));
    const queue = createFileQueue(join(dir, 'inbox'));

    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' }); // A - closed
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#2' }); // B - open
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#3' }); // C - closed

    const envA = envelope('1', 'o/a#1');
    const envB = envelope('2', 'o/a#2');
    const envC = envelope('3', 'o/a#3');
    await queue.enqueue(envA);
    await queue.enqueue(envB);
    await queue.enqueue(envC);

    const issueStates: Record<string, 'open' | 'closed' | null> = {
      'o/a#1': 'closed',
      'o/a#2': 'open',
      'o/a#3': 'closed',
    };

    const summary = await reconcileClosedIssues(
      {
        ledger,
        queue,
        getIssueState: async (repo: string, issue: string) => {
          const key = `${repo}#${issue}`;
          return issueStates[key] ?? null;
        },
      },
      { dryRun: false },
    );

    expect(summary.scanned).toBe(3);
    expect(summary.forgotten).toBe(2);

    expect(await ledger.get('github-issues', 'o/a#1')).toBeUndefined();
    expect(await ledger.get('github-issues', 'o/a#3')).toBeUndefined();

    const remainingEntry = await ledger.get('github-issues', 'o/a#2');
    expect(remainingEntry?.status).toBe('pending');

    const remainingEnvelopes = await queue.list();
    expect(remainingEnvelopes.map((e) => e.id).sort()).toEqual(['2']);
  });

  it('sweeps only pending entries — claimed/routed/done entries are never forgotten even if their issue is closed', async () => {
    const ledger = createLedger(join(dir, 'ledger.json'));
    const queue = createFileQueue(join(dir, 'inbox'));

    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' }); // pending, closed
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#2' }); // claimed, closed
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#3' }); // routed, closed
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#4' }); // done, closed

    await ledger.transition('github-issues', 'o/a#2', 'claimed');
    await ledger.transition('github-issues', 'o/a#3', 'routed');
    await ledger.transition('github-issues', 'o/a#4', 'done');

    const issueStates: Record<string, 'open' | 'closed' | null> = {
      'o/a#1': 'closed',
      'o/a#2': 'closed',
      'o/a#3': 'closed',
      'o/a#4': 'closed',
    };

    const summary = await reconcileClosedIssues({
      ledger,
      queue,
      getIssueState: async (repo: string, issue: string) => {
        const key = `${repo}#${issue}`;
        return issueStates[key] ?? null;
      },
    });

    expect(summary.scanned).toBe(1);
    expect(summary.forgotten).toBe(1);

    expect(await ledger.get('github-issues', 'o/a#1')).toBeUndefined();

    const claimed = await ledger.get('github-issues', 'o/a#2');
    expect(claimed?.status).toBe('claimed');

    const routed = await ledger.get('github-issues', 'o/a#3');
    expect(routed?.status).toBe('routed');

    const done = await ledger.get('github-issues', 'o/a#4');
    expect(done?.status).toBe('done');
  });

  it('isolates a mid-batch getIssueState throw — surrounding entries still processed, error counted, batch not aborted', async () => {
    const ledger = createLedger(join(dir, 'ledger.json'));
    const queue = createFileQueue(join(dir, 'inbox'));

    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' }); // closed
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#2' }); // throws
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#3' }); // closed

    await queue.enqueue(envelope('1', 'o/a#1'));
    await queue.enqueue(envelope('2', 'o/a#2'));
    await queue.enqueue(envelope('3', 'o/a#3'));

    const summary = await reconcileClosedIssues({
      ledger,
      queue,
      getIssueState: async (repo: string, issue: string) => {
        const key = `${repo}#${issue}`;
        if (key === 'o/a#2') throw new Error('gh api boom');
        if (key === 'o/a#1' || key === 'o/a#3') return 'closed';
        return null;
      },
    });

    expect(summary.scanned).toBe(3);
    expect(summary.forgotten).toBe(2);
    expect(summary.errors).toBe(1);

    expect(await ledger.get('github-issues', 'o/a#1')).toBeUndefined();
    expect(await ledger.get('github-issues', 'o/a#3')).toBeUndefined();

    const untouched = await ledger.get('github-issues', 'o/a#2');
    expect(untouched?.status).toBe('pending');
  });

  it('total getIssueState outage (every call returns null) forgets nothing', async () => {
    const ledger = createLedger(join(dir, 'ledger.json'));
    const queue = createFileQueue(join(dir, 'inbox'));

    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#2' });
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#3' });

    const summary = await reconcileClosedIssues({
      ledger,
      queue,
      getIssueState: async () => null,
    });

    expect(summary.scanned).toBe(3);
    expect(summary.forgotten).toBe(0);
    expect(summary.errors).toBe(0);

    expect((await ledger.get('github-issues', 'o/a#1'))?.status).toBe('pending');
    expect((await ledger.get('github-issues', 'o/a#2'))?.status).toBe('pending');
    expect((await ledger.get('github-issues', 'o/a#3'))?.status).toBe('pending');
  });

  it('dryRun reports would-forget counts but mutates nothing — ledger entries and inbox envelopes remain untouched', async () => {
    const ledger = createLedger(join(dir, 'ledger.json'));
    const queue = createFileQueue(join(dir, 'inbox'));

    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' }); // closed
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#2' }); // open
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#3' }); // closed

    await queue.enqueue(envelope('1', 'o/a#1'));
    await queue.enqueue(envelope('2', 'o/a#2'));
    await queue.enqueue(envelope('3', 'o/a#3'));

    const issueStates: Record<string, 'open' | 'closed' | null> = {
      'o/a#1': 'closed',
      'o/a#2': 'open',
      'o/a#3': 'closed',
    };

    const summary = await reconcileClosedIssues(
      {
        ledger,
        queue,
        getIssueState: async (repo: string, issue: string) => {
          const key = `${repo}#${issue}`;
          return issueStates[key] ?? null;
        },
      },
      { dryRun: true },
    );

    expect(summary.scanned).toBe(3);
    expect(summary.forgotten).toBe(2);
    expect(summary.errors).toBe(0);

    // No mutation: ledger entries still present and pending.
    expect((await ledger.get('github-issues', 'o/a#1'))?.status).toBe('pending');
    expect((await ledger.get('github-issues', 'o/a#2'))?.status).toBe('pending');
    expect((await ledger.get('github-issues', 'o/a#3'))?.status).toBe('pending');

    // No mutation: all inbox envelopes still present.
    const remainingEnvelopes = await queue.list();
    expect(remainingEnvelopes.map((e) => e.id).sort()).toEqual(['1', '2', '3']);
  });
});

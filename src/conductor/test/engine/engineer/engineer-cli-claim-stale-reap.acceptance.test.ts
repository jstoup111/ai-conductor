// Acceptance spec for claim-time stale-claim auto-heal (#468).
//
// Covers: FR-1, FR-2, FR-3, FR-4, FR-10, FR-11, FR-12
//
// .docs/stories/engineer-unclaim-requeue-verb-stale-claimed-ledger.md classifies most
// criteria as single CLI operations (`engineer unclaim <ref>`, `engineer requeue --stale`),
// which the plan (.docs/plans/engineer-unclaim-requeue-verb-stale-claimed-ledger.md,
// Tasks 8-14) covers with unit tests directly on `engineer-cli.ts`'s `dispatchEngineer`
// entry point (already the real production entry point for those verbs, per this
// codebase's own convention — see engineer-cli-resolve.test.ts).
//
// The genuinely cross-operation criteria are Stories 1, 2, and 8: the automatic reap
// (`claimed` → `pending`) and the subsequent dequeue happen inside ONE `engineer claim`
// call (Story 1's Then-clause: "eligible to be claimed on that same pull"). The plan's
// own Tasks 5-7 test this reap+precedence logic directly on `delivery-guard.ts`'s
// `createDeliveryGuardedQueue` in isolation — which proves the guard's internal behavior
// but not that the REAL `engineer claim` command (which layers `claimUnblocked` +
// priority-band resolution on top of the guarded queue, engineer-cli.ts's `case 'claim'`)
// actually surfaces a reaped idea, in FIFO order, on the same pull. A guard unit test can
// pass while the real CLI entry point never wires the reap into what's returned to the
// operator — the exact "primitive ships with zero production callers" failure class this
// harness has shipped before. This spec drives `dispatchEngineer` directly (not
// `createDeliveryGuardedQueue` in isolation) and asserts only the OBSERVABLE guarantees
// the stories pin (which idea is served, and the ledger's status/capturedAt/attempts
// fields) — not the reap mechanism's internal shape (e.g. whatever envelope text a
// reaped-with-no-original-envelope entry is reconstructed with, which no story/FR pins).
//
// Pre-implementation: `requeueClaimed`, `isStaleClaim`, and the reap pass inside
// `createDeliveryGuardedQueue` don't exist yet (RED): a stale `claimed` entry with no
// queued envelope is invisible to today's guard, so `engineer claim` reports it `empty`
// (or serves an unrelated pending idea) instead of reaping and serving it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import { createLedger, type LedgerEntry } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../src/engine/engineer/intake/port.js';

const SOURCE = 'github-issues';

// Comfortably past / within the ADR-approved 24h default staleness window
// (adr-2026-07-22-stale-claim-staleness-window-default.md) — no config override needed.
const STALE_AGE_MS = 25 * 60 * 60 * 1000;
const FRESH_AGE_MS = 60 * 60 * 1000;

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** Same gh stub shape as engineer-cli-claim-delivery-guard.test.ts: OPEN PRs, no
 * dependency links, empty label sets — so the claim path never blocks/drops on gh. */
function makeGh() {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      return { stdout: JSON.stringify({ state: 'OPEN', mergedAt: null }) };
    }
    if (args[0] === 'issue' && args[1] === 'list') {
      return { stdout: JSON.stringify([]) };
    }
    // Covers `gh api repos/<o>/<r>/issues/<n>` (label reader) and `issue view` (liveness probe).
    return { stdout: JSON.stringify({}) };
  };
  return { gh, calls };
}

let workDir: string;
let engineerDir: string;
let ledgerPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-claim-stale-reap-'));
  engineerDir = join(workDir, 'engineer');
  ledgerPath = join(engineerDir, 'ledger.json');
  await mkdir(engineerDir, { recursive: true });
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** Seed (or overwrite) a raw ledger entry, bypassing the Ledger API — the only way to
 * backdate `lastSeenAt`/`capturedAt`, since every `Ledger` mutator stamps "now". */
async function seedLedgerEntry(entry: LedgerEntry): Promise<void> {
  let store: Record<string, LedgerEntry> = {};
  try {
    store = JSON.parse(await readFile(ledgerPath, 'utf8'));
  } catch {
    // absent — start empty
  }
  await mkdir(dirname(ledgerPath), { recursive: true });
  store[`${entry.source}\0${entry.sourceRef}`] = entry;
  await writeFile(ledgerPath, JSON.stringify(store, null, 2), 'utf8');
}

function captureOut() {
  const out: string[] = [];
  const err: string[] = [];
  const opts = (extra: Partial<DispatchEngineerOpts>): DispatchEngineerOpts => ({
    engineerDir,
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  });
  return { out, err, opts };
}

describe('engineer claim: stale-claim auto-heal reaches the real dispatchEngineer entry point', () => {
  it('reaps a stale claimed idea to pending, announces it, and serves it on the same pull (Story 1 happy, FR-1/2/12)', async () => {
    const sourceRef = 'o/a#501';
    await seedLedgerEntry({
      source: SOURCE,
      sourceRef,
      status: 'claimed',
      attempts: 0,
      capturedAt: '2026-07-01T00:00:00.000Z',
      lastSeenAt: isoAgo(STALE_AGE_MS),
    });

    const { out, err, opts } = captureOut();
    const { gh } = makeGh();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));

    expect(code).toBe(0);
    const response = JSON.parse(out[0]);
    expect(response).toMatchObject({ kind: 'claim', source: SOURCE, sourceRef });

    // FR-12: the recovered idea is announced to the operator, not silently reaped.
    expect(err.some((line) => line.includes(sourceRef))).toBe(true);

    const ledger = createLedger(ledgerPath);
    const after = await ledger.get(SOURCE, sourceRef);
    expect(after?.status).toBe('claimed'); // reaped to pending, then re-served this same pull
    expect(after?.capturedAt).toBe('2026-07-01T00:00:00.000Z'); // FR-4: capture-time preserved
  });

  it('does not reap or announce a claimed idea within the staleness window (Story 1 negative, FR-3/10)', async () => {
    const sourceRef = 'o/a#502';
    await seedLedgerEntry({
      source: SOURCE,
      sourceRef,
      status: 'claimed',
      attempts: 0,
      capturedAt: isoAgo(FRESH_AGE_MS),
      lastSeenAt: isoAgo(FRESH_AGE_MS),
    });

    const { out, err, opts } = captureOut();
    const { gh } = makeGh();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));

    expect(code).toBe(0);
    // No other pending idea exists, so a still-live claim must leave the queue empty.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', empty: true });
    expect(err.some((line) => line.includes(sourceRef))).toBe(false);

    const ledger = createLedger(ledgerPath);
    const after = await ledger.get(SOURCE, sourceRef);
    expect(after?.status).toBe('claimed');
    expect(after?.attempts).toBe(0);
  });

  it('serves a reaped older idea before a newer pending idea, preserving FIFO and bumping churn (Story 2, FR-4/11)', async () => {
    const staleRef = 'o/a#503'; // older capturedAt, stale-claimed
    const pendingRef = 'o/a#504'; // newer capturedAt, healthy pending

    await seedLedgerEntry({
      source: SOURCE,
      sourceRef: staleRef,
      status: 'claimed',
      attempts: 0,
      capturedAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: isoAgo(STALE_AGE_MS),
    });

    const ledger = createLedger(ledgerPath);
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    await ledger.record({ source: SOURCE, sourceRef: pendingRef });
    const pendingEnvelope: Envelope = {
      id: 'env-504',
      source: SOURCE,
      sourceRef: pendingRef,
      text: 'a healthy newer idea',
      receivedAt: new Date().toISOString(),
    };
    await queue.enqueue(pendingEnvelope);

    const { out, opts } = captureOut();
    const { gh } = makeGh();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));

    expect(code).toBe(0);
    // The reaped, older idea wins — not the newer healthy pending one.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', source: SOURCE, sourceRef: staleRef });

    const afterStale = await ledger.get(SOURCE, staleRef);
    expect(afterStale?.capturedAt).toBe('2026-01-01T00:00:00.000Z'); // FR-4
    expect(afterStale?.attempts).toBeGreaterThanOrEqual(1); // FR-11: churn recorded

    // The newer idea is untouched — still pending, still queued for the next pull.
    const afterPending = await ledger.get(SOURCE, pendingRef);
    expect(afterPending?.status).toBe('pending');
  });

  it('reaps only the stale claimed entry, leaving an old delivered entry untouched (Story 8, FR-6 boundary)', async () => {
    const claimedRef = 'o/a#505';
    const doneRef = 'o/a#506';
    const doneEntry: LedgerEntry = {
      source: SOURCE,
      sourceRef: doneRef,
      status: 'done',
      attempts: 0,
      prUrl: 'https://github.com/o/a/pull/900',
      capturedAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: isoAgo(STALE_AGE_MS),
    };
    await seedLedgerEntry(doneEntry);
    await seedLedgerEntry({
      source: SOURCE,
      sourceRef: claimedRef,
      status: 'claimed',
      attempts: 0,
      capturedAt: '2026-01-02T00:00:00.000Z',
      lastSeenAt: isoAgo(STALE_AGE_MS),
    });

    const { out, opts } = captureOut();
    const { gh } = makeGh();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', source: SOURCE, sourceRef: claimedRef });

    const ledger = createLedger(ledgerPath);
    // The done entry is byte-for-byte untouched by the reap.
    const afterDone = await ledger.get(SOURCE, doneRef);
    expect(afterDone).toEqual(doneEntry);
  });
});

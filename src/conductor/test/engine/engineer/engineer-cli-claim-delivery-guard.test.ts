// Acceptance spec for the Engineer Claim Delivery Guard (#243).
//
// .docs/stories/engineer-claim-delivery-guard.md classifies every guard/handoff
// criterion as a single CLI operation (`engineer claim` or `engineer handoff`),
// which the plan (.docs/plans/engineer-claim-delivery-guard.md, Tasks 1-10) covers
// with unit tests directly on `delivery-guard.ts` and the engineer-cli suite.
//
// The ONE story criterion that genuinely crosses two operations is the
// "`engineer resolve` marks an entry delivered" Done-When bullet: "After resolve,
// a subsequent `engineer claim` with a duplicate envelope for that ref heals/drops
// it via the TR-1 guard (integration of the two halves)." (plan Task 13). This spec
// drives the REAL `dispatchEngineer` entry point for BOTH commands in sequence —
// not the new `delivery-guard.ts` unit in isolation — so it fails if either half is
// unimplemented or if the two are wired together incorrectly.
//
// `resolve` does not exist on `EngineerDispatch` yet (RED): dispatch objects are
// built as plain objects and cast, so this compiles today and fails at runtime for
// the right reason (no matching switch case / guard not wired) until Tasks 8-13 land.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  dispatchEngineer,
  type DispatchEngineerOpts,
  type EngineerDispatch,
} from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import type { Envelope } from '../../../src/engine/engineer/intake/port.js';

const SOURCE = 'github-issues';
const SOURCE_REF = 'o/a#243';
const PR_URL = 'https://github.com/o/a/pull/999';

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: 'env-1',
    source: SOURCE,
    sourceRef: SOURCE_REF,
    text: 'duplicate re-capture of #243',
    receivedAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

function makeGh(prState: 'OPEN' | 'MERGED' | 'CLOSED' = 'OPEN') {
  const calls: string[][] = [];
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      return { stdout: JSON.stringify({ state: prState, mergedAt: prState === 'MERGED' ? '2026-07-04T00:00:00.000Z' : null }) };
    }
    // For dependency checking (issue list with linked_by filter), return empty
    if (args[0] === 'issue' && args[1] === 'list') {
      return { stdout: JSON.stringify([]) };
    }
    return { stdout: JSON.stringify({}) };
  };
  return { gh, calls };
}

let workDir: string;
let engineerDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-claim-guard-'));
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

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

describe('engineer claim with delivery guard (Task 8: integration of guard into CLI)', () => {
  it('claim heals a delivered entry and drops its duplicate envelope (TR-1 + TR-3)', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));

    // Seed the ledger: entry is already claimed and has prUrl (PR was delivered but
    // we re-captured the same issue as a duplicate envelope).
    await ledger.record({ source: SOURCE, sourceRef: SOURCE_REF });
    await ledger.transition(SOURCE, SOURCE_REF, 'claimed', { prUrl: PR_URL, branch: 'spec/243-guard' });

    // Enqueue a duplicate envelope for the same sourceRef
    await queue.enqueue(makeEnvelope());

    const { out, opts } = captureOut();
    const { gh } = makeGh('OPEN');

    // Run: engineer claim with guard wrapping the queue
    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));

    // Assert: exit code 0
    expect(code).toBe(0);

    // Assert: stdout reports empty queue (guard healed and dropped duplicate)
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', empty: true });

    // Assert: ledger entry is healed to 'done' with prUrl preserved
    const afterClaim = await ledger.get(SOURCE, SOURCE_REF);
    expect(afterClaim).toMatchObject({ status: 'done', prUrl: PR_URL, branch: 'spec/243-guard' });

    // Assert: inbox is empty (duplicate was dropped)
    const inboxFiles = await readdir(join(engineerDir, 'inbox'));
    expect(inboxFiles.filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('claim serves healthy pending entries unchanged (no friction from guard)', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));

    // Seed the ledger: entry is pending (healthy state, not yet claimed)
    await ledger.record({ source: SOURCE, sourceRef: SOURCE_REF });
    await ledger.transition(SOURCE, SOURCE_REF, 'pending');

    // Enqueue an envelope for this pending entry
    await queue.enqueue(makeEnvelope({ text: 'a healthy pending idea' }));

    const { out, opts } = captureOut();
    const { gh, calls } = makeGh('OPEN');

    // Run: engineer claim with guard wrapping the queue
    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));

    // Assert: exit code 0
    expect(code).toBe(0);

    // Assert: stdout reports the claimed entry (not empty, healthy path)
    const claimResponse = JSON.parse(out[0]);
    expect(claimResponse).toMatchObject({
      kind: 'claim',
      sourceRef: SOURCE_REF,
      source: SOURCE,
      text: 'a healthy pending idea',
    });
    // Healthy entries pass through the guard without PR state checks
    // (only entries with ledger + prUrl are checked by the guard)

    // Assert: inbox is empty (envelope was claimed)
    const inboxFiles = await readdir(join(engineerDir, 'inbox'));
    expect(inboxFiles.filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });
});

describe('engineer resolve → engineer claim compose (TR-1 + TR-3 integration, plan Task 13)', () => {
  it('resolves a stranded entry, then a later claim heals/drops the duplicate envelope for it', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const queue = createFileQueue(join(engineerDir, 'inbox'));

    // Strand the entry as `claimed` with no prUrl — the write-back-failure (#290)
    // scenario `engineer resolve` exists to recover from.
    await ledger.record({ source: SOURCE, sourceRef: SOURCE_REF });
    await ledger.transition(SOURCE, SOURCE_REF, 'claimed', { branch: 'spec/243-guard' });

    // A duplicate envelope re-captured for the same idea while it was stranded.
    await queue.enqueue(makeEnvelope());

    const { out, opts } = captureOut();
    const { gh } = makeGh('OPEN');

    // ── resolve ────────────────────────────────────────────────────────────
    const resolveDispatch = {
      kind: 'resolve',
      sourceRef: SOURCE_REF,
      prUrl: PR_URL,
    } as unknown as EngineerDispatch;
    const resolveCode = await dispatchEngineer(resolveDispatch, opts({ gh }));
    expect(resolveCode).toBe(0);

    const afterResolve = await ledger.get(SOURCE, SOURCE_REF);
    expect(afterResolve).toMatchObject({ status: 'done', prUrl: PR_URL, branch: 'spec/243-guard' });

    // ── claim ──────────────────────────────────────────────────────────────
    out.length = 0;
    const claimCode = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));
    expect(claimCode).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', empty: true });

    // The entry stays `done` — resolve's evidence is untouched by the guard's heal.
    const afterClaim = await ledger.get(SOURCE, SOURCE_REF);
    expect(afterClaim).toMatchObject({ status: 'done', prUrl: PR_URL });

    // The duplicate envelope was dropped from the inbox, not served to a session.
    const inboxFiles = await readdir(join(engineerDir, 'inbox'));
    expect(inboxFiles.filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('resolving an unknown sourceRef reports found:false and never authors a duplicate claim', async () => {
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    await queue.enqueue(makeEnvelope({ id: 'env-2', sourceRef: 'o/a#404' }));

    const { out, opts } = captureOut();
    const { gh } = makeGh('OPEN');

    const resolveDispatch = {
      kind: 'resolve',
      sourceRef: 'o/a#404',
      prUrl: PR_URL,
    } as unknown as EngineerDispatch;
    const resolveCode = await dispatchEngineer(resolveDispatch, opts({ gh }));
    expect(resolveCode).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'resolve', sourceRef: 'o/a#404', found: false });

    // No ledger entry was created by resolve, so claim serves the envelope normally
    // (the healthy path gets no friction from an unknown-ref resolve).
    out.length = 0;
    const claimCode = await dispatchEngineer({ kind: 'claim' }, opts({ gh }));
    expect(claimCode).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'o/a#404' });
  });
});

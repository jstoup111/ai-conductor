// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "intake claim closed-issue guard + brain
// reconciliation sweep" (claim-side half — TR-1..TR-5).
//
// Stories: .docs/stories/intake-claim-closed-issue-guard-and-brain-sweep.md
// Plan:    .docs/plans/intake-claim-closed-issue-guard-and-brain-sweep.md
// Design:  .docs/decisions/adr-2026-07-22-intake-closed-issue-reconciliation.md
//
// Drives the REAL production entry point — `dispatchEngineer({kind: 'claim'})`
// — against a real, file-backed IntakeQueue + Ledger (rooted in a scratch
// engineerDir) with only the `gh` shell boundary faked. Per §3b of
// writing-system-tests: a unit test that calls `createDeliveryGuardedQueue`'s
// new issue-state branch directly would pass even if `engineer-cli.ts`'s
// `claim` case never reaches the widened guard — this test fails in that case,
// because it is the #538 regression itself: today, `createDeliveryGuardedQueue`
// (delivery-guard.ts:136) passes a `pending` github-issues candidate straight
// through with NO probe, so `claim` can currently hand out a closed issue.
// None of this feature's production code exists yet (the issue-state probe
// branch, `ledger.forget` wired into the guard, `parseSourceRef`) — every
// test below is expected to FAIL against today's passthrough behavior.
//
// Seam faked here (system boundary only, per the skill's stubbing rules): the
// `gh` shell runner. The queue, ledger, and guard are all real. The fake `gh`
// answers three distinct call shapes the real claim path makes today (label
// read for priority banding, dependency `blocked_by` lookup) plus the NEW
// issue-state probe this feature adds (`gh issue view <n> --json state -q
// .state`, per the plan's Technical Approach) — matched loosely on
// `args[0] === 'issue' && args[1] === 'view'` so this spec does not freeze an
// unconfirmed exact-flag-order assumption.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { dispatchEngineer } from '../../src/engine/engineer-cli.js';
import { createFileQueue } from '../../src/engine/engineer/intake/queue.js';
import { createLedger } from '../../src/engine/engineer/intake/ledger.js';
import { parseEnvelope } from '../../src/engine/engineer/intake/port.js';

// ─── scratch dirs ───────────────────────────────────────────────────────────

let workDirs: string[] = [];
async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'claim-closed-guard-'));
  workDirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
  workDirs = [];
});

// ─── fake gh: answers label-read, blocked_by, and issue-state probe calls ──

type IssueState = 'OPEN' | 'CLOSED' | 'THROW' | 'GARBAGE';

function createFakeGh(issueStates: Record<string, IssueState> = {}) {
  const issueViewCalls: string[][] = [];
  const run = async (args: string[], _opts: { cwd: string }) => {
    if (args[0] === 'issue' && args[1] === 'view') {
      issueViewCalls.push(args);
      const number = String(args[2]);
      const state = issueStates[number];
      if (state === undefined || state === 'THROW') {
        throw new Error(`gh: could not resolve issue #${number}`);
      }
      if (state === 'GARBAGE') {
        return { stdout: 'not json or a state at all {{{' };
      }
      return { stdout: state };
    }
    if (args[0] === 'api') {
      const path = String(args[1] ?? '');
      if (path.includes('dependencies/blocked_by')) return { stdout: '[]' };
      if (path.includes('/issues/')) return { stdout: JSON.stringify({ labels: [] }) };
      return { stdout: '{}' };
    }
    return { stdout: '' };
  };
  return { run, issueViewCalls };
}

// ─── seed helper (mirrors Flow C2 in dependency-ordered-intake-and-dispatch) ─

async function seedInbox(
  engineerDir: string,
  entries: Array<{ source?: string; sourceRef: string; receivedAt: string; text: string }>,
): Promise<{ queue: ReturnType<typeof createFileQueue>; ledger: ReturnType<typeof createLedger> }> {
  const queue = createFileQueue(join(engineerDir, 'inbox'));
  const ledger = createLedger(join(engineerDir, 'ledger.json'));
  for (const entry of entries) {
    const source = entry.source ?? 'github-issues';
    await ledger.record({ source, sourceRef: entry.sourceRef });
    await queue.enqueue(
      parseEnvelope({
        id: entry.sourceRef,
        source,
        sourceRef: entry.sourceRef,
        text: entry.text,
        status: 'pending',
        receivedAt: entry.receivedAt,
      }),
    );
  }
  return { queue, ledger };
}

async function claim(engineerDir: string, gh: ReturnType<typeof createFakeGh>['run']) {
  const out: string[] = [];
  const errs: string[] = [];
  const code = await dispatchEngineer(
    { kind: 'claim' },
    { engineerDir, gh, print: (s) => out.push(s), printErr: (s) => errs.push(s) },
  );
  return { code, result: JSON.parse(out.join('')), errs };
}

// ─────────────────────────────────────────────────────────────────────────────
// TR-1 — Claim delivers an open github issue unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe('TR-1 — claim delivers an open github issue unchanged', () => {
  it('a pending github-issues candidate whose issue is OPEN is delivered unchanged, and the probe is reached exactly once (guards the :136 passthrough regression)', async () => {
    const engineerDir = await freshDir();
    const { ledger } = await seedInbox(engineerDir, [
      { sourceRef: 'acme/app#7', receivedAt: '2026-07-01T00:00:00.000Z', text: 'an open idea' },
    ]);
    const gh = createFakeGh({ '7': 'OPEN' });

    const { code, result } = await claim(engineerDir, gh.run);

    expect(code).toBe(0);
    expect(result).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#7', text: 'an open idea' });

    // The probe was reached for this pending candidate — not skipped by the
    // old healthy-passthrough seam.
    expect(gh.issueViewCalls.length).toBe(1);
    expect(gh.issueViewCalls[0]).toContain('7');

    // Delivered exactly as today: ledger advances to 'claimed', not forgotten.
    expect((await ledger.get('github-issues', 'acme/app#7'))?.status).toBe('claimed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TR-2 — Claim never hands out a closed github issue
// ─────────────────────────────────────────────────────────────────────────────
describe('TR-2 — claim never hands out a closed github issue', () => {
  it('closed candidate (older) then open candidate (newer): the closed one is forgotten+dropped, the OPEN one is returned — the closed one is NEVER returned', async () => {
    const engineerDir = await freshDir();
    const { ledger } = await seedInbox(engineerDir, [
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'dead issue' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'live issue' },
    ]);
    const gh = createFakeGh({ '1': 'CLOSED', '2': 'OPEN' });

    const { code, result } = await claim(engineerDir, gh.run);

    expect(code).toBe(0);
    expect(result.kind).toBe('claim');
    expect(result.sourceRef).toBe('acme/app#2');
    expect(result.text).not.toBe('dead issue');

    // Closed one: forgotten from the ledger (no entry at all — not merely a
    // status change) and dropped from the inbox.
    expect(await ledger.get('github-issues', 'acme/app#1')).toBeUndefined();
    const freshQueue = createFileQueue(join(engineerDir, 'inbox'));
    const remaining = await freshQueue.claim();
    expect(remaining).toBeNull(); // #2 was already claimed above; #1 was dropped, not left pending.
  });

  it('closed candidate is the ONLY item in the queue: claim() forgets+drops it and returns null cleanly — no crash, no exception', async () => {
    const engineerDir = await freshDir();
    const { ledger } = await seedInbox(engineerDir, [
      { sourceRef: 'acme/app#9', receivedAt: '2026-07-01T00:00:00.000Z', text: 'only a dead issue' },
    ]);
    const gh = createFakeGh({ '9': 'CLOSED' });

    const { code, result } = await claim(engineerDir, gh.run);

    expect(code).toBe(0);
    expect(result).toEqual({ kind: 'claim', empty: true });
    expect(await ledger.get('github-issues', 'acme/app#9')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TR-3 — Unknown issue state fails safe (never drop on uncertainty)
// ─────────────────────────────────────────────────────────────────────────────
describe('TR-3 — unknown issue state fails safe', () => {
  it('getIssueState returning an unconfirmed/unparseable result delivers the candidate as if OPEN — ledger entry is not forgotten', async () => {
    const engineerDir = await freshDir();
    const { ledger } = await seedInbox(engineerDir, [
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-01T00:00:00.000Z', text: 'unconfirmed state' },
    ]);
    const gh = createFakeGh({ '3': 'GARBAGE' });

    const { code, result } = await claim(engineerDir, gh.run);

    expect(code).toBe(0);
    expect(result).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#3' });
    // Delivered — not forgotten. The entry still exists and progresses normally.
    expect((await ledger.get('github-issues', 'acme/app#3'))?.status).toBe('claimed');
    // The probe was actually attempted (and returned garbage) — distinguishes
    // "fail-safe after a real probe" from "no probe exists yet" (today's
    // behavior, which would trivially satisfy the assertions above without
    // this feature existing at all).
    expect(gh.issueViewCalls.length).toBe(1);
  });

  it('getIssueState throwing (gh failure) is caught and mapped to the same fail-safe deliver outcome — no candidate is dropped on an exception', async () => {
    const engineerDir = await freshDir();
    const { ledger } = await seedInbox(engineerDir, [
      { sourceRef: 'acme/app#4', receivedAt: '2026-07-01T00:00:00.000Z', text: 'gh is down' },
    ]);
    const gh = createFakeGh({ '4': 'THROW' });

    const { code, result } = await claim(engineerDir, gh.run);

    expect(code).toBe(0);
    expect(result).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#4' });
    expect((await ledger.get('github-issues', 'acme/app#4'))?.status).toBe('claimed');
    // Same rationale as the GARBAGE case above: prove the probe actually ran
    // (and threw) rather than never having existed.
    expect(gh.issueViewCalls.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TR-4 / TR-5 — Non-github-issues envelopes and malformed refs bypass the probe
//
// These two drive `createDeliveryGuardedQueue` directly (still the REAL
// production guard, still wrapping a REAL file-backed queue + ledger) rather
// than the full `dispatchEngineer({kind:'claim'})` stack used above. Reason:
// the full CLI stack also runs the pre-existing, unrelated dependency-order
// gate (`claimUnblocked` + `createBlockerResolver`, #229) downstream of the
// guard, and THAT gate independently treats any sourceRef it cannot parse as
// `owner/repo#n` (including a non-github-issues chat-turn ref, or this
// story's own "no #" malformed-ref example) as `indeterminate` -> deferred —
// which would make the CLI-level claim() result reflect the OTHER feature's
// behavior, not this guard's. Testing the guard directly isolates exactly
// what TR-4/TR-5 assert (probe skipped, candidate not dropped) from that
// unrelated coupling.
// ─────────────────────────────────────────────────────────────────────────────
describe('TR-4 — non-github-issues envelopes bypass the issue probe', () => {
  // Note: this passes both before AND after this feature ships — today's
  // guard has no probe of any kind, so it trivially makes zero calls. It is
  // a permanent regression backstop (source-scoping must never regress to
  // probing every source), not a RED signal on its own; TR-1/TR-2/TR-3/TR-5
  // above and below fail against today's code and carry this file's RED
  // evidence.
  it('a candidate whose source is not github-issues reaches delivery with ZERO getIssueState calls', async () => {
    const engineerDir = await freshDir();
    const { queue, ledger } = await seedInbox(engineerDir, [
      {
        source: 'claude-session',
        sourceRef: 'chat-turn-abc123',
        receivedAt: '2026-07-01T00:00:00.000Z',
        text: 'an idea from chat, not github',
      },
    ]);
    const gh = createFakeGh();
    const { createDeliveryGuardedQueue } = await import(
      '../../src/engine/engineer/intake/delivery-guard.js'
    );
    const guarded = createDeliveryGuardedQueue(queue, ledger as any, { gh: gh.run });

    const delivered = await guarded.claim();

    expect(delivered).toMatchObject({ source: 'claude-session', sourceRef: 'chat-turn-abc123' });
    expect(gh.issueViewCalls.length).toBe(0);
  });
});

describe('TR-5 — a malformed sourceRef never causes a wrongful drop', () => {
  it('a github-issues candidate whose sourceRef has no "#" (un-parseable) is delivered — not dropped — with the probe skipped and a diagnostic logged', async () => {
    const engineerDir = await freshDir();
    const { queue, ledger } = await seedInbox(engineerDir, [
      {
        sourceRef: 'acme/app', // no "#n" — cannot be parsed into (repo, issue)
        receivedAt: '2026-07-01T00:00:00.000Z',
        text: 'malformed ref',
      },
    ]);
    const gh = createFakeGh();
    const logLines: string[] = [];
    const { createDeliveryGuardedQueue } = await import(
      '../../src/engine/engineer/intake/delivery-guard.js'
    );
    const guarded = createDeliveryGuardedQueue(queue, ledger as any, {
      gh: gh.run,
      logger: { info: (msg: string) => logLines.push(msg) },
    });

    const delivered = await guarded.claim();

    expect(delivered).toMatchObject({ source: 'github-issues', sourceRef: 'acme/app' });
    expect(gh.issueViewCalls.length).toBe(0);
    // Ledger untouched — still 'pending' (not forgotten).
    expect((await ledger.get('github-issues', 'acme/app'))?.status).toBe('pending');
    // A diagnostic surfaces the skipped probe (loose match — exact wording is
    // an implementation detail, but SOME mention of the malformed ref must
    // reach the operator-visible log).
    expect(logLines.some((line) => line.includes('acme/app'))).toBe(true);
  });
});

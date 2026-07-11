// `conduct-ts engineer poll` + `engineer forget` CLI primitives (Phase 9.3b, T22/T23).
// FR-32 (poll-on-launch primitive) + FR-40 (manual forget). gh is injected — no network.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectEngineerCommand,
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import { createFileQueue } from '../../../src/engine/engineer/intake/queue.js';
import { parseEnvelope } from '../../../src/engine/engineer/intake/port.js';

// ── fake gh: issue list + edit (label strip) ──────────────────────────────────

function makeGh(issuesByRepo: Record<string, Array<{ number: number; title: string; body: string; labels?: string[] }>>) {
  const calls: string[][] = [];
  const gh = async (args: string[], opts: { cwd: string }) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      const ri = args.indexOf('-R');
      const repo = ri >= 0 ? args[ri + 1] : opts.cwd;
      const issues = issuesByRepo[repo] ?? [];
      return {
        stdout: JSON.stringify(
          issues.map((i) => ({ number: i.number, title: i.title, body: i.body, labels: (i.labels ?? []).map((l) => ({ name: l })) })),
        ),
      };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

// ── scaffolding ───────────────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-intake-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeRegistry(repos: Array<{ name: string }>): Promise<void> {
  const records = repos.map((r) => ({
    schemaVersion: 1,
    name: r.name,
    path: join(workDir, r.name.replace('/', '_')),
    status: 'registered',
    registeredAt: '2026-06-27T00:00:00.000Z',
  }));
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function captureOut() {
  const out: string[] = [];
  const err: string[] = [];
  const opts = (extra: Partial<DispatchEngineerOpts>): DispatchEngineerOpts => ({
    registryPath,
    engineerDir,
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  });
  return { out, err, opts };
}

// ═══════════════════════════════════════════════════════════════════════════════

// detectEngineerCommand reads process.argv offsets: [node, entry, 'engineer', sub, ...].
const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];

describe('detectEngineerCommand: poll + forget grammar', () => {
  it('parses `engineer poll`', () => {
    expect(detectEngineerCommand(argv('poll'))).toEqual({ kind: 'poll' });
  });
  it('parses `engineer forget <ref>`', () => {
    expect(detectEngineerCommand(argv('forget', 'o/a#1'))).toEqual({ kind: 'forget', sourceRef: 'o/a#1' });
  });
  it('forget without a ref → guide', () => {
    expect(detectEngineerCommand(argv('forget'))).toEqual({ kind: 'guide' });
  });
});

describe('engineer poll (T22, FR-32)', () => {
  it('polls issues and enqueues envelopes into the inbox', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'poll' }, opts({ gh }));
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'poll', enqueued: 1, sourceRefs: ['o/a#1'] });

    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1);
  });

  it('double poll enqueues no duplicates (ledger dedups)', async () => {
    await writeRegistry([{ name: 'o/a' }]);
    const { gh } = makeGh({ 'o/a': [{ number: 1, title: 'Idea', body: 'body' }] });
    const { out, opts } = captureOut();

    await dispatchEngineer({ kind: 'poll' }, opts({ gh }));
    out.length = 0;
    await dispatchEngineer({ kind: 'poll' }, opts({ gh }));

    expect(JSON.parse(out[0])).toMatchObject({ kind: 'poll', enqueued: 0 });
    const inbox = await readdir(join(engineerDir, 'inbox'));
    expect(inbox.filter((f) => f.endsWith('.json')).length).toBe(1); // still just the one
  });
});

describe('engineer forget (T23, FR-40)', () => {
  it('drops a ledger entry and strips the engineer:handled label', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });

    const { gh, calls } = makeGh({});
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'forget', sourceRef: 'o/a#1' }, opts({ gh }));
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'forget', sourceRef: 'o/a#1', found: true });

    expect(await ledger.known('github-issues', 'o/a#1')).toBe(false);
    expect(calls).toContainEqual(['api', '--method', 'DELETE', 'repos/o/a/issues/1/labels/engineer%3Ahandled']);
  });

  it('reports found:false for an absent ref without crashing or calling gh', async () => {
    const { gh, calls } = makeGh({});
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'forget', sourceRef: 'o/z#9' }, opts({ gh }));
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'forget', sourceRef: 'o/z#9', found: false });
    expect(calls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// `conduct-ts engineer claim` — priority-banded ordering (#461, plan Task 9).
//
// Stories: .docs/stories/2026-07-10-priority-banded-intake-claim.md (TR-1..TR-4)
// Design:  .docs/plans/2026-07-10-priority-banded-intake-claim.md
//
// NONE of this feature's production code exists yet — `dispatchEngineer`'s
// `claim` case wires no priority resolver at all today, so `claimUnblocked`
// always drains in pure receivedAt-FIFO order. Every test below drives the
// REAL production entry point (`dispatchEngineer({ kind: 'claim' })` — the
// same seam Flow C2 in dependency-ordered-intake-and-dispatch.test.ts uses)
// against a real file-backed IntakeQueue + Ledger and an injected fake `gh`
// that serves both the blocker (`.../dependencies/blocked_by`) and label
// (`.../issues/<n>`) endpoints the real resolvers call — never a hand-rolled
// queue/resolver fake, per §3b (drive the wired path, not the new unit in
// isolation).
// ─────────────────────────────────────────────────────────────────────────────

describe('engineer claim: priority-banded ordering (#461)', () => {
  /** Fake `gh` runner keyed by `owner/repo#N`, serving both the blocker
   *  endpoint (`createBlockerResolver`) and the label endpoint
   *  (`ghIssueLabelReader`) from the SAME injected function — mirroring how
   *  the real CLI wires one `gh` for both concerns. */
  function createFakeGh(
    fixtures: {
      labels?: Record<string, string[]>;
      blockedBy?: Record<string, unknown[]>;
      notFound?: string[];
      throws?: string[];
    } = {},
  ) {
    const calls: string[][] = [];
    const run = async (args: string[], _opts: { cwd: string }) => {
      calls.push(args);
      const path = args.find((a) => a.startsWith('repos/'));
      if (!path) return { stdout: '[]' };

      const blockedMatch = path.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by$/);
      if (blockedMatch) {
        const key = `${blockedMatch[1]}#${blockedMatch[2]}`;
        return { stdout: JSON.stringify(fixtures.blockedBy?.[key] ?? []) };
      }

      const issueMatch = path.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
      const key = issueMatch ? `${issueMatch[1]}#${issueMatch[2]}` : '';

      if (fixtures.throws?.includes(key)) {
        throw new Error(`transport failure fetching labels for ${key}`);
      }
      if (fixtures.notFound?.includes(key)) {
        const err: any = new Error('HTTP 404: Not Found');
        err.status = 404;
        throw err;
      }
      const names = fixtures.labels?.[key] ?? [];
      return { stdout: JSON.stringify({ labels: names.map((name) => ({ name })) }) };
    };
    return { run, calls };
  }

  const openBlocker = (repo: string, number: number) => ({
    number,
    repository_url: `https://api.github.com/repos/${repo}`,
    state: 'open',
  });

  /** Seed the real file-backed inbox + ledger directly (mirrors Flow C2's
   *  seedInbox), so `dispatchEngineer`'s own `buildIntake` composition root
   *  drives real production wiring end to end. */
  async function seedInbox(
    entries: Array<{ sourceRef: string; receivedAt: string; text: string }>,
  ): Promise<{ queue: ReturnType<typeof createFileQueue>; ledger: ReturnType<typeof createLedger> }> {
    await mkdir(join(engineerDir, 'inbox'), { recursive: true });
    const queue = createFileQueue(join(engineerDir, 'inbox'));
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    for (const entry of entries) {
      await ledger.record({ source: 'github-issues', sourceRef: entry.sourceRef });
      await queue.enqueue(
        parseEnvelope({
          id: entry.sourceRef,
          source: 'github-issues',
          sourceRef: entry.sourceRef,
          text: entry.text,
          status: 'pending',
          receivedAt: entry.receivedAt,
        }),
      );
    }
    return { queue, ledger };
  }

  it('TR-1 happy 1: critical (newest) is claimed over low (oldest) — band beats received order', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'low, oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-05T00:00:00.000Z', text: 'critical, newest' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#1': ['priority: low'], 'acme/app#2': ['priority: critical'] },
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });

    // The low entry is deferred, not dropped — it's still pending afterward.
    const freshQueue = createFileQueue(join(engineerDir, 'inbox'));
    const stillPending = await freshQueue.claim();
    expect(stillPending?.sourceRef).toBe('acme/app#1');
  });

  it('TR-1 happy 2: band drain order across claims — unlabeled/high/medium serves high, then medium', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'unlabeled' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'high' },
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-03T00:00:00.000Z', text: 'medium' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#2': ['priority: high'], 'acme/app#3': ['priority: medium'] },
    });
    const { out, opts } = captureOut();

    const code1 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code1).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });

    out.length = 0;
    const code2 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code2).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#3' });
  });

  it('TR-1 neg 1: a 404 (deleted) issue bands as unlabeled — not an error, ordering still proceeds', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'deleted issue' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'medium' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#2': ['priority: medium'] },
      notFound: ['acme/app#1'],
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    // medium outranks unlabeled — the 404'd entry never wins by being skipped
    // past the banding step entirely.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });
  });

  it('TR-1 happy 3: a relabel after capture is honored on the NEXT claim — no cache from a prior claim', async () => {
    // Round 1: A(medium) and C(medium) tie the band, A wins on FIFO (oldest).
    // B(low) loses to both and stays pending.
    // B is chronologically the NEWEST of the three — plain FIFO (ignoring
    // bands entirely) would serve C, not B, in round 2. Only honoring B's
    // fresh critical label makes B win, so this discriminates a stale/cached
    // band from a claim-time read.
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'A: medium, oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-03T00:00:00.000Z', text: 'B: low, then relabeled critical' },
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-02T00:00:00.000Z', text: 'C: medium, middle' },
    ]);
    const labels: Record<string, string[]> = {
      'acme/app#1': ['priority: medium'],
      'acme/app#2': ['priority: low'],
      'acme/app#3': ['priority: medium'],
    };
    const { run } = createFakeGh({ labels });
    const { out, opts } = captureOut();

    const code1 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code1).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#1' });

    // Operator relabels B to critical from their phone, between claims.
    labels['acme/app#2'] = ['priority: critical'];

    out.length = 0;
    const code2 = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));
    expect(code2).toBe(0);
    // If the label read were cached from claim 1, B would still be 'low' and C
    // (medium) would win. Honoring the new label means B wins instead.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });
  });

  it('TR-2 happy + neg 2: a label-read outage falls open to FIFO, still acks + transitions the ledger, and logs exactly one warning', async () => {
    const { ledger } = await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'newest, would win if banded' },
    ]);
    const { run } = createFakeGh({ throws: ['acme/app#1', 'acme/app#2'] });
    const { out, err, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    // Pure FIFO on outage — the oldest wins, regardless of what labels would
    // have said had the reader not failed.
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#1' });

    // Fallback side effects are identical to the banded path: ack + ledger
    // 'claimed' transition still happened.
    expect((await ledger.get('github-issues', 'acme/app#1'))?.status).toBe('claimed');

    const warnings = err.filter((l) => /priority|outage|label/i.test(l));
    expect(warnings.length).toBe(1);
  });

  it('TR-2 neg 1: reader throws on the 2nd of 3 refs (partial success before the throw) — order is still pure FIFO, never half-banded', async () => {
    await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'oldest' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'middle, throws' },
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-03T00:00:00.000Z', text: 'newest' },
    ]);
    const { run } = createFakeGh({
      labels: { 'acme/app#1': ['priority: low'] },
      throws: ['acme/app#2'],
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#1' });
  });

  it('TR-4 happy 1: banding composes with blocker deferral — a blocked critical defers, the unblocked high is claimed', async () => {
    // The blocked entry is also the chronologically oldest, so a claim that
    // ONLY deferred blockers (no banding at all) would coincidentally land on
    // the same winner. The real discriminator is that the label endpoint must
    // actually have been consulted — proof the banded walk, not luck of
    // ordering, is what ran.
    const { ledger } = await seedInbox([
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'critical, blocked' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'high, unblocked' },
    ]);
    const { run, calls } = createFakeGh({
      labels: { 'acme/app#1': ['priority: critical'], 'acme/app#2': ['priority: high'] },
      blockedBy: { 'acme/app#1': [openBlocker('acme/app', 9)] },
    });
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'claim' }, opts({ gh: run }));

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2' });

    // Deferral is stateless — the blocked critical's ledger status is untouched.
    expect((await ledger.get('github-issues', 'acme/app#1'))?.status).toBe('pending');

    // The banded walk actually read labels — not just deferral-by-luck.
    const labelCalls = calls.filter((c) => c.some((a) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(a)));
    expect(labelCalls.length).toBeGreaterThan(0);
  });
});

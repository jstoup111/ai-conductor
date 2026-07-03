// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Dependency-Ordered Intake and Dispatch" (#229).
//
// Stories:  .docs/stories/dependency-ordered-intake-and-dispatch.md
// Plan:     .docs/plans/dependency-ordered-intake-and-dispatch.md
//
// NONE of this feature's production code exists yet (blocker-resolver.ts,
// the daemon gate wired into discoverBacklog, the WAITING dashboard group, the
// intake claim deferral, the migrate-issue-deps command). Every test below is
// therefore expected to FAIL, either because a module genuinely does not exist
// yet ("Cannot find module") or because the REAL, EXISTING entry point
// (discoverBacklog / scanInheritedState / renderDashboard) has not yet been
// widened to the new contract this feature adds — those failures surface as
// assertion mismatches against the widened shape, which is the correct RED
// signal for a live-path test (writing-system-tests §3b/§3d: never test a
// not-yet-wired helper in isolation while the live path still runs old code).
//
// Seams asserted at (only these are faked — everything else is the real
// module under contract):
//   - discoverBacklog(...) gains `opts.resolver: { resolve(sourceRef) }` and
//     `opts.log` (log already exists) and its return widens from
//     `BacklogItem[]` to `{ items, waiting }` (Task 10/11 in the plan).
//   - scanInheritedState's `deps.discover()` return widens the same way, and
//     `InheritedState` gains a `waiting` array (Task 16).
//   - renderDashboard(state) gains a WAITING section rendered from
//     `state.waiting` (Task 16).
//   - NEW module `src/engine/engineer/intake/dependency-claim.ts` exporting
//     `claimUnblocked(deps)` — the dependency-aware wrapper around the
//     existing file-backed IntakeQueue (Task 19-21). Driven here against a
//     hand-built in-memory IntakeQueue + Ledger fake (never the real
//     filesystem queue — this flow is about deferral semantics, not the
//     atomic-rename primitive already covered by queue.test.ts).
//   - NEW module `src/engine/engineer/issue-dep-migration.ts` exporting
//     `runMigration(deps)` — driven against an in-memory fake `gh` runner
//     that models the platform's blocked_by graph (Task 22-25).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile as fsReadFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { discoverBacklog, type BacklogTreeSource } from '../../src/engine/daemon-backlog.js';
import { scanInheritedState, renderDashboard } from '../../src/engine/daemon-dashboard.js';
import { localWorkSource, type LocalWorkSourceDeps } from '../../src/engine/daemon-work-source.js';
import { createBlockerResolver, type BlockerRunner } from '../../src/engine/blocker-resolver.js';
import { dispatchEngineer } from '../../src/engine/engineer-cli.js';
import { createFileQueue } from '../../src/engine/engineer/intake/queue.js';
import { createLedger } from '../../src/engine/engineer/intake/ledger.js';
import { parseEnvelope } from '../../src/engine/engineer/intake/port.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Filesystem-backed BacklogTreeSource (mirrors daemon-backlog.test.ts). */
function fsTreeSource(root: string): BacklogTreeSource {
  return {
    async listPlanFiles() {
      try {
        return (await readdir(join(root, '.docs/plans'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async readFile(relPath: string) {
      try {
        return await fsReadFile(join(root, relPath), 'utf-8');
      } catch {
        return null;
      }
    },
  };
}

const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
const planWithDeps = () => '# Plan\n\n### Task 1\n**Dependencies:** none\n';

/** Seed a fully eligible plan+stories pair, optionally carrying a Source-Ref marker. */
async function seedSpec(dir: string, slug: string, opts: { sourceRef?: string } = {}): Promise<void> {
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await mkdir(join(dir, '.docs/stories'), { recursive: true });
  await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps());
  await writeFile(join(dir, `.docs/stories/${slug}.md`), APPROVED_STORIES);
  if (opts.sourceRef !== undefined) {
    await mkdir(join(dir, '.docs/intake'), { recursive: true });
    await writeFile(join(dir, `.docs/intake/${slug}.md`), `Source-Ref: ${opts.sourceRef}\n`);
  }
}

/**
 * A fake blocker resolver: `.resolve(sourceRef)` returns whatever verdict was
 * `.set()` for that ref (default `{kind:'unblocked'}`), or throws when the ref
 * is set to the sentinel `'THROW'` — modeling an unreachable platform at the
 * resolver seam (Task 15's "throwing runner" scenario, one layer up).
 */
function makeFakeResolver(initial: Record<string, unknown> = {}) {
  const state = new Map<string, unknown>(Object.entries(initial));
  const calls: string[] = [];
  return {
    calls,
    set(ref: string, verdict: unknown) {
      state.set(ref, verdict);
    },
    resolve: async (sourceRef: string) => {
      calls.push(sourceRef);
      const v = state.get(sourceRef);
      if (v === 'THROW') throw new Error(`platform unreachable for ${sourceRef}`);
      return v ?? { kind: 'unblocked' };
    },
  };
}

/** Pull `{items, waiting}` out of whatever discoverBacklog currently returns. */
function widen(result: unknown): { items: any[]; waiting: any[] } {
  const r = result as any;
  return { items: r?.items ?? [], waiting: r?.waiting ?? [] };
}

let workDirs: string[] = [];
async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dep-intake-'));
  workDirs.push(d);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow A — Daemon dependency gate across scan cycles
// Stories: FR-4/FR-5 (skip without dropping), FR-7 (indeterminate fail-closed),
//          FR-3 (no-origin / malformed ref), FR-12 (cycle held + recovers)
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow A — daemon dependency gate across scan cycles', () => {
  it('open blocker holds a spec across >=3 ticks; an unblocked spec dispatches the SAME tick (no head-of-line blocking)', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'blocked-spec', { sourceRef: 'acme/app#10' });
    await seedSpec(dir, 'clear-spec'); // sorts after blocked-spec alphabetically? irrelevant — no marker, no gate
    const resolver = makeFakeResolver({ 'acme/app#10': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '10' }] } });

    for (let tick = 1; tick <= 3; tick++) {
      const result = await discoverBacklog(dir, undefined, () => {}, {
        treeSource: fsTreeSource(dir),
        resolver,
      } as any);
      const { items, waiting } = widen(result);
      expect(items.map((i: any) => i.slug), `tick ${tick}: unblocked spec must dispatch`).toContain('clear-spec');
      expect(items.map((i: any) => i.slug), `tick ${tick}: blocked spec must never dispatch`).not.toContain(
        'blocked-spec',
      );
      expect(waiting.map((w: any) => w.slug), `tick ${tick}: blocked spec must be visible in waiting`).toContain(
        'blocked-spec',
      );
    }
  });

  it('blocker closes → the spec dispatches on the immediately following tick', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'was-blocked', { sourceRef: 'acme/app#11' });
    const resolver = makeFakeResolver({ 'acme/app#11': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '11' }] } });

    const tick1 = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(tick1.items.map((i: any) => i.slug)).not.toContain('was-blocked');

    resolver.set('acme/app#11', { kind: 'unblocked' });
    const tick2 = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(tick2.items.map((i: any) => i.slug)).toContain('was-blocked');
  });

  it('indeterminate (unreachable platform) → held with no dispatch; recovery dispatches on the next scan', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'flaky-origin', { sourceRef: 'acme/app#12' });
    const resolver = makeFakeResolver({ 'acme/app#12': 'THROW' });

    const tick1 = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(tick1.items.map((i: any) => i.slug), 'indeterminate spec must not dispatch').not.toContain(
      'flaky-origin',
    );
    expect(
      tick1.waiting.find((w: any) => w.slug === 'flaky-origin')?.verdict?.kind,
      'must be visible as indeterminate',
    ).toBe('indeterminate');

    resolver.set('acme/app#12', { kind: 'unblocked' });
    const tick2 = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(tick2.items.map((i: any) => i.slug), 'must dispatch once the platform recovers').toContain(
      'flaky-origin',
    );
  });

  it('a malformed (unparseable) Source-Ref marker is indeterminate, never dispatched — distinct from no marker at all', async () => {
    const dir = await freshDir();
    // Marker file present but the ref value has no parseable `owner/repo#N` shape.
    await seedSpec(dir, 'garbled-origin', { sourceRef: 'not-a-valid-ref' });
    const resolver = makeFakeResolver();

    const result = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(result.items.map((i: any) => i.slug), 'malformed ref must never be promoted to eligible').not.toContain(
      'garbled-origin',
    );
    expect(
      result.waiting.find((w: any) => w.slug === 'garbled-origin')?.verdict?.kind,
      'malformed ref fails closed as indeterminate',
    ).toBe('indeterminate');
  });

  it('no Source-Ref marker at all → dispatches normally with ZERO resolver calls for it (FR-3 happy)', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'no-origin-spec'); // no .docs/intake marker
    const resolver = makeFakeResolver();

    const result = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(result.items.map((i: any) => i.slug)).toContain('no-origin-spec');
    expect(resolver.calls, 'the resolver must never be consulted for a non-intake spec').toHaveLength(0);
  });

  it('platform totally unreachable only poisons the gated spec — a no-origin spec still dispatches the same tick', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'gated-spec', { sourceRef: 'acme/app#13' });
    await seedSpec(dir, 'ungated-spec');
    const resolver = makeFakeResolver({ 'acme/app#13': 'THROW' });

    const result = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(result.items.map((i: any) => i.slug), 'no-origin spec is unaffected by the outage').toContain(
      'ungated-spec',
    );
    expect(result.items.map((i: any) => i.slug)).not.toContain('gated-spec');
  });

  it('a 2-node dependency cycle is held and identified naming its members; breaking it resumes normal evaluation next scan', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'cycle-member', { sourceRef: 'acme/app#20' });
    const members = [
      { repo: 'acme/app', number: '20' },
      { repo: 'acme/app', number: '21' },
    ];
    const resolver = makeFakeResolver({ 'acme/app#20': { kind: 'cycle', members } });

    const tick1 = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(tick1.items.map((i: any) => i.slug)).not.toContain('cycle-member');
    const waitingEntry = tick1.waiting.find((w: any) => w.slug === 'cycle-member');
    expect(waitingEntry?.verdict?.kind, 'cycle must be surfaced as its own verdict kind').toBe('cycle');
    expect(
      waitingEntry?.verdict?.members?.map((m: any) => m.number),
      'cycle verdict must name its members',
    ).toEqual(expect.arrayContaining(['20', '21']));

    // Operator breaks the cycle (closes/unlinks one issue) → normal evaluation resumes.
    resolver.set('acme/app#20', { kind: 'unblocked' });
    const tick2 = widen(
      await discoverBacklog(dir, undefined, () => {}, { treeSource: fsTreeSource(dir), resolver } as any),
    );
    expect(tick2.items.map((i: any) => i.slug)).toContain('cycle-member');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow A2 — live path through localWorkSource().discover() (rem-fr4-3)
//
// Flow A above drives `discoverBacklog` directly with a hand-rolled fake
// resolver. That never exercises the REAL production wiring: the daemon
// run-loop only ever calls `localWorkSource(deps).discover({refresh})`
// (daemon-work-source.ts), which on every pass constructs a FRESH resolver
// via `deps.makeResolver()` (matching production's
// `createBlockerResolver({run: createGhBlockerRunner()})`) and forwards it
// into the real `discoverBacklog`. This flow drives that exact seam: a fake
// `gh` runner stands in for the platform, `createBlockerResolver` is the
// REAL resolver built from it, and `discover()` is called exactly as the
// run-loop calls it. `waiting` never comes back from `discover()` itself
// (its return type is `BacklogItem[]`) — it is surfaced by the warn-once
// announcer, which logs via the same `waitingDetail()` helper renderDashboard
// uses (daemon-dashboard.ts:345-381), so asserting on the log line is
// asserting on the exact WaitingEntry-shaped detail the dashboard renders.
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow A2 — live path through localWorkSource().discover()', () => {
  /** Fake `gh` runner: models `blocked_by` responses per issue key, mutable across calls. */
  function createFakeGh(initialBlockedBy: Record<string, unknown[]> = {}): {
    run: BlockerRunner;
    setBlockedBy(key: string, entries: unknown[]): void;
    throwFor: Set<string>;
  } {
    const table = new Map<string, unknown[]>(Object.entries(initialBlockedBy));
    const throwFor = new Set<string>();
    const run: BlockerRunner = async (args: string[]) => {
      const target = args.find((a) => a.includes('/dependencies/blocked_by'));
      const m = target?.match(/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by/);
      const key = m ? `${m[1]}#${m[2]}` : '';
      if (throwFor.has(key)) throw new Error(`platform unreachable for ${key}`);
      return { stdout: JSON.stringify(table.get(key) ?? []) };
    };
    return {
      run,
      setBlockedBy(key: string, entries: unknown[]) {
        table.set(key, entries);
      },
      throwFor,
    };
  }

  const openBlocker = (repo: string, number: number) => ({
    number,
    repository_url: `https://api.github.com/repos/${repo}`,
    state: 'open',
  });

  /** Build LocalWorkSourceDeps wired to a real, fs-backed discoverBacklog + a live makeResolver factory. */
  function makeDeps(
    dir: string,
    makeResolver: () => ReturnType<typeof createBlockerResolver>,
    log: (m: string) => void,
  ): LocalWorkSourceDeps {
    return {
      projectRoot: dir,
      baseBranch: 'main',
      log,
      isProcessed: async () => false,
      hasWarned: async () => false,
      markWarned: async () => {},
      fastForwardRoot: async () => {},
      discoverBacklog: (root, isProcessed, innerLog, opts) =>
        discoverBacklog(root, isProcessed, innerLog, { ...opts, treeSource: fsTreeSource(root) } as any),
      makeResolver,
    };
  }

  it('a spec with an open blocker (resolved via a fake gh runner + the real resolver factory) is held in waiting, not items, with dashboard-consumable blocker detail', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'gh-blocked-spec', { sourceRef: 'acme/app#40' });
    const gh = createFakeGh({ 'acme/app#40': [openBlocker('acme/app', 41)] });
    const logLines: string[] = [];
    const ws = localWorkSource(
      makeDeps(dir, () => createBlockerResolver({ run: gh.run }), (m) => logLines.push(m)),
    );

    const items = await ws.discover({ refresh: false });

    expect(items.map((i: any) => i.slug), 'blocked spec must not dispatch').not.toContain('gh-blocked-spec');
    const waitingLine = logLines.find((l) => l.includes('gh-blocked-spec'));
    expect(waitingLine, 'a WAITING announcement must be logged for the blocked spec').toBeDefined();
    // Same detail string renderDashboard would produce for this verdict (daemon-dashboard.ts:345-381).
    expect(waitingLine).toContain('blocked by acme/app#41');
  });

  it('re-evaluation across scans: blocker closes between two discover() calls → the spec moves from waiting to items', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'gh-reeval-spec', { sourceRef: 'acme/app#42' });
    const gh = createFakeGh({ 'acme/app#42': [openBlocker('acme/app', 43)] });
    const logLines: string[] = [];
    const ws = localWorkSource(
      makeDeps(dir, () => createBlockerResolver({ run: gh.run }), (m) => logLines.push(m)),
    );

    const tick1 = await ws.discover({ refresh: false });
    expect(tick1.map((i: any) => i.slug), 'tick 1: still blocked, must not dispatch').not.toContain(
      'gh-reeval-spec',
    );
    expect(logLines.some((l) => l.includes('gh-reeval-spec') && l.includes('blocked by'))).toBe(true);

    // Blocker closes on the platform between scans.
    gh.setBlockedBy('acme/app#42', []);
    const tick2 = await ws.discover({ refresh: false });
    expect(tick2.map((i: any) => i.slug), 'tick 2: blocker closed, must dispatch').toContain('gh-reeval-spec');
  });

  it('indeterminate (gh runner throws, modeling a GitHub outage) fails closed to waiting with a visible indeterminate reason', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'gh-outage-spec', { sourceRef: 'acme/app#44' });
    const gh = createFakeGh();
    gh.throwFor.add('acme/app#44');
    const logLines: string[] = [];
    const ws = localWorkSource(
      makeDeps(dir, () => createBlockerResolver({ run: gh.run }), (m) => logLines.push(m)),
    );

    const items = await ws.discover({ refresh: false });

    expect(items.map((i: any) => i.slug), 'indeterminate must fail closed — never dispatch').not.toContain(
      'gh-outage-spec',
    );
    const waitingLine = logLines.find((l) => l.includes('gh-outage-spec'));
    expect(waitingLine, 'the indeterminate reason must be visible in the WAITING announcement').toBeDefined();
    expect(waitingLine).toContain('indeterminate:');
    expect(waitingLine).toContain('platform unreachable for acme/app#44');
  });

  it('a 2-node dependency cycle (via the real resolver + fake gh) surfaces as its own error state, never silently dispatched', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'gh-cycle-spec', { sourceRef: 'acme/app#50' });
    const gh = createFakeGh({
      'acme/app#50': [openBlocker('acme/app', 51)],
      'acme/app#51': [openBlocker('acme/app', 50)],
    });
    const logLines: string[] = [];
    const ws = localWorkSource(
      makeDeps(dir, () => createBlockerResolver({ run: gh.run }), (m) => logLines.push(m)),
    );

    const items = await ws.discover({ refresh: false });

    expect(items.map((i: any) => i.slug), 'a cyclic spec must never silently dispatch').not.toContain(
      'gh-cycle-spec',
    );
    const waitingLine = logLines.find((l) => l.includes('gh-cycle-spec'));
    expect(waitingLine, 'the cycle must be surfaced as a distinct waiting reason, not silently swallowed').toBeDefined();
    expect(waitingLine).toContain('cycle:');
    expect(waitingLine).toContain('acme/app#50');
    expect(waitingLine).toContain('acme/app#51');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow B — WAITING visibility parity, one-bucket invariant, warn-once
// Story: FR-6
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow B — WAITING visibility parity + one-bucket invariant + warn-once', () => {
  it('renderDashboard shows a WAITING section with slug + blocker refs, and the same slug is absent from ELIGIBLE', () => {
    const state: any = {
      halted: [],
      inProgress: [],
      eligible: [],
      processed: [],
      processedCount: 0,
      waiting: [
        {
          slug: 'blocked-spec',
          sourceRef: 'acme/app#10',
          verdict: { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '10' }] },
        },
      ],
    };
    const output = renderDashboard(state);
    expect(output, 'a WAITING group must be rendered').toContain('WAITING (1)');
    expect(output, 'the blocker reference must be visible').toContain('acme/app#10');
    // one-bucket invariant: the slug never ALSO appears under ELIGIBLE.
    const eligibleSection = output.slice(output.indexOf('ELIGIBLE'), output.indexOf('PROCESSED'));
    expect(eligibleSection).not.toContain('blocked-spec');
  });

  it('scanInheritedState adapts to the widened discover() return and surfaces a waiting array (not folded into eligible)', async () => {
    const dir = await freshDir();
    const fakeDiscover = async () => ({
      items: [],
      waiting: [{ slug: 'blocked-spec', sourceRef: 'acme/app#10', verdict: { kind: 'blocked', blockers: [] } }],
    });
    const state: any = await scanInheritedState({
      worktreeBase: join(dir, '.worktrees'),
      processedDir: join(dir, '.daemon/processed'),
      discover: fakeDiscover as any,
    });
    expect(state.waiting, 'InheritedState must carry a waiting array').toEqual([
      { slug: 'blocked-spec', sourceRef: 'acme/app#10', verdict: { kind: 'blocked', blockers: [] } },
    ]);
    expect(state.eligible.map((e: any) => e.slug)).not.toContain('blocked-spec');
  });

  it('an empty waiting set renders no WAITING section (both scanInheritedState and renderDashboard agree)', async () => {
    const dir = await freshDir();
    const fakeDiscover = async () => ({ items: [], waiting: [] });
    const state: any = await scanInheritedState({
      worktreeBase: join(dir, '.worktrees'),
      processedDir: join(dir, '.daemon/processed'),
      discover: fakeDiscover as any,
    });
    expect(state.waiting, 'waiting must be an explicit empty array, not undefined').toEqual([]);
    const output = renderDashboard(state);
    expect(output).not.toContain('WAITING');
  });

  it('status output surfaces WAITING identically to the dashboard render (same group builder)', async () => {
    const dir = await freshDir();
    const waitingEntry = {
      slug: 'blocked-spec',
      sourceRef: 'acme/app#10',
      verdict: { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '10' }] },
    };
    const fakeDiscover = async () => ({ items: [], waiting: [waitingEntry] });
    // "Dashboard" and "status" are both produced by scanInheritedState + renderDashboard
    // per the plan ("status output ... reuse the dashboard group builder") — drive the
    // pipeline twice, exactly as the two call sites would, and assert parity.
    const dashboardState: any = await scanInheritedState({
      worktreeBase: join(dir, '.worktrees'),
      processedDir: join(dir, '.daemon/processed'),
      discover: fakeDiscover as any,
    });
    const statusState: any = await scanInheritedState({
      worktreeBase: join(dir, '.worktrees'),
      processedDir: join(dir, '.daemon/processed'),
      discover: fakeDiscover as any,
    });
    const dashboardOutput = renderDashboard(dashboardState);
    const statusOutput = renderDashboard(statusState);
    expect(dashboardOutput).toEqual(statusOutput);
    expect(dashboardOutput).toContain('WAITING (1)');
  });

  it('an unchanged blocker set is announced at most once across repeated scans; a set change re-announces exactly once more', async () => {
    const dir = await freshDir();
    await seedSpec(dir, 'noisy-spec', { sourceRef: 'acme/app#14' });
    const resolver = makeFakeResolver({
      'acme/app#14': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '14' }] },
    });
    const logLines: string[] = [];
    const log = (msg: string) => logLines.push(msg);
    const isAnnouncement = (msg: string) => msg.includes('noisy-spec') && /wait|block/i.test(msg);

    for (let i = 0; i < 3; i++) {
      await discoverBacklog(dir, undefined, log, { treeSource: fsTreeSource(dir), resolver } as any);
    }
    expect(
      logLines.filter(isAnnouncement),
      '3 identical-state scans must announce the block exactly once',
    ).toHaveLength(1);

    // Blocker set changes (different open blocker) → exactly one MORE announcement.
    resolver.set('acme/app#14', { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '15' }] });
    await discoverBacklog(dir, undefined, log, { treeSource: fsTreeSource(dir), resolver } as any);
    expect(
      logLines.filter(isAnnouncement),
      'a blocker-set change must re-announce exactly once more',
    ).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow C — Engineer claim dependency-aware deferral
// Stories: FR-8 (oldest-unblocked wins), FR-9 (all-blocked distinct from empty),
//          FR-12 intake negative (cycle defers, never dropped)
// ─────────────────────────────────────────────────────────────────────────────

const CLAIM_MOD = '../../src/engine/engineer/intake/dependency-claim.js';

async function loadClaimModule(): Promise<Record<string, unknown>> {
  return (await import(CLAIM_MOD)) as Record<string, unknown>;
}
function requireClaimFn(mod: Record<string, unknown>): (...a: any[]) => any {
  const fn = mod.claimUnblocked;
  if (typeof fn !== 'function') {
    throw new Error('expected export "claimUnblocked" to be a function (not yet implemented)');
  }
  return fn as (...a: any[]) => any;
}

function makeEnvelope(sourceRef: string, receivedAt: string) {
  return {
    id: `id-${sourceRef}`,
    source: 'github-issues',
    sourceRef,
    text: `idea for ${sourceRef}`,
    status: 'pending' as const,
    receivedAt,
  };
}

/** In-memory IntakeQueue fake, oldest-first by insertion order — plus a
 * `listPending` extra the dependency-aware claim walk needs to inspect every
 * candidate (the real queue.claim() atomic-rename primitive only ever returns
 * the single oldest entry, which is insufficient for a walk-and-defer). */
function makeFakeQueue(envelopes: ReturnType<typeof makeEnvelope>[]) {
  const pending = [...envelopes];
  const claimed = new Map<string, any>();
  return {
    async enqueue(e: any) {
      pending.push(e);
    },
    async claim() {
      const e = pending.shift();
      if (!e) return null;
      claimed.set(e.id, e);
      return e;
    },
    async ack(e: any) {
      claimed.delete(e.id);
    },
    async release(e: any) {
      claimed.delete(e.id);
      pending.push(e);
    },
    async listPending() {
      return [...pending];
    },
  };
}

function makeFakeLedger(initial: Record<string, { status: string; attempts: number }>) {
  const map = new Map(Object.entries(initial));
  return {
    async transition(_source: string, sourceRef: string, status: string) {
      const cur = map.get(sourceRef) ?? { status: 'pending', attempts: 0 };
      map.set(sourceRef, { ...cur, status });
    },
    get(sourceRef: string) {
      return map.get(sourceRef);
    },
  };
}

function makeResolveDependency(verdicts: Record<string, unknown>) {
  return async (sourceRef: string | undefined) => {
    if (!sourceRef) return { kind: 'unblocked' };
    return verdicts[sourceRef] ?? { kind: 'unblocked' };
  };
}

describe('Flow C — engineer claim defers blocked intake entries', () => {
  it('[A(blocked), B(unblocked)] in age order → claim returns B; A remains pending untouched', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'unblocked' },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#2');
    const stillPending = await queue.listPending();
    expect(stillPending.map((e: any) => e.sourceRef)).toContain('acme/app#1');
  });

  it("A's blocker closes → the NEXT claim returns A", async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const queue = makeFakeQueue([A]); // B already claimed+ack'd in a prior claim
    const resolveDependency = makeResolveDependency({ 'acme/app#1': { kind: 'unblocked' } });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#1');
  });

  it('deferral is free: a deferred entry keeps ledger status "pending" and its attempt count unchanged', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const ledger = makeFakeLedger({ 'acme/app#1': { status: 'pending', attempts: 2 } });
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'unblocked' },
    });

    await claimUnblocked({ queue, resolveDependency, ledger });
    expect(ledger.get('acme/app#1')).toEqual({ status: 'pending', attempts: 2 });
  });

  it('an indeterminate entry is deferred exactly like a blocked one; the walk proceeds to the next entry', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'indeterminate', detail: 'platform unreachable' },
      'acme/app#2': { kind: 'unblocked' },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#2');
  });

  it('[A(blocked), B(blocked), C(unblocked)] → C is returned — the walk covers the whole queue, not just the head', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z');
    const queue = makeFakeQueue([A, B, C]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#3': { kind: 'unblocked' },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#3');
  });

  it('zero pending entries → the existing empty outcome, unchanged shape', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const queue = makeFakeQueue([]);
    const resolveDependency = makeResolveDependency({});

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome).toEqual({ kind: 'empty' });
  });

  it('all pending entries blocked → a distinct all-blocked outcome listing every deferred entry and its blockers', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '8' }] },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).toBe('all-blocked');
    expect(outcome.entries.map((e: any) => e.envelope.sourceRef).sort()).toEqual([
      'acme/app#1',
      'acme/app#2',
    ]);
    for (const entry of outcome.entries) {
      expect(entry.verdict.kind).toBe('blocked');
    }
  });

  it('all-blocked is NOT the empty outcome and NOT a claim — a consumer that only knows empty/claim cannot misread it', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const queue = makeFakeQueue([A]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).not.toBe('empty');
    expect(outcome.kind).not.toBe('claim');
    expect(outcome.envelope).toBeUndefined();
  });

  it('one blocked + one claimable → the claim wins; no all-blocked report is produced', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'unblocked' },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).toBe('claim');
  });

  it('a cycle-verdict entry is deferred with the cycle reason, never dropped from the queue', async () => {
    const claimUnblocked = requireClaimFn(await loadClaimModule());
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const queue = makeFakeQueue([A]);
    const members = [
      { repo: 'acme/app', number: '1' },
      { repo: 'acme/app', number: '2' },
    ];
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'cycle', members },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });
    expect(outcome.kind).toBe('all-blocked');
    expect(outcome.entries).toHaveLength(1);
    expect(outcome.entries[0].verdict.kind).toBe('cycle');
    const stillPending = await queue.listPending();
    expect(stillPending.map((e: any) => e.sourceRef)).toContain('acme/app#1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow C2 — live path through `conduct-ts engineer claim` (rem-fr8-2, rem-fr9-2)
//
// Flow C above drives `claimUnblocked` directly with a hand-rolled fake queue.
// This flow drives the REAL production wiring end to end: dispatchEngineer({kind:
// 'claim'}) → the real file-backed IntakeQueue + Ledger (rooted in a temp
// engineerDir, mirroring engineer-cli-launch-intake.test.ts's `claim` coverage)
// → the real createBlockerResolver, fed by an injected fake `gh` runner that
// models per-issue blocked_by responses. No network, no branch/checkout calls —
// the claim path is pure queue/ledger/API-verdict bookkeeping.
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow C2 — live path through the engineer CLI claim command', () => {
  const openBlocker = (repo: string, number: number) => ({
    number,
    repository_url: `https://api.github.com/repos/${repo}`,
    state: 'open',
  });

  /** Fake `gh` runner keyed by `owner/repo#N`, mirroring Flow A2's createFakeGh. */
  function createFakeGh(blockedByTable: Record<string, unknown[]> = {}) {
    const calls: string[][] = [];
    const run = async (args: string[], _opts: { cwd: string }) => {
      calls.push(args);
      const target = args.find((a) => a.includes('/dependencies/blocked_by'));
      const m = target?.match(/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by/);
      const key = m ? `${m[1]}#${m[2]}` : '';
      return { stdout: JSON.stringify(blockedByTable[key] ?? []) };
    };
    return { run, calls };
  }

  async function seedInbox(
    engineerDir: string,
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

  it('[blocked-older, unblocked-newer] → the unblocked idea is claimed (acked, ledger transitioned); the blocked idea is deferred (released, not acked); no branch switches', async () => {
    const engineerDir = await freshDir();
    const { ledger } = await seedInbox(engineerDir, [
      { sourceRef: 'acme/app#1', receivedAt: '2026-07-01T00:00:00.000Z', text: 'older, blocked' },
      { sourceRef: 'acme/app#2', receivedAt: '2026-07-02T00:00:00.000Z', text: 'newer, unblocked' },
    ]);
    const gh = createFakeGh({ 'acme/app#1': [openBlocker('acme/app', 9)] });

    const out: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'claim' },
      { engineerDir, gh: gh.run, print: (s) => out.push(s), printErr: () => {} },
    );

    expect(code).toBe(0);
    const result = JSON.parse(out.join(''));
    // The unblocked-newer idea was claimed, NOT the blocked-older one.
    expect(result).toMatchObject({ kind: 'claim', sourceRef: 'acme/app#2', text: 'newer, unblocked' });

    // Claimed: acked (removed from the inbox) + ledger transitioned to 'claimed'.
    expect((await ledger.get('github-issues', 'acme/app#2'))?.status).toBe('claimed');

    // Deferred: released back to the queue (still pending), NOT acked, ledger
    // status untouched (deferral is stateless — Flow C's "deferral is free").
    const freshQueue = createFileQueue(join(engineerDir, 'inbox'));
    const stillClaimable = await freshQueue.claim();
    expect(stillClaimable?.sourceRef).toBe('acme/app#1');
    expect((await ledger.get('github-issues', 'acme/app#1'))?.status).toBe('pending');

    // No branch switches — the ONLY gh traffic on the claim path is the
    // dependency lookup (`api .../dependencies/blocked_by`); no `checkout`,
    // `branch`, or `switch` call is ever made.
    expect(gh.calls.length).toBeGreaterThan(0);
    for (const call of gh.calls) {
      expect(call).not.toContain('checkout');
      expect(call).not.toContain('switch');
      expect(call[0]).not.toBe('branch');
      expect(call[0]).toBe('api');
    }
  });

  it('all-queued-ideas-blocked → the CLI emits the all-blocked shape with per-entry blockers, distinct from the empty-queue shape', async () => {
    const engineerDir = await freshDir();
    await seedInbox(engineerDir, [
      { sourceRef: 'acme/app#3', receivedAt: '2026-07-03T00:00:00.000Z', text: 'idea 3' },
      { sourceRef: 'acme/app#4', receivedAt: '2026-07-04T00:00:00.000Z', text: 'idea 4' },
    ]);
    const gh = createFakeGh({
      'acme/app#3': [openBlocker('acme/app', 30)],
      'acme/app#4': [openBlocker('acme/app', 40)],
    });

    const out: string[] = [];
    const code = await dispatchEngineer(
      { kind: 'claim' },
      { engineerDir, gh: gh.run, print: (s) => out.push(s), printErr: () => {} },
    );

    expect(code).toBe(0);
    const result = JSON.parse(out.join(''));
    expect(result.kind).toBe('claim');
    expect(result.allBlocked).toBe(true);
    // Distinct shape from the empty-queue report — no `empty` flag at all, and
    // `entries` carries per-entry verdict detail an empty report never has.
    expect(result.empty).toBeUndefined();
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries).toHaveLength(2);
    for (const entry of result.entries) {
      expect(entry.sourceRef).toMatch(/^acme\/app#[34]$/);
      expect(entry.verdict.kind).toBe('blocked');
      expect(Array.isArray(entry.verdict.blockers)).toBe(true);
      expect(entry.verdict.blockers.length).toBeGreaterThan(0);
    }

    // Contrast: an empty queue reports the OTHER {kind:'claim',empty:true} shape.
    const emptyDir = await freshDir();
    const emptyOut: string[] = [];
    const emptyCode = await dispatchEngineer(
      { kind: 'claim' },
      { engineerDir: emptyDir, gh: gh.run, print: (s) => emptyOut.push(s), printErr: () => {} },
    );
    expect(emptyCode).toBe(0);
    const emptyResult = JSON.parse(emptyOut.join(''));
    expect(emptyResult).toEqual({ kind: 'claim', empty: true });
    expect(emptyResult.allBlocked).toBeUndefined();
    expect(emptyResult.entries).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow D — Migration end-to-end (prose → native links)
// Stories: FR-10 (propose/confirm/manual-review), FR-11 (idempotent, additive-only)
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATION_MOD = '../../src/engine/engineer/issue-dep-migration.js';

async function loadMigrationModule(): Promise<Record<string, unknown>> {
  return (await import(MIGRATION_MOD)) as Record<string, unknown>;
}
function requireMigrationFn(mod: Record<string, unknown>): (...a: any[]) => any {
  const fn = mod.runMigration;
  if (typeof fn !== 'function') {
    throw new Error('expected export "runMigration" to be a function (not yet implemented)');
  }
  return fn as (...a: any[]) => any;
}

// Realistic prose fixtures, mirroring the actual #217-#229 program issues.
const FIXTURE_ISSUES = [
  { ref: 'acme/app#230', body: 'This work is Gated on #217 landing first.' },
  { ref: 'acme/app#231', body: 'Depends on: #189 / #190 before we can start.' },
  { ref: 'acme/app#232', body: 'Blocked by #226 — do not start early.' },
  { ref: 'acme/app#233', body: 'This issue is a Blocker for #226 (reverse direction).' },
  { ref: 'acme/app#234', body: 'Related work tracked at owner/other#5 (cross-repo).' },
  {
    ref: 'acme/app#228',
    body:
      'Umbrella task list:\n- [ ] Phase A: #217 implementation\n- [ ] Phase B: #218 testing\n- [ ] Phase C: #219 rollout\n',
  },
  { ref: 'acme/app#236', body: 'Blocked by #999 (that issue happens to be closed).' },
];

/** In-memory fake platform: tracks blocked_by links per issue and every gh call made. */
function makeFakePlatform(opts: { failing?: Set<string> } = {}) {
  const links = new Map<string, Set<string>>();
  const calls: { args: string[] }[] = [];
  const failing = opts.failing ?? new Set<string>();
  const gh = async (args: string[], _opts: { cwd: string }) => {
    calls.push({ args });
    const target = args.find((a) => a.includes('/dependencies/blocked_by'));
    const m = target?.match(/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by/);
    const issueKey = m ? `${m[1]}#${m[2]}` : null;

    // Detect write: either -X POST or --method POST
    const hasXMethod = args.includes('-X') && args[args.indexOf('-X') + 1] === 'POST';
    const hasMethodFlag = args.includes('--method') && args[args.indexOf('--method') + 1] === 'POST';
    const isWrite = hasXMethod || hasMethodFlag;

    if (!isWrite) {
      const set = issueKey ? links.get(issueKey) ?? new Set() : new Set();
      return {
        stdout: JSON.stringify(
          [...set].map((ref) => {
            const [repo, number] = ref.split('#');
            return { number: Number(number), repository_url: `https://api.github.com/repos/${repo}` };
          }),
        ),
      };
    }
    if (issueKey && failing.has(issueKey)) throw new Error('transient gh failure');

    // Extract target ref from -f flags: owner=..., repo=..., issue_number=...
    const ownerIdx = args.findIndex((a) => a.startsWith('owner='));
    const repoIdx = args.findIndex((a) => a.startsWith('repo='));
    const issueNumIdx = args.findIndex((a) => a.startsWith('issue_number='));

    if (ownerIdx >= 0 && repoIdx >= 0 && issueNumIdx >= 0) {
      const owner = args[ownerIdx].replace(/^owner=/, '');
      const repo = args[repoIdx].replace(/^repo=/, '');
      const issueNum = args[issueNumIdx].replace(/^issue_number=/, '');
      const addedRef = `${owner}/${repo}#${issueNum}`;

      if (issueKey) {
        const set = links.get(issueKey) ?? new Set();
        set.add(addedRef);
        links.set(issueKey, set);
      }
    }
    return { stdout: '{}' };
  };
  return { gh, calls, links, failing };
}

/** Audit helper: every call must be a blocked_by GET or a blocked_by write — nothing else. */
function isOnlyLinkTraffic(calls: { args: string[] }[]): boolean {
  return calls.every((c) => c.args.some((a) => a.includes('/dependencies/blocked_by')));
}

describe('Flow D — prose-to-link migration end-to-end', () => {
  it('dry-run lists deterministic edges from real-shaped prose before anything is written', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    const summary = await runMigration({
      gh: platform.gh,
      issues: FIXTURE_ISSUES,
      confirm: async () => false,
    });

    const proposedPairs = summary.proposed.map((e: any) => `${e.issue}->${e.blockedBy}`);
    expect(proposedPairs).toEqual(
      expect.arrayContaining([
        'acme/app#230->acme/app#217',
        'acme/app#231->acme/app#189',
        'acme/app#231->acme/app#190',
        'acme/app#232->acme/app#226',
      ]),
    );
  });

  it('operator confirms → the proposed links are written and the summary reports each created link', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    const summary = await runMigration({
      gh: platform.gh,
      issues: FIXTURE_ISSUES,
      confirm: async () => true,
    });

    expect(summary.created.map((e: any) => `${e.issue}->${e.blockedBy}`)).toEqual(
      expect.arrayContaining(['acme/app#230->acme/app#217']),
    );
    expect(platform.links.get('acme/app#230')?.has('acme/app#217')).toBe(true);
  });

  it('umbrella task-list phase prose lands in manual-review, never auto-derived as an edge', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    const summary = await runMigration({
      gh: platform.gh,
      issues: FIXTURE_ISSUES,
      confirm: async () => false,
    });

    expect(summary.manualReview.map((m: any) => m.issue)).toContain('acme/app#228');
    expect(summary.proposed.map((e: any) => e.issue)).not.toContain('acme/app#228');
  });

  it('reverse-direction prose ("Blocker for #N") lands in manual-review, not auto-converted', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    const summary = await runMigration({
      gh: platform.gh,
      issues: FIXTURE_ISSUES,
      confirm: async () => false,
    });

    expect(summary.manualReview.map((m: any) => m.issue)).toContain('acme/app#233');
    expect(
      summary.proposed.some((e: any) => e.issue === 'acme/app#233' && e.blockedBy === 'acme/app#226'),
    ).toBe(false);
  });

  it('cross-repository prose lands in manual-review and is never auto-written', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    const summary = await runMigration({
      gh: platform.gh,
      issues: FIXTURE_ISSUES,
      confirm: async () => true, // even on confirm, cross-repo must not be written
    });

    expect(summary.manualReview.map((m: any) => m.issue)).toContain('acme/app#234');
    expect(platform.links.get('acme/app#234')?.has('owner/other#5')).not.toBe(true);
  });

  it('declining confirmation writes ZERO links (counting fake)', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    await runMigration({
      gh: platform.gh,
      issues: FIXTURE_ISSUES,
      confirm: async () => false,
    });

    const writeCalls = platform.calls.filter(
      (c) => c.args.includes('-X') && c.args[c.args.indexOf('-X') + 1] !== 'GET',
    );
    expect(writeCalls).toHaveLength(0);
    expect(platform.links.size).toBe(0);
  });

  it('prose referencing a closed issue still proposes the edge (graph completeness; satisfaction checked at gate time)', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    const summary = await runMigration({
      gh: platform.gh,
      issues: FIXTURE_ISSUES,
      confirm: async () => false,
    });

    expect(
      summary.proposed.some((e: any) => e.issue === 'acme/app#236' && e.blockedBy === 'acme/app#999'),
    ).toBe(true);
  });

  it('a completed migration re-run performs ZERO new writes; previously-created links are reported already-present', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    await runMigration({ gh: platform.gh, issues: FIXTURE_ISSUES, confirm: async () => true });

    const rerun = await runMigration({ gh: platform.gh, issues: FIXTURE_ISSUES, confirm: async () => true });
    expect(rerun.created).toHaveLength(0);
    expect(rerun.alreadyPresent.map((e: any) => `${e.issue}->${e.blockedBy}`)).toEqual(
      expect.arrayContaining(['acme/app#230->acme/app#217']),
    );
  });

  it('a link that already exists on the platform is reported as already-present, not duplicated', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    platform.links.set('acme/app#230', new Set(['acme/app#217'])); // pre-existing, created manually

    const summary = await runMigration({ gh: platform.gh, issues: FIXTURE_ISSUES, confirm: async () => true });
    expect(summary.alreadyPresent.map((e: any) => `${e.issue}->${e.blockedBy}`)).toContain(
      'acme/app#230->acme/app#217',
    );
    expect(summary.created.map((e: any) => `${e.issue}->${e.blockedBy}`)).not.toContain(
      'acme/app#230->acme/app#217',
    );
  });

  it('a mid-run write failure leaves earlier successes intact; a re-run creates exactly the missing edges', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform({ failing: new Set(['acme/app#231']) });

    const firstRun = await runMigration({ gh: platform.gh, issues: FIXTURE_ISSUES, confirm: async () => true });
    expect(firstRun.failed.length).toBeGreaterThan(0);
    expect(platform.links.get('acme/app#230')?.has('acme/app#217')).toBe(true); // unaffected edge landed

    platform.failing.delete('acme/app#231');
    const secondRun = await runMigration({ gh: platform.gh, issues: FIXTURE_ISSUES, confirm: async () => true });
    const secondRunPairs = secondRun.created.map((e: any) => `${e.issue}->${e.blockedBy}`);
    expect(secondRunPairs).toEqual(
      expect.arrayContaining(['acme/app#231->acme/app#189', 'acme/app#231->acme/app#190']),
    );
    // Already-landed edges are NOT recreated on the second run.
    expect(secondRunPairs).not.toContain('acme/app#230->acme/app#217');
  });

  it('across a full confirmed run, only link-creation traffic is ever issued — no edit/close/label/delete calls', async () => {
    const runMigration = requireMigrationFn(await loadMigrationModule());
    const platform = makeFakePlatform();
    await runMigration({ gh: platform.gh, issues: FIXTURE_ISSUES, confirm: async () => true });

    expect(platform.calls.length).toBeGreaterThan(0);
    expect(isOnlyLinkTraffic(platform.calls), 'every gh call must target the blocked_by link endpoint').toBe(
      true,
    );
    expect(platform.calls.some((c) => c.args.includes('close'))).toBe(false);
    expect(platform.calls.some((c) => c.args.includes('edit'))).toBe(false);
    expect(platform.calls.some((c) => c.args.includes('label'))).toBe(false);
    expect(platform.calls.some((c) => c.args.includes('delete'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────
// Each freshDir() call registers its tmp dir here; sweep them all once at the
// end of the file's run rather than per-test, so a mid-suite crash in one flow
// never leaks tmp dirs used by another.
afterAll(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

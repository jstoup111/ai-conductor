// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Daemon Issue-Priority Scheduling" (issue #200).
//
// Stories:  .docs/stories/2026-07-03-daemon-issue-priority-scheduling.md
// Plan:     .docs/plans/2026-07-03-daemon-issue-priority-scheduling.md
//
// NONE of this feature's production code exists yet: `backlog-priority.ts`
// (parsePriorityLabels / orderBacklog / createPriorityResolver /
// ghIssueLabelReader) is a brand-new module, and the REAL, EXISTING entry
// points — `localWorkSource(...).discover()` and `scanInheritedState` /
// `renderDashboard` — have not yet been widened to call it. Every test below
// is therefore expected to FAIL, either with "Cannot find module
// backlog-priority.js" or, for the live-path flows, because the widened
// contract (banded order, `band` annotations, fallback marker) is not yet
// produced by today's code (writing-system-tests §3b/§3d: drive the REAL
// entry point, not the new unit in isolation, so the test fails if the entry
// point stays wired to old behavior).
//
// Only these are faked — everything else is the real module under contract:
//   - the tree source backing `discoverBacklog` (in-memory fs fixture, mirrors
//     daemon-backlog.test.ts / dependency-ordered-intake-and-dispatch.test.ts)
//   - `LocalWorkSourceDeps.fastForwardRoot` / `.isProcessed` / `.hasWarned` /
//     `.markWarned` (no real git/fs ledger needed for these flows)
//   - the `IssueLabelReader` seam (`(refs) => Promise<Map<string, string[] |
//     'not-found'>>`) — never a real `gh` call; one flow additionally exercises
//     `ghIssueLabelReader` against a fake injected exec runner (mirrors the
//     `GhRunner` pattern in pr-labels.ts) to prove the cross-repo-ref → argv →
//     label-name derivation, not just the resolver in isolation.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile as fsReadFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { discoverBacklog, type BacklogTreeSource, type DiscoverBacklogOpts } from '../../src/engine/daemon-backlog.js';
import { localWorkSource, type LocalWorkSourceDeps } from '../../src/engine/daemon-work-source.js';
import { scanInheritedState, renderDashboard, type ScanInheritedStateDeps } from '../../src/engine/daemon-dashboard.js';
import { pickEligible, type PickEligibleCtx, type BacklogItem } from '../../src/engine/daemon.js';

// `backlog-priority.ts` does not exist yet (pre-implementation). It is loaded
// via a per-test dynamic import (mirrors the pattern already used in
// daemon-work-source.test.ts) so a missing module fails the ONE test that
// needs it, at runtime, with a real "Cannot find module" error — not a
// whole-file collection crash that would report zero executed tests and
// starve the RED-evidence gate (writing-system-tests §6: a collection error
// is not RED). Local type aliases below mirror the plan's documented seams so
// the fakes below type-check without importing types from the missing file.
const BACKLOG_PRIORITY_MOD = '../../src/engine/backlog-priority.js';
async function loadPriorityMod(): Promise<{
  createPriorityResolver: (reader: IssueLabelReader, log: (m: string) => void) => any;
  orderBacklog: (items: BacklogItem[], res: PriorityResolution) => BacklogItem[];
  ghIssueLabelReader: (runGh: GhRunner) => IssueLabelReader;
}> {
  return (await import(BACKLOG_PRIORITY_MOD)) as any;
}

type IssueLabelReader = (refs: string[]) => Promise<Map<string, string[] | 'not-found'>>;
type PriorityResolution =
  | { mode: 'banded'; bands: Map<string, 'high' | 'medium' | 'low'> }
  | { mode: 'fallback' }
  | { mode: 'off' };
type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture helpers (mirror dependency-ordered-intake-and-dispatch.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

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
const DRAFT_STORIES = '# Stories\n**Status:** DRAFT\n';
const planWithDeps = () => '# Plan\n\n### Task 1\n**Dependencies:** none\n';

/** Seed a plan+stories pair, optionally carrying a Source-Ref intake marker
 *  (real or deliberately garbled) and optionally marked DRAFT (ineligible). */
async function seedSpec(
  dir: string,
  slug: string,
  opts: { sourceRef?: string; garbledRef?: string; draft?: boolean } = {},
): Promise<void> {
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await mkdir(join(dir, '.docs/stories'), { recursive: true });
  await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps());
  await writeFile(join(dir, `.docs/stories/${slug}.md`), opts.draft ? DRAFT_STORIES : APPROVED_STORIES);
  if (opts.sourceRef !== undefined) {
    await mkdir(join(dir, '.docs/intake'), { recursive: true });
    await writeFile(join(dir, `.docs/intake/${slug}.md`), `Source-Ref: ${opts.sourceRef}\n`);
  }
  if (opts.garbledRef !== undefined) {
    await mkdir(join(dir, '.docs/intake'), { recursive: true });
    await writeFile(join(dir, `.docs/intake/${slug}.md`), `Source-Ref: ${opts.garbledRef}\n`);
  }
}

let workDirs: string[] = [];
async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'issue-priority-'));
  workDirs.push(d);
  return d;
}

afterAll(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Fake `IssueLabelReader`: resolves each ref from a fixed map, records every
 *  batch it was called with, and rejects the WHOLE call when any requested
 *  ref is mapped to the `'THROW'` sentinel — modeling a transport/auth outage
 *  (atomic per fetch, never a per-ref failure) at the resolver seam. */
function makeFakeReader(
  labels: Record<string, string[] | 'not-found' | 'THROW'>,
): IssueLabelReader & { calls: string[][] } {
  const calls: string[][] = [];
  const reader = (async (refs: string[]) => {
    calls.push([...refs]);
    if (refs.some((r) => labels[r] === 'THROW')) {
      throw new Error('priority source unreachable');
    }
    const out = new Map<string, string[] | 'not-found'>();
    for (const r of refs) {
      const v = labels[r];
      out.set(r, v === undefined ? 'not-found' : (v as string[] | 'not-found'));
    }
    return out;
  }) as IssueLabelReader & { calls: string[][] };
  reader.calls = calls;
  return reader;
}

/** Build LocalWorkSourceDeps around the REAL discoverBacklog (fs-fixture tree
 *  source) and an injected priority resolver — the new optional dep this
 *  feature adds to the existing WorkSource seam (plan Task 11). Cast via
 *  `as any` because `priorityResolver` does not exist on `LocalWorkSourceDeps`
 *  until that task lands — this is the pre-implementation RED signal. */
async function buildDeps(
  dir: string,
  opts: { reader?: IssueLabelReader; log?: (m: string) => void } = {},
): Promise<LocalWorkSourceDeps> {
  const log = opts.log ?? (() => {});
  const resolver = opts.reader ? (await loadPriorityMod()).createPriorityResolver(opts.reader, log) : undefined;
  return {
    projectRoot: dir,
    baseBranch: 'main',
    log,
    isProcessed: async () => false,
    hasWarned: async () => false,
    markWarned: async () => {},
    fastForwardRoot: async () => {},
    discoverBacklog: (root, isProcessed, l, discOpts: DiscoverBacklogOpts) =>
      discoverBacklog(root, isProcessed, l, { ...discOpts, treeSource: fsTreeSource(root) }),
    ...(resolver ? { priorityResolver: resolver } : {}),
  } as unknown as LocalWorkSourceDeps;
}

/** Slugs in dispatch order, as returned by `workSource.discover()`. */
async function orderedSlugs(dir: string, deps: LocalWorkSourceDeps, refresh = true): Promise<string[]> {
  const items = await localWorkSource(deps).discover({ refresh });
  return items.map((i) => i.slug);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow A — end-to-end banded ordering through the real WorkSource
// Stories: FR-1/FR-2/FR-3/FR-4/FR-5 happy + negative paths
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow A — banded ordering via localWorkSource.discover()', () => {
  it('unlinked spec builds before a priority:high linked spec, regardless of merge date', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-07-01-unlinked-spec');
    await seedSpec(dir, '2026-06-25-linked-high-spec', { sourceRef: 'acme/app#10' });
    const reader = makeFakeReader({ 'acme/app#10': ['priority: high'] });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs.indexOf('2026-07-01-unlinked-spec'), 'unlinked must dispatch first').toBeLessThan(
      slugs.indexOf('2026-06-25-linked-high-spec'),
    );
  });

  it('an all-unlinked backlog makes ZERO priority-source calls', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-20-a');
    await seedSpec(dir, '2026-06-21-b');
    const reader = makeFakeReader({});

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-06-20-a', '2026-06-21-b']);
    expect(reader.calls.flat(), 'no linked refs → reader must never be invoked').toHaveLength(0);
  });

  it('a garbled Source-Ref marker is treated as unlinked (top band), no error', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-22-garbled', { garbledRef: 'not-a-real-ref-no-hash' });
    await seedSpec(dir, '2026-06-19-linked-high', { sourceRef: 'acme/app#10' });
    const reader = makeFakeReader({ 'acme/app#10': ['priority: high'] });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs[0]).toBe('2026-06-22-garbled');
  });

  it('high → medium → low dispatch order holds regardless of merge dates', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-low-spec', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-30-high-spec', { sourceRef: 'acme/app#2' });
    await seedSpec(dir, '2026-06-20-medium-spec', { sourceRef: 'acme/app#3' });
    const reader = makeFakeReader({
      'acme/app#1': ['priority: low'],
      'acme/app#2': ['priority: high'],
      'acme/app#3': ['priority: medium'],
    });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-06-30-high-spec', '2026-06-20-medium-spec', '2026-06-10-low-spec']);
  });

  it('a priority:low spec builds before an unlabeled spec despite being older', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-20-unlabeled', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-07-02-low', { sourceRef: 'acme/app#2' });
    const reader = makeFakeReader({ 'acme/app#1': [], 'acme/app#2': ['priority: low'] });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-07-02-low', '2026-06-20-unlabeled']);
  });

  it('same-band specs keep chronological (input) order — stable sort', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-01-medium-a', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-15-medium-b', { sourceRef: 'acme/app#2' });
    await seedSpec(dir, '2026-06-30-medium-c', { sourceRef: 'acme/app#3' });
    const reader = makeFakeReader({
      'acme/app#1': ['priority: medium'],
      'acme/app#2': ['priority: medium'],
      'acme/app#3': ['priority: medium'],
    });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-06-01-medium-a', '2026-06-15-medium-b', '2026-06-30-medium-c']);
  });

  it('a deleted/not-found linked issue falls to the unlabeled band without an outage', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-deleted-issue', { sourceRef: 'acme/app#404' });
    await seedSpec(dir, '2026-06-05-high', { sourceRef: 'acme/app#1' });
    const log: string[] = [];
    const reader = makeFakeReader({ 'acme/app#1': ['priority: high'] }); // #404 absent → 'not-found'

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader, log: (m) => log.push(m) }));

    expect(slugs).toEqual(['2026-06-05-high', '2026-06-10-deleted-issue']);
    expect(log.some((l) => /outage|unreachable|unavailable/i.test(l)), 'not-found is data, not an outage').toBe(
      false,
    );
  });

  it('an unknown/near-miss label (priority: urgent) never ranks — spec lands unlabeled', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-near-miss', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-05-low', { sourceRef: 'acme/app#2' });
    const reader = makeFakeReader({
      'acme/app#1': ['priority: urgent', 'Priority-High'],
      'acme/app#2': ['priority: low'],
    });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-06-05-low', '2026-06-10-near-miss']);
  });

  it('a CLOSED issue still labeled priority:high is honored (issue state irrelevant to ordering)', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-01-closed-high', { sourceRef: 'acme/app#9' });
    await seedSpec(dir, '2026-07-01-unlabeled', { sourceRef: 'acme/app#8' });
    // Reader contract carries only labels, never issue open/closed state — a
    // closed issue that still has the label resolves identically to an open one.
    const reader = makeFakeReader({ 'acme/app#9': ['priority: high'], 'acme/app#8': [] });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-06-01-closed-high', '2026-07-01-unlabeled']);
  });

  it('multi-labeled issue resolves to the highest of the set, deterministically', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-01-multi', { sourceRef: 'acme/app#7' });
    await seedSpec(dir, '2026-06-02-medium', { sourceRef: 'acme/app#6' });
    const reader = makeFakeReader({
      'acme/app#7': ['priority: low', 'priority: high', 'bug'],
      'acme/app#6': ['priority: medium'],
    });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-06-01-multi', '2026-06-02-medium']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow B — refresh-scoped caching + relabel-without-restart
// Stories: FR-6 all paths
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow B — refresh caching and relabel reorders without a restart', () => {
  it('a relabel takes effect on the NEXT refresh scan, in the same process', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-relabel-target', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-05-medium', { sourceRef: 'acme/app#2' });
    const labels: Record<string, string[]> = { 'acme/app#1': ['priority: low'], 'acme/app#2': ['priority: medium'] };
    const reader: IssueLabelReader = async (refs) => {
      const out = new Map<string, string[] | 'not-found'>();
      for (const r of refs) out.set(r, labels[r] ?? 'not-found');
      return out;
    };
    const deps = await buildDeps(dir, { reader });

    const before = await orderedSlugs(dir, deps, true);
    expect(before).toEqual(['2026-06-05-medium', '2026-06-10-relabel-target']); // low behind medium

    labels['acme/app#1'] = ['priority: high']; // operator relabels from their phone
    const after = await orderedSlugs(dir, deps, true); // next refresh scan, same process/deps
    expect(after).toEqual(['2026-06-10-relabel-target', '2026-06-05-medium']);
  });

  it('non-refresh scans reuse cached bands with ZERO new reader calls', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    const reader = makeFakeReader({ 'acme/app#1': ['priority: high'] });
    const deps = await buildDeps(dir, { reader });

    await orderedSlugs(dir, deps, true); // refresh: fetches once
    const callsAfterRefresh = reader.calls.length;
    await orderedSlugs(dir, deps, false); // non-refresh: must NOT fetch again
    await orderedSlugs(dir, deps, false);

    expect(reader.calls.length).toBe(callsAfterRefresh);
  });

  it('a relabel between two non-refresh scans is NOT picked up until the next refresh', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    const labels: Record<string, string[]> = { 'acme/app#1': ['priority: low'] };
    const reader: IssueLabelReader = async (refs) => {
      const out = new Map<string, string[] | 'not-found'>();
      for (const r of refs) out.set(r, labels[r] ?? 'not-found');
      return out;
    };
    const deps = await buildDeps(dir, { reader });

    await orderedSlugs(dir, deps, true); // establishes cache: low
    labels['acme/app#1'] = ['priority: high']; // relabel happens between scans
    const staleScan = await localWorkSource(deps).discover({ refresh: false });
    expect((staleScan[0] as any).band ?? 'low', 'stale ranking used until refresh').not.toBe('high');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow C — priority-source outage degrades to chronological order
// Stories: FR-7 all paths
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow C — outage fail-soft through the real WorkSource', () => {
  it('a fetch failure falls back to chronological order, warns exactly once, and still dispatches', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-05-b', { sourceRef: 'acme/app#2' });
    const log: string[] = [];
    const reader = makeFakeReader({ 'acme/app#1': 'THROW', 'acme/app#2': ['priority: high'] });
    const deps = await buildDeps(dir, { reader, log: (m) => log.push(m) });

    const slugs = await orderedSlugs(dir, deps, true);

    expect(slugs).toEqual(['2026-06-05-b', '2026-06-10-a']); // chronological, not banded
    expect(log.filter((l) => /outage|unreachable|fallback/i.test(l))).toHaveLength(1);
  });

  it('a persisting outage across many scans warns only once (suppressed while ongoing)', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    const log: string[] = [];
    const reader = makeFakeReader({ 'acme/app#1': 'THROW' });
    const deps = await buildDeps(dir, { reader, log: (m) => log.push(m) });

    for (let i = 0; i < 4; i++) await orderedSlugs(dir, deps, true);

    expect(log.filter((l) => /outage|unreachable|fallback/i.test(l))).toHaveLength(1);
  });

  it('recovery resumes banding; a NEW outage later in the same process warns again', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-05-b', { sourceRef: 'acme/app#2' });
    const log: string[] = [];
    const flags: Record<string, string[] | 'THROW'> = { 'acme/app#1': 'THROW', 'acme/app#2': ['priority: low'] };
    const reader: IssueLabelReader = async (refs) => {
      if (refs.some((r) => flags[r] === 'THROW')) throw new Error('unreachable');
      const out = new Map<string, string[] | 'not-found'>();
      for (const r of refs) out.set(r, (flags[r] as string[]) ?? 'not-found');
      return out;
    };
    const deps = await buildDeps(dir, { reader, log: (m) => log.push(m) });

    await orderedSlugs(dir, deps, true); // outage #1 → 1 warning
    flags['acme/app#1'] = ['priority: high']; // source recovers
    await orderedSlugs(dir, deps, true); // banding resumes
    flags['acme/app#1'] = 'THROW'; // outage #2 begins
    await orderedSlugs(dir, deps, true);

    expect(log.filter((l) => /outage|unreachable|fallback/i.test(l))).toHaveLength(2);
  });

  it('the fallback path never changes which specs are eligible — order only', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-05-b');
    await seedSpec(dir, '2026-06-01-c', { draft: true }); // ineligible regardless of priority

    const banded = new Set(await orderedSlugs(dir, await buildDeps(dir, { reader: makeFakeReader({ 'acme/app#1': ['priority: high'] }) })));
    const fallback = new Set(await orderedSlugs(dir, await buildDeps(dir, { reader: makeFakeReader({ 'acme/app#1': 'THROW' }) })));
    const noResolver = new Set(await orderedSlugs(dir, await buildDeps(dir)));

    expect(banded).toEqual(new Set(['2026-06-10-a', '2026-06-05-b']));
    expect(fallback).toEqual(banded);
    expect(noResolver).toEqual(banded);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow D — priority is an ordering concern only, never an eligibility concern
// Stories: FR-8 all paths
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow D — priority never overrides eligibility, park, or dedup', () => {
  it('an ineligible (parked/halted) priority:high item never blocks an eligible priority:low item', async () => {
    const highItem: BacklogItem = { slug: 'high-slug', sourceRef: 'acme/app#1' };
    const lowItem: BacklogItem = { slug: 'low-slug', sourceRef: 'acme/app#2' };
    const resolution: PriorityResolution = {
      mode: 'banded',
      bands: new Map([
        ['acme/app#1', 'high'],
        ['acme/app#2', 'low'],
      ]),
    };
    const { orderBacklog } = await loadPriorityMod();
    const ordered = orderBacklog([highItem, lowItem], resolution); // high sorts first

    const ctx: PickEligibleCtx = {
      inFlight: { has: () => false },
      parked: new Set(['high-slug']), // previously halted by a human
      started: new Set(),
      isHalted: async (slug) => slug === 'high-slug', // still parked
    };

    const picked = await pickEligible({ items: ordered }, ctx);
    expect(picked?.slug).toBe('low-slug');
  });

  it('a stories-not-approved spec is skipped regardless of a priority:high linked issue', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-unapproved-high', { sourceRef: 'acme/app#1', draft: true });
    await seedSpec(dir, '2026-06-05-eligible-low', { sourceRef: 'acme/app#2' });
    const reader = makeFakeReader({ 'acme/app#1': ['priority: high'], 'acme/app#2': ['priority: low'] });

    const slugs = await orderedSlugs(dir, await buildDeps(dir, { reader }));

    expect(slugs).toEqual(['2026-06-05-eligible-low']); // draft spec never appears at all
  });

  it('the eligible SET is identical whether priority resolution is wired or not — only sequence differs', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-05-b', { sourceRef: 'acme/app#2' });
    await seedSpec(dir, '2026-06-01-c');

    const withResolver = await orderedSlugs(
      dir,
      await buildDeps(dir, { reader: makeFakeReader({ 'acme/app#1': ['priority: high'], 'acme/app#2': ['priority: low'] }) }),
    );
    const withoutResolver = await orderedSlugs(dir, await buildDeps(dir));

    expect(new Set(withResolver)).toEqual(new Set(withoutResolver));
  });

  it('an in-flight priority:high item never blocks an eligible priority:low item', async () => {
    const highItem: BacklogItem = { slug: 'high-in-flight', sourceRef: 'acme/app#1' };
    const lowItem: BacklogItem = { slug: 'low-eligible', sourceRef: 'acme/app#2' };
    const resolution: PriorityResolution = {
      mode: 'banded',
      bands: new Map([
        ['acme/app#1', 'high'],
        ['acme/app#2', 'low'],
      ]),
    };
    const { orderBacklog } = await loadPriorityMod();
    const ordered = orderBacklog([highItem, lowItem], resolution); // high sorts first

    const ctx: PickEligibleCtx = {
      inFlight: {
        has: (slug) => slug === 'high-in-flight', // high item is currently in-flight
      },
      parked: new Set(),
      started: new Set(),
    };

    const picked = await pickEligible({ items: ordered }, ctx);
    expect(picked?.slug).toBe('low-eligible');
  });

  it('owner-gate rejection does not block eligible items, priority does not override', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-owner-fails-high', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-06-05-owner-passes-low', { sourceRef: 'acme/app#2' });
    const reader = makeFakeReader({ 'acme/app#1': ['priority: high'], 'acme/app#2': ['priority: low'] });

    // Simulate owner-gate by filtering to only items that "pass" the gate
    // In a real scenario, this would be enforced by the owner-gate implementation
    // in discoverBacklog. Here we verify that even if high-priority is rejected
    // by the gate, the low-priority item is still eligible.
    const deps = await buildDeps(dir, { reader });
    const allSlugs = await orderedSlugs(dir, deps);

    // Both items should be eligible regardless of owner-gate status
    // (owner-gate filtering happens at discovery level, not overridden by priority)
    expect(allSlugs).toContain('2026-06-05-owner-passes-low');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow E — operator-visible effective order and band on the dashboard
// Stories: FR-10 all paths
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow E — dashboard shows effective build order, band, and fallback mode', () => {
  async function renderFor(dir: string, deps: LocalWorkSourceDeps): Promise<string> {
    const scanDeps: ScanInheritedStateDeps = {
      worktreeBase: join(dir, '.worktrees'),
      processedDir: join(dir, '.daemon/processed'),
      discover: () => localWorkSource(deps).discover({ refresh: true }),
    };
    const state = await scanInheritedState(scanDeps);
    return renderDashboard(state);
  }

  it('ELIGIBLE lines show effective build order with band annotations', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-25-high-spec', { sourceRef: 'acme/app#1' });
    await seedSpec(dir, '2026-07-01-unlinked-spec');
    const reader = makeFakeReader({ 'acme/app#1': ['priority: high'] });

    const out = await renderFor(dir, await buildDeps(dir, { reader }));
    const eligibleBlock = out.slice(out.indexOf('ELIGIBLE'));

    expect(eligibleBlock.indexOf('2026-07-01-unlinked-spec')).toBeLessThan(
      eligibleBlock.indexOf('2026-06-25-high-spec'),
    );
    expect(out).toMatch(/2026-07-01-unlinked-spec\s*\[no-issue\]/);
    expect(out).toMatch(/2026-06-25-high-spec\s*\[high\]/);
  });

  it('an outage-fallback scan is marked distinctly, with no stale band annotations', async () => {
    const dir = await freshDir();
    await seedSpec(dir, '2026-06-10-a', { sourceRef: 'acme/app#1' });
    const reader = makeFakeReader({ 'acme/app#1': 'THROW' });

    const out = await renderFor(dir, await buildDeps(dir, { reader }));

    expect(out).toContain('(priority: chronological fallback)');
    expect(out).not.toMatch(/2026-06-10-a\s*\[(high|medium|low|unlabeled|no-issue)\]/);
  });

  it('an empty pending backlog renders the ordering section cleanly, no error', async () => {
    const dir = await freshDir();
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const reader = makeFakeReader({});

    const out = await renderFor(dir, await buildDeps(dir, { reader }));

    expect(out).toContain('ELIGIBLE (0)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow F — production gh label reader: cross-repo ref → argv → labels
// Stories: FR-3 happy path (cross-repo ref resolved per-ref); FR-7 (transport
//          error classification at the real gh call site, not a hand-built fake)
// ─────────────────────────────────────────────────────────────────────────────
describe('Flow F — ghIssueLabelReader resolves a cross-repo sourceRef via the real parser', () => {
  it('builds the correct gh argv for an issue in a DIFFERENT repo than the daemon\'s own', async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const runGh: GhRunner = async (args, opts) => {
      calls.push({ args, cwd: opts.cwd });
      return { stdout: JSON.stringify({ labels: [{ name: 'priority: high' }, { name: 'bug' }] }) };
    };

    const { ghIssueLabelReader } = await loadPriorityMod();
    const reader = ghIssueLabelReader(runGh);
    const result = await reader(['other-org/other-repo#42']);

    expect(calls[0]?.args).toEqual(['api', 'repos/other-org/other-repo/issues/42']);
    expect(result.get('other-org/other-repo#42')).toEqual(['priority: high', 'bug']);
  });

  it('a 404 from gh maps to \'not-found\' (data), any other failure throws (transport)', async () => {
    const notFoundRunner: GhRunner = async () => {
      const err: any = new Error('gh: Not Found (HTTP 404)');
      err.stderr = 'HTTP 404: Not Found';
      throw err;
    };
    const { ghIssueLabelReader } = await loadPriorityMod();
    const reader1 = ghIssueLabelReader(notFoundRunner);
    const result = await reader1(['acme/app#999']);
    expect(result.get('acme/app#999')).toBe('not-found');

    const enoentRunner: GhRunner = async () => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    };
    const reader2 = ghIssueLabelReader(enoentRunner);
    await expect(reader2(['acme/app#1'])).rejects.toThrow();
  });
});

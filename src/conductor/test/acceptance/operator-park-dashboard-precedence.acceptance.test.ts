import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  scanInheritedState,
  renderDashboard,
  type InheritedState,
  type ScanInheritedStateDeps,
  type WaitingEntry,
} from '../../src/engine/daemon-dashboard.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import type { BacklogItem } from '../../src/engine/daemon.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Operator Park" (FR-6): parked features must
// render ONCE, under a `PARKED` group, and `PARKED` outranks every existing
// dashboard group (HALTED, IN-PROGRESS, WAITING, ELIGIBLE, PROCESSED).
//
// `scanInheritedState`/`renderDashboard`/`InheritedState` have NO concept of
// "parked" today — no `parked` field, no PARKED group, no exclusion of a
// parked slug from the group it would otherwise land in. This file drives the
// REAL `scanInheritedState` against real worktree/processed-ledger fixtures
// (exactly as the production dashboard does) for the five existing groups,
// then overlays the REAL park-marker primitives (dynamically imported —
// `park-marker.ts` does not exist yet at RED time, plan Task 1) to compute
// which fixture slugs are parked, and hands that overlay to `renderDashboard`
// via a cast (`as InheritedState & { parked?: ... }`) since the real function
// signature has no such parameter yet.
//
// Every assertion below is expected to fail for the RIGHT reason pre-
// implementation: either the parked slug still appears in its old group (no
// exclusion logic exists), or the rendered string has no `PARKED` line at all
// (no such group exists). Plan Task 11 is what will thread a parked-slugs
// input through `scanInheritedState`/`buildState` and add the PARKED group to
// `renderDashboard` — once it does, these assertions describe the real,
// intended behavior instead of a synthetic overlay.
// ─────────────────────────────────────────────────────────────────────────────

const PARK_MARKER_MOD = '../../src/engine/park-marker.js';

interface ParkMarkerModule {
  writeOperatorPark: (root: string, slug: string) => Promise<void>;
  isOperatorParked: (root: string, slug: string) => Promise<boolean>;
  removeOperatorPark: (root: string, slug: string) => Promise<void>;
}

async function loadParkMarker(): Promise<ParkMarkerModule> {
  const mod = (await import(PARK_MARKER_MOD)) as Record<string, unknown>;
  for (const name of ['writeOperatorPark', 'isOperatorParked', 'removeOperatorPark'] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `expected export "${name}" from park-marker.ts to be a function (not yet implemented)`,
      );
    }
  }
  return mod as unknown as ParkMarkerModule;
}

/**
 * Real-primitive parked-slug overlay. No "list all parked slugs" export is
 * specified by the plan (Task 1 only promises write/read/remove-by-slug), so
 * this asks the REAL `isOperatorParked` about every candidate slug our own
 * fixture created — a reasonable RED-time assumption per the task brief,
 * since a durable "list" export isn't part of the documented Task 1 surface.
 */
async function computeParkedSlugs(
  parkMarker: ParkMarkerModule,
  root: string,
  candidates: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const slug of candidates) {
    if (await parkMarker.isOperatorParked(root, slug)) out.push(slug);
  }
  return out;
}

let projectRoot: string;
let worktreeBase: string;
let processedDir: string;

async function haltWorktree(slug: string, body = `halted: ${slug}\n`): Promise<void> {
  const wt = join(worktreeBase, slug);
  await mkdir(join(wt, '.pipeline'), { recursive: true });
  await writeFile(join(wt, HALT_MARKER), body);
}

async function inProgressWorktree(slug: string): Promise<void> {
  const wt = join(worktreeBase, slug);
  await mkdir(join(wt, '.pipeline'), { recursive: true });
  await writeFile(
    join(wt, '.pipeline/conduct-state.json'),
    JSON.stringify({ worktree: 'done', memory: 'done', build: 'in_progress' }),
    'utf-8',
  );
}

async function markProcessed(slug: string): Promise<void> {
  await mkdir(processedDir, { recursive: true });
  await writeFile(join(processedDir, slug), JSON.stringify({ status: 'shipped' }), 'utf-8');
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'operator-park-dash-root-'));
  worktreeBase = await mkdtemp(join(tmpdir(), 'operator-park-dash-worktrees-'));
  processedDir = join(worktreeBase, '..', 'processed'); // placeholder, replaced below
  processedDir = await mkdtemp(join(tmpdir(), 'operator-park-dash-processed-'));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(worktreeBase, { recursive: true, force: true });
  await rm(processedDir, { recursive: true, force: true });
});

function makeDiscover(
  items: BacklogItem[],
  waiting: WaitingEntry[],
): ScanInheritedStateDeps['discover'] {
  return async () => ({ items, waiting });
}

describe('operator-park dashboard precedence acceptance (FR-6): PARKED outranks every group', () => {
  it('a slug that is BOTH halted and operator-parked renders once, under PARKED — not under HALTED — with every other group populated', async () => {
    const parkMarker = await loadParkMarker();

    await haltWorktree('halted-and-parked', 'human touch this\n');
    await haltWorktree('halted-plain');
    await inProgressWorktree('inprogress-plain');
    await markProcessed('processed-plain');

    const eligibleItem: BacklogItem = { slug: 'eligible-plain' };
    const waitingEntry: WaitingEntry = {
      slug: 'waiting-plain',
      verdict: { kind: 'blocked', blockers: [{ repo: 'acme/repo', number: 7 }] },
    };

    await parkMarker.writeOperatorPark(projectRoot, 'halted-and-parked');

    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([eligibleItem], [waitingEntry]),
    };
    const state = await scanInheritedState(deps);

    const parked = await computeParkedSlugs(parkMarker, projectRoot, [
      'halted-and-parked',
      'halted-plain',
      'inprogress-plain',
      'processed-plain',
      'eligible-plain',
      'waiting-plain',
    ]);
    expect(parked).toEqual(['halted-and-parked']);

    const rendered = renderDashboard(
      { ...state, parked } as InheritedState & { parked: string[] },
    );

    // Correct end-state (fails today: no PARKED group, no exclusion logic).
    const parkedSection = extractSection(rendered, 'PARKED');
    expect(parkedSection).toContain('halted-and-parked');

    const haltedSection = extractSection(rendered, 'HALTED');
    expect(haltedSection).not.toContain('halted-and-parked');
    expect(haltedSection).toContain('halted-plain'); // sibling group untouched

    // Every other existing group is still populated in the same fixture.
    expect(extractSection(rendered, 'IN-PROGRESS')).toContain('inprogress-plain');
    expect(extractSection(rendered, 'WAITING')).toContain('waiting-plain');
    expect(extractSection(rendered, 'ELIGIBLE')).toContain('eligible-plain');
    expect(extractSection(rendered, 'PROCESSED')).toContain('processed-plain');
  });

  it('a parked, never-dispatched backlog slug renders under PARKED, not ELIGIBLE', async () => {
    const parkMarker = await loadParkMarker();

    const parkedBacklogItem: BacklogItem = { slug: 'backlog-parked' };
    const plainBacklogItem: BacklogItem = { slug: 'backlog-plain' };
    await parkMarker.writeOperatorPark(projectRoot, 'backlog-parked');

    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([parkedBacklogItem, plainBacklogItem], []),
    };
    const state = await scanInheritedState(deps);

    const parked = await computeParkedSlugs(parkMarker, projectRoot, [
      'backlog-parked',
      'backlog-plain',
    ]);
    expect(parked).toEqual(['backlog-parked']);

    const rendered = renderDashboard(
      { ...state, parked } as InheritedState & { parked: string[] },
    );

    expect(extractSection(rendered, 'PARKED')).toContain('backlog-parked');
    expect(extractSection(rendered, 'ELIGIBLE')).not.toContain('backlog-parked');
    expect(extractSection(rendered, 'ELIGIBLE')).toContain('backlog-plain');
  });

  it('no parked slugs: every existing group is unchanged, and only an empty PARKED (0) header is added (no other noise)', async () => {
    await haltWorktree('halted-only');
    await inProgressWorktree('inprogress-only');
    await markProcessed('processed-only');

    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([{ slug: 'eligible-only' }], []),
    };
    const state = await scanInheritedState(deps);
    const baseline = renderDashboard(state);

    // No parked overlay at all — behavior for every existing group is
    // byte-identical to calling renderDashboard directly, unaugmented.
    const rendered = renderDashboard(
      { ...state, parked: [] } as InheritedState & { parked: string[] },
    );
    expect(extractSection(rendered, 'HALTED')).toBe(extractSection(baseline, 'HALTED'));
    expect(extractSection(rendered, 'IN-PROGRESS')).toBe(extractSection(baseline, 'IN-PROGRESS'));
    expect(extractSection(rendered, 'ELIGIBLE')).toBe(extractSection(baseline, 'ELIGIBLE'));
    expect(extractSection(rendered, 'PROCESSED')).toBe(extractSection(baseline, 'PROCESSED'));

    // Documented expectation (stories FR-6 negative path): "no PARKED section
    // noise beyond an empty-group header consistent with existing empty
    // groups" — i.e. a `PARKED (0)` header should be present even with zero
    // parks, exactly like `HALTED (0)`/`WAITING (0)` would be. This fails
    // today: there is no PARKED header at all.
    expect(rendered).toContain('PARKED (0)');
  });

  it('a stale park (marker exists, no worktree, no backlog entry) still renders visibly under PARKED', async () => {
    const parkMarker = await loadParkMarker();

    // Deliberately no worktree and no backlog item for this slug — a stale
    // park left behind after e.g. a slug rename.
    await parkMarker.writeOperatorPark(projectRoot, 'stale-parked-slug');
    await haltWorktree('halted-only');

    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([], []),
    };
    const state = await scanInheritedState(deps);

    // The stale slug is invisible to `scanInheritedState` (no worktree, not in
    // backlog) — it must be surfaced from the parked overlay directly, not
    // derived from any of the five existing groups.
    const parked = await computeParkedSlugs(parkMarker, projectRoot, [
      'stale-parked-slug',
      'halted-only',
    ]);
    expect(parked).toEqual(['stale-parked-slug']);

    const rendered = renderDashboard(
      { ...state, parked } as InheritedState & { parked: string[] },
    );

    // Fails today: no PARKED group exists, so the stale slug is dropped
    // entirely rather than surfaced for the operator to notice and unpark.
    expect(extractSection(rendered, 'PARKED')).toContain('stale-parked-slug');
  });
});

/** Pull the lines of one `<NAME> (n)` section out of the rendered dashboard block. */
function extractSection(rendered: string, name: string): string {
  const lines = rendered.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(`${name} (`));
  if (startIdx === -1) return '';
  const rest = lines.slice(startIdx + 1);
  const endOffset = rest.findIndex((l) => /^[A-Z][A-Z- ]* \(\d+\)$/.test(l) || /^──/.test(l));
  const body = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return [lines[startIdx], ...body].join('\n');
}

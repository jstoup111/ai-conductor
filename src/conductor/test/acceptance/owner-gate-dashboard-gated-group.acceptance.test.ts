import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  scanInheritedState,
  renderDashboard,
  type InheritedState,
  type ScanInheritedStateDeps,
} from '../../src/engine/daemon-dashboard.js';
import type { BacklogItem } from '../../src/engine/daemon.js';

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-1, FR-3, FR-4, FR-13
//
// RED acceptance specs for Story "Dashboard renders a GATED group with reason
// and remedy per slug" (.docs/stories/2026-07-03-surface-owner-gated-specs-
// dashboard-status.md). `renderDashboard`/`InheritedState` have NO concept of
// a `gated` bucket today — no GATED section, no reason/remedy rendering, no
// exclusion of a gated slug from the group it would otherwise land in (or
// rather: today a gated slug simply never appears anywhere, since the gate
// channel doesn't exist yet).
//
// This file drives the REAL `scanInheritedState` against real worktree/
// processed-ledger fixtures (exactly as the production dashboard does), then
// overlays a `gated` list — shaped exactly as plan Task 1 documents
// (`{ kind: 'spec', slug, reason, otherOwner?, remedy }` /
// `{ kind: 'repo', warning, remedy }`) — onto the real scan result via a cast,
// since `discoverBacklog` does not yet return a `gated` channel (plan Tasks
// 1-4) and `scanInheritedState` does not yet thread it through (plan Task 8).
// This mirrors `operator-park-dashboard-precedence.acceptance.test.ts` exactly.
//
// Every assertion is expected to fail for the RIGHT reason pre-implementation:
// the rendered string has no `GATED` line at all (no such group exists yet in
// `renderDashboard`), so `rendered.toContain('GATED (')` fails first, before
// any content-specific assertion is ever reached.
// ─────────────────────────────────────────────────────────────────────────────

type GatedSpecEntry = {
  kind: 'spec';
  slug: string;
  reason: 'other-owner' | 'unowned-post-cutover' | 'unowned-indeterminate';
  otherOwner?: string;
  remedy: string;
};
type GatedRepoEntry = { kind: 'repo'; warning: 'identity-unresolved' | 'no-cutover'; remedy: string };
type GatedEntry = GatedSpecEntry | GatedRepoEntry;

let worktreeBase: string;
let processedDir: string;

beforeEach(async () => {
  worktreeBase = await mkdtemp(join(tmpdir(), 'owner-gate-dash-worktrees-'));
  processedDir = await mkdtemp(join(tmpdir(), 'owner-gate-dash-processed-'));
});

afterEach(async () => {
  await rm(worktreeBase, { recursive: true, force: true });
  await rm(processedDir, { recursive: true, force: true });
});

async function markProcessed(slug: string): Promise<void> {
  await mkdir(processedDir, { recursive: true });
  await writeFile(join(processedDir, slug), JSON.stringify({ status: 'shipped' }), 'utf-8');
}

function makeDiscover(items: BacklogItem[]): ScanInheritedStateDeps['discover'] {
  return async () => ({ items, waiting: [] });
}

function makeThrowingDiscover(msg: string): ScanInheritedStateDeps['discover'] {
  return async () => {
    throw new Error(msg);
  };
}

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

describe('owner-gate dashboard GATED group acceptance (Covers: FR-1, FR-3, FR-4, FR-13)', () => {
  it('a spec gated as other-owner renders under GATED with the owner name and a remedy hint', async () => {
    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([{ slug: 'plain-eligible' }]),
    };
    const state = await scanInheritedState(deps);

    const gated: GatedEntry[] = [
      {
        kind: 'spec',
        slug: '2026-07-01-foo',
        reason: 'other-owner',
        otherOwner: 'alice',
        remedy: 'declare an Owner: alice or the daemon\'s own owner for this spec',
      },
    ];

    const rendered = renderDashboard({ ...state, gated } as InheritedState & { gated: GatedEntry[] });

    // Fails today: no GATED group exists at all.
    expect(rendered).toContain('GATED (1)');
    const gatedSection = extractSection(rendered, 'GATED');
    expect(gatedSection).toContain('2026-07-01-foo');
    expect(gatedSection).toContain('alice');
    expect(gatedSection.toLowerCase()).toContain('owner');

    // Sibling group still renders normally.
    expect(extractSection(rendered, 'ELIGIBLE')).toContain('plain-eligible');
  });

  it('remedy hints are reason-specific: post-cutover names the Owner: marker, indeterminate names owner_gate_cutover', async () => {
    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([]),
    };
    const state = await scanInheritedState(deps);

    const gated: GatedEntry[] = [
      {
        kind: 'spec',
        slug: 'post-cutover-slug',
        reason: 'unowned-post-cutover',
        remedy: 'add an Owner: marker to the spec on the default branch',
      },
      {
        kind: 'spec',
        slug: 'indeterminate-slug',
        reason: 'unowned-indeterminate',
        remedy: 'set owner_gate_cutover to grandfather this spec',
      },
    ];

    const rendered = renderDashboard({ ...state, gated } as InheritedState & { gated: GatedEntry[] });

    // Fails today: no GATED group at all.
    expect(rendered).toContain('GATED (2)');
    const gatedSection = extractSection(rendered, 'GATED');
    const postCutoverLine = gatedSection.split('\n').find((l) => l.includes('post-cutover-slug'));
    const indeterminateLine = gatedSection.split('\n').find((l) => l.includes('indeterminate-slug'));
    expect(postCutoverLine).toBeDefined();
    expect(postCutoverLine).toContain('Owner:');
    expect(indeterminateLine).toBeDefined();
    expect(indeterminateLine).toContain('owner_gate_cutover');
  });

  it('a slug that is BOTH processed and would-be-gated (stale ledger scenario) renders ONLY in PROCESSED — never in GATED', async () => {
    await markProcessed('processed-and-gated');

    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([]),
    };
    const state = await scanInheritedState(deps);

    // A real discovery pass would still have gated this slug (its scan predates
    // knowledge of the ledger entry) — the dashboard's existing PROCESSED
    // precedence must win, exactly as it does for HALTED/WAITING today.
    const gated: GatedEntry[] = [
      {
        kind: 'spec',
        slug: 'processed-and-gated',
        reason: 'other-owner',
        otherOwner: 'bob',
        remedy: 'declare ownership',
      },
    ];

    const rendered = renderDashboard(
      { ...state, gated } as InheritedState & { gated: GatedEntry[] },
      { includeCompleted: true },
    );

    expect(extractSection(rendered, 'PROCESSED')).toContain('processed-and-gated');
    // Fails today: no GATED group exists, so this can't yet assert the
    // precedence-filtered explicit-empty form — it fails on the missing header.
    expect(rendered).toContain('GATED (0)');
  });

  it('zero gated specs renders an explicit empty GATED (0) form — never a missing section', async () => {
    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeDiscover([{ slug: 'only-eligible' }]),
    };
    const state = await scanInheritedState(deps);

    const rendered = renderDashboard({ ...state, gated: [] } as InheritedState & { gated: GatedEntry[] });

    // Fails today: renderDashboard has no GATED header at all, empty or not.
    expect(rendered).toContain('GATED (0)');
  });

  it('discovery failing mid-scan renders GATED with the same failure fallback as ELIGIBLE today — not a fabricated authoritative empty state', async () => {
    const logs: string[] = [];
    const deps: ScanInheritedStateDeps = {
      worktreeBase,
      processedDir,
      discover: makeThrowingDiscover('backlog discovery failed: simulated'),
      log: (m) => logs.push(m),
    };
    const state = await scanInheritedState(deps);

    // Existing failure behavior: ELIGIBLE degrades to an empty (0) section, and
    // the failure is logged (never thrown out of scanInheritedState).
    expect(logs.some((l) => l.includes('backlog discovery failed'))).toBe(true);

    const rendered = renderDashboard({ ...state, gated: [] } as InheritedState & { gated: GatedEntry[] });
    expect(extractSection(rendered, 'ELIGIBLE')).toContain('ELIGIBLE (0)');
    // Fails today: no GATED section exists in the failure-fallback rendering.
    expect(rendered).toContain('GATED (0)');
  });
});

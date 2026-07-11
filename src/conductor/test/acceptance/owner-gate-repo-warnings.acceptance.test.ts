import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
// Covers: FR-11
//
// RED acceptance specs for Story "Repo-level gate warnings surface on the
// dashboard, including fail-closed identity". `renderDashboard` has no concept
// of a repo-scoped gated warning today (no GATED section at all — plan Tasks
// 5/6/9). This overlays the repo-warning shape documented by the plan
// (`{ kind: 'repo', warning: 'identity-unresolved' | 'no-cutover', remedy }`,
// adr-2026-07-03-owner-gate-gated-channel) onto a real `scanInheritedState`
// result, mirroring `owner-gate-dashboard-gated-group.acceptance.test.ts` and
// the park-marker acceptance template.
// ─────────────────────────────────────────────────────────────────────────────

type GatedRepoEntry = { kind: 'repo'; warning: 'identity-unresolved' | 'no-cutover'; remedy: string };
type GatedEntry = GatedRepoEntry | { kind: 'spec'; slug: string; reason: string; remedy: string };

let worktreeBase: string;
let processedDir: string;

beforeEach(async () => {
  worktreeBase = await mkdtemp(join(tmpdir(), 'owner-gate-repo-warn-worktrees-'));
  processedDir = await mkdtemp(join(tmpdir(), 'owner-gate-repo-warn-processed-'));
});

afterEach(async () => {
  await rm(worktreeBase, { recursive: true, force: true });
  await rm(processedDir, { recursive: true, force: true });
});

function makeDiscover(items: BacklogItem[] = []): ScanInheritedStateDeps['discover'] {
  return async () => ({ items, waiting: [] });
}

function extractSection(rendered: string, name: string): string {
  const lines = rendered.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(`${name} (`));
  if (startIdx === -1) return '';
  const rest = lines.slice(startIdx + 1);
  const endOffset = rest.findIndex((l) => /^[A-Z][A-Z- ]* \(\d+\)$/.test(l) || /^──/.test(l));
  const body = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return [lines[startIdx], ...body].join('\n');
}

describe('owner-gate repo-level dashboard warnings acceptance (Covers: FR-11)', () => {
  it('active gate + no owner_gate_cutover + an un-owned spec seen → a repo-level warning names owner_gate_cutover as the remedy', async () => {
    const deps: ScanInheritedStateDeps = { worktreeBase, processedDir, discover: makeDiscover() };
    const state = await scanInheritedState(deps);

    const gated: GatedEntry[] = [
      { kind: 'repo', warning: 'no-cutover', remedy: 'set owner_gate_cutover in .ai-conductor/config.yml' },
    ];

    const rendered = renderDashboard({ ...state, gated } as InheritedState & { gated: GatedEntry[] });

    // Fails today: no GATED section exists to carry the repo-level warning.
    expect(rendered).toContain('GATED (1)');
    const gatedSection = extractSection(rendered, 'GATED');
    expect(gatedSection.toLowerCase()).toContain('un-owned');
    expect(gatedSection).toContain('owner_gate_cutover');
  });

  it('daemon identity supplied but UNRESOLVED → dashboard shows "building NOTHING — identity unresolved" with a remedy, never an unexplained empty dashboard', async () => {
    const deps: ScanInheritedStateDeps = { worktreeBase, processedDir, discover: makeDiscover() };
    const state = await scanInheritedState(deps);

    // Fail-closed early return: the repo-scoped entry is what discovery would
    // have produced per adr-2026-07-03-owner-gate-gated-channel; overlaid here
    // since discoverBacklog does not emit it yet (plan Task 6).
    const gated: GatedEntry[] = [
      {
        kind: 'repo',
        warning: 'identity-unresolved',
        remedy: 'set spec_owner in ~/.ai-conductor/config.yml or authenticate gh',
      },
    ];

    const rendered = renderDashboard({ ...state, gated } as InheritedState & { gated: GatedEntry[] });

    // Fails today: no GATED section, so the identity-unresolved warning and its
    // "building NOTHING" framing are entirely absent — an unexplained empty
    // dashboard is exactly the failure this story exists to prevent.
    expect(rendered.toLowerCase()).toContain('building nothing');
    expect(rendered.toLowerCase()).toContain('identity unresolved');
    const gatedSection = extractSection(rendered, 'GATED');
    expect(gatedSection).toContain('spec_owner');
  });

  it('gate unwired (legacy mode, no daemonOwner) → zero repo-level warnings and zero GATED entries (silent legacy behavior preserved)', async () => {
    const deps: ScanInheritedStateDeps = { worktreeBase, processedDir, discover: makeDiscover([{ slug: 'legacy-item' }]) };
    const state = await scanInheritedState(deps);

    // No overlay at all — legacy callers never pass a `gated` field.
    const rendered = renderDashboard(state);

    // This assertion actually PASSES today (there is no GATED noise because
    // there is no GATED section at all) — included for completeness of the
    // legacy-preservation contract; the meaningful RED assertion is the next
    // one, which pins the post-implementation explicit-empty contract once a
    // `gated: []` overlay is supplied for a legacy-shaped call (Task 7).
    expect(rendered).not.toContain('identity unresolved');
    expect(rendered).not.toContain('owner_gate_cutover');

    const renderedWithEmptyOverlay = renderDashboard(
      { ...state, gated: [] } as InheritedState & { gated: GatedEntry[] },
    );
    // Fails today: no GATED (0) header exists.
    expect(renderedWithEmptyOverlay).toContain('GATED (0)');
  });

  it('cutover configured and all specs owned → no repo-level warning appears (no false alarms)', async () => {
    const deps: ScanInheritedStateDeps = { worktreeBase, processedDir, discover: makeDiscover([{ slug: 'owned-item' }]) };
    const state = await scanInheritedState(deps);

    const rendered = renderDashboard({ ...state, gated: [] } as InheritedState & { gated: GatedEntry[] });

    expect(rendered).not.toContain('owner_gate_cutover');
    expect(rendered).not.toContain('identity unresolved');
    // Fails today: no explicit GATED (0) header.
    expect(rendered).toContain('GATED (0)');
  });
});

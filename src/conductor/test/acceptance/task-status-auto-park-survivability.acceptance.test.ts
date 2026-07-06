import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeOperatorPark,
  isOperatorParked,
  removeOperatorPark,
} from '../../src/engine/park-marker.js';
import { rekickSweep, type RekickSweepDeps } from '../../src/engine/daemon-rekick.js';
import { dispatchDaemonPark } from '../../src/engine/daemon-park-cli.js';
import { renderDashboard, type InheritedState } from '../../src/engine/daemon-dashboard.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "No evidence after N attempts parks the feature —
// visibly, durably, never looping" (ADR H2/H7, carried #280 reconciliation,
// .docs/stories/prd-audit-kickback-preserves-task-status.md Slice 3, plan
// Tasks 22–26).
//
// CONFIDENCE NOTE (flagged per verify-claims protocol — this file is the
// weakest-grounded of the four, and should NOT be treated as pinning the
// eventual API):
//
//  - `writeAutoPark(root, slug, reason)` (plan Task 22 step 1: "Extend
//    park-marker.ts") — HIGH confidence: the plan spells out this exact
//    signature and the body format `auto-parked: <reason>`.
//  - A provenance reader distinguishing auto vs operator parks — MEDIUM
//    confidence on the name `readParkProvenance(root, slug)`; the plan only
//    says "a provenance reader" without naming it.
//  - `incrementNoEvidenceAttempts` / `resetNoEvidenceAttempts` /
//    `readNoEvidenceAttempts` in `task-evidence.ts` — LOW-MEDIUM confidence:
//    the plan pins the sidecar PATH (`.pipeline/task-evidence.json`, Task 1)
//    and that a "durable no-evidence attempt counter" lives there (Task 12),
//    but does not name the accessor functions.
//  - `checkAndAutoPark` in a new `daemon-auto-park.ts` — LOW confidence: Task
//    23 explicitly defers this to "the daemon gate layer... wiring per the
//    review" without naming a module or function. This is a plausible single
//    entry point for the trigger decision (reads the sidecar counter, writes
//    the park marker via `writeAutoPark`, and reports whether dispatch should
//    stop) but is this test author's construction, not a value pinned by any
//    approved doc. If Task 23 lands with a different shape, this file's RED
//    reason ("module not found") stays valid, but its assertions on the
//    RETURN shape must be re-verified — do not treat them as spec.
//
// Everything NOT flagged above (park-marker.ts existence checks, rekickSweep,
// daemon-park-cli's real unpark verb, daemon-dashboard's renderDashboard) are
// existing, already-shipped production primitives driven for real.
// ─────────────────────────────────────────────────────────────────────────────

const TASK_EVIDENCE_MOD = '../../src/engine/task-evidence.js';
const AUTO_PARK_MOD = '../../src/engine/daemon-auto-park.js';

interface TaskEvidenceModule {
  incrementNoEvidenceAttempts: (projectRoot: string) => Promise<number>;
  resetNoEvidenceAttempts: (projectRoot: string) => Promise<void>;
  readNoEvidenceAttempts: (projectRoot: string) => Promise<number>;
}

async function loadTaskEvidence(bust = false): Promise<TaskEvidenceModule> {
  const spec = bust ? `${TASK_EVIDENCE_MOD}?t=${Date.now()}-${Math.random()}` : TASK_EVIDENCE_MOD;
  const mod = (await import(spec)) as Record<string, unknown>;
  for (const name of [
    'incrementNoEvidenceAttempts',
    'resetNoEvidenceAttempts',
    'readNoEvidenceAttempts',
  ] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `expected export "${name}" from task-evidence.ts to be a function (not yet implemented)`,
      );
    }
  }
  return mod as unknown as TaskEvidenceModule;
}

interface AutoParkModule {
  checkAndAutoPark: (
    projectRoot: string,
    slug: string,
    opts: { maxAttempts: number; daemon: boolean; reason?: string; emit?: (evt: unknown) => void },
  ) => Promise<{ parked: boolean }>;
}

async function loadAutoPark(): Promise<AutoParkModule> {
  const mod = (await import(AUTO_PARK_MOD)) as Record<string, unknown>;
  const fn = mod.checkAndAutoPark;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected export "checkAndAutoPark" from daemon-auto-park.ts to be a function (not yet implemented)',
    );
  }
  return mod as unknown as AutoParkModule;
}

interface ParkMarkerModule {
  writeAutoPark: (root: string, slug: string, reason: string) => Promise<void>;
  readParkProvenance: (root: string, slug: string) => Promise<'operator' | 'auto' | null>;
}

async function loadParkMarkerAutoExtension(): Promise<ParkMarkerModule> {
  const mod = (await import('../../src/engine/park-marker.js')) as Record<string, unknown>;
  for (const name of ['writeAutoPark', 'readParkProvenance'] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `expected export "${name}" from park-marker.ts to be a function (not yet implemented)`,
      );
    }
  }
  return mod as unknown as ParkMarkerModule;
}

let root: string; // project root housing `.daemon/parked/<slug>` and `.pipeline/task-evidence.json`
let worktreeBase: string;
const SLUG = 'never-evidences';
const MAX_ATTEMPTS = 3;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'auto-park-root-'));
  worktreeBase = await mkdtemp(join(tmpdir(), 'auto-park-worktrees-'));
  await mkdir(join(root, '.pipeline'), { recursive: true });
  // validateSlug requires a plan or worktree to exist for the slug.
  await mkdir(join(root, '.docs/plans'), { recursive: true });
  await writeFile(join(root, '.docs/plans', `${SLUG}.md`), '### Task 1\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(worktreeBase, { recursive: true, force: true });
});

describe('acceptance: no evidence after N attempts parks the feature, survivably (H2/H7, Slice 3)', () => {
  it('happy: N consecutive no-evidence misses write a distinct auto-park marker, stop dispatch, and are visible to isOperatorParked', async () => {
    const taskEvidence = await loadTaskEvidence();
    const autoPark = await loadAutoPark();

    let last: { parked: boolean } = { parked: false };
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await taskEvidence.incrementNoEvidenceAttempts(root);
      last = await autoPark.checkAndAutoPark(root, SLUG, { maxAttempts: MAX_ATTEMPTS, daemon: true });
    }

    expect(last.parked).toBe(true);
    expect(await isOperatorParked(root, SLUG)).toBe(true); // existence-based check still sees it

    const parkMarker = await loadParkMarkerAutoExtension();
    expect(await parkMarker.readParkProvenance(root, SLUG)).toBe('auto');
  });

  it('happy: empty/missing plan at seed time takes the same auto-park path with reason "empty/missing plan" (never a "no tasks" HALT loop)', async () => {
    const autoPark = await loadAutoPark();
    const result = await autoPark.checkAndAutoPark(root, SLUG, {
      maxAttempts: MAX_ATTEMPTS,
      daemon: true,
      reason: 'empty/missing plan',
    });
    expect(result.parked).toBe(true);
    const parkMarker = await loadParkMarkerAutoExtension();
    expect(await parkMarker.readParkProvenance(root, SLUG)).toBe('auto');
    const body = await readFile(join(root, '.daemon', 'parked', SLUG), 'utf-8');
    expect(body).toMatch(/empty\/missing plan/);
  });

  it('happy: rekickSweep on a new base SHA skips the auto-parked slug (existence-based check survives re-kick)', async () => {
    const parkMarker = await loadParkMarkerAutoExtension();
    await parkMarker.writeAutoPark(root, SLUG, 'no completion evidence after 3 attempts');

    const wt = join(worktreeBase, SLUG);
    await mkdir(join(wt, '.pipeline'), { recursive: true });
    await writeFile(join(wt, '.pipeline/HALT'), `parked: ${SLUG}\n`);

    const deps: RekickSweepDeps = {
      listHaltedWorktrees: async () => [SLUG],
      readHaltReason: async () => 'auto-parked',
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {},
      clearMarker: async () => {},
      lastRekickSha: new Map(),
      log: () => {},
      isOperatorParked: (slug) => isOperatorParked(root, slug),
    };

    const result = await rekickSweep(deps, 'a'.repeat(40));
    expect(result.skipped).toContain(SLUG);
    expect(result.cleared).not.toContain(SLUG);
  });

  it('happy: the unpark verb removes the marker AND resets the no-evidence counter; next tick resumes', async () => {
    const taskEvidence = await loadTaskEvidence();
    const parkMarker = await loadParkMarkerAutoExtension();

    for (let i = 0; i < MAX_ATTEMPTS; i++) await taskEvidence.incrementNoEvidenceAttempts(root);
    await parkMarker.writeAutoPark(root, SLUG, 'no completion evidence after 3 attempts');

    const code = await dispatchDaemonPark({ kind: 'unpark', slug: SLUG }, { cwd: root, out: () => {} });
    expect(code).toBe(0);
    expect(await isOperatorParked(root, SLUG)).toBe(false);

    // Today's dispatchDaemonPark only removes the marker — it has no notion of
    // the no-evidence counter at all, so this is expected to fail until the
    // unpark verb is wired to reset it (Task 24).
    expect(await taskEvidence.readNoEvidenceAttempts(root)).toBe(0);
  });

  it('negative: the N-attempt counter persists across a simulated engine restart (fresh module instance reads the sidecar, not an in-memory Map)', async () => {
    const first = await loadTaskEvidence();
    await first.incrementNoEvidenceAttempts(root);
    await first.incrementNoEvidenceAttempts(root);

    // Force a genuinely fresh module instance (cache-busted specifier) so any
    // in-memory Map/Set keyed by root cannot leak the count across — the
    // counter must be readable ONLY because it was persisted to
    // `.pipeline/task-evidence.json` on disk.
    const fresh = await loadTaskEvidence(true);
    expect(await fresh.readNoEvidenceAttempts(root)).toBe(2);
  });

  it('negative: evidence accruing before N is reached resets the counter (a slow-but-progressing feature is never parked)', async () => {
    const taskEvidence = await loadTaskEvidence();
    await taskEvidence.incrementNoEvidenceAttempts(root);
    await taskEvidence.incrementNoEvidenceAttempts(root);
    expect(await taskEvidence.readNoEvidenceAttempts(root)).toBe(2);

    // Progress observed (completed-count increase) — resets to zero.
    await taskEvidence.resetNoEvidenceAttempts(root);
    expect(await taskEvidence.readNoEvidenceAttempts(root)).toBe(0);
  });

  it('negative: dashboard-visible provenance distinguishes auto-park from operator-park', async () => {
    await writeOperatorPark(root, 'human-parked-feat');
    const parkMarker = await loadParkMarkerAutoExtension();
    await parkMarker.writeAutoPark(root, SLUG, 'no completion evidence after 3 attempts');

    const state = {
      halted: [],
      processed: [],
      inProgress: [],
      eligible: [],
      halvedCount: 0,
      processedCount: 0,
      parked: [SLUG, 'human-parked-feat'],
    } as unknown as InheritedState;

    const rendered = renderDashboard(state);
    // Today's renderDashboard treats `parked` as an undifferentiated list of
    // slugs — this assertion is the RED signal that provenance rendering
    // (auto vs "parked by operator") has not been added yet.
    expect(rendered).toMatch(new RegExp(`${SLUG}.*auto-parked|auto-parked.*${SLUG}`));
    expect(rendered).not.toMatch(new RegExp(`${SLUG}.*parked by operator`));
  });

  it('negative: an interactive (daemon:false) run in the same no-evidence state never writes a park marker', async () => {
    const autoPark = await loadAutoPark();
    const result = await autoPark.checkAndAutoPark(root, SLUG, {
      maxAttempts: MAX_ATTEMPTS,
      daemon: false,
    });
    expect(result.parked).toBe(false);
    expect(await isOperatorParked(root, SLUG)).toBe(false);
  });
});

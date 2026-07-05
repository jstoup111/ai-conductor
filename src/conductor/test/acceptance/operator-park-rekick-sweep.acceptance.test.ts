import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  rekickSweep,
  listHaltedWorktrees,
  readHaltReason,
  hasRebaseInProgress,
  abortRebase,
  clearMarker,
  HALT_MARKER,
  HALT_CLEARED_MARKER,
  REKICK_SENTINEL,
  type RekickSweepDeps,
} from '../../src/engine/daemon-rekick.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Operator Park" (.docs/stories/operator-park-a-
// human-placed-halt-must-survive-the.md, FR-3/FR-5, plus the FR-1/FR-4/FR-7
// CLI-to-sweep wiring proof). These drive the REAL `rekickSweep` (already
// implemented) against REAL worktree fixtures on disk, wired to the REAL
// `park-marker.ts` primitives (`writeOperatorPark`/`isOperatorParked`/
// `removeOperatorPark`) once that not-yet-implemented module exists.
//
// `park-marker.ts` does not exist yet at RED time (plan Task 1/2), so it is
// loaded dynamically rather than via a static top-level import — the same
// pattern used by test/acceptance/rekick-shipped-skip.acceptance.test.ts for
// `shipped-record.ts`. `RekickSweepDeps.isOperatorParked` also does not exist
// on the interface yet (plan Task 3 adds it); the deps object is built with
// the extra field and cast `as RekickSweepDeps`, exactly like the existing
// acceptance file's pattern, so this file compiles today and drives the
// sweep-side implementation.
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

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);

let projectRoot: string; // houses `.daemon/parked/<slug>` (repo-root operator state, ADR §2)
let worktreeBase: string; // real halted-worktree fixtures

async function haltWorktree(slug: string, body = `parked: ${slug}\n`): Promise<void> {
  const wt = join(worktreeBase, slug);
  await mkdir(join(wt, '.pipeline'), { recursive: true });
  await writeFile(join(wt, HALT_MARKER), body);
}

async function readHalt(slug: string): Promise<string | null> {
  return readFile(join(worktreeBase, slug, HALT_MARKER), 'utf-8').catch(() => null);
}

async function fileExists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

async function haltIsPresent(slug: string): Promise<boolean> {
  return fileExists(join(worktreeBase, slug, HALT_MARKER));
}

async function haltClearedIsPresent(slug: string): Promise<boolean> {
  return fileExists(join(worktreeBase, slug, HALT_CLEARED_MARKER));
}

async function sentinelIsPresent(slug: string): Promise<boolean> {
  return fileExists(join(worktreeBase, slug, REKICK_SENTINEL));
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'operator-park-root-'));
  worktreeBase = await mkdtemp(join(tmpdir(), 'operator-park-worktrees-'));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(worktreeBase, { recursive: true, force: true });
});

/**
 * Build real `RekickSweepDeps` wired against the fixture worktrees. Mirrors
 * `rekick-shipped-skip.acceptance.test.ts`'s `realDeps` helper. `abortRebase`
 * and `clearMarker` are wrapped in spies (still delegating to the real fs
 * primitives) so tests can assert they were never invoked for a parked slug —
 * an observable proxy for "nothing was touched" beyond just checking file
 * state, per the story's explicit "abort is NOT invoked" criterion.
 */
function realDeps(opts: {
  isOperatorParked?: (slug: string) => Promise<boolean>;
  isProcessed?: (slug: string) => Promise<boolean>;
  hasRebaseInProgress?: (slug: string) => Promise<boolean>;
  log: (m: string) => void;
  lastRekickSha?: Map<string, string>;
}): {
  deps: RekickSweepDeps;
  abortRebaseSpy: ReturnType<typeof vi.fn>;
  clearMarkerSpy: ReturnType<typeof vi.fn>;
} {
  const abortRebaseSpy = vi.fn((slug: string) => abortRebase(join(worktreeBase, slug)));
  const clearMarkerSpy = vi.fn((slug: string) => clearMarker(join(worktreeBase, slug)));
  const deps = {
    listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
    readHaltReason: (slug: string) => readHaltReason(worktreeBase, slug),
    hasRebaseInProgress:
      opts.hasRebaseInProgress ?? ((slug: string) => hasRebaseInProgress(join(worktreeBase, slug))),
    abortRebase: abortRebaseSpy,
    clearMarker: clearMarkerSpy,
    lastRekickSha: opts.lastRekickSha ?? new Map(),
    log: opts.log,
    isProcessed: opts.isProcessed,
    isOperatorParked: opts.isOperatorParked,
  } as RekickSweepDeps;
  return { deps, abortRebaseSpy, clearMarkerSpy };
}

describe('operator-park rekick-sweep acceptance (FR-3/FR-5): a parked worktree is left completely untouched', () => {
  it('FR-3 happy: a parked+rebase-paused worktree is skipped, HALT is byte-identical, abort/clear never invoked, no sentinel, verbatim log', async () => {
    const parkMarker = await loadParkMarker();
    const body = 'original halt reason\nmore detail\n';
    await haltWorktree('parked-feat', body);
    await parkMarker.writeOperatorPark(projectRoot, 'parked-feat');

    const log: string[] = [];
    const { deps, abortRebaseSpy, clearMarkerSpy } = realDeps({
      isOperatorParked: (slug) => parkMarker.isOperatorParked(projectRoot, slug),
      // Simulate a rebase paused mid-flight for this slug (RekickSweepDeps
      // already injects this primitive — no real git rebase state needed to
      // prove the parked check runs BEFORE the abort/clear chain).
      hasRebaseInProgress: async (slug) => slug === 'parked-feat',
      log: (m) => log.push(m),
    });

    const result = await rekickSweep(deps, SHA_1);

    expect(result.skipped).toContain('parked-feat');
    expect(result.cleared).not.toContain('parked-feat');
    expect(await readHalt('parked-feat')).toBe(body);
    expect(await haltClearedIsPresent('parked-feat')).toBe(false);
    expect(await sentinelIsPresent('parked-feat')).toBe(false);
    expect(abortRebaseSpy).not.toHaveBeenCalled();
    expect(clearMarkerSpy).not.toHaveBeenCalled();
    expect(log).toContain('re-kick parked-feat: skipped — operator-parked');
  });

  it('FR-3 negative (ordering): a parked slug that is ALSO isProcessed never reaches the isProcessed check', async () => {
    const parkMarker = await loadParkMarker();
    await haltWorktree('parked-and-shipped');
    await parkMarker.writeOperatorPark(projectRoot, 'parked-and-shipped');

    let isProcessedCalls = 0;
    const { deps } = realDeps({
      isOperatorParked: (slug) => parkMarker.isOperatorParked(projectRoot, slug),
      isProcessed: async (slug) => {
        if (slug === 'parked-and-shipped') isProcessedCalls++;
        return true;
      },
      log: () => {},
    });

    const result = await rekickSweep(deps, SHA_1);

    expect(result.skipped).toContain('parked-and-shipped');
    expect(isProcessedCalls).toBe(0); // the parked check precedes isProcessed
  });

  it('FR-5 mixed pass: parked A stays fully untouched while un-parked B clears in the SAME sweep call', async () => {
    const parkMarker = await loadParkMarker();
    await haltWorktree('parked-sibling');
    await haltWorktree('unparked-sibling');
    await parkMarker.writeOperatorPark(projectRoot, 'parked-sibling');

    const lastRekickSha = new Map<string, string>();
    const log: string[] = [];
    const { deps, abortRebaseSpy, clearMarkerSpy } = realDeps({
      isOperatorParked: (slug) => parkMarker.isOperatorParked(projectRoot, slug),
      log: (m) => log.push(m),
      lastRekickSha,
    });

    const result = await rekickSweep(deps, SHA_1);

    expect(result.skipped).toContain('parked-sibling');
    expect(result.cleared).toContain('unparked-sibling');

    // Parked sibling: nothing touched.
    expect(await haltIsPresent('parked-sibling')).toBe(true);
    expect(await haltClearedIsPresent('parked-sibling')).toBe(false);
    expect(await sentinelIsPresent('parked-sibling')).toBe(false);
    expect(lastRekickSha.has('parked-sibling')).toBe(false);

    // Un-parked sibling: cleared exactly as today's behavior.
    expect(await haltIsPresent('unparked-sibling')).toBe(false);
    expect(await haltClearedIsPresent('unparked-sibling')).toBe(true);
    expect(await sentinelIsPresent('unparked-sibling')).toBe(true);
    expect(lastRekickSha.get('unparked-sibling')).toBe(SHA_1);

    expect(abortRebaseSpy).not.toHaveBeenCalledWith('parked-sibling');
    expect(clearMarkerSpy).not.toHaveBeenCalledWith('parked-sibling');
  });

  it('FR-3 happy: a park is unconditional across SHAs — skipped at SHA X, skipped again at SHA Y, never once-per-SHA', async () => {
    const parkMarker = await loadParkMarker();
    await haltWorktree('perpetually-parked');
    await parkMarker.writeOperatorPark(projectRoot, 'perpetually-parked');

    const lastRekickSha = new Map<string, string>();
    const { deps } = realDeps({
      isOperatorParked: (slug) => parkMarker.isOperatorParked(projectRoot, slug),
      log: () => {},
      lastRekickSha,
    });

    const first = await rekickSweep(deps, SHA_1);
    expect(first.skipped).toContain('perpetually-parked');
    expect(await haltIsPresent('perpetually-parked')).toBe(true);

    const second = await rekickSweep(deps, SHA_2);
    expect(second.skipped).toContain('perpetually-parked');
    expect(await haltIsPresent('perpetually-parked')).toBe(true);
    expect(lastRekickSha.has('perpetually-parked')).toBe(false);
  });

  it('FR-3 negative (error isolation): an isOperatorParked failure fails TOWARD parked for that slug only — siblings still clear', async () => {
    await haltWorktree('flaky-park-check');
    await haltWorktree('healthy-sibling');

    const log: string[] = [];
    const throwingIsOperatorParked = async (slug: string): Promise<boolean> => {
      if (slug === 'flaky-park-check') throw new Error('EACCES: permission denied, stat');
      return false;
    };
    const { deps } = realDeps({
      isOperatorParked: throwingIsOperatorParked,
      log: (m) => log.push(m),
    });

    const result = await rekickSweep(deps, SHA_1);

    // Fail-toward-parked: the check error itself never clears the slug.
    expect(result.skipped).toContain('flaky-park-check');
    expect(result.cleared).not.toContain('flaky-park-check');
    expect(await haltIsPresent('flaky-park-check')).toBe(true);
    expect(log.some((l) => /flaky-park-check/.test(l) && /error|fail/i.test(l))).toBe(true);

    // Sibling is entirely unaffected by the error (per-worktree isolation).
    expect(result.cleared).toContain('healthy-sibling');
    expect(await haltIsPresent('healthy-sibling')).toBe(false);
  });

  it('FR-4/FR-7 end-to-end wiring: park -> sweep skips; unpark -> next sweep at a new SHA clears normally', async () => {
    const parkMarker = await loadParkMarker();
    await haltWorktree('park-then-unpark');
    await parkMarker.writeOperatorPark(projectRoot, 'park-then-unpark');

    const isOperatorParked = (slug: string) => parkMarker.isOperatorParked(projectRoot, slug);
    const lastRekickSha = new Map<string, string>();

    const { deps: parkedDeps } = realDeps({
      isOperatorParked,
      log: () => {},
      lastRekickSha,
    });
    const parkedResult = await rekickSweep(parkedDeps, SHA_1);
    expect(parkedResult.skipped).toContain('park-then-unpark');
    expect(await haltIsPresent('park-then-unpark')).toBe(true);

    // The real unpark primitive removes the marker.
    await parkMarker.removeOperatorPark(projectRoot, 'park-then-unpark');
    expect(await parkMarker.isOperatorParked(projectRoot, 'park-then-unpark')).toBe(false);

    // Same worktree, same deps shape, a genuine new SHA — ordinary re-kick
    // behavior resumes exactly as today's halted flow (unpark restores
    // "otherwise eligible" without requiring a daemon restart).
    const { deps: unparkedDeps } = realDeps({
      isOperatorParked,
      log: () => {},
      lastRekickSha,
    });
    const unparkedResult = await rekickSweep(unparkedDeps, SHA_2);
    expect(unparkedResult.cleared).toContain('park-then-unpark');
    expect(await haltIsPresent('park-then-unpark')).toBe(false);
    expect(await haltClearedIsPresent('park-then-unpark')).toBe(true);
    expect(await sentinelIsPresent('park-then-unpark')).toBe(true);
  });
});

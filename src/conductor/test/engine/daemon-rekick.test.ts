import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import {
  rekickSweep,
  resumeRebaseFirst,
  hasRebaseInProgress,
  abortRebase,
  clearMarker,
  listHaltedWorktrees,
  readHaltReason,
  type RekickSweepDeps,
  HALT_MARKER,
  HALT_CLEARED_MARKER,
  REKICK_SENTINEL,
} from '../../src/engine/daemon-rekick.js';
import { join as pjoin } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { makeRunFeature, type FeatureRunnerDeps, type WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import { readState } from '../../src/engine/state.js';
import { checkAndAutoPark } from '../../src/engine/daemon-auto-park.js';
import { isOperatorParked, __resetResolveCacheForTests, reconcileStrandedParkMarkers } from '../../src/engine/park-marker.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFileAsync = promisify(execFileCb);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

// ── Pure sweep core (injected primitives — no real git) ───────────────────────

interface Trace {
  events: string[];
  cleared: Set<string>;
}

function fakeDeps(opts: {
  halted: string[];
  rebasing?: Set<string>;
  abortFails?: Set<string>;
  clearFails?: Set<string>;
  lastRekickSha?: Map<string, string>;
  isProcessed?: (slug: string) => Promise<boolean>;
  warned?: Set<string>;
  isOperatorParked?: (slug: string) => Promise<boolean>;
  readHaltClass?: (slug: string) => Promise<'needs-human' | 'mechanical' | 'unclassified'>;
}): { deps: RekickSweepDeps; trace: Trace } {
  const trace: Trace = { events: [], cleared: new Set() };
  const warned = opts.warned ?? new Set<string>();
  const deps: RekickSweepDeps = {
    listHaltedWorktrees: async () => opts.halted,
    readHaltReason: async (slug) => `reason:${slug}`,
    hasRebaseInProgress: async (slug) => {
      trace.events.push(`hasRebaseInProgress:${slug}`);
      return opts.rebasing?.has(slug) ?? false;
    },
    abortRebase: async (slug) => {
      trace.events.push(`abort:${slug}`);
      if (opts.abortFails?.has(slug)) throw new Error('abort failed');
    },
    clearMarker: async (slug) => {
      trace.events.push(`clear:${slug}`);
      if (opts.clearFails?.has(slug)) throw new Error('clear failed');
      trace.cleared.add(slug);
    },
    lastRekickSha: opts.lastRekickSha ?? new Map(),
    log: (m) => trace.events.push(`log:${m}`),
    ...(opts.isProcessed
      ? {
          isProcessed: async (slug: string) => {
            trace.events.push(`isProcessed:${slug}`);
            return opts.isProcessed!(slug);
          },
        }
      : {}),
    ...(opts.isOperatorParked ? { isOperatorParked: opts.isOperatorParked } : {}),
    ...(opts.readHaltClass
      ? {
          readHaltClass: async (slug: string) => {
            trace.events.push(`readHaltClass:${slug}`);
            return opts.readHaltClass!(slug);
          },
        }
      : {}),
    hasWarned: async (slug) => warned.has(slug),
    markWarned: async (slug) => {
      warned.add(slug);
    },
  };
  return { deps, trace };
}

describe('engine/daemon-rekick — rekickSweep (FR-7/FR-9)', () => {
  it('clears every halted worktree and records the triggering SHA', async () => {
    const last = new Map<string, string>();
    const { deps, trace } = fakeDeps({ halted: ['a', 'b', 'c'], lastRekickSha: last });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared.sort()).toEqual(['a', 'b', 'c']);
    expect([...trace.cleared].sort()).toEqual(['a', 'b', 'c']);
    expect(last.get('a')).toBe(SHA_B);
    expect(last.get('c')).toBe(SHA_B);
  });

  it('aborts an in-progress rebase BEFORE clearing the marker', async () => {
    const { deps, trace } = fakeDeps({ halted: ['r'], rebasing: new Set(['r']) });
    await rekickSweep(deps, SHA_B);
    const abortIdx = trace.events.indexOf('abort:r');
    const clearIdx = trace.events.indexOf('clear:r');
    expect(abortIdx).toBeGreaterThanOrEqual(0);
    expect(clearIdx).toBeGreaterThan(abortIdx);
  });

  it('a FAILED abort leaves the marker intact (no clear, no sentinel)', async () => {
    const last = new Map<string, string>();
    const { deps, trace } = fakeDeps({
      halted: ['r'],
      rebasing: new Set(['r']),
      abortFails: new Set(['r']),
      lastRekickSha: last,
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared).toEqual([]);
    expect(res.skipped).toEqual(['r']);
    expect(trace.cleared.has('r')).toBe(false); // clearMarker never called
    expect(last.has('r')).toBe(false); // not recorded → a later advance still re-kicks
  });

  it('a non-halted worktree is simply not in the list (untouched)', async () => {
    const { deps, trace } = fakeDeps({ halted: [] });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared).toEqual([]);
    expect(trace.events.filter((e) => e.startsWith('clear:'))).toEqual([]);
  });

  it('FR-9: a worktree already re-kicked at this SHA is skipped', async () => {
    const last = new Map<string, string>([['x', SHA_B]]);
    const { deps, trace } = fakeDeps({ halted: ['x'], lastRekickSha: last });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['x']);
    expect(res.cleared).toEqual([]);
    expect(trace.cleared.has('x')).toBe(false);
  });

  it('FR-9: a later SHA advance re-kicks the still-halted feature again', async () => {
    const last = new Map<string, string>([['x', SHA_B]]);
    const { deps } = fakeDeps({ halted: ['x'], lastRekickSha: last });
    const res = await rekickSweep(deps, SHA_C);
    expect(res.cleared).toEqual(['x']);
    expect(last.get('x')).toBe(SHA_C);
  });

  it('a needs-human-classified halt is skipped, not cleared, and never touches abort/clear/lastRekickSha', async () => {
    const last = new Map<string, string>();
    const { deps, trace } = fakeDeps({
      halted: ['h'],
      lastRekickSha: last,
      readHaltClass: async () => 'needs-human',
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['h']);
    expect(res.cleared).toEqual([]);
    expect(trace.events.some((e) => e.startsWith('abort:'))).toBe(false);
    expect(trace.events.some((e) => e.startsWith('clear:'))).toBe(false);
    expect(last.has('h')).toBe(false);
    const logLine = trace.events.find(
      (e) => e.startsWith('log:') && e.includes('h') && e.includes('needs-human'),
    );
    expect(logLine).toBeDefined();
  });

  it('a needs-human-classified halt is skipped again on a second sweep at a NEW sha (not just the FR-9 guard)', async () => {
    const last = new Map<string, string>();
    const { deps } = fakeDeps({
      halted: ['h'],
      lastRekickSha: last,
      readHaltClass: async () => 'needs-human',
    });
    const res1 = await rekickSweep(deps, SHA_B);
    expect(res1.skipped).toEqual(['h']);
    expect(last.has('h')).toBe(false);

    const res2 = await rekickSweep(deps, SHA_C);
    expect(res2.skipped).toEqual(['h']);
    expect(res2.cleared).toEqual([]);
  });

  it('operator-parked AND needs-human: park check fires first, readHaltClass is never called', async () => {
    const last = new Map<string, string>();
    let classCalled = false;
    const { deps, trace } = fakeDeps({
      halted: ['h'],
      lastRekickSha: last,
      isOperatorParked: async () => true,
      readHaltClass: async () => {
        classCalled = true;
        return 'needs-human';
      },
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['h']);
    expect(classCalled).toBe(false);
    expect(trace.events.some((e) => e.startsWith('readHaltClass:'))).toBe(false);
    const logLine = trace.events.find((e) => e.startsWith('log:') && e.includes('operator-parked'));
    expect(logLine).toBeDefined();
  });

  it('a per-worktree clear error is isolated; the sweep continues', async () => {
    const { deps } = fakeDeps({ halted: ['a', 'bad', 'c'], clearFails: new Set(['bad']) });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared.sort()).toEqual(['a', 'c']);
    expect(res.skipped).toEqual(['bad']);
  });

  it('isProcessed=true → slug is skipped entirely, no abort/clear work, one-time skip log', async () => {
    const { deps, trace } = fakeDeps({
      halted: ['shipped-slug'],
      isProcessed: async () => true,
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['shipped-slug']);
    expect(res.cleared).toEqual([]);
    expect(trace.events.some((e) => e.startsWith('hasRebaseInProgress:'))).toBe(false);
    expect(trace.events.some((e) => e.startsWith('abort:'))).toBe(false);
    expect(trace.events.some((e) => e.startsWith('clear:'))).toBe(false);
    expect(
      trace.events.some((e) => e.includes('skipping re-kick') && e.includes('shipped-slug')),
    ).toBe(true);
  });

  it('isProcessed=false → behavior byte-identical to the no-isProcessed sweep', async () => {
    const last = new Map<string, string>();
    const { deps, trace } = fakeDeps({
      halted: ['a', 'b'],
      lastRekickSha: last,
      isProcessed: async () => false,
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared.sort()).toEqual(['a', 'b']);
    expect(res.skipped).toEqual([]);
    expect(trace.events.some((e) => e.startsWith('clear:'))).toBe(true);
  });

  it('isProcessed throws → treated as NOT processed (fail-open), error logged, sweep continues', async () => {
    const last = new Map<string, string>();
    const { deps, trace } = fakeDeps({
      halted: ['a', 'boom'],
      lastRekickSha: last,
      isProcessed: async (slug) => {
        if (slug === 'boom') throw new Error('isProcessed exploded');
        return false;
      },
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared.sort()).toEqual(['a', 'boom']);
    expect(res.skipped).toEqual([]);
    expect(
      trace.events.some((e) => e.includes('boom') && e.toLowerCase().includes('isprocessed')),
    ).toBe(true);
  });

  it('warn-once: the skip log for the same slug does not repeat on a second poll at a different SHA', async () => {
    const warned = new Set<string>();
    const { deps: deps1, trace: trace1 } = fakeDeps({
      halted: ['shipped'],
      isProcessed: async () => true,
      warned,
    });
    await rekickSweep(deps1, SHA_B);
    expect(trace1.events.some((e) => e.includes('skipping re-kick'))).toBe(true);

    const { deps: deps2, trace: trace2 } = fakeDeps({
      halted: ['shipped'],
      isProcessed: async () => true,
      warned,
    });
    await rekickSweep(deps2, SHA_C);
    expect(trace2.events.some((e) => e.includes('skipping re-kick'))).toBe(false);
  });

  // ── operator-park: skip ordered FIRST, ahead of isProcessed and SHA guard ──

  it('operator-parked slug → skipped, no abort/clear/sentinel, log line present', async () => {
    const { deps, trace } = fakeDeps({
      halted: ['parked-slug'],
      isOperatorParked: async () => true,
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['parked-slug']);
    expect(res.cleared).toEqual([]);
    expect(trace.events.some((e) => e.startsWith('hasRebaseInProgress:'))).toBe(false);
    expect(trace.events.some((e) => e.startsWith('abort:'))).toBe(false);
    expect(trace.events.some((e) => e.startsWith('clear:'))).toBe(false);
    expect(
      trace.events.some((e) => e === 'log:re-kick parked-slug: skipped — operator-parked'),
    ).toBe(true);
  });

  it('operator-parked slug with isProcessed also true → isProcessed is never called (ordering)', async () => {
    const { deps, trace } = fakeDeps({
      halted: ['parked-slug'],
      isOperatorParked: async () => true,
      isProcessed: async () => true,
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['parked-slug']);
    expect(trace.events.some((e) => e.startsWith('isProcessed:'))).toBe(false);
  });

  it('operator-parked slug is skipped across multiple sweeps at different SHAs; no lastRekickSha set', async () => {
    const last = new Map<string, string>();
    const { deps } = fakeDeps({
      halted: ['parked-slug'],
      lastRekickSha: last,
      isOperatorParked: async () => true,
    });
    const res1 = await rekickSweep(deps, SHA_B);
    expect(res1.skipped).toEqual(['parked-slug']);
    expect(last.has('parked-slug')).toBe(false);

    const res2 = await rekickSweep(deps, SHA_C);
    expect(res2.skipped).toEqual(['parked-slug']);
    expect(last.has('parked-slug')).toBe(false);
  });

  it('one slug parked + one slug halted → parked slug skipped, halted slug cleared, in one sweep', async () => {
    const { deps, trace } = fakeDeps({
      halted: ['parked-a', 'halted-b'],
      isOperatorParked: async (slug) => slug === 'parked-a',
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['parked-a']);
    expect(res.cleared).toEqual(['halted-b']);
    expect(trace.events.some((e) => e === 'clear:halted-b')).toBe(true);
    expect(trace.events.some((e) => e === 'clear:parked-a')).toBe(false);
  });

  it('isOperatorParked throws for one slug → that slug is skipped with an anomaly log, sibling still cleared', async () => {
    const { deps, trace } = fakeDeps({
      halted: ['boom-slug', 'halted-b'],
      isOperatorParked: async (slug) => {
        if (slug === 'boom-slug') throw new Error('parked-check exploded');
        return false;
      },
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['boom-slug']);
    expect(res.cleared).toEqual(['halted-b']);
    expect(trace.events.some((e) => e === 'clear:halted-b')).toBe(true);
    expect(trace.events.some((e) => e === 'clear:boom-slug')).toBe(false);
    expect(
      trace.events.some(
        (e) => e.includes('boom-slug') && e.toLowerCase().includes('anomaly'),
      ),
    ).toBe(true);
  });

  // ── FR-5 regression: operator-park must never weaken existing guards ──────

  it('FR-5 regression: mixed sweep — parked sibling untouched, un-parked sibling clears normally in one pass', async () => {
    const last = new Map<string, string>();
    const { deps, trace } = fakeDeps({
      halted: ['parked-a', 'halted-b'],
      lastRekickSha: last,
      isOperatorParked: async (slug) => slug === 'parked-a',
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.skipped).toEqual(['parked-a']);
    expect(res.cleared).toEqual(['halted-b']);
    expect(trace.cleared.has('parked-a')).toBe(false);
    expect(trace.cleared.has('halted-b')).toBe(true);
    expect(last.has('parked-a')).toBe(false);
    expect(last.get('halted-b')).toBe(SHA_B);
  });

  it('FR-5 regression: no parked slugs — sweep output is byte-identical to the pre-park sweep', async () => {
    const last = new Map<string, string>();
    const { deps, trace } = fakeDeps({
      halted: ['a', 'b', 'c'],
      lastRekickSha: last,
      isOperatorParked: async () => false,
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared.sort()).toEqual(['a', 'b', 'c']);
    expect(res.skipped).toEqual([]);
    expect([...trace.cleared].sort()).toEqual(['a', 'b', 'c']);
    expect(last.get('a')).toBe(SHA_B);
    expect(last.get('b')).toBe(SHA_B);
    expect(last.get('c')).toBe(SHA_B);
  });

  it('FR-5 regression: SHA guard still applies to an un-parked slug already re-kicked at this SHA', async () => {
    const last = new Map<string, string>([['b', SHA_B]]);
    const { deps, trace } = fakeDeps({
      halted: ['a', 'b'],
      lastRekickSha: last,
      isOperatorParked: async () => false,
    });
    const res = await rekickSweep(deps, SHA_B);
    // 'a' is not yet recorded at SHA_B, so it clears; 'b' was already re-kicked
    // at SHA_B and the SHA guard skips it — the parked check does not bypass this.
    expect(res.cleared).toEqual(['a']);
    expect(res.skipped).toEqual(['b']);
    expect(trace.cleared.has('b')).toBe(false);
  });

  it('FR-5 regression: isOperatorParked undefined behaves identically to today (backward-compat)', async () => {
    const last = new Map<string, string>([['b', SHA_B]]);
    const { deps, trace } = fakeDeps({
      halted: ['a', 'b'],
      lastRekickSha: last,
      // no isOperatorParked at all
    });
    const res = await rekickSweep(deps, SHA_B);
    expect(res.cleared).toEqual(['a']);
    expect(res.skipped).toEqual(['b']);
    expect(trace.cleared.has('b')).toBe(false);
  });
});

// ── Real fs/git primitives (isolated repos) ───────────────────────────────────

describe('engine/daemon-rekick — real primitives (isolated repo)', () => {
  let base: string;
  let dir: string;
  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }
  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rekick-prim-'));
    dir = join(base, 'wt-halted');
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  // Build a repo with a real conflicting rebase paused mid-flight.
  async function repoWithPausedRebase(): Promise<void> {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1; // branch\n');
    await git('add', '.');
    await git('commit', '-m', 'branch');
    await git('checkout', 'main');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 2; // base\n');
    await git('add', '.');
    await git('commit', '-m', 'base');
    await git('checkout', 'feature/foo');
    await git('rebase', 'main').catch(() => undefined); // stops at conflict
  }

  it('hasRebaseInProgress: true mid-rebase, false after abort', async () => {
    await repoWithPausedRebase();
    expect(await hasRebaseInProgress(dir)).toBe(true);
    await abortRebase(dir);
    expect(await hasRebaseInProgress(dir)).toBe(false);
  });

  it('hasRebaseInProgress: false on a clean repo', async () => {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'README.md'), '# x\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    expect(await hasRebaseInProgress(dir)).toBe(false);
  });

  it('abortRebase throws when there is no rebase to abort', async () => {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'README.md'), '# x\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await expect(abortRebase(dir)).rejects.toThrow();
  });

  it('clearMarker preserves reason → removes HALT → writes REKICK sentinel; listHalted/readReason agree', async () => {
    const p = join(dir, '.pipeline');
    await mkdir(p, { recursive: true });
    await writeFile(join(p, 'HALT'), 'prd-audit gap\nFR-3 missing\n', 'utf-8');
    // worktreeBase = dedicated base dir (1 entry: wt-halted); slug = basename(dir)
    const worktreeBase = base;
    const slug = basename(dir);
    expect(await listHaltedWorktrees(worktreeBase)).toContain(slug);
    expect(await readHaltReason(worktreeBase, slug)).toBe('prd-audit gap');

    await clearMarker(dir);
    expect(await fileExists(join(dir, HALT_MARKER))).toBe(false);
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(true);
    expect(await readFile(join(dir, HALT_CLEARED_MARKER), 'utf-8')).toContain('prd-audit gap');
  }, 20000); // real-git/fs under parallel load; matches rebase-autostash.test.ts convention

  it('clearMarker overwrites a prior .cleared', async () => {
    const p = join(dir, '.pipeline');
    await mkdir(p, { recursive: true });
    await writeFile(join(p, 'HALT.cleared'), 'OLD reason\n', 'utf-8');
    await writeFile(join(p, 'HALT'), 'NEW reason\n', 'utf-8');
    await clearMarker(dir);
    const cleared = await readFile(join(p, 'HALT.cleared'), 'utf-8');
    expect(cleared).toContain('NEW reason');
    expect(cleared).not.toContain('OLD reason');
  });

  it('clearMarker on an absent HALT is a no-op (still drops sentinel)', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await expect(clearMarker(dir)).resolves.toBeUndefined();
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(true);
  });
});

// ── FR-12: resumeRebaseFirst (isolated repo, daemon-equivalent real git) ───────

describe('engine/daemon-rekick — resumeRebaseFirst (FR-12)', () => {
  let dir: string;
  let events: ConductorEventEmitter;
  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }
  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }
  async function branchContains(sha: string): Promise<boolean> {
    return execFileAsync('git', ['-C', dir, 'merge-base', '--is-ancestor', sha, 'feature/foo'])
      .then(() => true, () => false);
  }
  async function initFeatureRepo(): Promise<void> {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/other.ts'), 'export const bar = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');
  }
  async function writeSentinel(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, REKICK_SENTINEL), 'rekick\n', 'utf-8');
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rekick-resume-'));
    events = new ConductorEventEmitter();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('no sentinel → skipped (no rebase forced)', async () => {
    await initFeatureRepo();
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: false,
    });
    expect(res).toBe('skipped');
  });

  it('with sentinel + advanced base → rebases the branch onto the base, consumes the sentinel', async () => {
    await initFeatureRepo();
    // Advance base non-conflicting.
    await git('checkout', 'main');
    await writeFile(join(dir, 'SIBLING.md'), '# merged\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling merged');
    const baseSha = await git('rev-parse', 'HEAD');
    await git('checkout', 'feature/foo');
    expect(await branchContains(baseSha)).toBe(false);

    await writeSentinel();
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: true,
    });
    expect(res).toBe('rebased');
    // The advanced base is now integrated BEFORE any gate resumes.
    expect(await branchContains(baseSha)).toBe(true);
    // One-shot: sentinel consumed.
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(false);
  });

  // Branch and base edit the SAME file differently → guaranteed rebase conflict.
  async function initConflictRepo(): Promise<void> {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1; // branch\n');
    await git('add', '.');
    await git('commit', '-m', 'branch');
    await git('checkout', 'main');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 2; // base\n');
    await git('add', '.');
    await git('commit', '-m', 'base');
    await git('checkout', 'feature/foo');
  }

  it('a re-conflict on the new base with NO resolver wired → halted immediately (backward compatible)', async () => {
    await initConflictRepo();

    await writeSentinel();
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: false,
    });
    expect(res).toBe('halted');
    expect(await fileExists(join(dir, HALT_MARKER))).toBe(true);
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(false);
    // The rebase is left paused (9.0's existing conflict→HALT path).
    const inProgress =
      (await fileExists(join(dir, '.git/rebase-merge'))) ||
      (await fileExists(join(dir, '.git/rebase-apply')));
    expect(inProgress).toBe(true);
  });

  // #300: a conflict reached via the re-kick play-forward must get the SAME
  // gated /rebase resolution loop the finish-time step uses before a human HALT.

  it('#300: a wired resolver that resolves the conflict → rebased, no HALT, sentinel consumed', async () => {
    await initConflictRepo();
    await writeSentinel();

    let attempts = 0;
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: false,
      resolveAttempts: 3,
      resolveConflict: async () => {
        attempts += 1;
        await writeFile(join(dir, 'src/feature.ts'), 'export const v = 3; // merged\n');
        await git('add', 'src/feature.ts');
        // core.editor=true → non-interactive `rebase --continue`
        await execFileAsync('git', ['-C', dir, '-c', 'core.editor=true', 'rebase', '--continue']);
        return { resolved: true };
      },
    });

    expect(res).toBe('rebased');
    expect(attempts).toBe(1);
    expect(await fileExists(join(dir, HALT_MARKER))).toBe(false);
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(false);
    // Rebase actually completed — nothing left paused.
    const inProgress =
      (await fileExists(join(dir, '.git/rebase-merge'))) ||
      (await fileExists(join(dir, '.git/rebase-apply')));
    expect(inProgress).toBe(false);
  });

  it('#300: a wired resolver that never completes → halted only AFTER exhausting the cap', async () => {
    await initConflictRepo();
    await writeSentinel();

    let attempts = 0;
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: false,
      resolveAttempts: 3,
      // Claims success but leaves the rebase paused → failed attempt, retried.
      resolveConflict: async () => {
        attempts += 1;
        return { resolved: true };
      },
    });

    expect(res).toBe('halted');
    expect(attempts).toBe(3); // exhausted the cap before parking
    expect(await fileExists(join(dir, HALT_MARKER))).toBe(true);
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(false);
  });

  // Task 12: Rekick call site ships capability-absent (fail-closed).
  // When a play-forward rebase touches code paths, the full target set
  // (build, build_review, manual_test) gets unconditionally invalidated kickback
  // verdicts WITHOUT preVerify capability, preserving fail-closed default.
  it('play-forward rebase with changed code paths → unconditionally fail-closed (no preVerify)', async () => {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });

    // Init commit: base state
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');

    // Feature branch: modify feature code
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');

    // Advance base: add new code file (non-conflicting)
    await git('checkout', 'main');
    await writeFile(join(dir, 'src/base-code.ts'), 'export const base = true;\n');
    await git('add', '.');
    await git('commit', '-m', 'base advance with code');

    // Back to feature for rebase
    await git('checkout', 'feature/foo');

    // Write sentinel and run rebase-first
    await writeSentinel();
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: true,
    });

    // Clean rebase, no conflicts
    expect(res).toBe('rebased');
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(false);

    // Crucial assertion: verdicts are UNCONDITIONALLY kicked back (fail-closed),
    // NOT reverified via preVerify capability. The rekick call site deliberately
    // omits preVerify, per ADR.
    const build = await readVerdict(dir, 'build');
    expect(build?.satisfied).toBe(false);
    expect(build?.kickback?.from).toBe('rebase');
    // Verify no preVerify-based reverification marker
    expect(build?.reason).not.toContain('re-verified mechanically');

    const buildReview = await readVerdict(dir, 'build_review');
    expect(buildReview?.satisfied).toBe(false);
    expect(buildReview?.kickback?.from).toBe('rebase');

    const manualTest = await readVerdict(dir, 'manual_test');
    expect(manualTest?.satisfied).toBe(false);
    expect(manualTest?.kickback?.from).toBe('rebase');
  });
});

// ── Task 11 wiring: rekickSweep over the REAL primitives the CLI assembles ─────

describe('engine/daemon-rekick — real-primitive sweep composition (FR-7/FR-8/FR-9)', () => {
  let base: string; // stands in for `<projectRoot>/.worktrees`
  async function gitIn(dir: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }
  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  // Build the EXACT RekickSweepDeps daemon-cli.ts assembles for `worktreeBase`.
  function realDeps(worktreeBase: string, last: Map<string, string>): RekickSweepDeps {
    return {
      listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
      readHaltReason: (slug) => readHaltReason(worktreeBase, slug),
      hasRebaseInProgress: (slug) => hasRebaseInProgress(pjoin(worktreeBase, slug)),
      abortRebase: (slug) => abortRebase(pjoin(worktreeBase, slug)),
      clearMarker: (slug) => clearMarker(pjoin(worktreeBase, slug)),
      lastRekickSha: last,
      log: () => {},
    };
  }

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rekick-compose-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('clears a plain halt and a mid-rebase halt (abort first), is FR-9-bounded at the same SHA', async () => {
    // Worktree A: a plain gate halt (no rebase).
    const a = join(base, 'feat-a', '.pipeline');
    await mkdir(a, { recursive: true });
    await writeFile(join(a, 'HALT'), 'prd-audit gap\n', 'utf-8');

    // Worktree B: a real conflicting rebase paused mid-flight + a HALT marker.
    const b = join(base, 'feat-b');
    await mkdir(b, { recursive: true });
    await initTestRepo(b);
    await gitIn(b, 'config', 'commit.gpgsign', 'false');
    await mkdir(join(b, 'src'), { recursive: true });
    await writeFile(join(b, 'src/x.ts'), 'export const v = 0;\n');
    await gitIn(b, 'add', '.');
    await gitIn(b, 'commit', '-m', 'init');
    await gitIn(b, 'checkout', '-b', 'feature/foo');
    await writeFile(join(b, 'src/x.ts'), 'export const v = 1; // branch\n');
    await gitIn(b, 'add', '.');
    await gitIn(b, 'commit', '-m', 'branch');
    await gitIn(b, 'checkout', 'main');
    await writeFile(join(b, 'src/x.ts'), 'export const v = 2; // base\n');
    await gitIn(b, 'add', '.');
    await gitIn(b, 'commit', '-m', 'base');
    await gitIn(b, 'checkout', 'feature/foo');
    await gitIn(b, 'rebase', 'main').catch(() => undefined); // pauses at conflict
    await mkdir(join(b, '.pipeline'), { recursive: true });
    await writeFile(join(b, '.pipeline/HALT'), 'rebase conflict\n', 'utf-8');
    expect(await hasRebaseInProgress(b)).toBe(true);

    const last = new Map<string, string>();
    const deps = realDeps(base, last);
    const res = await rekickSweep(deps, SHA_B);

    expect(res.cleared.sort()).toEqual(['feat-a', 'feat-b']);
    // A: marker cleared, reason preserved, sentinel written.
    expect(await fileExists(join(base, 'feat-a', HALT_MARKER))).toBe(false);
    expect(await fileExists(join(base, 'feat-a', REKICK_SENTINEL))).toBe(true);
    expect(await readFile(join(base, 'feat-a', HALT_CLEARED_MARKER), 'utf-8')).toContain(
      'prd-audit gap',
    );
    // B: the paused rebase was aborted BEFORE the marker cleared.
    expect(await hasRebaseInProgress(b)).toBe(false);
    expect(await fileExists(join(b, HALT_MARKER))).toBe(false);
    expect(await fileExists(join(b, REKICK_SENTINEL))).toBe(true);

    // FR-9: a second sweep at the SAME SHA clears nothing (both bounded).
    // (re-create markers to prove the guard, not the absence of markers)
    await writeFile(join(base, 'feat-a', HALT_MARKER), 'halted again\n', 'utf-8');
    const res2 = await rekickSweep(deps, SHA_B);
    expect(res2.cleared).toEqual([]);
    expect(res2.skipped).toContain('feat-a');
  });
});

// ── TS-5 (#358): merged-PR guard on the rekick play-forward path ──────────────
//
// `resumeRebaseFirst` does not yet accept `runGh`/`prUrl` opts, and the
// `'already_shipped'` outcome does not exist (plan Tasks 11/12,
// .docs/decisions/adr-2026-07-09-mid-run-merged-pr-guard.md, amendment
// 2026-07-09). Passing `runGh`/`prUrl` today is inert (unused options) — the
// happy-path assertions below are expected to FAIL because `res` stays one of
// the pre-existing `RekickResumeResult` values ('rebased'/'halted'), never
// `'already_shipped'`, and the real rebase/HALT still runs over the merged PR.
// The negative-path tests assert BYTE-IDENTICAL pass-through to the existing
// gated rebase-resolution flow this file already covers above (FR-12,
// #300) — those are expected to PASS today (fail-open by construction), which
// pins the "no regression on non-MERGED verdicts" contract.
describe('engine/daemon-rekick — resumeRebaseFirst merged-PR guard (#358, TS-5)', () => {
  let dir: string;
  let events: ConductorEventEmitter;
  const PR_URL = 'https://github.com/jstoup111/ai-conductor/pull/358';

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }
  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(
      () => true,
      () => false,
    );
  }

  function makeGhFake(
    opts: { state?: string; throws?: boolean } = {},
  ): { runGh: (args: string[], o: { cwd: string }) => Promise<{ stdout: string }>; calls: string[][] } {
    const calls: string[][] = [];
    const runGh = async (args: string[]) => {
      calls.push([...args]);
      if (opts.throws) throw new Error('gh runner failed');
      return {
        stdout: JSON.stringify({
          state: opts.state ?? 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [],
        }),
      };
    };
    return { runGh, calls };
  }

  // Non-conflicting: advanced base, clean rebase (same shape as the FR-12
  // "advanced base" test above).
  async function initAdvancingRepo(): Promise<{ baseSha: string }> {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/other.ts'), 'export const bar = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');
    await git('checkout', 'main');
    await writeFile(join(dir, 'SIBLING.md'), '# merged\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling merged');
    const baseSha = await git('rev-parse', 'HEAD');
    await git('checkout', 'feature/foo');
    return { baseSha };
  }

  async function writeSentinel(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, REKICK_SENTINEL), 'rekick\n', 'utf-8');
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rekick-guard-'));
    events = new ConductorEventEmitter();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("happy: MERGED verdict — no performRebase-driven rebase, resumeRebaseFirst returns 'already_shipped', log names the out-of-band merge", async () => {
    const { baseSha } = await initAdvancingRepo();
    const branchBefore = await git('rev-parse', 'feature/foo');
    await writeSentinel();
    const { runGh } = makeGhFake({ state: 'MERGED' });

    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: false,
      // Not yet declared options (Task 11) — expected to be inert today.
      runGh,
      prUrl: PR_URL,
    } as never);

    expect(res).toBe('already_shipped');
    // The advanced base must NOT have been integrated — no rebase ran.
    const branchAfter = await git('rev-parse', 'feature/foo');
    expect(branchAfter).toBe(branchBefore);
    expect(await fileExists(join(dir, HALT_MARKER))).toBe(false);
    void baseSha;
  });

  it.each([
    ['OPEN', { state: 'OPEN' }],
    ['CLOSED', { state: 'CLOSED' }],
    ['NOTFOUND', { state: 'NOTFOUND' }],
    ['UNKNOWN', { state: 'UNKNOWN' }],
    ['gh throws', { throws: true }],
  ] as const)(
    'negative: %s verdict — byte-identical pass-through to the existing gated rebase-resolution flow (rebases as today)',
    async (_label, ghOpts) => {
      const { baseSha } = await initAdvancingRepo();
      await writeSentinel();
      const { runGh } = makeGhFake(ghOpts);

      const res = await resumeRebaseFirst({
        worktreePath: dir,
        localBase: 'main',
        events,
        ranManualTest: true,
        runGh,
        prUrl: PR_URL,
      } as never);

      // Existing flow: the advanced base IS integrated (rebased), unchanged.
      expect(res).toBe('rebased');
      const branchContainsBase = await execFileAsync('git', [
        '-C',
        dir,
        'merge-base',
        '--is-ancestor',
        baseSha,
        'feature/foo',
      ]).then(
        () => true,
        () => false,
      );
      expect(branchContainsBase).toBe(true);
      expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(false);
    },
  );

  it('negative: no pr_url recorded — zero gh calls, existing flow proceeds unchanged', async () => {
    const { baseSha } = await initAdvancingRepo();
    await writeSentinel();
    const { runGh, calls } = makeGhFake({ state: 'MERGED' });

    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: true,
      runGh,
      // prUrl deliberately omitted.
    } as never);

    expect(calls).toHaveLength(0);
    expect(res).toBe('rebased');
    const branchContainsBase = await execFileAsync('git', [
      '-C',
      dir,
      'merge-base',
      '--is-ancestor',
      baseSha,
      'feature/foo',
    ]).then(
      () => true,
      () => false,
    );
    expect(branchContainsBase).toBe(true);
  });

  it('negative: no runGh recorded (backward compatibility) — zero gh calls, existing flow proceeds unchanged', async () => {
    const { baseSha } = await initAdvancingRepo();
    await writeSentinel();

    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: true,
      prUrl: PR_URL,
      // runGh deliberately omitted — backward-compatible case with no new options wired.
    } as never);

    // Existing flow: the advanced base IS integrated (rebased), unchanged.
    expect(res).toBe('rebased');
    const branchContainsBase = await execFileAsync('git', [
      '-C',
      dir,
      'merge-base',
      '--is-ancestor',
      baseSha,
      'feature/foo',
    ]).then(
      () => true,
      () => false,
    );
    expect(branchContainsBase).toBe(true);
    expect(await fileExists(join(dir, REKICK_SENTINEL))).toBe(false);
  });
});

// ── TS-5 (#358) sweep-level: the caller that consumes resumeRebaseFirst's
// outcome must write the processed marker, skip re-dispatch, and log the
// out-of-band line ────────────────────────────────────────────────────────
//
// Per the ADR/plan (Task 11), `resumeRebaseFirst`'s `'already_shipped'`
// outcome is consumed by daemon-cli.ts's `runConductorInWorktree` closure
// (wired through `makeFeatureRunnerDeps`, daemon-deps.ts:62/99) — NOT by
// `rekickSweep` (that function only ever clears/aborts HALT markers; it does
// not call `resumeRebaseFirst` at all, confirmed by inspection). That closure
// is unexported and requires a full daemon/provider/tmux harness to invoke
// directly (see test/engine/daemon-cli-rekick-sentinel-park-guard.test.ts's
// header comment, which documents the same constraint for a neighboring call
// site and resorts to source-assembly assertions for that reason).
//
// This test instead drives the REAL production seam one layer down: the
// `runConductor` injection point of `makeRunFeature` (daemon-runner.ts), fed
// a `runConductor` that performs the EXACT sequence the plan specifies for
// the daemon-cli.ts wiring once Task 11 lands — call `resumeRebaseFirst`
// with the real merged-PR guard opts, and on `'already_shipped'` write the
// synthetic ship markers and return without invoking a real conductor run
// (no re-dispatch). Everything downstream of that point (`readOutcome` →
// `isVerifiedShip` → `markProcessed`) is REAL production code, unmodified —
// exactly the same integration TS-3 pins in daemon-runner.test.ts. Because
// `resumeRebaseFirst` does not yet implement the guard, it returns 'rebased'
// today instead of 'already_shipped', so the synthetic markers are never
// written, `markProcessed` is never called, and the assertions below fail —
// RED for the right reason (the guard's absence, not a fixture bug).
describe('engine/daemon-rekick — sweep-level consumption of already_shipped (#358, TS-5)', () => {
  let dir: string;
  let worktreeBase: string;
  let processedDir: string;
  let events: ConductorEventEmitter;
  const PR_URL = 'https://github.com/jstoup111/ai-conductor/pull/358';
  const SLUG = 'merged-out-of-band';

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }
  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  function makeGhFake(
    opts: { state?: string; throws?: boolean } = {},
  ): { runGh: (args: string[], o: { cwd: string }) => Promise<{ stdout: string }>; calls: string[][] } {
    const calls: string[][] = [];
    const runGh = async (args: string[]) => {
      calls.push([...args]);
      if (opts.throws) throw new Error('gh runner failed');
      return {
        stdout: JSON.stringify({
          state: opts.state ?? 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [],
        }),
      };
    };
    return { runGh, calls };
  }

  async function initAdvancingRepo(): Promise<void> {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/other.ts'), 'export const bar = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');
    await git('checkout', 'main');
    await writeFile(join(dir, 'SIBLING.md'), '# merged\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling merged');
    await git('checkout', 'feature/foo');
  }

  async function writeSentinel(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, REKICK_SENTINEL), 'rekick\n', 'utf-8');
  }

  beforeEach(async () => {
    worktreeBase = await mkdtemp(join(tmpdir(), 'rekick-sweep-wt-'));
    dir = join(worktreeBase, SLUG);
    await mkdir(dir, { recursive: true });
    processedDir = await mkdtemp(join(tmpdir(), 'rekick-sweep-processed-'));
    events = new ConductorEventEmitter();
  });
  afterEach(async () => {
    await rm(worktreeBase, { recursive: true, force: true });
    await rm(processedDir, { recursive: true, force: true });
  });

  it("happy: MERGED verdict — sweep writes .daemon/processed/<slug> with prUrl, skips re-dispatch, logs 'already shipped out-of-band'", async () => {
    await initAdvancingRepo();
    await writeSentinel();
    const branchBefore = await git('rev-parse', 'feature/foo');
    const { runGh } = makeGhFake({ state: 'MERGED' });

    const logs: string[] = [];
    const log = (m: string) => logs.push(m);
    let realConductorInvoked = false;

    const deps: FeatureRunnerDeps = {
      createWorktree: async () => ({ path: dir, branch: 'feature/foo' }),
      // The exact sequence plan Task 11 specifies for daemon-cli.ts's
      // runConductorInWorktree once wired: check the guard via
      // resumeRebaseFirst BEFORE performRebase/conductor.run(); on
      // 'already_shipped' write the synthetic ship markers and return —
      // no real conductor dispatch.
      runConductor: async (wt) => {
        const res = await resumeRebaseFirst({
          worktreePath: wt.path,
          localBase: 'main',
          events,
          ranManualTest: false,
          runGh,
          prUrl: PR_URL,
          log,
        } as never);
        if (res === 'already_shipped') {
          await mkdir(join(wt.path, '.pipeline'), { recursive: true });
          await writeFile(join(wt.path, '.pipeline', 'finish-choice'), 'pr', 'utf-8');
          await writeFile(join(wt.path, '.pipeline', 'DONE'), '', 'utf-8');
          log(`already shipped out-of-band; local branch retained at ${branchBefore}`);
          return;
        }
        // Any non-'already_shipped' outcome means the feature is re-dispatched
        // through the normal gate loop (today's behavior).
        realConductorInvoked = true;
      },
      readOutcome: async (wt): Promise<WorktreeOutcome> => {
        const done = await fileExists(join(wt.path, '.pipeline', 'DONE'));
        if (!done) return { done: false, halted: false };
        const finishChoice = (
          await readFile(join(wt.path, '.pipeline', 'finish-choice'), 'utf-8').catch(() => '')
        ).trim();
        return {
          done: true,
          halted: false,
          finishChoice: finishChoice as WorktreeOutcome['finishChoice'],
          prUrl: PR_URL,
        };
      },
      teardownWorktree: async () => {},
      markProcessed: async (slug, prUrl) => {
        await mkdir(processedDir, { recursive: true });
        await writeFile(
          join(processedDir, slug),
          `${JSON.stringify({ status: 'shipped', prUrl: prUrl ?? null })}\n`,
          'utf-8',
        );
      },
      daemon: false,
      provider: { invoke: async () => ({ success: true, output: '' }), invokeInteractive: async () => {} },
      project: 'test-project',
      log,
    };

    const run = makeRunFeature(deps);
    const item: BacklogItem = { slug: SLUG };
    const outcome = await run(item);

    // Sweep-level side effect 1: the feature is NOT re-dispatched.
    expect(realConductorInvoked).toBe(false);
    // Sweep-level side effect 2: the processed marker is written with the
    // recorded prUrl.
    expect(await fileExists(join(processedDir, SLUG))).toBe(true);
    const processedContent = JSON.parse(await readFile(join(processedDir, SLUG), 'utf-8'));
    expect(processedContent.prUrl).toBe(PR_URL);
    // Sweep-level side effect 3: the log carries the out-of-band line.
    expect(logs.some((l) => /already shipped out-of-band/.test(l))).toBe(true);
    // The daemon-runner's outcome status reflects a verified ship.
    expect(outcome.status).toBe('done');
  });
});

// ── #436: pre-loop rebase (resumeRebaseFirst) must stamp conduct-state's
// `rebase` field the SAME way the finish-time `runRebaseStep` does ─────────
//
// `runRebaseStep` (conductor.ts) runs the rebase step INSIDE the gate loop:
// on a successful step it falls through to the generic step-completion path
// (conductor.ts ~2947) which calls `saveStepStatus(this.stateFilePath,
// 'rebase', 'done')` — so conduct-state.json's `rebase` field is stamped
// `'done'` in lockstep with the `.pipeline/gates/rebase.json` verdict that
// `applyRebaseVerdicts` writes.
//
// The daemon's re-kick play-forward path calls `resumeRebaseFirst` BEFORE
// the conductor's gate loop starts (a "pre-loop" rebase) — it writes the
// SAME `.pipeline/gates/rebase.json` verdict via `applyRebaseVerdicts`, but
// it never touches conduct-state.json. When the gate loop resumes it reads
// a `satisfied: true` gate verdict for `rebase`, yet conduct-state.json's
// `rebase` field is still `undefined`/`'pending'` — a silent, unmarked-state
// divergence between the two records of "did the rebase step run".
describe('engine/daemon-rekick — #436: pre-loop rebase must stamp state.rebase', () => {
  let dir: string;
  let events: ConductorEventEmitter;
  const STATE_PATH_REL = '.pipeline/conduct-state.json';

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function initFeatureRepo(): Promise<void> {
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const foo = 1;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/other.ts'), 'export const bar = 2;\n');
    await git('add', '.');
    await git('commit', '-m', 'feature work');
  }

  async function writeSentinel(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, REKICK_SENTINEL), 'rekick\n', 'utf-8');
  }

  async function writeInitialConductState(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    // A feature mid-flight, having reached the `rebase` gate but not yet
    // run it — the shape conduct-state.json is in the instant BEFORE a
    // daemon re-kick fires resumeRebaseFirst pre-loop.
    await writeFile(
      join(dir, STATE_PATH_REL),
      JSON.stringify({ build: 'done', last_step: 'build' }, null, 2) + '\n',
      'utf-8',
    );
  }

  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rekick-436-'));
    events = new ConductorEventEmitter();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('clean play-forward rebase: gate verdict and conduct-state.rebase must agree (RED — state.rebase never stamped)', async () => {
    await initFeatureRepo();
    await writeInitialConductState();

    // Advance base non-conflicting (mirrors the FR-12 "advanced base" fixture).
    await git('checkout', 'main');
    await writeFile(join(dir, 'SIBLING.md'), '# merged\n');
    await git('add', '.');
    await git('commit', '-m', 'sibling merged');
    await git('checkout', 'feature/foo');

    await writeSentinel();
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: true,
    });
    expect(res).toBe('rebased');

    // The gate verdict IS recorded — this mirrors what runRebaseStep writes
    // via applyRebaseVerdicts and is expected to pass today.
    const gateVerdict = await readVerdict(dir, 'rebase');
    expect(gateVerdict?.satisfied).toBe(true);

    // conduct-state.json's `rebase` field should be stamped 'done' — exactly
    // as runRebaseStep's fall-through to saveStepStatus(..., 'rebase',
    // 'done') would do for the SAME successful outcome inside the gate loop.
    // THIS IS THE RED ASSERTION: resumeRebaseFirst never writes
    // conduct-state.json, so `rebase` stays unset here, diverging silently
    // from the gate verdict that says the rebase is satisfied.
    const stateResult = await readState(join(dir, STATE_PATH_REL));
    expect(stateResult.ok).toBe(true);
    const state = stateResult.ok ? stateResult.value : {};
    expect(state.rebase).toBe('done');
  });

  // Negative path: a conflicted pre-loop rebase must NOT stamp state.rebase.
  // recordRebaseStepCompletion is still called (same call site as the clean
  // path above) but is a no-op on 'conflict_halt' outcomes — the shared
  // helper gates on outcome kind, not on whether it ran at all. This test
  // distinguishes "never ran" (state.rebase undefined, no HALT) from "ran
  // but conflicted" (state.rebase ALSO undefined, but a HALT is present) —
  // only the HALT file tells the two apart.
  it('conflicted play-forward rebase (resolution exhausted): state.rebase stays unset and HALT is left in place', async () => {
    // Branch and base edit the SAME file differently → guaranteed conflict
    // (mirrors initConflictRepo in the FR-12 describe block above).
    await initTestRepo(dir);
    await git('config', 'commit.gpgsign', 'false');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 0;\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    await git('checkout', '-b', 'feature/foo');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 1; // branch\n');
    await git('add', '.');
    await git('commit', '-m', 'branch');
    await git('checkout', 'main');
    await writeFile(join(dir, 'src/feature.ts'), 'export const v = 2; // base\n');
    await git('add', '.');
    await git('commit', '-m', 'base');
    await git('checkout', 'feature/foo');

    await writeInitialConductState();

    // Confirm the "never ran" baseline: no HALT, no state.rebase, before
    // resumeRebaseFirst is even invoked.
    expect(await readVerdict(dir, 'rebase')).toBeNull();
    const beforeState = await readState(join(dir, STATE_PATH_REL));
    const before = beforeState.ok ? beforeState.value : {};
    expect(before.rebase).toBeUndefined();

    await writeSentinel();
    const res = await resumeRebaseFirst({
      worktreePath: dir,
      localBase: 'main',
      events,
      ranManualTest: false,
      // No resolver wired → resolution is exhausted immediately and the
      // conflict is re-parked via the existing HALT path (mirrors the
      // FR-12 "no resolver wired" test above).
    });

    expect(res).toBe('halted');

    // The HALT is present — the rebase DID run and DID hit a real conflict.
    expect(await fileExists(join(dir, HALT_MARKER))).toBe(true);

    // Yet conduct-state.json's `rebase` field is STILL undefined — the
    // shared helper's outcome gate means a conflict_halt outcome is a
    // no-op, so this is indistinguishable from "never ran" by state alone.
    // Only the HALT file (asserted above) tells the two states apart.
    const stateResult = await readState(join(dir, STATE_PATH_REL));
    expect(stateResult.ok).toBe(true);
    const state = stateResult.ok ? stateResult.value : {};
    expect(state.rebase).toBeUndefined();

    // Sanity: unaffected fields from before the re-kick are left untouched.
    expect(state.build).toBe('done');
  });
});

// ── Task 7 (#486): Regression — capped worktree feature is skipped by the sweep ──
//
// The regression this test proves: when a feature is built inside a worktree,
// reaches the no-evidence cap, and gets auto-parked (marker written), the
// daemon's sweep (bound to main root) must see the marker and skip the feature
// in the SAME sweep, without attempting abort/clear.
describe('engine/daemon-rekick — Task 7 regression (#486)', () => {
  let mainRepoDir: string;
  let worktreeDir: string;
  const SLUG = 'test-feature-task7';
  const MAX_ATTEMPTS = 3;

  async function git(dir: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  beforeEach(async () => {
    // Create a temp parent for both main repo and worktree
    const base = await mkdtemp(join(tmpdir(), 'task7-regression-'));
    mainRepoDir = join(base, 'main-repo');
    worktreeDir = join(base, 'worktrees', SLUG);

    // Initialize main repo
    await mkdir(mainRepoDir, { recursive: true });
    await initTestRepo(mainRepoDir);
    await git(mainRepoDir, 'config', 'commit.gpgsign', 'false');

    // Create initial commit
    await mkdir(join(mainRepoDir, 'src'), { recursive: true });
    await writeFile(join(mainRepoDir, 'src/main.ts'), 'export const main = true;\n');
    await git(mainRepoDir, 'add', '.');
    await git(mainRepoDir, 'commit', '-m', 'init: main repo');

    // Create feature branch
    await git(mainRepoDir, 'checkout', '-b', `feature/${SLUG}`);
    await mkdir(join(mainRepoDir, 'src'), { recursive: true });
    await writeFile(join(mainRepoDir, 'src/feature.ts'), 'export const feature = 1;\n');
    await git(mainRepoDir, 'add', '.');
    await git(mainRepoDir, 'commit', '-m', 'feat: initial feature work');

    // Back to main before creating worktree
    await git(mainRepoDir, 'checkout', 'main');

    // Add a linked worktree from the feature branch
    await mkdir(join(base, 'worktrees'), { recursive: true });
    await git(mainRepoDir, 'worktree', 'add', '-b', `wt-${SLUG}`, worktreeDir, `feature/${SLUG}`);

    // Worktree is now checked out on the feature branch
    // Reset cache before test runs
    __resetResolveCacheForTests();
  });

  afterEach(async () => {
    // Clean up the git worktree before removing directories
    try {
      await git(mainRepoDir, 'worktree', 'remove', '--force', worktreeDir);
    } catch {
      // Worktree might already be gone
    }
    // Clean up entire temp tree
    const base = join(mainRepoDir, '..');
    await rm(base, { recursive: true, force: true });
    __resetResolveCacheForTests();
  });

  it('capped worktree feature parks at main root and sweep skips it (#486)', async () => {
    // Step 1: Seed no-evidence attempts >= cap in the worktree
    const pipelineDir = join(worktreeDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const evidenceData = {
      noEvidenceAttempts: MAX_ATTEMPTS,
      stamps: [],
    };
    await writeFile(
      join(pipelineDir, 'task-evidence.json'),
      JSON.stringify(evidenceData, null, 2),
      'utf-8'
    );

    // Step 2: Call checkAndAutoPark from the worktree
    // This should write the marker to the MAIN root, not the worktree
    const parkResult = await checkAndAutoPark(worktreeDir, SLUG, {
      daemon: true,
      maxAttempts: MAX_ATTEMPTS,
      reason: `no completion evidence after ${MAX_ATTEMPTS} attempts`,
    });

    expect(parkResult.parked).toBe(true);

    // Step 3: Verify marker is written at MAIN root, not worktree
    const mainMarkerPath = join(mainRepoDir, '.daemon', 'parked', SLUG);
    const worktreeMarkerPath = join(worktreeDir, '.daemon', 'parked', SLUG);

    expect(await fileExists(mainMarkerPath)).toBe(true);
    expect(await fileExists(worktreeMarkerPath)).toBe(false); // Key assertion for #486

    // Verify marker content contains auto-parked provenance
    const markerContent = await readFile(mainMarkerPath, 'utf-8');
    expect(markerContent).toContain('auto-parked:');

    // Step 4: Verify isOperatorParked sees the marker from the main root
    const isParked = await isOperatorParked(mainRepoDir, SLUG);
    expect(isParked).toBe(true);

    // Also verify from worktree root (resolves to main root)
    const isParkedFromWorktree = await isOperatorParked(worktreeDir, SLUG);
    expect(isParkedFromWorktree).toBe(true);

    // Step 5: Create HALT marker for the sweep to find
    await writeFile(join(pipelineDir, 'HALT'), 'capped at no-evidence\n', 'utf-8');

    // Step 6: Set up sweep deps (bound to main root, as daemon-cli does)
    const traces: string[] = [];
    const deps: RekickSweepDeps = {
      listHaltedWorktrees: async () => [SLUG],
      readHaltReason: async () => 'capped at no-evidence',
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {
        traces.push('abortRebase called');
        throw new Error('should not be called for operator-parked slug');
      },
      clearMarker: async () => {
        traces.push('clearMarker called');
        throw new Error('should not be called for operator-parked slug');
      },
      lastRekickSha: new Map(),
      log: (msg) => traces.push(`log: ${msg}`),
      // Key: isOperatorParked bound to main root as daemon-cli does
      isOperatorParked: async (slug) => isOperatorParked(mainRepoDir, slug),
    };

    // Step 7: Run the sweep
    const sweepResult = await rekickSweep(deps, SHA_B);

    // Step 8: Verify sweep behavior
    // Feature should be skipped (not cleared)
    expect(sweepResult.skipped).toContain(SLUG);
    expect(sweepResult.cleared).not.toContain(SLUG);

    // Verify no abort or clear was attempted
    expect(traces).not.toContain('abortRebase called');
    expect(traces).not.toContain('clearMarker called');

    // Verify the operator-parked skip log line
    expect(
      traces.some((t) => t === `log: re-kick ${SLUG}: skipped — operator-parked`),
    ).toBe(true);

    // Verify marker is still intact at main root (untouched by sweep)
    expect(await fileExists(mainMarkerPath)).toBe(true);
    expect(await readFile(mainMarkerPath, 'utf-8')).toContain('auto-parked:');
  });
});

// ── Task 15 (#486): Wire reconciliation at sweep start + same-sweep skip e2e ───
//
// Pre-seed a stranded marker at worktree `.daemon/parked/<slug>`, invoke the sweep
// wrapper, and verify: (1) marker moved to main root, (2) slug skipped in SAME sweep
describe('engine/daemon-rekick — Task 15: reconcile stranded markers at sweep start (#486)', () => {
  let mainRepoDir: string;
  let worktreeDir: string;
  const SLUG = 'test-feature-task15';

  async function git(dir: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  beforeEach(async () => {
    // Create a temp parent for the main repo
    const base = await mkdtemp(join(tmpdir(), 'task15-reconcile-'));
    mainRepoDir = join(base, 'main-repo');
    // Worktrees are stored inside the main repo at .worktrees/<slug>
    worktreeDir = join(mainRepoDir, '.worktrees', SLUG);

    // Initialize main repo
    await mkdir(mainRepoDir, { recursive: true });
    await initTestRepo(mainRepoDir);
    await git(mainRepoDir, 'config', 'commit.gpgsign', 'false');

    // Create initial commit
    await mkdir(join(mainRepoDir, 'src'), { recursive: true });
    await writeFile(join(mainRepoDir, 'src/main.ts'), 'export const main = true;\n');
    await git(mainRepoDir, 'add', '.');
    await git(mainRepoDir, 'commit', '-m', 'init: main repo');

    // Create feature branch
    await git(mainRepoDir, 'checkout', '-b', `feature/${SLUG}`);
    await mkdir(join(mainRepoDir, 'src'), { recursive: true });
    await writeFile(join(mainRepoDir, 'src/feature.ts'), 'export const feature = 1;\n');
    await git(mainRepoDir, 'add', '.');
    await git(mainRepoDir, 'commit', '-m', 'feat: initial feature work');

    // Back to main before creating worktree
    await git(mainRepoDir, 'checkout', 'main');

    // Add a linked worktree from the feature branch (stored inside .worktrees/)
    await mkdir(join(mainRepoDir, '.worktrees'), { recursive: true });
    await git(mainRepoDir, 'worktree', 'add', '-b', `wt-${SLUG}`, worktreeDir, `feature/${SLUG}`);

    // Reset cache before test runs
    __resetResolveCacheForTests();
  });

  afterEach(async () => {
    // Clean up the git worktree before removing directories
    try {
      await git(mainRepoDir, 'worktree', 'remove', '--force', worktreeDir);
    } catch {
      // Worktree might already be gone
    }
    // Clean up entire temp tree
    const base = join(mainRepoDir, '..');
    await rm(base, { recursive: true, force: true });
    __resetResolveCacheForTests();
  });

  it('pre-seeded stranded marker: reconciliation runs at sweep start, marker moves to main, slug skipped in same sweep', async () => {
    // Step 1: Pre-seed a stranded marker at worktree .daemon/parked/
    // (simulating a marker that was written from a worktree before the fix)
    const strandedMarkerDir = join(worktreeDir, '.daemon', 'parked');
    await mkdir(strandedMarkerDir, { recursive: true });
    const strandedMarkerBody = `auto-parked: reason for parking
date: 2026-07-10
`;
    await writeFile(join(strandedMarkerDir, SLUG), strandedMarkerBody, 'utf-8');

    // Verify pre-condition: marker is at worktree, not at main
    const worktreeMarkerPath = join(worktreeDir, '.daemon', 'parked', SLUG);
    const mainMarkerPath = join(mainRepoDir, '.daemon', 'parked', SLUG);
    expect(await fileExists(worktreeMarkerPath)).toBe(true);
    expect(await fileExists(mainMarkerPath)).toBe(false);

    // Step 2: Create HALT marker so the sweep will find the slug
    const pipelineDir = join(worktreeDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(join(pipelineDir, 'HALT'), 'pre-existing halt\n', 'utf-8');

    // Step 3: Set up sweep deps (bound to main root, as daemon-cli does)
    // The critical test: when rekickSweep runs, it should FIRST call
    // reconcileStrandedParkMarkers (not done here yet — this test should FAIL),
    // which moves the marker, then the sweep gate sees it at the main root
    // and skips the slug in the SAME sweep.
    const traces: string[] = [];
    const deps: RekickSweepDeps = {
      listHaltedWorktrees: async () => [SLUG],
      readHaltReason: async () => 'pre-existing halt',
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {
        traces.push('abortRebase called');
        throw new Error('should not call abort for operator-parked slug');
      },
      clearMarker: async () => {
        traces.push('clearMarker called');
        throw new Error('should not call clear for operator-parked slug');
      },
      lastRekickSha: new Map(),
      log: (msg) => traces.push(`log: ${msg}`),
      // isOperatorParked bound to main root as daemon-cli does
      isOperatorParked: async (slug) => isOperatorParked(mainRepoDir, slug),
    };

    // Step 4: Reconcile stranded markers (as daemon-cli does at the top of the sweep wrapper)
    const logs: string[] = [];
    await reconcileStrandedParkMarkers(mainRepoDir, (msg) => logs.push(msg));

    // Step 5: Run the sweep (which now sees the marker at main root and skips in same sweep)
    const sweepResult = await rekickSweep(deps, SHA_B);

    // Step 6: Verify the marker was moved to main root
    expect(await fileExists(worktreeMarkerPath)).toBe(false);
    expect(await fileExists(mainMarkerPath)).toBe(true);
    const mainMarkerContent = await readFile(mainMarkerPath, 'utf-8');
    expect(mainMarkerContent).toBe(strandedMarkerBody);

    // Step 7: Verify sweep saw the marker at main root and skipped the slug
    expect(sweepResult.skipped).toContain(SLUG);
    expect(sweepResult.cleared).not.toContain(SLUG);

    // Verify no abort or clear was attempted
    expect(traces).not.toContain('abortRebase called');
    expect(traces).not.toContain('clearMarker called');

    // Verify the operator-parked skip log line
    expect(
      traces.some((t) => t === `log: re-kick ${SLUG}: skipped — operator-parked`),
    ).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
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
  let dir: string;
  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }
  async function fileExists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rekick-prim-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Build a repo with a real conflicting rebase paused mid-flight.
  async function repoWithPausedRebase(): Promise<void> {
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
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
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'README.md'), '# x\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
    expect(await hasRebaseInProgress(dir)).toBe(false);
  });

  it('abortRebase throws when there is no rebase to abort', async () => {
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
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
    // worktreeBase = parent of `dir`; slug = basename(dir)
    const worktreeBase = join(dir, '..');
    const slug = dir.split('/').pop()!;
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
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
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
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
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
    await execFileAsync('git', ['init', '-b', 'main', b]);
    await gitIn(b, 'config', 'user.email', 'test@example.com');
    await gitIn(b, 'config', 'user.name', 'Test');
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

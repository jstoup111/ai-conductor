/**
 * Unit tests for the tolerant completion-signal reader used by the
 * auto-park contradiction guard (Task 1, #612).
 *
 * `readCompletionSignals(projectRoot)` parses `.pipeline/summary.json` and
 * returns `{ summaryTasksCompleted }`. It must never throw — missing files,
 * corrupt JSON, and absent/non-numeric `tasks_completed` all fail closed to
 * `0`, mirroring the tolerant-read pattern in `task-evidence.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readCompletionSignals,
  detectParkContradiction,
  checkAndAutoPark,
} from '../../src/engine/daemon-auto-park.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { isOperatorParked, removeOperatorPark, __resetResolveCacheForTests } from '../../src/engine/park-marker.js';
import { rekickSweep, type RekickSweepDeps } from '../../src/engine/daemon-rekick.js';

const execFileAsync = promisify(execFileCb);
const SHA_B = 'b'.repeat(40);

describe('readCompletionSignals', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-auto-park-unit-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('parses tasks_completed from a valid summary.json', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ tasks_completed: 5 }),
      'utf-8',
    );

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 5 });
  });

  it('returns 0 when summary.json is missing', async () => {
    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });

  it('returns 0 without throwing when summary.json is corrupt JSON', async () => {
    await writeFile(join(dir, '.pipeline', 'summary.json'), '{ not valid json', 'utf-8');

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });

  it('returns 0 when tasks_completed is absent', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ some_other_field: 1 }),
      'utf-8',
    );

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });

  it('returns 0 when tasks_completed is non-numeric', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ tasks_completed: 'five' }),
      'utf-8',
    );

    const result = await readCompletionSignals(dir);

    expect(result).toEqual({ summaryTasksCompleted: 0 });
  });
});

describe('detectParkContradiction', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-auto-park-contradiction-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns null when summary, evidence stamps, and resolved tasks are all zero', async () => {
    const result = await detectParkContradiction(dir, {
      resolvedTasks: 0,
      evidenceStampCount: 0,
    });

    expect(result).toBeNull();
  });

  it('returns a contradiction descriptor when only summaryTasksCompleted > 0', async () => {
    await writeFile(
      join(dir, '.pipeline', 'summary.json'),
      JSON.stringify({ tasks_completed: 3 }),
      'utf-8',
    );

    const result = await detectParkContradiction(dir, {
      resolvedTasks: 0,
      evidenceStampCount: 0,
    });

    expect(result).toEqual({
      summaryTasksCompleted: 3,
      evidenceStamps: 0,
      resolvedTasks: 0,
    });
  });

  it('returns a contradiction descriptor when only evidenceStampCount > 0', async () => {
    const result = await detectParkContradiction(dir, {
      resolvedTasks: 0,
      evidenceStampCount: 2,
    });

    expect(result).toEqual({
      summaryTasksCompleted: 0,
      evidenceStamps: 2,
      resolvedTasks: 0,
    });
  });

  it('returns a contradiction descriptor when only resolvedTasks > 0', async () => {
    const result = await detectParkContradiction(dir, {
      resolvedTasks: 4,
      evidenceStampCount: 0,
    });

    expect(result).toEqual({
      summaryTasksCompleted: 0,
      evidenceStamps: 0,
      resolvedTasks: 4,
    });
  });
});

describe('auto_park_contradiction event (Task 3, #612)', () => {
  it('is accepted by the ConductorEvent union and renders a loud human-readable line', () => {
    const event: ConductorEvent = {
      type: 'auto_park_contradiction',
      slug: 'org/repo',
      verdict: 'empty/missing plan',
      evidence: {
        summaryTasksCompleted: 5,
        evidenceStamps: 2,
        resolvedTasks: 3,
      },
    };

    const out: string[] = [];
    renderDaemonEvent(event, (m) => out.push(m));

    expect(out).toHaveLength(1);
    const line = out[0];
    expect(line).toContain('auto_park_contradiction');
    expect(line).toContain('org/repo');
    expect(line).toContain('empty/missing plan');
    expect(line).toContain('5');
    expect(line).toContain('2');
    expect(line).toContain('3');
  });
});

// ── Task 8: Auto-park stays daemon-gated; unpark restores eligibility ──
//
// Tests for:
// 1. Interactive (daemon:false) runs at cap must NOT write markers anywhere
// 2. After removeOperatorPark, the sweep must no longer skip the slug
describe('engine/daemon-auto-park — Task 8 (#486)', () => {
  let mainRepoDir: string;
  let worktreeDir: string;
  const SLUG = 'test-feature-task8';
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
    const base = await mkdtemp(join(tmpdir(), 'task8-'));
    mainRepoDir = join(base, 'main-repo');
    worktreeDir = join(base, 'worktrees', SLUG);

    // Initialize main repo
    await mkdir(mainRepoDir, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main', mainRepoDir]);
    await git(mainRepoDir, 'config', 'user.email', 'test@example.com');
    await git(mainRepoDir, 'config', 'user.name', 'Test');
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

  it('interactive run (daemon:false) at cap does NOT write markers anywhere', async () => {
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

    // Step 2: Call checkAndAutoPark from the worktree with daemon:false
    // Interactive mode should NOT write any marker
    const parkResult = await checkAndAutoPark(worktreeDir, SLUG, {
      daemon: false,
      maxAttempts: MAX_ATTEMPTS,
      reason: `no completion evidence after ${MAX_ATTEMPTS} attempts`,
    });

    // Step 3: Verify parked:false is returned (not parked in interactive mode)
    expect(parkResult.parked).toBe(false);

    // Step 4: Verify NO marker is written at MAIN root
    const mainMarkerPath = join(mainRepoDir, '.daemon', 'parked', SLUG);
    expect(await fileExists(mainMarkerPath)).toBe(false);

    // Step 5: Verify NO marker is written at worktree root
    const worktreeMarkerPath = join(worktreeDir, '.daemon', 'parked', SLUG);
    expect(await fileExists(worktreeMarkerPath)).toBe(false);

    // Step 6: Verify isOperatorParked returns false from both roots
    const isParkedFromMain = await isOperatorParked(mainRepoDir, SLUG);
    expect(isParkedFromMain).toBe(false);

    const isParkedFromWorktree = await isOperatorParked(worktreeDir, SLUG);
    expect(isParkedFromWorktree).toBe(false);
  });

  it('unpark removes marker and restores sweep eligibility', async () => {
    // Step 1: Seed no-evidence attempts >= cap
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

    // Step 2: Auto-park the slug (daemon:true)
    const parkResult = await checkAndAutoPark(worktreeDir, SLUG, {
      daemon: true,
      maxAttempts: MAX_ATTEMPTS,
      reason: `no completion evidence after ${MAX_ATTEMPTS} attempts`,
    });
    expect(parkResult.parked).toBe(true);

    // Step 3: Verify marker exists at main root
    const mainMarkerPath = join(mainRepoDir, '.daemon', 'parked', SLUG);
    expect(await fileExists(mainMarkerPath)).toBe(true);

    // Step 4: Verify isOperatorParked returns true
    let isParked = await isOperatorParked(mainRepoDir, SLUG);
    expect(isParked).toBe(true);

    // Step 5: Set up first sweep that should skip the slug
    const traces1: string[] = [];
    const deps1: RekickSweepDeps = {
      listHaltedWorktrees: async () => [SLUG],
      readHaltReason: async () => 'capped at no-evidence',
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {
        traces1.push('abortRebase called');
      },
      clearMarker: async () => {
        traces1.push('clearMarker called');
      },
      lastRekickSha: new Map(),
      log: (msg) => traces1.push(`log: ${msg}`),
      isOperatorParked: async (slug) => isOperatorParked(mainRepoDir, slug),
    };

    // Step 6: Run the first sweep — should skip the slug due to operator-parked marker
    const sweepResult1 = await rekickSweep(deps1, SHA_B);
    expect(sweepResult1.skipped).toContain(SLUG);
    expect(sweepResult1.cleared).not.toContain(SLUG);
    expect(traces1).not.toContain('abortRebase called');
    expect(traces1).not.toContain('clearMarker called');

    // Step 7: Remove the operator park marker
    await removeOperatorPark(mainRepoDir, SLUG);

    // Step 8: Verify marker is gone
    expect(await fileExists(mainMarkerPath)).toBe(false);

    // Step 9: Verify isOperatorParked now returns false
    isParked = await isOperatorParked(mainRepoDir, SLUG);
    expect(isParked).toBe(false);

    // Step 10: Create HALT marker for the second sweep to find
    const haltMarkerPath = join(pipelineDir, 'HALT');
    await writeFile(haltMarkerPath, 'capped at no-evidence\n', 'utf-8');

    // Step 11: Set up second sweep
    const traces2: string[] = [];
    let clearCalled = false;
    const deps2: RekickSweepDeps = {
      listHaltedWorktrees: async () => [SLUG],
      readHaltReason: async () => 'capped at no-evidence',
      hasRebaseInProgress: async () => false,
      abortRebase: async () => {
        traces2.push('abortRebase called');
        throw new Error('abortRebase should not be called when there is no rebase in progress');
      },
      clearMarker: async () => {
        clearCalled = true;
        traces2.push('clearMarker called');
      },
      lastRekickSha: new Map(),
      log: (msg) => traces2.push(`log: ${msg}`),
      isOperatorParked: async (slug) => {
        const parked = await isOperatorParked(mainRepoDir, slug);
        traces2.push(`isOperatorParked check: ${slug} = ${parked}`);
        return parked;
      },
    };

    // Step 12: Run the second sweep — should NOT skip (eligibility restored)
    const sweepResult2 = await rekickSweep(deps2, SHA_B);

    // Step 13: Verify slug is NOT in skipped (no longer parked)
    expect(sweepResult2.skipped).not.toContain(SLUG);

    // Step 14: Verify slug IS in cleared (normal flow resumed)
    expect(sweepResult2.cleared).toContain(SLUG);

    // Step 15: Verify clearMarker was called
    expect(clearCalled).toBe(true);
  });
});

/**
 * RED acceptance specs for TS-2 (issue #358): the merged-PR guard backstop at
 * `runRebaseStep` entry.
 *
 * Follows the isolated-repo, daemon:true, real-git pattern from
 * test/engine/rebase-resolution-wiring.test.ts (there is no standalone
 * runRebaseStep test file — it is exercised only through a real Conductor.run()
 * with `fromStep: 'rebase'`, per that file's header comment).
 *
 * `src/engine/merged-pr-guard.ts` does not exist yet. Today a MERGED verdict
 * has zero effect on conductor.ts, so the happy-path assertions here (no
 * performRebase invocation, branch tip retained, synthetic markers written)
 * are expected to FAIL against current behavior — the real rebase runs and
 * the synthetic markers are never written. This is the correct RED signal
 * (plan Tasks 8-9).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import * as rebaseModule from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);
const PR_URL = 'https://github.com/jstoup111/ai-conductor/pull/358';

function makeGhFake(
  opts: { state?: string; throws?: boolean } = {},
): { runGh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runGh: GhRunner = async (args) => {
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

async function seedPreRebaseState(
  statePath: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const state: ConductState = {};
  for (const s of ALL_STEPS) {
    if (s.name === 'rebase') break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  Object.assign(state, overrides);
  await writeState(statePath, state);
}

async function fileExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

/** Non-conflicting repo: `feat` branch cleanly rebases onto `main`. */
async function buildCleanRepo(): Promise<{
  repo: string;
  g: (args: string[]) => ReturnType<typeof execFile>;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-guard-clean-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo });

  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await writeFile(join(repo, 'a.ts'), 'base\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'init']);

  await g(['checkout', '-q', '-b', 'feat']);
  await writeFile(join(repo, 'b.ts'), 'feature\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'feat: add b']);

  await g(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'c.ts'), 'unrelated\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'main: add c']);

  await g(['checkout', '-q', 'feat']);
  return { repo, g };
}

/** Conflicting repo — same shape as rebase-resolution-wiring.test.ts. */
async function buildConflictRepo(): Promise<{
  repo: string;
  g: (args: string[]) => ReturnType<typeof execFile>;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-guard-conflict-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo });

  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await writeFile(join(repo, 'a.ts'), 'base\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'init']);

  await g(['checkout', '-q', '-b', 'feat']);
  await writeFile(join(repo, 'a.ts'), 'feature\n');
  await g(['commit', '-q', '-am', 'feat: change a']);

  await g(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'a.ts'), 'mainchange\n');
  await g(['commit', '-q', '-am', 'main: change a']);

  await g(['checkout', '-q', 'feat']);
  return { repo, g };
}

describe('engine/merged-pr-guard — rebase entry backstop (#358, TS-2)', () => {
  let repo: string;
  let g: (args: string[]) => ReturnType<typeof execFile>;
  let statePath: string;
  let events: ConductorEventEmitter;
  let performRebaseSpy: ReturnType<typeof vi.spyOn>;

  afterEach(async () => {
    performRebaseSpy?.mockRestore();
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('happy: MERGED verdict — performRebase never invoked, no HALT, both synthetic markers present, branch tip unchanged', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, { pr_url: PR_URL });

    const beforeSha = (await g(['rev-parse', 'feat'])).stdout.trim();

    performRebaseSpy = vi.spyOn(rebaseModule, 'performRebase');

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
    };
    const { runGh } = makeGhFake({ state: 'MERGED' });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      runGh,
    } as never);

    await conductor.run();

    // The real seam performRebase is imported directly by conductor.ts (not
    // re-exported through an injectable option), so a passing spy assertion
    // here requires the guard to short-circuit BEFORE that call — today it
    // does not, so this assertion is expected to fail (performRebase runs).
    expect(performRebaseSpy).not.toHaveBeenCalled();

    const haltExists = await fileExists(join(repo, '.pipeline/HALT'));
    expect(haltExists).toBe(false);

    expect(await fileExists(join(repo, '.pipeline/finish-choice'))).toBe(true);
    expect((await readFile(join(repo, '.pipeline/finish-choice'), 'utf-8')).trim()).toBe('pr');
    expect(await fileExists(join(repo, '.pipeline/DONE'))).toBe(true);

    // Branch tip unchanged — the guard never rebases or deletes the branch.
    const afterSha = (await g(['rev-parse', 'feat'])).stdout.trim();
    expect(afterSha).toBe(beforeSha);
  });

  it('negative: OPEN verdict + a genuinely conflicting branch — existing conflict HALT still occurs unchanged', async () => {
    ({ repo, g } = await buildConflictRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, { pr_url: PR_URL });

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
    };
    const { runGh } = makeGhFake({ state: 'OPEN' });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      runGh,
    } as never);

    await conductor.run();

    const haltExists = await fileExists(join(repo, '.pipeline/HALT'));
    expect(haltExists).toBe(true);
    // The guard must not fabricate ship markers over a real conflict.
    expect(await fileExists(join(repo, '.pipeline/finish-choice'))).toBe(false);
  });

  it('negative: gh invocation throws — performRebase proceeds (degraded = today\'s behavior)', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, { pr_url: PR_URL });

    const beforeSha = (await g(['rev-parse', 'feat'])).stdout.trim();

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
    };
    const { runGh } = makeGhFake({ throws: true });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      runGh,
    } as never);

    await conductor.run();

    // Degraded/fail-open: the real rebase ran, which for a clean repo means
    // the base commit is now an ancestor of `feat` (the tip SHA changed).
    const afterSha = (await g(['rev-parse', 'feat'])).stdout.trim();
    expect(afterSha).not.toBe(beforeSha);
    expect(await fileExists(join(repo, '.pipeline/finish-choice'))).toBe(false);
  });

  it('negative: no pr_url recorded — rebase proceeds unchanged (zero guard queries)', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath); // no pr_url

    const beforeSha = (await g(['rev-parse', 'feat'])).stdout.trim();

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
    };
    const { runGh, calls } = makeGhFake({ state: 'MERGED' });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      runGh,
    } as never);

    await conductor.run();

    expect(calls).toHaveLength(0);
    const afterSha = (await g(['rev-parse', 'feat'])).stdout.trim();
    expect(afterSha).not.toBe(beforeSha);
  });

  // ── TS-4: cost bound — exactly one guard query at rebase entry ────────────

  it('guard cost (TS-4, rebase half of the chain): exactly one guard query over a non-MERGED PR', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, { pr_url: PR_URL });

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
    };
    const { runGh, calls } = makeGhFake({ state: 'OPEN' });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      runGh,
    } as never);

    await conductor.run();

    // The companion kickback-entry query is exercised in
    // merged-pr-guard-kickback.test.ts; TS-4 is satisfied jointly.
    expect(calls.length).toBe(1);
  });
});

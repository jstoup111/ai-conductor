/**
 * RED acceptance specs for TS-2 (issue #358): the merged-PR guard backstop at
 * `runRebaseStep` entry.
 *
 * Follows the isolated-repo, daemon:true, real-git pattern from
 * test/engine/rebase-resolution-wiring.test.ts (there is no standalone
 * runRebaseStep test file — it is exercised only through a real Conductor.run()
 * with `fromStep: 'rebase'`, per that file's header comment).
 *
 * A merged PR bypasses rebase only after the strict durable-evidence verifier
 * returns `verified`; unavailable or unproven evidence must HALT.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, access } from 'node:fs/promises';
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
import { createProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';

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
  repo: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const state: ConductState = { feature_desc: 'feat' };
  for (const s of ALL_STEPS) {
    if (s.name === 'rebase') break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  (state as Record<string, unknown>).finish = 'done';
  Object.assign(state, overrides);
  await writeState(statePath, state);
  const baselineCommit = (
    await execFile('git', ['rev-parse', 'HEAD'], { cwd: repo })
  ).stdout.trim();
  await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });
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
  g: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-guard-clean-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo, encoding: 'utf8' as const });

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
  // Docs-only base advance: this fixture's subject is the merged-PR guard, and
  // it needs the branch to take the mergeable-SKIP path. A base that gains
  // code/test paths is no longer skippable on textual cleanliness alone —
  // which now includes root-level markdown, so this file lives under `docs/`
  // (harness markdown outside the four documentation exclusions is source).
  await mkdir(join(repo, 'docs'), { recursive: true });
  await writeFile(join(repo, 'docs/c.md'), 'unrelated\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'main: add c']);

  await g(['checkout', '-q', 'feat']);
  return { repo, g };
}

/** Conflicting repo — same shape as rebase-resolution-wiring.test.ts. */
async function buildConflictRepo(): Promise<{
  repo: string;
  g: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-guard-conflict-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo, encoding: 'utf8' as const });

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
  let g: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  let statePath: string;
  let events: ConductorEventEmitter;
  let performRebaseSpy: MockInstance<typeof rebaseModule.performRebase> | undefined;

  afterEach(async () => {
    performRebaseSpy?.mockRestore();
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('verified merged evidence skips rebase without manufacturing local completion markers', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, repo, { pr_url: PR_URL });

    const beforeSha = (await g(['rev-parse', 'feat'])).stdout.trim();

    performRebaseSpy = vi.spyOn(rebaseModule, 'performRebase');

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true } satisfies StepRunResult),
    };
    const verifyMergedShipment = vi.fn().mockResolvedValue({ kind: 'verified' as const });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: repo,
      daemon: true,
      mode: 'auto',
      fromStep: 'rebase',
      verifyMergedShipment,
    } as never);

    await conductor.run();

    expect(performRebaseSpy).not.toHaveBeenCalled();
    expect(verifyMergedShipment).toHaveBeenCalledWith(PR_URL, 'feat');

    const haltExists = await fileExists(join(repo, '.pipeline/HALT'));
    expect(haltExists).toBe(false);

    expect(await fileExists(join(repo, '.pipeline/finish-choice'))).toBe(false);
    // The ordinary state-machine completion marker is allowed only because
    // this test injects a verified durable shipment result; no finish-choice
    // marker is manufactured by the merged-PR backstop.
    expect(await fileExists(join(repo, '.pipeline/DONE'))).toBe(true);

    // Branch tip unchanged — the guard never rebases or deletes the branch.
    const afterSha = (await g(['rev-parse', 'feat'])).stdout.trim();
    expect(afterSha).toBe(beforeSha);
  });

  it('negative: OPEN verdict + a genuinely conflicting branch — existing conflict HALT still occurs unchanged', async () => {
    ({ repo, g } = await buildConflictRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, repo, { pr_url: PR_URL });

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

  it('negative: unavailable merged evidence HALTs without rebasing or synthetic success', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, repo, { pr_url: PR_URL });

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

    const afterSha = (await g(['rev-parse', 'feat'])).stdout.trim();
    expect(afterSha).toBe(beforeSha);
    expect(await fileExists(join(repo, '.pipeline/HALT'))).toBe(true);
    expect(await fileExists(join(repo, '.pipeline/finish-choice'))).toBe(false);
    expect(await fileExists(join(repo, '.pipeline/DONE'))).toBe(false);
  });

  it('negative: no pr_url recorded — clean normal finish uses mergeable skip with zero guard queries', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, repo); // no pr_url

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
    expect(afterSha).toBe(beforeSha);
    expect(await fileExists(join(repo, '.pipeline/HALT'))).toBe(false);
    expect(await fileExists(join(repo, '.pipeline/DONE'))).toBe(true);
  });

  // ── TS-4: cost bound — exactly one guard query at rebase entry ────────────

  it('guard cost (TS-4, rebase half of the chain): exactly one guard query over a non-MERGED PR', async () => {
    ({ repo, g } = await buildCleanRepo());
    statePath = join(repo, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await seedPreRebaseState(statePath, repo, { pr_url: PR_URL });

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

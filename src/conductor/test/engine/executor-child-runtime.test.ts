// Covers: task:rem-as-built-rem-vg-1
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { makeExecutorChildFeatureRunner } from '../../src/engine/executor-child-runtime.js';
import type { FeatureRunnerDeps, FeatureWorktree, WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const VERSION = '20261020T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'];
const order: WorkOrder = {
  schemaVersion: 1,
  repository: 'repo',
  slug: 'feature',
  baseSha: 'a'.repeat(40),
  engineVersionId: VERSION,
  manifest: [],
};

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function lifecycle(
  worktree: FeatureWorktree,
  outcome: WorktreeOutcome,
  overrides: Partial<FeatureRunnerDeps> = {},
): FeatureRunnerDeps {
  return {
    createWorktree: vi.fn(async () => worktree),
    runConductor: vi.fn(async () => {}),
    readOutcome: vi.fn(async () => outcome),
    teardownWorktree: vi.fn(async () => {}),
    markProcessed: vi.fn(async () => {}),
    daemon: true,
    project: 'repo',
    projectRoot: root,
    shipmentEvidence: vi.fn(async (input) => ({
      kind: 'valid' as const,
      slug: input.slug,
      pr: input.implementationPr,
      recordPath: '.docs/shipped/feature.md',
      hash: 'a'.repeat(64),
      commit: input.candidateCommit,
    })),
    ...overrides,
  };
}

describe('executor child runtime lifecycle composition', () => {
  it('returns setup-triage parking as a deferred autoPark effect and tears down the kept worktree', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(worktree.path, { recursive: true });
    const deps = lifecycle(worktree, { done: false, halted: false }, {
      prepareWorktree: vi.fn(async () => { throw new SetupFailureError('setup failed', 'setup tail'); }),
      runSetupTriage: vi.fn(async () => ({ kind: 'park' as const, outputTail: 'setup tail' })),
    });

    const outcome = await makeExecutorChildFeatureRunner({
      order,
      worktree,
      events: new ConductorEventEmitter(),
    }, deps)();

    expect(outcome).toMatchObject({
      slug: order.slug,
      status: 'error',
      terminalEffects: { autoPark: { reason: 'setup tail' } },
    });
    expect(deps.teardownWorktree).toHaveBeenCalledWith(worktree, true);
  });

  it('returns halt-cleanup and engineer signalling declaratively after a verified ship', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(join(worktree.path, '.pipeline'), { recursive: true });
    await writeFile(join(worktree.path, '.pipeline', 'events.jsonl'), '{"type":"feature_shipped"}\n');
    const deps = lifecycle(worktree, {
      done: true,
      halted: false,
      prUrl: 'https://github.com/example/repo/pull/42',
      finishChoice: 'pr',
    });

    const outcome = await makeExecutorChildFeatureRunner({
      order,
      worktree,
      events: new ConductorEventEmitter(),
    }, deps)();

    expect(outcome.terminalEffects).toMatchObject({
      cleanupHaltPresentation: { prUrl: 'https://github.com/example/repo/pull/42' },
      engineerSignal: {
        outcome: { slug: order.slug, status: 'done', prUrl: 'https://github.com/example/repo/pull/42' },
        eventsContent: '{"type":"feature_shipped"}\n',
      },
      markProcessed: { prUrl: 'https://github.com/example/repo/pull/42' },
      enrollWatch: { prUrl: 'https://github.com/example/repo/pull/42' },
      sweep: true,
    });
    expect(deps.teardownWorktree).not.toHaveBeenCalled();
  });

  it('invokes lifecycle teardown when the conductor reports a halt', async () => {
    const testRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'executor-runtime-')));
    root = testRoot;
    const worktree = { path: join(testRoot, '.worktrees', order.slug), branch: 'feature/branch' };
    await mkdir(worktree.path, { recursive: true });
    const deps = lifecycle(worktree, { done: false, halted: true, reason: 'gate halted' });

    const outcome = await makeExecutorChildFeatureRunner({
      order,
      worktree,
      events: new ConductorEventEmitter(),
    }, deps)();

    expect(outcome).toMatchObject({
      slug: order.slug,
      status: 'halted',
      terminalEffects: { sweep: true, engineerSignal: { outcome: { status: 'halted' } } },
    });
    expect(deps.teardownWorktree).toHaveBeenCalledWith(worktree, true);
  });
});

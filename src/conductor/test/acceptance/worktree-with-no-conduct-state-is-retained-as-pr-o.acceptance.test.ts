/**
 * Acceptance specs for #1329:
 * .docs/stories/worktree-with-no-conduct-state-is-retained-as-pr-o.md.
 *
 * Multi-operation flows covered here:
 * - Story 2: scan persisted worktree state, render the operator dashboard, and
 *   independently select work through the real dispatch predicate.
 * - Story 6: collect a failed dispatch, observe its durable stop, prove the
 *   same daemon run does not retry it, clear the stop, and prove a fresh run
 *   can select it again.
 *
 * Stories 1, 3, 4, and 5 are single scan/render operations. Their criteria
 * are unit-covered by plan Tasks 1-4, 7-10, and 13 rather than duplicated at
 * the acceptance layer. Existing error coverage in
 * test/engine/daemon-runner.test.ts proves HALT creation only after a
 * worktree handle exists; it does not cover the pre-handle failure below.
 *
 * Correctness-critical production call sites exercised:
 * - src/engine/daemon-dashboard.ts: scanInheritedState, called from
 *   src/daemon-cli.ts by the startup/status dashboard entry point.
 * - src/engine/daemon-runner.ts: makeRunFeature, called from
 *   src/daemon-cli.ts for every daemon dispatch.
 * - src/engine/daemon.ts: pickEligible, called by the daemon loop.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderDashboard,
  scanInheritedState,
} from '../../src/engine/daemon-dashboard.js';
import {
  pickEligible,
  type BacklogItem,
  type PickEligibleCtx,
} from '../../src/engine/daemon.js';
import {
  makeRunFeature,
  type FeatureRunnerDeps,
} from '../../src/engine/daemon-runner.js';

const SLUG = 'never-started-feature';
const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function pickContext(overrides: Partial<PickEligibleCtx> = {}): PickEligibleCtx {
  return {
    inFlight: { has: () => false },
    parked: new Set(),
    started: new Set(),
    ...overrides,
  };
}

function failingRunnerDeps(
  projectRoot: string,
  logs: string[],
  createWorktree: FeatureRunnerDeps['createWorktree'],
): FeatureRunnerDeps {
  return {
    projectRoot,
    project: 'acceptance',
    daemon: false,
    createWorktree,
    runConductor: async () => {
      throw new Error('runConductor must not run after worktree creation fails');
    },
    readOutcome: async () => {
      throw new Error('readOutcome must not run after worktree creation fails');
    },
    teardownWorktree: async () => {},
    markProcessed: async () => {},
    log: (line) => logs.push(line),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('acceptance: never-started worktree classification and dispatch parity (#1329)', () => {
  it('keeps a setup-era-only worktree visible as never-started and dispatchable', async () => {
    const projectRoot = await tempRoot('never-started-dashboard-');
    const worktreeBase = join(projectRoot, '.worktrees');
    const pipeline = join(worktreeBase, SLUG, '.pipeline');
    await mkdir(join(pipeline, 'git-hooks'), { recursive: true });
    await mkdir(join(pipeline, 'session-hooks'), { recursive: true });
    await writeFile(join(pipeline, 'step-heartbeat'), '{}\n', 'utf8');
    await writeFile(join(pipeline, 'task-evidence.json'), '{}\n', 'utf8');
    await writeFile(join(pipeline, 'events.jsonl'), '', 'utf8');

    const backlog: BacklogItem[] = [{ slug: SLUG, tier: 'M', track: 'technical' }];
    const state = await scanInheritedState({
      worktreeBase,
      processedDir: join(projectRoot, '.daemon', 'processed'),
      discover: async () => backlog,
    });
    const dashboard = renderDashboard(state);
    const selected = await pickEligible({ items: backlog }, pickContext());

    expect.soft(dashboard).toContain('NEVER-STARTED (1)');
    expect.soft(dashboard).toContain(`  • ${SLUG}`);
    expect.soft(dashboard).toContain('no pipeline state was ever written');
    expect.soft(dashboard).toContain('remains dispatchable');
    expect.soft(dashboard).not.toContain(`RETAINED WORKTREES (1)\n  • ${SLUG}`);
    expect.soft(dashboard).toMatch(new RegExp(`ELIGIBLE \\(1\\)[\\s\\S]*${SLUG}`));
    expect(selected?.slug).toBe(SLUG);
  });
});

describe('acceptance: every failed dispatch leaves an operator-clearable lever (#1329)', () => {
  it('parks a pre-handle failure until its marker is cleared, then a fresh run can select it', async () => {
    const projectRoot = await tempRoot('pre-handle-dispatch-error-');
    const logs: string[] = [];
    const worktreePath = join(projectRoot, '.worktrees', SLUG);
    const haltPath = join(worktreePath, '.pipeline', 'HALT');
    const item: BacklogItem = { slug: SLUG, tier: 'M', track: 'technical' };
    const runner = makeRunFeature(
      failingRunnerDeps(projectRoot, logs, async () => {
        throw new Error('git worktree add failed before returning a handle');
      }),
    );

    const outcome = await runner(item);
    const markerExists = await exists(haltPath);
    const markerBody = markerExists ? await readFile(haltPath, 'utf8') : '';

    expect.soft(outcome).toMatchObject({
      slug: SLUG,
      status: 'error',
      reason: 'git worktree add failed before returning a handle',
    });
    expect.soft(markerExists).toBe(true);
    expect.soft(markerBody).toContain('git worktree add failed before returning a handle');
    expect.soft(markerBody).toContain('Resume procedure');

    const sameRunSelection = await pickEligible(
      { items: [item] },
      pickContext({
        parked: new Set([SLUG]),
        started: new Set([SLUG]),
        isHalted: async (slug) => slug === SLUG && (await exists(haltPath)),
      }),
    );
    expect.soft(sameRunSelection).toBeUndefined();

    await rm(haltPath, { force: true });
    const freshRunSelection = await pickEligible(
      { items: [item] },
      pickContext({
        isHalted: async (slug) => slug === SLUG && (await exists(haltPath)),
      }),
    );
    expect(freshRunSelection?.slug).toBe(SLUG);
  });

  it('reports an explicit unrecoverable state when the deterministic marker path is unwritable', async () => {
    const projectRoot = await tempRoot('unwritable-pre-handle-dispatch-error-');
    const logs: string[] = [];
    const worktreePath = join(projectRoot, '.worktrees', SLUG);
    await mkdir(join(projectRoot, '.worktrees'), { recursive: true });
    await writeFile(worktreePath, 'not a git worktree or directory\n', 'utf8');

    const runner = makeRunFeature(
      failingRunnerDeps(projectRoot, logs, async () => {
        throw new Error('target path exists but is not a valid git worktree');
      }),
    );
    const outcome = await runner({ slug: SLUG, tier: 'M', track: 'technical' });

    expect.soft(outcome.status).toBe('error');
    expect.soft(await exists(join(worktreePath, '.pipeline', 'HALT'))).toBe(false);
    expect(logs.join('\n')).toMatch(
      new RegExp(`unrecoverable-state[\\s\\S]*${SLUG}`, 'i'),
    );
  });
});

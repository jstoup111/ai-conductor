/**
 * Acceptance specs for issue #1091:
 * .docs/stories/daemon-reaps-a-feature-worktree-at-pr-open-before-.md.
 *
 * These specs drive the real production entry points whose wiring changes:
 * `makeRunFeature`, `sweepMergeableLabels`, the inherited-state dashboard,
 * and the pre-boot daemon command detector/dispatcher. GitHub and the
 * shipped-record probe are faithful injected boundary fakes; filesystem and
 * local-Git behavior remain real.
 *
 * Existing lower-layer coverage deliberately not duplicated here:
 * - task-status resume semantics: test/engine/artifacts.test.ts:4269
 * - CI-fix resolve-worktree lifecycle: test/engine/ci-fix.test.ts:361
 * - rebase-resolution build-worktree guard: test/engine/autoresolve-guards.test.ts
 *
 * Production call sites covered by the replacement-wiring specs:
 * - src/engine/daemon-runner.ts:285 (`makeRunFeature`)
 * - src/engine/mergeable-sweep.ts:245 (`sweepMergeableLabels`)
 * - src/engine/daemon-dashboard.ts:270 (`scanInheritedState`)
 * - src/engine/daemon-park-cli.ts:62,122 (detect + dispatch)
 */

import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  makeRunFeature,
  type FeatureRunnerDeps,
} from '../../src/engine/daemon-runner.js';
import {
  enrollWatch,
  readWatch,
  sweepMergeableLabels,
  type SweepOpts,
} from '../../src/engine/mergeable-sweep.js';
import {
  renderDashboard,
  scanInheritedState,
} from '../../src/engine/daemon-dashboard.js';
import {
  detectDaemonParkCommand,
  dispatchDaemonPark,
  type DaemonParkDispatch,
} from '../../src/engine/daemon-park-cli.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const execFile = promisify(execFileCb);
const PR_URL = 'https://github.com/owner/repo/pull/1091';
const SLUG = 'deferred-reap';

type RecordPresence = 'present' | 'absent' | 'indeterminate';

type ReapAwareSweepOpts = SweepOpts & {
  shippedRecordProbe?: (
    repoCwd: string,
    slug: string,
  ) => Promise<RecordPresence>;
  teardownWorktree?: (
    worktree: { path: string; branch: string },
    keep: boolean,
  ) => Promise<void>;
};

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

function ghForStates(states: Record<string, 'MERGED' | 'CLOSED' | 'OPEN'>): GhRunner {
  return async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      const prUrl = args[2] ?? '';
      return {
        stdout: JSON.stringify({
          state: states[prUrl] ?? 'OPEN',
          mergeable: 'UNKNOWN',
          isDraft: false,
          statusCheckRollup: [],
          labels: [],
        }),
      };
    }
    return { stdout: '' };
  };
}

async function seedWorktree(projectRoot: string, slug: string): Promise<string> {
  const worktree = join(projectRoot, '.worktrees', slug);
  const pipeline = join(worktree, '.pipeline');
  await mkdir(join(pipeline, 'gates'), { recursive: true });
  const files: Array<[string, string]> = [
    ['task-status.json', JSON.stringify({
      tasks: [
        { id: 1, status: 'completed' },
        { id: 2, status: 'completed' },
        { id: 3, status: 'completed' },
        { id: 4, status: 'completed' },
        { id: 5, status: 'pending' },
      ],
    })],
    ['HALT', 'seeded halt evidence\n'],
    ['HALT.class', 'manual\n'],
    ['QUARANTINE', 'quarantine-ref\n'],
    ['DONE', 'done\n'],
    ['finish-choice', 'pr\n'],
    ['version-approval', 'approved\n'],
    ['conduct-state.json', JSON.stringify({ finish: 'done', pr_url: PR_URL })],
    ['protected-artifact-seal.json', '{}\n'],
    ['events.jsonl', '{"type":"step_completed"}\n'],
    ['gates/build.json', '{}\n'],
  ];
  await Promise.all(
    files.map(async ([relative, body]) => {
      await writeFile(join(pipeline, relative), body, 'utf8');
    }),
  );
  return worktree;
}

async function runSweep(
  opts: ReapAwareSweepOpts,
): Promise<void> {
  await sweepMergeableLabels(opts);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('deferred feature-worktree reap — production lifecycle entry points', () => {
  it('S1: a verified PR ship retains every non-reconstructable pipeline artifact and enrolls the later sweep', async () => {
    const projectRoot = await tempRoot('deferred-reap-runner-');
    const worktree = await seedWorktree(projectRoot, SLUG);
    const logs: string[] = [];

    const deps: FeatureRunnerDeps = {
      createWorktree: async () => ({ path: worktree, branch: `feat/${SLUG}` }),
      runConductor: async () => {},
      readOutcome: async () => ({
        done: true,
        halted: false,
        finishChoice: 'pr',
        prUrl: PR_URL,
      }),
      shipmentEvidence: async () => ({
        kind: 'valid',
        slug: SLUG,
        pr: PR_URL,
        recordPath: `.docs/shipped/${SLUG}.md`,
        hash: 'acceptance-hash',
        commit: 'acceptance-commit',
      }),
      teardownWorktree: async (featureWorktree, keep) => {
        if (!keep) {
          await rm(featureWorktree.path, { recursive: true, force: true });
        }
      },
      markProcessed: async (slug, prUrl) => {
        const processedDir = join(projectRoot, '.daemon', 'processed');
        await mkdir(processedDir, { recursive: true });
        await writeFile(
          join(processedDir, slug),
          `${JSON.stringify({ status: 'shipped', prUrl: prUrl ?? null })}\n`,
          'utf8',
        );
      },
      daemon: false,
      project: 'acceptance',
      projectRoot,
      runGh: ghForStates({ [PR_URL]: 'OPEN' }),
      enrollWatch,
      sweepMergeableLabels: async () => {},
      log: (line) => logs.push(line),
    };

    const outcome = await makeRunFeature(deps)({ slug: SLUG });

    expect(outcome).toMatchObject({ status: 'done', prUrl: PR_URL });
    for (const relative of [
      'task-status.json',
      'HALT',
      'HALT.class',
      'QUARANTINE',
      'DONE',
      'finish-choice',
      'version-approval',
      'conduct-state.json',
      'gates/build.json',
      'protected-artifact-seal.json',
      'events.jsonl',
    ]) {
      expect(
        await exists(join(worktree, '.pipeline', relative)),
        `${relative} should survive PR-open`,
      ).toBe(true);
    }
    expect(await readWatch(projectRoot)).toEqual([
      { prUrl: PR_URL, slug: SLUG, repoCwd: projectRoot, resolveAttempts: 0, ciFixAttempts: 0 },
    ]);
    expect(await exists(join(projectRoot, '.daemon', 'processed', SLUG))).toBe(true);
    expect(logs.join('\n')).toContain(`retained ${SLUG}`);
    expect(logs.join('\n')).toContain('reason: pr-open-awaiting-main');
  });

  it('S2: a MERGED watch entry is reaped in the same sweep only when its record is proven on origin/main', async () => {
    const projectRoot = await tempRoot('deferred-reap-merged-');
    const worktree = await seedWorktree(projectRoot, SLUG);
    await enrollWatch(projectRoot, { prUrl: PR_URL, slug: SLUG, repoCwd: projectRoot });
    const logs: string[] = [];
    const teardownCalls: string[] = [];

    await runSweep({
      projectRoot,
      runGh: ghForStates({ [PR_URL]: 'MERGED' }),
      log: (line) => logs.push(line),
      shippedRecordProbe: async () => 'present',
      teardownWorktree: async (featureWorktree, keep) => {
        expect(keep).toBe(false);
        teardownCalls.push(featureWorktree.path);
        await rm(featureWorktree.path, { recursive: true, force: true });
      },
    });

    expect(teardownCalls).toEqual([worktree]);
    expect(await exists(worktree)).toBe(false);
    expect(await readWatch(projectRoot)).toEqual([]);
    expect(logs.join('\n')).toContain(`reaped ${SLUG}`);
    expect(logs.join('\n')).toContain('reason: shipped-record-on-main');
  });

  it('S2/S4: absent and indeterminate records retain and recheck without blocking a proven sibling reap', async () => {
    const projectRoot = await tempRoot('deferred-reap-recheck-');
    const slugs = ['record-absent', 'fetch-indeterminate', 'record-present'];
    const urls = slugs.map((slug, index) => `https://github.com/owner/repo/pull/${1200 + index}`);
    await Promise.all(slugs.map((slug) => seedWorktree(projectRoot, slug)));
    for (let index = 0; index < slugs.length; index += 1) {
      await enrollWatch(projectRoot, {
        prUrl: urls[index],
        slug: slugs[index],
        repoCwd: projectRoot,
      });
    }
    const states = Object.fromEntries(urls.map((url) => [url, 'MERGED'])) as Record<
      string,
      'MERGED'
    >;
    const logs: string[] = [];

    await runSweep({
      projectRoot,
      runGh: ghForStates(states),
      log: (line) => logs.push(line),
      shippedRecordProbe: async (_repoCwd, slug) => (
        slug === 'record-absent'
          ? 'absent'
          : slug === 'fetch-indeterminate'
            ? 'indeterminate'
            : 'present'
      ),
      teardownWorktree: async (featureWorktree) => {
        await rm(featureWorktree.path, { recursive: true, force: true });
      },
    });

    expect((await readWatch(projectRoot)).map((entry) => entry.slug).sort()).toEqual([
      'fetch-indeterminate',
      'record-absent',
    ]);
    expect(await exists(join(projectRoot, '.worktrees', 'record-absent'))).toBe(true);
    expect(await exists(join(projectRoot, '.worktrees', 'fetch-indeterminate'))).toBe(true);
    expect(await exists(join(projectRoot, '.worktrees', 'record-present'))).toBe(false);
    expect(logs.join('\n')).toContain('reason: record-not-yet-on-main');
    expect(logs.join('\n')).toMatch(/indeterminate|could not determine/i);
  });

  it('S3/S5: CLOSED prunes the watch but preserves task progress and surfaces the worktree from disk', async () => {
    const projectRoot = await tempRoot('deferred-reap-closed-');
    const worktree = await seedWorktree(projectRoot, SLUG);
    await enrollWatch(projectRoot, { prUrl: PR_URL, slug: SLUG, repoCwd: projectRoot });
    const logs: string[] = [];

    await runSweep({
      projectRoot,
      runGh: ghForStates({ [PR_URL]: 'CLOSED' }),
      log: (line) => logs.push(line),
      shippedRecordProbe: async () => 'absent',
      teardownWorktree: async (featureWorktree) => {
        await rm(featureWorktree.path, { recursive: true, force: true });
      },
    });

    expect(await readWatch(projectRoot)).toEqual([]);
    const taskStatus = JSON.parse(
      await readFile(join(worktree, '.pipeline', 'task-status.json'), 'utf8'),
    ) as { tasks: Array<{ id: number; status: string }> };
    expect(taskStatus.tasks.filter((task) => task.status === 'completed').map((task) => task.id))
      .toEqual([1, 2, 3, 4]);
    expect(logs.join('\n')).toContain('reason: pr-closed-unmerged');

    const state = await scanInheritedState({
      worktreeBase: join(projectRoot, '.worktrees'),
      processedDir: join(projectRoot, '.daemon', 'processed'),
      discover: async () => [],
    });
    const dashboard = renderDashboard(state);
    expect(dashboard).toMatch(/RETAINED WORKTREES \(1\)/);
    expect(dashboard).toContain(SLUG);
    expect(dashboard).toContain('pr-closed-unmerged');
  });

  it('S5: the disk-listed retained worktree can be reclaimed by one exact slug from a nested cwd', async () => {
    const projectRoot = await tempRoot('deferred-reap-reclaim-');
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: projectRoot });
    await execFile('git', ['config', 'user.email', 'acceptance@example.com'], { cwd: projectRoot });
    await execFile('git', ['config', 'user.name', 'Acceptance'], { cwd: projectRoot });
    await writeFile(join(projectRoot, 'README.md'), '# fixture\n', 'utf8');
    await execFile('git', ['add', 'README.md'], { cwd: projectRoot });
    await execFile('git', ['commit', '-q', '-m', 'fixture'], { cwd: projectRoot });
    await mkdir(join(projectRoot, '.worktrees'), { recursive: true });
    const worktree = join(projectRoot, '.worktrees', SLUG);
    await execFile(
      'git',
      ['worktree', 'add', '-q', '-b', `feat/${SLUG}`, worktree, 'main'],
      { cwd: projectRoot },
    );
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'task-status.json'), '{"tasks":[]}\n', 'utf8');
    const nestedCwd = join(projectRoot, 'operator', 'nested');
    await mkdir(nestedCwd, { recursive: true });

    const argv = ['node', 'conduct', 'daemon', 'reclaim-worktree', SLUG];
    const detected = detectDaemonParkCommand(argv);
    expect(detected).toEqual({ kind: 'reclaim-worktree', slug: SLUG });

    const output: string[] = [];
    const code = await dispatchDaemonPark(
      detected as DaemonParkDispatch,
      { cwd: nestedCwd, out: (line) => output.push(line) },
    );

    expect(code).toBe(0);
    expect(output.join('\n')).toContain(worktree);
    expect(output.join('\n')).toMatch(/reclaim|removed/i);
    expect(await exists(worktree)).toBe(false);
  });
});

/**
 * Acceptance specs for
 * .docs/stories/bin-teardown-run-a-project-supplied-teardown-hook-.md.
 *
 * Covers: FR-1, FR-2, FR-3, FR-5, FR-6, FR-8
 *
 * These specs drive every in-scope production removal entry point with real local Git
 * worktrees and real executable project scripts:
 *   - post-ship reap: sweepMergeableLabels -> makeFeatureRunnerDeps().teardownWorktree
 *   - operator reclaim: dispatchDaemonPark('reclaim-worktree')
 *   - parked reconciliation: reconcileMergedPark
 *
 * GitHub and the shipped-record probe are faithful injected boundary fakes. The
 * filesystem, Git worktrees, project script process, environment, and removal remain
 * real. No test calls a third-party service.
 *
 * Lower-layer coverage deliberately left to the plan's unit/structural tasks:
 *   - FR-4 absent-script silence (Story 3 / Task 1)
 *   - FR-7 timeout resolution and enforcement (Story 8 / Tasks 7-8)
 *   - FR-9 output summarization (Story 9 / Task 4)
 *   - FR-10 removal coverage guard (Story 10 / Tasks 15-16)
 *   - FR-11 exemption registry (Story 11 / Tasks 17-18)
 * FR-12 is enforced by the existing repository-local documentation gate; see
 * test/acceptance/maintain-documentation-gate.acceptance.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { makeFeatureRunnerDeps } from '../../src/engine/daemon-deps.js';
import { dispatchDaemonPark } from '../../src/engine/daemon-park-cli.js';
import {
  enrollWatch,
  sweepMergeableLabels,
} from '../../src/engine/mergeable-sweep.js';
import { reconcileMergedPark } from '../../src/engine/park-reconciliation.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import { sanitizeNamespace } from '../../src/engine/worktree-prepare.js';

const execFile = promisify(execFileCb);
const roots: string[] = [];

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function initRepo(withOrigin = false): Promise<{
  root: string;
  git: (...args: string[]) => Promise<string>;
  runGit: GitRunner;
}> {
  const root = await mkdtemp(join(tmpdir(), 'project-teardown-acceptance-'));
  roots.push(root);
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFile('git', args, { cwd: root });
    return stdout.trim();
  };
  const runGit: GitRunner = async (args, opts) => {
    const { stdout } = await execFile('git', args, { cwd: opts.cwd });
    return { stdout };
  };

  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'README.md'), '# fixture\n', 'utf8');
  await git('add', '.');
  await git('commit', '-q', '-m', 'fixture');

  if (withOrigin) {
    const origin = await mkdtemp(join(tmpdir(), 'project-teardown-origin-'));
    roots.push(origin);
    await execFile('git', ['init', '--bare', '-q', '-b', 'main', origin]);
    await git('remote', 'add', 'origin', origin);
    await git('push', '-q', '-u', 'origin', 'main');
  }

  return { root, git, runGit };
}

async function addWorktree(
  root: string,
  git: (...args: string[]) => Promise<string>,
  slug: string,
): Promise<string> {
  const worktree = join(root, '.worktrees', slug);
  await mkdir(join(root, '.worktrees'), { recursive: true });
  await git('worktree', 'add', '-q', '-b', `feat/${slug}`, worktree, 'main');
  return worktree;
}

async function installTeardown(worktree: string, body: string): Promise<void> {
  const script = join(worktree, 'bin', 'teardown');
  await mkdir(join(worktree, 'bin'), { recursive: true });
  await writeFile(script, `#!/bin/sh\nset -eu\n${body}\n`, 'utf8');
  await chmod(script, 0o755);
}

async function recorded(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '');
}

function mergedGh(): GhRunner {
  return async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        stdout: JSON.stringify({
          state: 'MERGED',
          mergeable: 'MERGEABLE',
          isDraft: false,
          statusCheckRollup: [],
          labels: [],
        }),
      };
    }
    return { stdout: '' };
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project teardown hook — real removal entry points', () => {
  it('runs with the setup identity before the daemon post-ship reap removes the worktree', async () => {
    const { root, git } = await initRepo();
    const slug = 'reap-needs-sanitizing';
    const worktree = await addWorktree(root, git, slug);
    const record = join(root, 'reap-record.txt');
    await writeFile(join(worktree, 'witness.txt'), 'still-readable\n', 'utf8');
    await installTeardown(
      worktree,
      `test -r witness.txt\nprintf '%s|%s|%s|readable\\n' "$CI" "$WORKTREE_NAMESPACE" "$PWD" >> ${JSON.stringify(record)}`,
    );
    await rm(join(worktree, '.pipeline'), { recursive: true, force: true });
    await rm(join(worktree, '.env'), { force: true });

    const deps = makeFeatureRunnerDeps({
      projectRoot: root,
      worktreeBase: join(root, '.worktrees'),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
    });
    await enrollWatch(root, {
      prUrl: 'https://github.com/example/project/pull/1',
      slug,
      repoCwd: root,
    });
    await sweepMergeableLabels({
      projectRoot: root,
      runGh: mergedGh(),
      shippedRecordProbe: async () => 'present',
      teardownWorktree: deps.teardownWorktree,
    });

    expect({
      record: await recorded(record),
      worktreeExists: await exists(worktree),
    }).toEqual({
      record: `true|${sanitizeNamespace(slug)}|${worktree}|readable\n`,
      worktreeExists: false,
    });
  });

  it('contains a failed teardown without changing the daemon reap outcome', async () => {
    const { root, git } = await initRepo();
    const slug = 'failed-reap';
    const worktree = await addWorktree(root, git, slug);
    const logs: string[] = [];
    await installTeardown(worktree, "printf 'reap-failure-marker\\n' >&2\nexit 23");
    const deps = makeFeatureRunnerDeps({
      projectRoot: root,
      worktreeBase: join(root, '.worktrees'),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
      log: (line) => logs.push(line),
    });
    await enrollWatch(root, {
      prUrl: 'https://github.com/example/project/pull/2',
      slug,
      repoCwd: root,
    });

    await sweepMergeableLabels({
      projectRoot: root,
      log: (line) => logs.push(line),
      runGh: mergedGh(),
      shippedRecordProbe: async () => 'present',
      teardownWorktree: deps.teardownWorktree,
    });

    expect(await exists(worktree)).toBe(false);
    expect(logs.join('\n')).toContain(worktree);
    expect(logs.join('\n')).toContain('reap-failure-marker');
    expect(logs.join('\n')).toContain(`reaped ${slug}`);
  });

  it('never tears down a retained worktree and runs exactly once when it is later reaped', async () => {
    const { root, git } = await initRepo();
    const slug = 'retained-then-reaped';
    const worktree = await addWorktree(root, git, slug);
    const record = join(root, 'retained-record.txt');
    await installTeardown(worktree, `printf 'invoked\\n' >> ${JSON.stringify(record)}`);
    const deps = makeFeatureRunnerDeps({
      projectRoot: root,
      worktreeBase: join(root, '.worktrees'),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
    });
    if (!deps.teardownWorktree) throw new Error('production teardown dependency is unavailable');

    await deps.teardownWorktree({ path: worktree, branch: `feat/${slug}` }, true);
    expect({ record: await recorded(record), worktreeExists: await exists(worktree) }).toEqual({
      record: '',
      worktreeExists: true,
    });

    await deps.teardownWorktree({ path: worktree, branch: `feat/${slug}` }, false);
    expect({ record: await recorded(record), worktreeExists: await exists(worktree) }).toEqual({
      record: 'invoked\n',
      worktreeExists: false,
    });
  });

  it('runs teardown for operator reclaim and preserves the exit status when teardown fails', async () => {
    const { root, git } = await initRepo();
    const passingSlug = 'reclaim-passing';
    const failingSlug = 'reclaim-failing';
    const passingWorktree = await addWorktree(root, git, passingSlug);
    const failingWorktree = await addWorktree(root, git, failingSlug);
    const passingRecord = join(root, 'reclaim-passing.txt');
    const failingRecord = join(root, 'reclaim-failing.txt');
    await installTeardown(passingWorktree, `printf 'passing\\n' >> ${JSON.stringify(passingRecord)}`);
    await installTeardown(
      failingWorktree,
      `printf 'failing\\n' >> ${JSON.stringify(failingRecord)}\nprintf 'reclaim-failure-marker\\n' >&2\nexit 19`,
    );
    const passingOut: string[] = [];
    const failingOut: string[] = [];

    const passingCode = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: passingSlug },
      { cwd: root, out: (line) => passingOut.push(line) },
    );
    const failingCode = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: failingSlug },
      { cwd: root, out: (line) => failingOut.push(line) },
    );

    expect({
      passingCode,
      failingCode,
      passingRecord: await recorded(passingRecord),
      failingRecord: await recorded(failingRecord),
      passingExists: await exists(passingWorktree),
      failingExists: await exists(failingWorktree),
    }).toEqual({
      passingCode: 0,
      failingCode: 0,
      passingRecord: 'passing\n',
      failingRecord: 'failing\n',
      passingExists: false,
      failingExists: false,
    });
    expect(failingOut.join('\n')).toContain(failingWorktree);
    expect(failingOut.join('\n')).toContain('reclaim-failure-marker');
  });

  it('applies the configured teardown bound when an operator reclaims a worktree', async () => {
    const { root, git } = await initRepo();
    const slug = 'reclaim-configured-timeout';
    const worktree = await addWorktree(root, git, slug);
    const record = join(root, 'reclaim-timeout-record.txt');
    const lines: string[] = [];
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), 'teardown_timeout_seconds: 0.1\n', 'utf8');
    await installTeardown(
      worktree,
      `sleep 0.25\nprintf 'completed-after-timeout\\n' >> ${JSON.stringify(record)}`,
    );

    const code = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug },
      { cwd: root, out: (line) => lines.push(line) },
    );

    expect({
      code,
      record: await recorded(record),
      timeout: lines.some((line) => line === `teardown: timed out in ${worktree} after 0.1 second(s)`),
      worktreeExists: await exists(worktree),
    }).toEqual({
      code: 0,
      record: '',
      timeout: true,
      worktreeExists: false,
    });
  });

  it('runs teardown once before parked reconciliation falls back to directory removal', async () => {
    const { root, git, runGit } = await initRepo(true);
    const slug = 'reconcile-leftover';
    await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(root, '.docs', 'shipped', `${slug}.md`), '# shipped\n', 'utf8');
    await git('add', '.docs/shipped');
    await git('commit', '-q', '-m', 'record shipment');
    await git('push', '-q', 'origin', 'main');

    const worktree = join(root, '.worktrees', slug);
    const record = join(root, 'reconcile-record.txt');
    const logs: string[] = [];
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, 'witness.txt'), 'still-readable\n', 'utf8');
    await installTeardown(
      worktree,
      `test -r witness.txt\nprintf 'invoked\\n' >> ${JSON.stringify(record)}\nprintf 'reconcile-failure-marker\\n' >&2\nexit 17`,
    );

    const outcome = await reconcileMergedPark({
      projectRoot: root,
      slug,
      runGit,
      log: (line) => logs.push(line),
    });

    expect({ outcome, record: await recorded(record), worktreeExists: await exists(worktree) }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-absent', 'unparked'] },
      record: 'invoked\n',
      worktreeExists: false,
    });
    expect(logs.join('\n')).toContain(worktree);
    expect(logs.join('\n')).toContain('reconcile-failure-marker');
  });

  it('applies the configured teardown bound during parked reconciliation', async () => {
    const { root, git, runGit } = await initRepo(true);
    const slug = 'reconcile-configured-timeout';
    await mkdir(join(root, '.docs', 'shipped'), { recursive: true });
    await writeFile(join(root, '.docs', 'shipped', `${slug}.md`), '# shipped\n', 'utf8');
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), 'teardown_timeout_seconds: 0.1\n', 'utf8');
    await git('add', '.docs/shipped', '.ai-conductor/config.yml');
    await git('commit', '-q', '-m', 'record shipment');
    await git('push', '-q', 'origin', 'main');

    const worktree = join(root, '.worktrees', slug);
    const record = join(root, 'reconcile-timeout-record.txt');
    const logs: string[] = [];
    await mkdir(worktree, { recursive: true });
    await installTeardown(
      worktree,
      `sleep 0.25\nprintf 'completed-after-timeout\\n' >> ${JSON.stringify(record)}`,
    );

    const outcome = await reconcileMergedPark({
      projectRoot: root,
      slug,
      runGit,
      log: (line) => logs.push(line),
    });

    expect({
      outcome,
      record: await recorded(record),
      timeout: logs.includes(`teardown: timed out in ${worktree} after 0.1 second(s)`),
      worktreeExists: await exists(worktree),
    }).toEqual({
      outcome: { slug, steps: ['worktree-removed', 'branch-absent', 'unparked'] },
      record: '',
      timeout: true,
      worktreeExists: false,
    });
  });
});

/**
 * RED acceptance specs for worktree-local provider scratch lifecycle (#1223).
 *
 * Stories: .docs/stories/interrupted-self-host-runs-leak-provider-homes-unt.md
 * Plan:    .docs/plans/interrupted-self-host-runs-leak-provider-homes-unt.md
 * ADR:     adr-2026-08-09-worktree-local-provider-scratch
 *
 * These cases exercise only composed production boundaries:
 *
 * - Stories 3/4: each real build-path creator provisions into the owning
 *   worktree, exposes that path to the child, leaves git clean, and removes it
 *   through the creator's existing teardown contract.
 * - Story 5: the real daemon loop invokes the new best-effort scratch sweep at
 *   its dispatch boundary and contains a sweep failure without losing dispatch.
 * - Story 6: the real production worktree-removal dependency removes ignored
 *   scratch while preserving durable run-state outside the worktree.
 *
 * Unit-covered by the plan (not duplicated here): Story 1's pure resolver
 * (Tasks 1–4), Story 2's lease codec/acquire failures (Tasks 5–8), Story 4's
 * release edge cases (Tasks 9–10), Story 5's liveness classifications
 * (Tasks 15–17), Story 7's event variants/emission/persistence (Tasks 20–21),
 * and Story 8's legacy candidate classifier/once guard (Tasks 22–23).
 *
 * The new option/dependency fields are cast through the current public types
 * so this file compiles before implementation and fails on observable runtime
 * outcomes instead of becoming a collection error.
 */

import { execFile as execFileCb } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeFeatureRunnerDeps } from '../../src/engine/daemon-deps.js';
import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';
import { provisionSandboxBuildEnv } from '../../src/engine/self-host/sandbox-build-env.js';
import { sweepFeatureWorktreeScratch } from '../../src/engine/self-host/provider-scratch.js';

const execFile = promisify(execFileCb);
const roots: string[] = [];

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function initRepo(prefix: string): Promise<{
  root: string;
  git: (...args: string[]) => Promise<string>;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFile('git', args, { cwd: root });
    return stdout.trim();
  };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await mkdir(join(root, 'skills'), { recursive: true });
  await writeFile(join(root, 'skills', 'fixture.md'), 'fixture\n');
  await writeFile(join(root, '.gitignore'), '.daemon/\n');
  await git('add', '.');
  await git('commit', '-q', '-m', 'fixture');
  return { root, git };
}

function expectedHome(worktree: string, provider: 'claude' | 'codex'): string {
  return join(worktree, '.daemon', 'scratch', 'R', `2-${provider}`);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Stories 3/4 — build-path homes are worktree-local and self-cleaning', () => {
  it('Codex provisions CODEX_HOME under the owning worktree and teardown leaves nothing', async () => {
    const { root: worktree, git } = await initRepo('provider-scratch-codex-');
    const home = await provisionProviderHome({
      provider: { id: 'codex' },
      worktreeRoot: worktree,
      runId: 'R',
      attempt: 2,
      repository: 'owner/repo',
      featureSlug: 'scratch-feature',
    } as unknown as Parameters<typeof provisionProviderHome>[0]);

    const path = home.homeDir;
    expect(path).toMatch(new RegExp(`^${expectedHome(worktree, 'codex')}/self-host-codex-`));
    expect(home.childEnv().CODEX_HOME).toBe(path);
    expect(relative(worktree, path).split(sep)[0]).toBe('.daemon');
    const lease = JSON.parse(await readFile(join(worktree, '.daemon', 'scratch', 'R', '2-codex', 'owner.json'), 'utf8'));
    expect(Object.keys(lease).sort()).toEqual(['attempt', 'featureSlug', 'ownerPid', 'repository', 'runId', 'startedAt']);
    expect(lease).toMatchObject({ repository: 'owner/repo', featureSlug: 'scratch-feature', runId: 'R', attempt: 2, ownerPid: process.pid });
    expect(await git('status', '--porcelain')).toBe('');

    await home.teardown();
    await home.teardown();
    expect(await exists(path)).toBe(false);
    expect(await exists(join(worktree, '.daemon', 'scratch', 'R'))).toBe(false);
  });

  it('Claude provisions CLAUDE_CONFIG_DIR under the owning worktree and teardown leaves nothing', async () => {
    const { root: worktree, git } = await initRepo('provider-scratch-claude-');
    const sandbox = await provisionSandboxBuildEnv({
      worktreeRoot: worktree,
      harnessRoot: worktree,
      globalStateFile: join(worktree, 'missing-operator-state.json'),
      runId: 'R',
      attempt: 2,
      repository: 'owner/repo',
      featureSlug: 'scratch-feature',
    } as unknown as Parameters<typeof provisionSandboxBuildEnv>[0]);

    const path = sandbox.configDir;
    expect(path).toMatch(new RegExp(`^${expectedHome(worktree, 'claude')}/harness-selfbuild-`));
    expect(sandbox.childEnv().CLAUDE_CONFIG_DIR).toBe(path);
    expect(relative(worktree, path).split(sep)[0]).toBe('.daemon');
    const lease = JSON.parse(await readFile(join(worktree, '.daemon', 'scratch', 'R', '2-claude', 'owner.json'), 'utf8'));
    expect(Object.keys(lease).sort()).toEqual(['attempt', 'featureSlug', 'ownerPid', 'repository', 'runId', 'startedAt']);
    expect(lease).toMatchObject({ repository: 'owner/repo', featureSlug: 'scratch-feature', runId: 'R', attempt: 2, ownerPid: process.pid });
    expect(await git('status', '--porcelain')).toBe('');

    await sandbox.teardown();
    await sandbox.teardown();
    expect(await exists(path)).toBe(false);
    expect(await exists(join(worktree, '.daemon', 'scratch', 'R'))).toBe(false);
  });
});

describe('Story 5 — scratch reclamation is a best-effort dispatch-boundary hook', () => {
  const item: BacklogItem = { slug: 'scratch-feature' };

  it('runs the scratch sweep before dispatching a feature', async () => {
    const order: string[] = [];
    const deps = {
      discoverBacklog: async () => [item],
      sweepProviderScratch: async () => {
        order.push('sweep');
      },
      runFeature: async () => {
        order.push('dispatch');
        return { slug: item.slug, status: 'done' as const };
      },
    } as unknown as DaemonDeps;

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    expect(order).toEqual(['sweep', 'dispatch']);
    expect(result.processed).toContainEqual({ slug: item.slug, status: 'done' });
  });

  it('reports a throwing scratch sweep and still dispatches normally', async () => {
    const logs: string[] = [];
    const runFeature = vi.fn(async () => ({ slug: item.slug, status: 'done' as const }));
    const deps = {
      discoverBacklog: async () => [item],
      sweepProviderScratch: async () => {
        throw new Error('scratch sweep exploded');
      },
      runFeature,
      log: (line: string) => logs.push(line),
    } as unknown as DaemonDeps;

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    expect(runFeature).toHaveBeenCalledTimes(1);
    expect(result.processed).toContainEqual({ slug: item.slug, status: 'done' });
    expect(logs.join('\n')).toContain('scratch sweep exploded');
  });
});

describe('Concrete worktree daemon sweep', () => {
  it('reclaims an interrupted leased provider home without touching durable external state', async () => {
    const { root } = await initRepo('provider-scratch-daemon-');
    const worktree = join(root, '.worktrees', 'scratch-feature');
    const durable = join(root, 'durable-runs', 'scratch-feature', 'conduct-state.json');
    await mkdir(join(worktree, 'skills'), { recursive: true });
    await mkdir(join(durable, '..'), { recursive: true }); await writeFile(durable, '{}\n');
    const home = await provisionProviderHome({ provider: { id: 'codex' }, worktreeRoot: worktree, repository: 'owner/repo', featureSlug: 'scratch-feature', runId: 'R', attempt: 2 });
    const leasePath = join(worktree, '.daemon', 'scratch', 'R', '2-codex', 'owner.json');
    const lease = JSON.parse(await readFile(leasePath, 'utf8')); lease.ownerPid = 99999999; await writeFile(leasePath, `${JSON.stringify(lease)}\n`);
    await sweepFeatureWorktreeScratch({ worktreeBase: join(root, '.worktrees'), events: { emit: async () => {} } as never, log: () => {} });
    expect(await exists(home.homeDir)).toBe(false);
    expect(await exists(durable)).toBe(true);
  });
});

describe('Story 6 — production worktree removal is the final scratch backstop', () => {
  it('removes worktree-local scratch while preserving external durable run-state', async () => {
    const { root, git } = await initRepo('provider-scratch-reap-');
    const worktree = join(root, '.worktrees', 'scratch-feature');
    const externalRunState = join(root, 'durable-runs', 'scratch-feature');
    await mkdir(join(root, '.worktrees'), { recursive: true });
    await git('worktree', 'add', '-q', '-b', 'feat/scratch-feature', worktree, 'main');
    const providerHome = await provisionProviderHome({
      provider: { id: 'codex' },
      worktreeRoot: worktree,
      repository: root,
      featureSlug: 'scratch-feature',
      runId: 'R',
      attempt: 2,
    });
    const leasePath = join(worktree, '.daemon', 'scratch', 'R', '2-codex', 'owner.json');
    expect(JSON.parse(await readFile(leasePath, 'utf8'))).toMatchObject({
      repository: root,
      featureSlug: 'scratch-feature',
      runId: 'R',
      attempt: 2,
    });
    expect(await exists(providerHome.homeDir)).toBe(true);
    await mkdir(externalRunState, { recursive: true });
    await writeFile(join(externalRunState, 'conduct-state.json'), '{}\n');

    const deps = makeFeatureRunnerDeps({
      projectRoot: root,
      worktreeBase: join(root, '.worktrees'),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
    });
    if (!deps.teardownWorktree) throw new Error('production teardown dependency is unavailable');

    await deps.teardownWorktree(
      { path: worktree, branch: 'feat/scratch-feature' },
      false,
    );

    expect(await exists(worktree)).toBe(false);
    expect(await exists(leasePath)).toBe(false);
    expect(await exists(join(externalRunState, 'conduct-state.json'))).toBe(true);

    await expect(deps.teardownWorktree(
      { path: worktree, branch: 'feat/scratch-feature' },
      false,
    )).resolves.toBeUndefined();
    expect(await exists(join(externalRunState, 'conduct-state.json'))).toBe(true);
  });
});

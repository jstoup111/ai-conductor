// Covers: task:37
/**
 * Done-when sweep (G4): the four expected-SHA force-push callers against a
 * real local bare remote.
 *
 * - autoresolve `publishResolution` (and `pushRefreshedBranch`)
 * - ci-fix `runCiFix` (through `pushRefreshedBranch`)
 * - the post-rebase draft refresh `openShipDraftPr({ pushMode: 'lease' })`
 * - halt-record publication through `writeHaltMarker`
 *
 * Every caller reaches the REAL executeRemoteGit (so Task-35 recording of the
 * pushed tip is production code); only the GitHub-identity lookup is
 * replaced by a fixed origin URL and committed-provenance context, and every
 * argv reaching executeRemoteGit and its process boundary is recorded. Events
 * go through the real ConductorEventEmitter → EventPersister spine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { publishResolution } from '../../src/engine/autoresolve.js';
import { runCiFix } from '../../src/engine/ci-fix.js';
import { openShipDraftPr } from '../../src/engine/ship-draft-pr.js';
import { writeHaltMarker } from '../../src/engine/halt-marker.js';
import { PRE_PUSH_HOOK } from '../../src/engine/git-hook-assets.js';
import { pushedTipIntentRef, pushedTipRef } from '../../src/engine/push-lease.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import * as rebaseModule from '../../src/engine/rebase.js';
import type { GitRunner as RebaseGitRunner } from '../../src/engine/rebase.js';
import type { GitRunner as PrGitRunner, GhRunner } from '../../src/engine/pr-labels.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../src/engine/github-operations.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';

/**
 * ci-fix builds its git runner internally. This passthrough wrapper lets one
 * scenario fail only the lease's post-fetch remote-tip read; it is inert
 * unless `failTrackingReadAfterFetch` is set.
 */
const ciFixGitControl = vi.hoisted(() => ({ failTrackingReadAfterFetch: false }));
vi.mock('../../src/engine/rebase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/rebase.js')>();
  return {
    ...actual,
    makeGitRunner: (cwd: string): RebaseGitRunner => {
      const real = actual.makeGitRunner(cwd);
      let fetched = false;
      return async (args, opts) => {
        if (ciFixGitControl.failTrackingReadAfterFetch) {
          if (args[0] === 'fetch' && args.some((arg) => arg.startsWith('+refs/heads/'))) fetched = true;
          if (fetched && args[0] === 'rev-parse' && args.some((arg) => arg.startsWith('refs/remotes/origin/'))) {
            return { exitCode: 1, stdout: '', stderr: 'injected remote-read failure' };
          }
        }
        return real(args, opts);
      };
    },
  };
});

const BRANCH = 'feat/daemon-demo';
const REMOTE_REF = `refs/heads/${BRANCH}`;
const PR_URL = 'https://github.com/acme/rocket/pull/7';
const roots: string[] = [];

afterEach(async () => {
  ciFixGitControl.failTrackingReadAfterFetch = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execa('git', [...args], { cwd });
  return stdout.trim();
}

async function maybeRef(cwd: string, name: string): Promise<string | undefined> {
  const result = await execa('git', ['rev-parse', '--verify', '--quiet', name], { cwd, reject: false });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

async function commit(cwd: string, message: string): Promise<string> {
  await writeFile(join(cwd, `${message.replaceAll(' ', '-')}.txt`), `${message}\n`);
  await git(cwd, ['add', '-A']);
  await git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/rocket', defaultBranch: 'main', specBranch: 'spec/demo',
      featureMarker: '.docs/specs/demo.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/specs/demo.md', content: 'Owner: alice\n' }] },
    },
  };
}

const ORIGIN_CONFIG = async () => ({ stdout: 'git@github.com:acme/rocket.git\n' });

/**
 * The real executeRemoteGit. `entries` records every argv that reaches
 * executeRemoteGit; `writes` records every argv that reaches its process
 * boundary (an actual remote write).
 */
function guardedRemote(entries: string[][], writes: string[][]): typeof executeRemoteGit {
  return (args, dependencies) => {
    entries.push([...args]);
    return executeRemoteGit(args, {
      ...dependencies,
      config: ORIGIN_CONFIG,
      mutation: mutation(),
      runRemoteGit: async (remoteArgs, options) => {
        writes.push([...remoteArgs]);
        return dependencies.runRemoteGit(remoteArgs, options);
      },
    });
  };
}

const throwingGit: PrGitRunner = async (args, opts) => {
  const { stdout } = await execa('git', args, { cwd: opts.cwd });
  return { stdout };
};

function recordingGh(): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) return { stdout: JSON.stringify({ comments: [] }) };
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, state: 'OPEN' }) };
    return { stdout: '' };
  };
  return { gh, calls };
}

/** Guarded GitHub operations seam: records every escalation write as data. */
function recordingOperations(): { operations: GithubOperationRunner; requests: GithubOperationRequest[] } {
  const requests: GithubOperationRequest[] = [];
  return { requests, operations: { run: async (request) => { requests.push(request); return {}; } } };
}

/** The escalation comment carries exactly the reason publishResolution returned. */
function escalationComment(requests: readonly GithubOperationRequest[]): string | undefined {
  const comment = requests.find((request) => request.operation === 'pull-request.comment.create');
  return comment === undefined ? undefined : String((comment.payload as { body?: unknown } | undefined)?.body ?? '');
}

function spine(root: string) {
  const events = new ConductorEventEmitter();
  const path = join(root, 'events.jsonl');
  const persister = new EventPersister(path, events);
  persister.start();
  return {
    events,
    async persisted(): Promise<ConductorEvent[]> {
      persister.stop();
      if (!existsSync(path)) return [];
      const text = await readFile(path, 'utf8');
      return text.trim() === '' ? [] : text.trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent);
    },
  };
}

/**
 * Remote with `main`, a root checkout `repo` (on main), and — when
 * `worktree` is set — a feature worktree whose directory is named `demo`
 * (the halt record's slug) with `feat/daemon-demo` checked out.
 */
async function fixture(options: { worktree: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'push-lease-callers-'));
  roots.push(root);
  const remote = join(root, 'origin.git');
  const repo = join(root, 'repo');
  await mkdir(repo);
  await initTestRepo(repo);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n.test-git-hooks/\n.worktrees/\n');
  const seed = await commit(repo, 'seed');
  await git(root, ['init', '--bare', '--initial-branch=main', remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  await git(repo, ['fetch', '-q', 'origin']);
  let feature = repo;
  if (options.worktree) {
    feature = join(root, 'wt', 'demo');
    await mkdir(join(root, 'wt'));
    await git(repo, ['worktree', 'add', '-q', '-b', BRANCH, feature]);
  } else {
    await git(repo, ['checkout', '-q', '-b', BRANCH]);
  }
  return { root, remote, repo, feature, seed };
}

/** An engine push of R1 through the real executeRemoteGit: Task 35 records pushed/ = R1. */
async function enginePush(cwd: string): Promise<string> {
  const sha = await git(cwd, ['rev-parse', 'HEAD']);
  await expect(executeRemoteGit(['push', 'origin', `HEAD:${REMOTE_REF}`], {
    cwd, config: ORIGIN_CONFIG, mutation: mutation(),
    runRemoteGit: async (args) => ({ stdout: (await execa('git', args, { cwd })).stdout }),
  })).resolves.toMatchObject({ kind: 'executed' });
  expect(await maybeRef(cwd, pushedTipRef('demo', BRANCH))).toBe(sha);
  return sha;
}

/** A human pushes R2 on top of R1 from an independent clone. */
async function humanPush(root: string, remote: string, name: string): Promise<string> {
  const human = join(root, `human-${name}`);
  await git(root, ['clone', '-q', remote, human]);
  await git(human, ['config', 'user.email', 'human@example.com']);
  await git(human, ['config', 'user.name', 'Human']);
  await git(human, ['checkout', '-q', BRANCH]);
  const sha = await commit(human, `human ${name}`);
  await git(human, ['push', '-q', 'origin', BRANCH]);
  return sha;
}

/**
 * Recorded tip R1; the engine rewrote HEAD (no R1, no R2); a human pushed R2;
 * another worktree's full fetch advanced origin/feat/daemon-demo to R2.
 */
async function recordedThenHumanAdvanced(options: { worktree: boolean }) {
  const f = await fixture(options);
  await commit(f.feature, 'feature work');
  const r1 = await enginePush(f.feature);
  await git(f.feature, ['commit', '--amend', '-q', '-m', 'feature work (rebased)']);
  const head = await git(f.feature, ['rev-parse', 'HEAD']);
  const r2 = await humanPush(f.root, f.remote, 'r2');
  // Another worktree (the root checkout) runs a FULL fetch; tracking refs are shared.
  await git(f.repo, ['fetch', '-q', 'origin']);
  expect(await maybeRef(f.feature, `refs/remotes/origin/${BRANCH}`)).toBe(r2);
  expect((await execa('git', ['merge-base', '--is-ancestor', r2, head], { cwd: f.feature, reject: false })).exitCode).toBe(1);
  return { ...f, r1, r2, head };
}

const remoteTip = (remote: string) => git(remote, ['rev-parse', REMOTE_REF]);
const leaseRefusals = (events: ConductorEvent[]) => events.filter((event) => event.type === 'push_lease_refused');

describe('expected-SHA lease callers against a real remote — sweep G4', () => {
  // Covers: S14.7, task:rem-prd-audit-rem-prd-audit-R32
  it('publishResolution refuses against the recorded R1 when a human R2 was fetched past it, leaving the remote at R2', async () => {
    const f = await recordedThenHumanAdvanced({ worktree: true });
    const { events, persisted } = spine(f.root);
    const entries: string[][] = [];
    const writes: string[][] = [];
    const { gh } = recordingGh();
    const { operations, requests } = recordingOperations();
    const logs: string[] = [];

    const result = await publishResolution({
      git: rebaseModule.makeGitRunner(f.feature),
      branch: BRANCH,
      prUrl: PR_URL,
      gh: { runGh: gh, operations, cwd: f.repo, log: (line) => logs.push(line) },
      remoteGit: guardedRemote(entries, writes),
      remoteMutation: mutation(),
      events,
      cwd: f.feature,
    });

    expect(result).toEqual({
      published: false,
      stage: 'lease-push',
      reason: expect.stringContaining(`remote tip for ${REMOTE_REF} changed from ${f.r1}`),
    });
    expect(entries).toEqual([]);
    expect(writes).toEqual([]);
    expect(await remoteTip(f.remote)).toBe(f.r2);
    const refusals = leaseRefusals(await persisted());
    expect(refusals).toEqual([
      expect.objectContaining({ type: 'push_lease_refused', ref: REMOTE_REF, expected: f.r1, actual: f.r2 }),
    ]);
    // The canonical slug (`demo`) is the one whose pushed/ record was consulted and kept.
    expect(await maybeRef(f.feature, pushedTipRef('demo', BRANCH))).toBe(f.r1);
    expect(await maybeRef(f.feature, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
    // Escalated with that refusal as the reason.
    expect(logs.some((line) => line.includes('lease-push') && line.includes('escalated'))).toBe(true);
    expect(escalationComment(requests)).toContain(`**Reason:** ${result.published ? '' : result.reason}`);
    expect(requests.some((request) => request.operation !== 'pull-request.comment.create'
      && JSON.stringify(request).includes('needs-remediation'))).toBe(true);
  });

  // Covers: S14.7, S14.9, task:37
  it('refuses the draft refresh, ci-fix and halt-record publication against recorded R1 after a fetched human R2, keeping R2', async () => {
    // Draft refresh.
    {
      const f = await recordedThenHumanAdvanced({ worktree: true });
      const { events, persisted } = spine(f.root);
      const entries: string[][] = [];
      const writes: string[][] = [];
      const { gh, calls: ghCalls } = recordingGh();
      const logs: string[] = [];
      const result = await openShipDraftPr({
        gh, git: throwingGit, cwd: f.feature, branch: BRANCH, baseBranch: 'main', featureDesc: 'demo',
        pushMode: 'lease', remoteGit: guardedRemote(entries, writes), remoteMutation: mutation(), events,
        log: (line) => logs.push(line),
      });
      expect(result).toMatchObject({ reason: expect.stringContaining(`changed from ${f.r1} to ${f.r2}`) });
      expect(result.outcome).not.toBe('published');
      expect(ghCalls).toEqual([]);
      expect(entries).toEqual([]);
      expect(writes).toEqual([]);
      expect(await remoteTip(f.remote)).toBe(f.r2);
      expect(leaseRefusals(await persisted())).toEqual([
        expect.objectContaining({ ref: REMOTE_REF, expected: f.r1, actual: f.r2 }),
      ]);
    }

    // ci-fix: built on R1; while it verifies, a human pushes R2 and another worktree fetches it.
    {
      const f = await fixture({ worktree: false });
      await commit(f.repo, 'feature work');
      const r1 = await enginePush(f.repo);
      await git(f.repo, ['checkout', '-q', 'main']);
      const { events, persisted } = spine(f.root);
      const entries: string[][] = [];
      const writes: string[][] = [];
      let r2 = '';
      const logs: string[] = [];
      const result = await runCiFix(
        { prUrl: PR_URL, slug: 'demo', repoCwd: f.repo, ciFixAttempts: 0 },
        BRANCH,
        'hint',
        {
          fixRunner: { run: async ({ worktreePath }) => { await commit(worktreePath, 'ci fix'); return { kind: 'changed' as const }; } },
          verify: async () => {
            r2 = await humanPush(f.root, f.remote, 'r2');
            await git(f.repo, ['fetch', '-q', 'origin']);
            return 0;
          },
          prepareWorktree: async () => {},
          remoteGit: guardedRemote(entries, writes),
          remoteMutation: mutation(),
          events,
        },
        (line) => logs.push(line),
      );
      expect(result).toEqual({ kind: 'failed', stage: 'publication' });
      expect(entries).toEqual([]);
      expect(writes).toEqual([]);
      expect(await remoteTip(f.remote)).toBe(r2);
      expect(leaseRefusals(await persisted())).toEqual([
        expect.objectContaining({ ref: REMOTE_REF, expected: r1, actual: r2 }),
      ]);
      expect(logs.some((line) => line.includes('ci-fix lease push failed') && line.includes(r1))).toBe(true);
    }

    // Halt-record publication.
    {
      const f = await recordedThenHumanAdvanced({ worktree: true });
      const { events, persisted } = spine(f.root);
      const entries: string[][] = [];
      const writes: string[][] = [];
      await expect(writeHaltMarker(f.feature, 'operator decision required\n', 'needs-human', events, {
        git: throwingGit, remoteGit: guardedRemote(entries, writes), mutation: mutation(),
      })).resolves.toEqual({ status: 'written' });
      expect(entries).toEqual([]);
      expect(writes).toEqual([]);
      expect(await remoteTip(f.remote)).toBe(f.r2);
      expect(leaseRefusals(await persisted())).toEqual([
        expect.objectContaining({ ref: REMOTE_REF, expected: f.r1, actual: f.r2 }),
      ]);
    }
  });

  // Covers: S14.8, task:37
  it('keeps the halt-record commit and persists push_lease_refused and halt_record_push_failed when R2 was fetched past recorded R1', async () => {
    const f = await recordedThenHumanAdvanced({ worktree: true });
    const { events, persisted } = spine(f.root);
    const entries: string[][] = [];
    const writes: string[][] = [];

    await expect(writeHaltMarker(f.feature, 'operator decision required\n', 'needs-human', events, {
      git: throwingGit, remoteGit: guardedRemote(entries, writes), mutation: mutation(),
    })).resolves.toEqual({ status: 'written' });

    expect(writes).toEqual([]);
    expect(await remoteTip(f.remote)).toBe(f.r2);
    await expect(readFile(join(f.feature, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('operator decision required');
    expect(await git(f.feature, ['rev-parse', 'HEAD~1'])).toBe(f.head);
    expect(await git(f.feature, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toBe('.docs/halted/demo.md');
    await expect(git(f.feature, ['show', 'HEAD:.docs/halted/demo.md'])).resolves.toContain('Status: halted');
    const all = await persisted();
    expect(leaseRefusals(all)).toEqual([
      expect.objectContaining({ ref: REMOTE_REF, expected: f.r1, actual: f.r2 }),
    ]);
    expect(all.filter((event) => event.type === 'halt_record_push_failed')).toEqual([
      expect.objectContaining({ path: '.docs/halted/demo.md', reason: expect.stringContaining(f.r2) }),
    ]);
    expect(all.some((event) => event.type === 'halt_record_written')).toBe(false);
  });

  // Covers: S14.2, S14.16, task:37
  it('draft refresh fetches only the feature branch, leases against the recorded remote tip R and records the new tip through the engine pre-push hook', async () => {
    const f = await fixture({ worktree: true });
    await commit(f.feature, 'feature work');
    const r = await enginePush(f.feature);
    await git(f.feature, ['commit', '--amend', '-q', '-m', 'feature work (rebased)']);
    const head = await git(f.feature, ['rev-parse', 'HEAD']);

    // Install the engine pre-push hook for this worktree; the common-dir hook
    // it chains to leaves a marker proving the engine hook ran and passed.
    const hooks = join(f.feature, '.pipeline', 'git-hooks');
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, 'pre-push'), PRE_PUSH_HOOK, 'utf8');
    await chmod(join(hooks, 'pre-push'), 0o755);
    await git(f.feature, ['config', '--worktree', 'core.hooksPath', hooks]).catch(async () => {
      await git(f.feature, ['config', 'extensions.worktreeConfig', 'true']);
      await git(f.feature, ['config', '--worktree', 'core.hooksPath', hooks]);
    });
    const commonHooks = join(await git(f.feature, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'hooks');
    await mkdir(commonHooks, { recursive: true });
    const marker = join(f.root, 'engine-pre-push-passed');
    await writeFile(join(commonHooks, 'pre-push'), `#!/bin/sh\ncat >/dev/null\ntouch "${marker}"\n`);
    await chmod(join(commonHooks, 'pre-push'), 0o755);

    const calls: string[][] = [];
    const recordingGit: PrGitRunner = async (args, opts) => {
      calls.push([...args]);
      return throwingGit(args, opts);
    };
    const entries: string[][] = [];
    const writes: string[][] = [];
    const { gh } = recordingGh();

    const result = await openShipDraftPr({
      gh, git: recordingGit, cwd: f.feature, branch: BRANCH, baseBranch: 'main', featureDesc: 'demo',
      pushMode: 'lease', remoteGit: guardedRemote(entries, writes), remoteMutation: mutation(),
    });

    expect(result).toEqual({ outcome: 'published', prUrl: PR_URL });
    const fetches = calls.filter((call) => call[0] === 'fetch');
    expect(fetches).toEqual([['fetch', 'origin', `+${REMOTE_REF}:refs/remotes/origin/${BRANCH}`]]);
    const fetchIndex = calls.findIndex((call) => call[0] === 'fetch');
    const pushIndex = calls.findIndex((call) => call[0] === 'push');
    expect(fetchIndex).toBeGreaterThanOrEqual(0);
    expect(pushIndex).toBeGreaterThan(fetchIndex);
    expect(entries).toEqual([['push', 'origin', `HEAD:${REMOTE_REF}`, `--force-with-lease=${REMOTE_REF}:${r}`]]);
    expect(writes).toEqual(entries);
    expect(await remoteTip(f.remote)).toBe(head);
    expect(await maybeRef(f.feature, pushedTipRef('demo', BRANCH))).toBe(head);
    expect(await maybeRef(f.feature, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
    expect(existsSync(marker)).toBe(true);
  });

  // Covers: S14.3, task:37
  it('ci-fix publishes a fix built on a human push H past the recorded tip', async () => {
    const f = await fixture({ worktree: false });
    await commit(f.repo, 'feature work');
    const r1 = await enginePush(f.repo);
    await git(f.repo, ['checkout', '-q', 'main']);
    const h = await humanPush(f.root, f.remote, 'h');
    const entries: string[][] = [];
    const writes: string[][] = [];
    let fixSha = '';

    const result = await runCiFix(
      { prUrl: PR_URL, slug: 'demo', repoCwd: f.repo, ciFixAttempts: 0 },
      BRANCH,
      'hint',
      {
        fixRunner: { run: async ({ worktreePath }) => {
          expect(await git(worktreePath, ['rev-parse', 'HEAD'])).toBe(h);
          fixSha = await commit(worktreePath, 'ci fix');
          return { kind: 'changed' as const };
        } },
        verify: async () => 0,
        prepareWorktree: async () => {},
        remoteGit: guardedRemote(entries, writes),
        remoteMutation: mutation(),
      },
      () => {},
    );

    expect(result).toEqual({ kind: 'published' });
    expect(entries).toEqual([['push', 'origin', `HEAD:${REMOTE_REF}`, `--force-with-lease=${REMOTE_REF}:${h}`]]);
    expect(await remoteTip(f.remote)).toBe(fixSha);
    expect(await git(f.remote, ['rev-parse', `${REMOTE_REF}~1`])).toBe(h);
    expect(await maybeRef(f.repo, pushedTipRef('demo', BRANCH))).toBe(fixSha);
    expect(r1).not.toBe(h);
  });

  // Covers: S14.11, task:37
  it('on a failed single-branch fetch or remote read every caller attempts no push, keeps its pushed tip, and reports the failure its own way', async () => {
    for (const failure of ['fetch', 'remote read'] as const) {
      // Each feature-worktree caller gets a fresh recorded-tip fixture and an
      // engine rewrite that needs a force push.
      const prepare = async () => {
        const f = await fixture({ worktree: true });
        await commit(f.feature, 'feature work');
        const r1 = await enginePush(f.feature);
        await git(f.feature, ['commit', '--amend', '-q', '-m', 'feature work (rebased)']);
        if (failure === 'fetch') await rename(f.remote, `${f.remote}.offline`);
        return { ...f, r1 };
      };
      const failRead = <T extends (args: string[], ...rest: never[]) => Promise<unknown>>(runner: T, failed: (args: string[]) => Awaited<ReturnType<T>>): T => {
        let fetched = false;
        return (async (args: string[], ...rest: never[]) => {
          if (failure === 'remote read') {
            if (args[0] === 'fetch') fetched = true;
            if (fetched && args[0] === 'rev-parse' && args.some((arg) => arg.startsWith('refs/remotes/origin/'))) return failed(args);
          }
          return runner(args, ...rest);
        }) as T;
      };

      // autoresolve: escalates with the failure as the reason.
      {
        const f = await prepare();
        const entries: string[][] = [];
        const writes: string[][] = [];
        const { gh } = recordingGh();
        const { operations, requests } = recordingOperations();
        const logs: string[] = [];
        const result = await publishResolution({
          git: failRead(rebaseModule.makeGitRunner(f.feature), () => ({ exitCode: 1, stdout: '', stderr: 'read failed' })),
          branch: BRANCH, prUrl: PR_URL, gh: { runGh: gh, operations, cwd: f.repo, log: (line) => logs.push(line) },
          remoteGit: guardedRemote(entries, writes), remoteMutation: mutation(), cwd: f.feature,
        });
        const expected = failure === 'fetch' ? `could not fetch ${REMOTE_REF}` : `could not read remote tip for ${REMOTE_REF}`;
        expect(result).toEqual({ published: false, stage: 'lease-push', reason: expect.stringContaining(expected) });
        expect(logs.some((line) => line.includes('lease-push') && line.includes('escalated'))).toBe(true);
        expect(escalationComment(requests)).toContain(`**Reason:** ${result.published ? '' : result.reason}`);
        expect(entries).toEqual([]);
        expect(writes).toEqual([]);
        expect(await maybeRef(f.feature, pushedTipRef('demo', BRANCH))).toBe(f.r1);
      }

      // Draft refresh: logs a loud failure naming the ref and returns (the build continues).
      {
        const f = await prepare();
        const entries: string[][] = [];
        const writes: string[][] = [];
        const { gh } = recordingGh();
        const logs: string[] = [];
        const result = await openShipDraftPr({
          gh, git: failRead(throwingGit, () => { throw new Error('read failed'); }), cwd: f.feature, branch: BRANCH,
          baseBranch: 'main', featureDesc: 'demo', pushMode: 'lease',
          remoteGit: guardedRemote(entries, writes), remoteMutation: mutation(), log: (line) => logs.push(line),
        });
        expect(result).toMatchObject({ outcome: 'push-failed', reason: expect.stringContaining(REMOTE_REF) });
        expect(logs.some((line) => line.includes('failed') && line.includes(REMOTE_REF) && line.includes('build continues'))).toBe(true);
        expect(entries).toEqual([]);
        expect(writes).toEqual([]);
        expect(await maybeRef(f.feature, pushedTipRef('demo', BRANCH))).toBe(f.r1);
      }

      // Halt-record publication: halt_record_push_failed, commit kept, halt path succeeds.
      {
        const f = await prepare();
        const head = await git(f.feature, ['rev-parse', 'HEAD']);
        const { events, persisted } = spine(f.root);
        const entries: string[][] = [];
        const writes: string[][] = [];
        await expect(writeHaltMarker(f.feature, 'operator decision required\n', 'needs-human', events, {
          git: failRead(throwingGit, () => { throw new Error('read failed'); }),
          remoteGit: guardedRemote(entries, writes), mutation: mutation(),
        })).resolves.toEqual({ status: 'written' });
        expect(entries).toEqual([]);
        expect(writes).toEqual([]);
        expect(await git(f.feature, ['rev-parse', 'HEAD~1'])).toBe(head);
        expect(await git(f.feature, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).toBe('.docs/halted/demo.md');
        expect((await persisted()).filter((event) => event.type === 'halt_record_push_failed')).toEqual([
          expect.objectContaining({ path: '.docs/halted/demo.md', reason: expect.stringContaining(REMOTE_REF) }),
        ]);
        expect(await maybeRef(f.feature, pushedTipRef('demo', BRANCH))).toBe(f.r1);
      }

      // ci-fix: escalates (publication failure) with the failure as the logged reason.
      {
        const f = await fixture({ worktree: false });
        await commit(f.repo, 'feature work');
        const r1 = await enginePush(f.repo);
        await git(f.repo, ['checkout', '-q', 'main']);
        const entries: string[][] = [];
        const writes: string[][] = [];
        const logs: string[] = [];
        ciFixGitControl.failTrackingReadAfterFetch = failure === 'remote read';
        const result = await runCiFix(
          { prUrl: PR_URL, slug: 'demo', repoCwd: f.repo, ciFixAttempts: 0 },
          BRANCH,
          'hint',
          {
            fixRunner: { run: async ({ worktreePath }) => { await commit(worktreePath, 'ci fix'); return { kind: 'changed' as const }; } },
            verify: async () => {
              if (failure === 'fetch') await rename(f.remote, `${f.remote}.offline`);
              return 0;
            },
            prepareWorktree: async () => {},
            remoteGit: guardedRemote(entries, writes),
            remoteMutation: mutation(),
          },
          (line) => logs.push(line),
        );
        ciFixGitControl.failTrackingReadAfterFetch = false;
        const expected = failure === 'fetch' ? `could not fetch ${REMOTE_REF}` : `could not read remote tip for ${REMOTE_REF}`;
        expect(result).toEqual({ kind: 'failed', stage: 'publication' });
        expect(logs.some((line) => line.includes('ci-fix lease push failed') && line.includes(expected))).toBe(true);
        expect(logs.some((line) => line.includes('ci-fix-lease-push') && line.includes('escalated'))).toBe(true);
        expect(entries).toEqual([]);
        expect(writes).toEqual([]);
        expect(await maybeRef(f.repo, pushedTipRef('demo', BRANCH))).toBe(r1);
      }
    }
  });
});

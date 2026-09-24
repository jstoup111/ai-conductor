// Task 9: handoff records delivery evidence on the local-commit fallback (branch metadata).
//
// When `conduct-ts engineer handoff --source-ref` with openSpecPr throws or returns
// pr-skipped (non-PR-opened outcomes), the handoff command MUST record the branch
// as delivery evidence in the intake ledger, preserving status and only adding branch
// metadata. This enables the operator to retry via an `engineer resolve` call if the
// write-back fails (e.g., #290 stranded entries).
//
// Contract (Task 9 AC):
// 1. handoff with --source-ref + openSpecPr throws → ledger.transition(sourceRef, status, {branch})
//    status unchanged, only branch added to meta. Exit 0 with kind:'local-commit'.
// 2. Same behavior for pr-skipped outcome (status unchanged, branch added).
// 3. Without --source-ref, no ledger write attempted (no branch recorded).
// 4. If ledger.transition throws, exit 0 with stderr error message (handoff still succeeds).
// 5. pr-opened path regression: original flow works unchanged (branch recorded by openSpecPr caller if needed).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { access, mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';
import type { HandoffDeps } from '../../../src/engine/engineer/handoff.js';

const execFile = promisify(execFileCb);

const ACCEPTED_STORIES = [
  '# Stories: test',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: test feature',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given X, when Y, then Z.',
  '',
  '#### Negative Paths',
  '- Given invalid input, when Y, then it is refused.',
  '',
].join('\n');

const PLAN_WITH_DEPS = [
  '# Implementation Plan: test',
  '',
  '**Stories:** .docs/stories/test.md',
  '',
  '## Task Dependency Graph',
  '```',
  '1 → 2',
  '```',
  '',
].join('\n');

let workDir: string;
let registryPath: string;
let engineerDir: string;
let repoPath: string;
let defaultBranch: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/**
 * Create the per-idea worktree and seed the pre-written DECIDE artifacts.
 * Returns the worktree path to pass as `--worktree`.
 */
async function seedWorktree(): Promise<string> {
  const wt = await createEngineerWorktree(repoPath, 'test feature');
  const dir = wt.worktreePath;
  await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
  await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await writeFile(join(dir, '.docs', 'specs', 'test.md'), '# PRD: test\n\nApproved.\n');
  await writeFile(join(dir, '.docs', 'stories', 'test.md'), ACCEPTED_STORIES);
  await writeFile(join(dir, '.docs', 'plans', 'test.md'), PLAN_WITH_DEPS);
  return dir;
}

async function writeRegistry(): Promise<void> {
  const records = [
    {
      schemaVersion: 1,
      name: 'test-proj',
      path: repoPath,
      status: 'registered',
      registeredAt: '2026-07-04T00:00:00.000Z',
    },
  ];
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

async function writeRemoteRegistry(): Promise<void> {
  const records = [
    {
      schemaVersion: 1,
      name: 'test-proj',
      path: repoPath,
      remote: 'https://github.com/acme/test-proj.git',
      status: 'registered',
      registeredAt: '2026-07-04T00:00:00.000Z',
    },
  ];
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

const noOpGit = async () => ({ stdout: '', stderr: '' });

function authorizedPublication(
  gh: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>,
  branch: string,
  repository: string,
  number: number,
): NonNullable<HandoffDeps['publication']> {
  const featureMarker = `.docs/intake/${branch.slice('spec/'.length)}.md`;
  return {
    repository,
    remote: {
      cwd: repoPath,
      config: async () => ({ stdout: `https://github.com/${repository}.git` }),
      runRemoteGit: noOpGit,
      mutation: {
        provenance: { repository, defaultBranch: 'main', specBranch: branch, featureMarker, publication: 'initial' },
        dependencies: {
          resolveMachineOwner: async () => ({ resolved: true as const, id: 'test-owner' }),
          provenanceDiscovery: { readCommittedRecords: async () => [{ path: featureMarker, content: 'Owner: test-owner\n' }] },
        },
      },
    },
    operations: {
      async run(request) {
        if (request.operation === 'pull-request.create') {
          const payload = request.payload as { head: string; title: string; body: string };
          await gh(['pr', 'create', '--head', payload.head, '--title', payload.title, '--body', payload.body], { cwd: repoPath });
          return { created: { repository, kind: 'pull-request' as const, number } };
        }
        return {};
      },
    },
  };
}

function captureOpts(extra: Partial<DispatchEngineerOpts>): {
  out: string[];
  err: string[];
  opts: DispatchEngineerOpts;
} {
  const out: string[] = [];
  const err: string[] = [];
  const opts: DispatchEngineerOpts = {
    registryPath,
    engineerDir,
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  };
  return { out, err, opts };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-handoff-branch-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  repoPath = join(workDir, 'test-proj');
  await mkdir(engineerDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
  defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  await writeRegistry();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer handoff — branch evidence recording on local-commit/pr-skipped (Task 9)', () => {
  async function handoffThroughRealEnsureRunning(
    setup: (branch: string) => Promise<void> | void,
  ): Promise<{ err: string[]; launches: string[]; timeline: string[] }> {
    const sourceRef = 'o/reclaim#42';
    const PR_URL = 'https://github.com/o/reclaim/pull/42';
    await writeRemoteRegistry();
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});
    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
    await setup(branch);
    const gh = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: `Opening pull request...\n${PR_URL}\n` };
      if (args[0] === 'pr' && args[1] === 'edit') return { stdout: '' };
      return { stdout: JSON.stringify({}) };
    };
    const launches: string[] = [];
    const timeline: string[] = [];
    const { err, opts } = captureOpts({
      gh: gh as any,
      git: noOpGit,
      handoffPublication: authorizedPublication(gh as any, branch, 'o/reclaim', 42),
      intakeResolveActor: async () => ({ resolved: true, id: 'test-owner' }),
      ensureRunningOpts: { launch: () => { launches.push('launch'); timeline.push('launch'); } },
    });
    opts.printErr = (message) => { err.push(message); timeline.push(message); };
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === 42 && signal === 0) {
        const error = new Error('ESRCH') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
    }) as typeof process.kill);
    try {
      await dispatchEngineer({ kind: 'handoff', project: 'test-proj', branch, worktree, sourceRef }, opts);
    } finally {
      kill.mockRestore();
    }
    return { err, launches, timeline };
  }

  it('prints a SIGKILL reclaim witness before the real ensureRunning launch', async () => {
    const at = '2026-09-23T12:00:00.000Z';
    const result = await handoffThroughRealEnsureRunning(async () => {
      await mkdir(join(repoPath, '.daemon'), { recursive: true });
      await writeFile(join(repoPath, '.daemon', 'daemon.pid'), JSON.stringify({ pid: 42, uuid: 'dead', startedAt: at }));
      await writeFile(join(repoPath, '.daemon', 'exit-events.jsonl'), `${JSON.stringify({ type: 'daemon_exited', pid: 42, code: null, signal: 'SIGKILL', at })}\n`);
    });

    expect(result.err).toContain(`reclaiming lock from dead pid 42 (killed by SIGKILL at ${at})`);
    expect(result.launches).toEqual(['launch']);
    expect(result.timeline.indexOf(`reclaiming lock from dead pid 42 (killed by SIGKILL at ${at})`))
      .toBeLessThan(result.timeline.indexOf('launch'));
  });

  it('prints an unknown exit cause and still launches through the real handoff path', async () => {
    const result = await handoffThroughRealEnsureRunning(async () => {
      await mkdir(join(repoPath, '.daemon'), { recursive: true });
      await writeFile(join(repoPath, '.daemon', 'daemon.pid'), JSON.stringify({ pid: 42, uuid: 'dead', startedAt: '2026-09-23T12:00:00.000Z' }));
    });

    expect(result.err).toContain('reclaiming lock from dead pid 42 (exit cause unknown)');
    expect(result.launches).toEqual(['launch']);
  });

  it('prints an unreadable exit-ledger note and still launches without throwing', async () => {
    const result = await handoffThroughRealEnsureRunning(async () => {
      await mkdir(join(repoPath, '.daemon', 'exit-events.jsonl'), { recursive: true });
      await writeFile(join(repoPath, '.daemon', 'daemon.pid'), JSON.stringify({ pid: 42, uuid: 'dead', startedAt: '2026-09-23T12:00:00.000Z' }));
    });

    expect(result.err.join('\n')).toContain('(exit ledger unreadable:');
    expect(result.launches).toEqual(['launch']);
  });

  it('passes the injected git runner through before creating the remote spec PR', async () => {
    await writeRemoteRegistry();
    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
    const trace: Array<{ command: string; args: string[]; cwd: string }> = [];
    const injectedGit = async (args: string[], options?: { cwd?: string }) => {
      trace.push({ command: 'git', args: [...args], cwd: options?.cwd ?? '' });
      return { stdout: '', stderr: '' };
    };
    const gh = async (args: string[], options?: { cwd?: string }) => {
      trace.push({ command: 'gh', args: [...args], cwd: options?.cwd ?? '' });
      return { stdout: 'https://github.com/acme/test-proj/pull/42', stderr: '' };
    };
    const publication = authorizedPublication(gh as any, branch, 'acme/test-proj', 42);
    const { opts } = captureOpts({
      gh: gh as any,
      ensureRunningLaunch: async () => {},
    });
    const optsWithGit = {
      ...opts,
      git: injectedGit,
      handoffPublication: {
        ...publication,
        remote: {
          ...publication.remote,
          runRemoteGit: injectedGit,
        },
      },
    } as DispatchEngineerOpts & { git: typeof injectedGit };

    await dispatchEngineer({
      kind: 'handoff',
      project: 'test-proj',
      branch,
      worktree,
    }, optsWithGit);

    expect(trace).toEqual([
      { command: 'git', args: ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`], cwd: repoPath },
      {
        command: 'gh',
        args: expect.arrayContaining(['pr', 'create', '--head', branch]),
        cwd: repoPath,
      },
    ]);
  });

  it('TEST 1: remote PR publication failure exits 1, retains worktree, and records branch evidence', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/a#243';
    await writeRemoteRegistry();

    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    const gh = async () => {
      throw new Error('authentication failed while contacting GitHub');
    };

    const { out, err, opts } = captureOpts({
      gh: gh as any,
      git: noOpGit,
      handoffPublication: authorizedPublication(gh as any, branch, 'acme/test-proj', 42),
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    const afterHandoff = await ledger.get('github-issues', sourceRef);
    const worktreeExists = await access(worktree).then(() => true, () => false);

    expect({
      code,
      out,
      stderr: err.join('\n'),
      worktreeExists,
      ledger: { status: afterHandoff?.status, branch: afterHandoff?.branch },
    }).toEqual({
      code: 1,
      out: [],
      stderr: expect.stringMatching(/PR open failed[\s\S]*authentication failed[\s\S]*worktree kept/i),
      worktreeExists: true,
      ledger: { status: 'claimed', branch },
    });
  });

  it('TEST 2: with --source-ref + pr-skipped outcome → records branch evidence, status unchanged', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/b#100';

    // Seed ledger entry with status 'claimed'
    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh runner throws with no-remote error (triggers pr-skipped)
    const gh = async () => {
      throw new Error('git: error: No remote configured.');
    };

    const { out, opts } = captureOpts({
      gh: gh as any,
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    // Assert: exit 0
    expect(code).toBe(0);

    // Assert: stdout has kind 'local-commit' (pr-skipped surfaces as local-commit)
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('local-commit');

    // Assert: ledger entry has branch recorded, status unchanged
    const afterHandoff = await ledger.get('github-issues', sourceRef);
    expect(afterHandoff?.status).toBe('claimed');
    expect(afterHandoff?.branch).toBe(branch);
  });

  it('does not print a local-commit result when branch evidence encounters a corrupt ledger', async () => {
    const sourceRef = 'o/b#101';
    const ledgerPath = join(engineerDir, 'ledger.json');
    const ledger = createLedger(ledgerPath);
    await ledger.record({ source: 'github-issues', sourceRef });
    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
    const corruptContent = 'SECRET_LEDGER_ENTRY_MUST_NOT_REACH_THE_OPERATOR';
    await writeFile(ledgerPath, corruptContent, 'utf8');

    const { out, err, opts } = captureOpts({
      gh: (async () => {
        throw new Error('git: error: No remote configured.');
      }) as any,
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      { kind: 'handoff', project: 'test-proj', branch, worktree, sourceRef },
      opts,
    );

    const diagnostic = err.join('\n');
    const quarantines = await readdir(engineerDir);
    const quarantine = quarantines.find((name) => name.startsWith('ledger.json.corrupt-'));
    expect(quarantine).toBeDefined();
    expect({ code, out, leaksLedgerContent: diagnostic.includes(corruptContent) }).toEqual({
      code: 1,
      out: [],
      leaksLedgerContent: false,
    });
    expect(diagnostic).toContain(ledgerPath);
    expect(diagnostic).toContain(join(engineerDir, quarantine!));
  });

  it('TEST 3: without --source-ref → no ledger write attempted, kind local-commit', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/c#50';

    // Seed a ledger entry but it should NOT be touched
    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});
    const before = await ledger.get('github-issues', sourceRef);
    expect(before?.branch).toBeUndefined();

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh throws
    const gh = async () => {
      throw new Error('Network error');
    };

    const { out, opts } = captureOpts({
      gh: gh as any,
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        // NO sourceRef
      },
      opts,
    );

    // Assert: exit 0, kind local-commit
    expect(code).toBe(0);
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('local-commit');

    // Assert: ledger entry is UNCHANGED (no branch recorded)
    const after = await ledger.get('github-issues', sourceRef);
    expect(after?.branch).toBeUndefined();
  });

  it('TEST 4: with --source-ref + openSpecPr throws but no ledger entry → exits 1 with diagnostics', async () => {
    // This test verifies that when openSpecPr throws and there's a sourceRef but no
    // existing ledger entry (e.g., malformed sourceRef or stale ledger), publication
    // still fails while the missing ledger entry remains a non-crashing diagnostic path.
    const sourceRef = 'o/d#75'; // This ref was never seeded in the ledger
    await writeRemoteRegistry();

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh throws
    const gh = async () => {
      throw new Error('Network error');
    };

    const { out, err, opts } = captureOpts({
      gh: gh as any,
      git: noOpGit,
      handoffPublication: authorizedPublication(gh as any, branch, 'acme/test-proj', 42),
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    expect(code).toBe(1);
    expect(out).toEqual([]);

    // Assert: stderr shows the PR open failure
    const stderrText = err.join('\n');
    expect(stderrText).toMatch(/engineer handoff: PR open failed/i);
  });

  it('TEST 5: pr-opened path + branch evidence (regression) → end-to-end flow unchanged', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/e#200';
    const PR_URL = 'https://github.com/o/e/pull/999';
    await writeRemoteRegistry();

    // Seed ledger entry
    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh succeeds with a PR URL
    const gh = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'create') {
        return { stdout: `Opening pull request...\n${PR_URL}\n` };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        return { stdout: '' };
      }
      return { stdout: JSON.stringify({}) };
    };

    const { out, opts } = captureOpts({
      gh: gh as any,
      git: noOpGit,
      handoffPublication: authorizedPublication(gh as any, branch, 'o/e', 999),
      intakeResolveActor: async () => ({ resolved: true, id: 'test-owner' }),
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    // Assert: exit 0
    expect(code).toBe(0);

    // Assert: stdout has kind 'pr-opened' with URL
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('pr-opened');
    expect(result.url).toBe(PR_URL);

    // Assert: ledger entry is updated to 'done' with prUrl (via reportDone)
    // NOTE: This is the existing behavior we're NOT changing — just verifying
    // the pr-opened path still works as before.
    const afterHandoff = await ledger.get('github-issues', sourceRef);
    // The reportDone call would set status to 'done' and prUrl, but that's
    // beyond the scope of this test — we just verify we didn't break the pr-opened output.
    expect(result.url).toBe(PR_URL);
  });
});

describe('engineer handoff — evidence-write failure handling + pr-opened regression (Task 10)', () => {
  it('TEST 10.1: handoff with --source-ref + openSpecPr throws + ledger.transition throws → exit 0, stderr contains error', async () => {
    const sourceRef = 'o/a#243';
    const realLedger = createLedger(join(engineerDir, 'ledger.json'));

    // Seed ledger entry with status 'claimed'
    await realLedger.record({ source: 'github-issues', sourceRef });
    await realLedger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh runner throws simulating openSpecPr failure
    const gh = async () => {
      throw new Error('Network error');
    };

    // Use vi.mock to intercept createLedger and return a mocked ledger that throws on transition
    const { out, err, opts } = captureOpts({
      gh: gh as any,
      ensureRunningLaunch: async () => {},
    });

    // Mock the createLedger to throw on transition (for the branch evidence recording path)
    const ledgerModule = await import('../../../src/engine/engineer/intake/ledger.js');
    const originalCreateLedger = ledgerModule.createLedger;
    let transitionThrowCount = 0;
    vi.spyOn(ledgerModule, 'createLedger').mockImplementation((path: string) => {
      // Return a mock ledger that throws on transition
      return {
        async known() { return false; },
        async record() {},
        async transition() {
          transitionThrowCount++;
          throw new Error('Ledger write failed: disk full');
        },
        async get() {
          return { source: 'github-issues', sourceRef, status: 'claimed', attempts: 0 };
        },
        async forget() {},
        async list() { return []; },
        async reopen() {},
        async requeueClaimed() { return { acted: false }; },
      };
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    vi.restoreAllMocks();

    // Assert: exit 0 (handoff succeeds despite ledger error)
    expect(code).toBe(0);

    // Assert: stdout has kind 'local-commit'
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('local-commit');

    // Assert: stderr contains the ledger error message
    const stderrText = err.join('\n');
    expect(stderrText).toMatch(/Failed to record branch evidence.*disk full/i);

    // Assert: transition was actually attempted
    expect(transitionThrowCount).toBeGreaterThan(0);
  });

  it('TEST 10.2: handoff with --source-ref + pr-skipped outcome + ledger.transition throws → exit 0, stderr contains error', async () => {
    const sourceRef = 'o/b#100';
    const realLedger = createLedger(join(engineerDir, 'ledger.json'));

    // Seed ledger entry with status 'claimed'
    await realLedger.record({ source: 'github-issues', sourceRef });
    await realLedger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh runner throws with no-remote error (triggers pr-skipped)
    const gh = async () => {
      throw new Error('git: error: No remote configured.');
    };

    const { out, err, opts } = captureOpts({
      gh: gh as any,
      ensureRunningLaunch: async () => {},
    });

    // Mock createLedger to return a ledger that throws on transition
    const ledgerModule = await import('../../../src/engine/engineer/intake/ledger.js');
    let transitionThrowCount = 0;
    vi.spyOn(ledgerModule, 'createLedger').mockImplementation((path: string) => {
      return {
        async known() { return false; },
        async record() {},
        async transition() {
          transitionThrowCount++;
          throw new Error('Ledger write failed: permission denied');
        },
        async get() {
          return { source: 'github-issues', sourceRef, status: 'claimed', attempts: 0 };
        },
        async forget() {},
        async list() { return []; },
        async reopen() {},
        async requeueClaimed() { return { acted: false }; },
      };
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    vi.restoreAllMocks();

    // Assert: exit 0
    expect(code).toBe(0);

    // Assert: stdout has kind 'local-commit' (pr-skipped surfaces as local-commit)
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('local-commit');

    // Assert: stderr contains the ledger error message
    const stderrText = err.join('\n');
    expect(stderrText).toMatch(/Failed to record branch evidence.*permission denied/i);

    // Assert: transition was attempted
    expect(transitionThrowCount).toBeGreaterThan(0);
  });

  it('TEST 10.3: handoff pr-opened path → entry transitions to done with prUrl+branch (reportDone regression)', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/e#200';
    const PR_URL = 'https://github.com/o/e/pull/999';
    await writeRemoteRegistry();

    // Seed ledger entry
    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh succeeds with a PR URL
    const gh = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'create') {
        return { stdout: `Opening pull request...\n${PR_URL}\n` };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        return { stdout: '' };
      }
      return { stdout: JSON.stringify({}) };
    };

    const { out, opts } = captureOpts({
      gh: gh as any,
      git: noOpGit,
      handoffPublication: authorizedPublication(gh as any, branch, 'o/e', 999),
      intakeResolveActor: async () => ({ resolved: true, id: 'test-owner' }),
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    // Assert: exit 0
    expect(code).toBe(0);

    // Assert: stdout has kind 'pr-opened' with URL
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('pr-opened');
    expect(result.url).toBe(PR_URL);

    // Assert: ledger entry is now 'done' with prUrl and branch (reportDone result)
    const afterHandoff = await ledger.get('github-issues', sourceRef);
    expect(afterHandoff?.status).toBe('done');
    expect(afterHandoff?.prUrl).toBe(PR_URL);
    expect(afterHandoff?.branch).toBe(branch);
  });

  it('TEST 10.4: handoff pr-opened with gh failure during reportDone → exit 0, stderr, entry marked done anyway', async () => {
    const ledger = createLedger(join(engineerDir, 'ledger.json'));
    const sourceRef = 'o/f#250';
    const PR_URL = 'https://github.com/o/f/pull/888';
    await writeRemoteRegistry();

    // Seed ledger entry
    await ledger.record({ source: 'github-issues', sourceRef });
    await ledger.transition('github-issues', sourceRef, 'claimed', {});

    const worktree = await seedWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);

    // gh succeeds for openSpecPr but fails for reportDone (pr comment/label)
    let callCount = 0;
    const gh = async (args: string[]) => {
      callCount++;
      if (args[0] === 'pr' && args[1] === 'create') {
        // openSpecPr succeeds and returns PR URL
        return { stdout: `Opening pull request...\n${PR_URL}\n` };
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        // reportDone tries to comment — fails
        throw new Error('gh: failed to comment on PR (403 Forbidden)');
      }
      if (args[0] === 'issue' && args[1] === 'edit') {
        // reportDone tries to add label — fails
        throw new Error('gh: failed to update labels (403 Forbidden)');
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        return { stdout: '' };
      }
      return { stdout: JSON.stringify({}) };
    };

    const { out, err, opts } = captureOpts({
      gh: gh as any,
      git: noOpGit,
      handoffPublication: authorizedPublication(gh as any, branch, 'o/f', 888),
      intakeResolveActor: async () => ({ resolved: true, id: 'test-owner' }),
      ensureRunningLaunch: async () => {},
    });

    const code = await dispatchEngineer(
      {
        kind: 'handoff',
        project: 'test-proj',
        branch,
        worktree,
        sourceRef,
      },
      opts,
    );

    // Assert: exit 0 (handoff succeeds, PR is opened regardless of reportDone gh failure)
    expect(code).toBe(0);

    // Assert: stdout has kind 'pr-opened' with URL
    const result = JSON.parse(out[0]);
    expect(result.kind).toBe('pr-opened');
    expect(result.url).toBe(PR_URL);

    // Assert: stderr may show the gh failures from reportDone (advisory)
    // But the key is: even though reportDone gh fails, the ledger is still updated to done
    // (because reportDone itself doesn't throw, it swallows errors internally)
    const stderrText = err.join('\n');
    // Note: reportDone swallows the errors, so we may or may not see them in stderr
    // The important thing is we don't fail the handoff

    // Assert: ledger entry is marked done with prUrl (reportDone succeeds at ledger level
    // even if gh fails)
    const afterHandoff = await ledger.get('github-issues', sourceRef);
    expect(afterHandoff?.status).toBe('done');
    expect(afterHandoff?.prUrl).toBe(PR_URL);
    expect(afterHandoff?.branch).toBe(branch);
  });
});

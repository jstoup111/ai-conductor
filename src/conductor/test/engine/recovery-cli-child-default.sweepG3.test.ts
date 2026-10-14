// Covers: task:29, task:rem-prd-audit-rem-5
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChildId } from '../../src/engine/child-context.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { repairMarkerRefFor, routeRecordRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

// Record every git invocation made through the production git runner, and every
// restack entry-function call, without changing their behavior.
const recorded = vi.hoisted(() => ({ git: [] as string[][], restack: [] as string[] }));

vi.mock('../../src/engine/rebase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/rebase.js')>();
  return {
    ...actual,
    makeGitRunner: (cwd: string) => {
      const run = actual.makeGitRunner(cwd);
      return (args: string[], opts?: Parameters<typeof run>[1]) => {
        recorded.git.push([...args]);
        return run(args, opts);
      };
    },
  };
});
vi.mock('../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-executor.js')>();
  return { ...actual, runRestack: (...args: Parameters<typeof actual.runRestack>) => {
    recorded.restack.push('runRestack');
    return actual.runRestack(...args);
  } };
});
vi.mock('../../src/engine/restack/restack-recovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-recovery.js')>();
  return { ...actual, recoverRestackJournal: (...args: Parameters<typeof actual.recoverRestackJournal>) => {
    recorded.restack.push('recoverRestackJournal');
    return actual.recoverRestackJournal(...args);
  } };
});
vi.mock('../../src/engine/restack/stack-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/stack-preflight.js')>();
  return { ...actual, runStackPreflight: (...args: Parameters<typeof actual.runStackPreflight>) => {
    recorded.restack.push('runStackPreflight');
    return actual.runStackPreflight(...args);
  } };
});
vi.mock('../../src/engine/restack/restack-journal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-journal.js')>();
  return { ...actual, createRestackJournal: (...args: Parameters<typeof actual.createRestackJournal>) => {
    recorded.restack.push('createRestackJournal');
    return actual.createRestackJournal(...args);
  } };
});

const execFile = promisify(execFileCallback);
const roots: string[] = [];

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8').then(() => undefined),
  rename,
};

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

const authorizedGate = {
  count: 1, cumulative: 5, treeHash: null, lastReason: 'cap', priorVerdict: false, resolvedBefore: 0,
  capEvidence: { gate: 'build_review', consumed: 5, limit: 5, latestReason: 'cap', haltGeneration: 'g1' },
  resumeAuthorization: { adjustmentId: 'a1', haltGeneration: 'g1', consumed: false },
};

/** Two-child stack whose closed child 1 has operator commit X past its closure. */
async function repairPendingFixture(withRepair = true): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'recovery-cli-sweep-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'recovery@example.test']);
  await git(root, ['config', 'user.name', 'Recovery CLI sweep']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-qm', 'base']);
  await git(root, ['branch', 'feat/daemon-feature']);
  const worktree = join(root, '.worktrees', 'feature');
  await git(root, ['worktree', 'add', '-q', worktree, 'feat/daemon-feature']);
  await git(worktree, ['branch', 'feat/c1/feature', 'feat/daemon-feature']);
  const closure = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
  await git(worktree, ['update-ref', 'refs/conductor/feature/closed/c1', closure]);
  if (withRepair) {
    await git(worktree, ['checkout', '-q', 'feat/c1/feature']);
    await writeFile(join(worktree, 'operator-change.txt'), 'X\n');
    await git(worktree, ['add', 'operator-change.txt']);
    await git(worktree, ['commit', '-qm', 'operator change X']);
    await git(worktree, ['checkout', '-q', 'feat/daemon-feature']);
  }
  await mkdir(join(worktree, '.ai-conductor'), { recursive: true });
  await writeFile(join(worktree, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n');
  await writeCoverageBindingEnvelope(worktree, {
    version: 1,
    slug: 'feature',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { T1: 1, T3: 2 }, titles: ['First', 'Second'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  const childState = {
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
  };
  await Promise.all([1, 2].map(async (child) => {
    const path = join(worktree, '.pipeline', 'children', String(child));
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'conduct-state.json'), `${JSON.stringify(childState)}\n`);
  }));
  await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), `${JSON.stringify({ last_step: 'build_review' })}\n`);
  await writeFile(join(worktree, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
    { id: 'T1', status: 'pending' }, { id: 'T3', status: 'pending' },
  ] }));
  await writeFile(join(worktree, '.pipeline', 'children', '2', 'kickback-ledger.json'),
    JSON.stringify({ version: 1, gates: { build_review: authorizedGate } }));
  return { root, worktree };
}

afterEach(async () => {
  recorded.git.length = 0;
  recorded.restack.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const REF_WRITING_GIT = new Set(['update-ref', 'hash-object', 'mktree', 'commit-tree', 'commit', 'symbolic-ref']);

function refWritingCalls(calls: readonly string[][]): string[][] {
  return calls.filter((args) => {
    if (args[0] === 'symbolic-ref') return args.length > 2 && !args.includes('-q');
    if (args[0] === 'hash-object') return args.includes('-w');
    return REF_WRITING_GIT.has(args[0]!);
  });
}

describe('read-only CLI resolutions while stack repair is pending (sweep)', () => {
  // Covers: task:29
  it('refuses un-overlaid repair-pending state without a ref write, journal write, restack entry or restack event', async () => {
    // Test setup imports part of the engine graph; reload it so every consumer
    // binds the recording git runner and restack spies rather than cached originals.
    vi.resetModules();
    const { consumeResumeAuthorizations } = await import('../../src/engine/daemon-rekick.js');
    const { dispatchKickbackBudgetCommand } = await import('../../src/engine/kickback-budget-cli.js');
    const { dispatchRewindCommand } = await import('../../src/engine/rewind.js');
    const { detectTaskCommand, dispatchTaskCommand } = await import('../../src/engine/task-cli.js');
    const { root, worktree } = await repairPendingFixture();
    const refsBefore = await git(worktree, ['for-each-ref', '--format=%(refname) %(objectname)']);
    recorded.git.length = 0;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // consumeResumeAuthorizations: real cursor through the recorded git runner.
      const clearHalt = vi.fn(async () => 'confirmed' as const);
      await expect(consumeResumeAuthorizations({
        listHaltedWorktrees: async () => ['feature'],
        worktreePath: () => worktree,
        isOperatorParked: async () => false,
        readLiveHaltClass: async () => 'needs-human',
        readLiveHaltGeneration: async () => 'g1',
        clearHalt,
      } as never)).resolves.toEqual([]);
      expect(clearHalt).not.toHaveBeenCalled();
      expect((await readKickbackLedger(worktree, 2 as ChildId)).gates.build_review?.resumeAuthorization?.consumed).toBe(false);

      // kickback-budget inspect with default-child resolution.
      const output: string[] = [];
      await expect(dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' },
        { cwd: root, resolveMainRoot: async () => root, print: (line) => output.push(line) },
      )).resolves.toBe(0);
      expect(JSON.parse(output.join('\n'))).toMatchObject({ feature: 'feature' });
      expect(JSON.parse(output.join('\n')).child).toBeUndefined();

      // An un-overlaid repair-pending cursor remains refused for task commands.
      const taskStatusBefore = await readFile(join(worktree, '.pipeline', 'task-status.json'), 'utf8');
      await expect(dispatchTaskCommand(detectTaskCommand(['node', 'conduct', 'task', 'start', 'T1'])!, worktree)).resolves.toBe(1);
      expect(errors).toHaveBeenCalledWith('[task-cli] active child resolution refused (repair-pending)');
      await expect(readFile(join(worktree, '.pipeline', 'task-status.json'), 'utf8')).resolves.toBe(taskStatusBefore);

      // rewind refusal for the closed child.
      const childOneBefore = await readFile(join(worktree, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8');
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build', child: '1' }, worktree)).resolves.toBe(1);
      expect(errors).toHaveBeenCalledWith('rewind: child 1 is closed and cannot be rewound (#3203)');
      await expect(readFile(join(worktree, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8')).resolves.toBe(childOneBefore);
    } finally {
      errors.mockRestore();
    }

    // The production git runner was exercised (the cursor ran through it) and wrote nothing.
    expect(recorded.git.some((args) => args[0] === 'rev-list')).toBe(true);
    expect(refWritingCalls(recorded.git)).toEqual([]);
    expect(recorded.git.filter((args) => args.some((arg) => arg.includes('restack/journal')))).toEqual([]);
    await expect(git(worktree, ['for-each-ref', '--format=%(refname) %(objectname)'])).resolves.toBe(refsBefore);
    expect(recorded.restack).toEqual([]);
    const events = await readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8').catch(() => '');
    expect(events.split('\n').filter((line) => line.includes('"type":"restack_'))).toEqual([]);
  });

  it('reports the routed host membership plus its active round tasks, and otherwise reports the cursor child rows', async () => {
    vi.resetModules();
    const { detectTaskCommand, dispatchTaskCommand } = await import('../../src/engine/task-cli.js');
    const { worktree } = await repairPendingFixture();
    const routeRound = parseRoundId('r1')!;
    await writeFile(join(worktree, '.ai-conductor', 'config.yml'),
      'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
    const writeRef = async (ref: string, value: unknown) => {
      const blob = (await execa('git', ['hash-object', '-w', '--stdin'], { cwd: worktree, input: JSON.stringify(value) })).stdout.trim();
      await git(worktree, ['update-ref', ref, blob]);
    };
    await writeRef(repairMarkerRefFor('feature'), { host: 1, roundId: routeRound });
    await writeRef(routeRecordRefFor('feature', routeRound), {
      roundId: routeRound, kind: 'audit', phase: 'open', items: [],
      allocation: { 1: { remTaskIds: ['rem-r1'], blockBodies: ['### Task rem-r1\n'] } },
      hosts: { 1: 'repairing' }, currentHostIndex: 0, receipt: {}, outbox: [],
    });
    await writeFile(join(worktree, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: 'T1', status: 'pending' }, { id: 'T3', status: 'pending' }, { id: 'rem-r1', status: 'in_progress' },
    ] }));

    const output: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line) => { output.push(String(line)); });
    try {
      await expect(dispatchTaskCommand(detectTaskCommand(['node', 'conduct', 'task', 'status'])!, worktree)).resolves.toBe(0);
      expect(JSON.parse(output.join('\n')).map((row: { id: string }) => row.id)).toEqual(['T1', 'rem-r1']);
    } finally {
      log.mockRestore();
    }

    const cursorFixture = await repairPendingFixture(false);
    const cursorOutput: string[] = [];
    const cursorLog = vi.spyOn(console, 'log').mockImplementation((line) => { cursorOutput.push(String(line)); });
    try {
      await expect(dispatchTaskCommand(detectTaskCommand(['node', 'conduct', 'task', 'status'])!, cursorFixture.worktree)).resolves.toBe(0);
      expect(JSON.parse(cursorOutput.join('\n')).map((row: { id: string }) => row.id)).toEqual(['T3']);
    } finally {
      cursorLog.mockRestore();
    }
  });
});

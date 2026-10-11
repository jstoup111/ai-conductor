// Covers: task:31.2
import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { createProgram, type KickbackBudgetDispatch } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { appendCloseoutEvent } from '../../src/engine/closeout-events.js';
import { writeCoverageBindingEnvelope } from '../../src/engine/coverage-binding-envelope.js';
import {
  clearHaltForResume,
  clearMarker,
  consumeResumeAuthorizations,
  listHaltedWorktrees,
  readKickbackHaltGeneration,
  readRawHaltClass,
} from '../../src/engine/daemon-rekick.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import { supersedeHaltRecord } from '../../src/engine/halt-record.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { isOperatorParked } from '../../src/engine/park-marker.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { cascadesRefFor, readCascadeCounts } from '../../src/engine/restack/cascade-cap.js';
import { runRestack } from '../../src/engine/restack/restack-executor.js';
import { runStackPreflight } from '../../src/engine/restack/stack-preflight.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function child(value: number) {
  const parsed = parseChildId(value);
  if (parsed === undefined) throw new Error('invalid child fixture');
  return parsed;
}

async function sealEnvelope(repo: string, runId: string) {
  await writeCoverageBindingEnvelope(repo, {
    version: 1,
    slug: 'demo',
    runId,
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
}

/**
 * Two-child stack (child 1, leaf child 2) whose child 1 carries an operator
 * commit past `closed/c1`, so the cursor is `repair-pending`. Child 1 has
 * already been charged 3 cascades (the default cap); child 2 has its own
 * unrelated entry so cross-child isolation is observable.
 */
async function stackFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kickback-budget-restack-sweep-'));
  roots.push(root);
  const repo = join(root, '.worktrees', 'demo');
  const childWorktree = join(root, '.worktrees', 'c1');
  const git = async (args: string[], cwd = root) => (await execFile('git', args, { cwd })).stdout.trim();
  const commit = async (message: string, path: string) => {
    await writeFile(join(childWorktree, path), `${message}\n`);
    await git(['add', path], childWorktree);
    await git(['commit', '-qm', message], childWorktree);
    return git(['rev-parse', 'HEAD'], childWorktree);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'cascade@example.test']);
  await git(['config', 'user.name', 'Cascade cap']);
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt', '.gitignore']);
  await git(['commit', '-qm', 'base']);
  await git(['worktree', 'add', '-qb', 'feat/c1/demo', childWorktree, 'main']);
  const closed = await commit('closed child', 'child.txt');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  const operatorCommit = await commit('repair child', 'repair.txt');
  await git(['branch', 'feat/daemon-demo', closed]);
  await git(['worktree', 'add', '-q', repo, 'feat/daemon-demo']);
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await sealEnvelope(repo, 'run-1');
  const blob = (await makeGitRunner(repo)(
    ['hash-object', '-w', '--stdin'],
    { input: JSON.stringify({ version: 1, counts: { 1: 3, 2: 3 } }) },
  )).stdout.trim();
  await git(['update-ref', cascadesRefFor('demo'), blob]);
  return { root, repo, git, commit, closed, operatorCommit };
}

type Subject = Awaited<ReturnType<typeof stackFixture>>;

async function haltAtCascadeCap(subject: Subject) {
  await expect(runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'feature-repair',
    git: makeGitRunner(subject.repo),
  })).resolves.toEqual({ kind: 'halted' });
  await expect(access(join(subject.repo, HALT_MARKER))).resolves.toBeUndefined();
}

function runCli(
  subject: Subject,
  command: Omit<KickbackBudgetDispatch, 'kind' | 'feature' | 'format'>,
  appendEvent?: typeof appendCloseoutEvent,
) {
  return dispatchKickbackBudgetCommand(
    { kind: 'kickback-budget', feature: 'demo', format: 'human', ...command },
    {
      cwd: subject.root,
      resolveMainRoot: async () => subject.root,
      isInteractive: () => true,
      resolveOperator: () => 'operator',
      print: () => {},
      ...(appendEvent === undefined ? {} : { appendEvent }),
    },
  );
}

const raise = (by = 2, target = '1') =>
  ({ action: 'raise' as const, gate: 'restack', child: target, by, rationale: 'repair the stopped cascade' });
const reset = (target = '1') =>
  ({ action: 'reset' as const, gate: 'restack', child: target, rationale: 'restart the stopped cascade' });

/** The daemon's pre-dispatch maintenance boundary, wired as daemon-cli.ts wires it. */
function daemonConsumeAuthorizations(subject: Subject) {
  const worktreeBase = join(subject.root, '.worktrees');
  return consumeResumeAuthorizations({
    listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
    worktreePath: (slug) => join(worktreeBase, slug),
    isOperatorParked: (slug) => isOperatorParked(subject.root, slug),
    readLiveHaltClass: (slug) => readRawHaltClass(join(worktreeBase, slug)),
    readLiveHaltGeneration: (slug) => readKickbackHaltGeneration(join(worktreeBase, slug)),
    clearHalt: (slug) => clearHaltForResume({
      worktreePath: join(worktreeBase, slug),
      slug,
      clearMarker,
      resolveCommittedRecord: (worktreePath, feature) => supersedeHaltRecord(worktreePath, feature, 'kickback-budget'),
    }),
  });
}

/** The stack preflight with the dispatch/resume entry points' prepareResume wiring. */
function entryPreflight(subject: Subject) {
  return runStackPreflight({
    worktree: subject.repo,
    slug: 'demo',
    git: makeGitRunner(subject.repo),
    prepareResume: async () => {
      if (await access(join(subject.repo, HALT_MARKER)).then(() => true).catch(() => false)) return;
      await supersedeHaltRecord(subject.repo, 'demo', 'stack-preflight');
    },
  });
}

async function cascades(subject: Subject) {
  const state = await readCascadeCounts(subject.repo, 'demo');
  if (state.kind !== 'counts') throw new Error('unreadable cascades');
  return state.counts;
}

const cascadesSha = (subject: Subject) => subject.git(['rev-parse', cascadesRefFor('demo')]);

async function restackEntry(subject: Subject) {
  const ledger = await readKickbackLedger(subject.repo, child(2));
  if (!('gates' in ledger)) throw new Error('unreadable ledger');
  return ledger.gates.restack;
}

async function expectRepaired(subject: Subject) {
  expect(await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).toBe(subject.operatorCommit);
  expect(await subject.git(['show', 'feat/daemon-demo:repair.txt'])).toBe('repair child');
  await expect(access(join(subject.repo, HALT_MARKER))).rejects.toThrow();
  expect(await readFile(join(subject.repo, '.docs', 'halted', 'demo.md'), 'utf8')).toMatch(/^Status: resolved$/m);
  expect((await restackEntry(subject))?.resumeAuthorization?.consumed).toBe(true);
}

describe('kickback-budget --gate restack end to end (sweep G4)', () => {
  it('raise at a cascade-cap halt lets the next dispatch preflight repair, reset lets the next resume repair, and no authorization leaves the halt untouched', async () => {
    // raise → next daemon dispatch
    const raised = await stackFixture();
    await haltAtCascadeCap(raised);
    expect(await runCli(raised, raise())).toBe(0);
    expect(await cascades(raised)).toMatchObject({ counts: { 1: 3 }, limits: { 1: 5 } });
    expect(await daemonConsumeAuthorizations(raised)).toEqual(['demo']);
    await expect(entryPreflight(raised)).resolves.toEqual({ kind: 'repaired' });
    await expectRepaired(raised);

    // reset → next resume
    const resetSubject = await stackFixture();
    await haltAtCascadeCap(resetSubject);
    expect(await runCli(resetSubject, reset())).toBe(0);
    expect((await cascades(resetSubject)).counts['1']).toBe(0);
    expect(await daemonConsumeAuthorizations(resetSubject)).toEqual(['demo']);
    await expect(entryPreflight(resetSubject)).resolves.toEqual({ kind: 'repaired' });
    await expectRepaired(resetSubject);

    // cap evidence, no authorization → no restack, no second halt, generation unchanged
    const unauthorized = await stackFixture();
    await haltAtCascadeCap(unauthorized);
    const generation = (await restackEntry(unauthorized))?.capEvidence?.haltGeneration;
    const halt = await readFile(join(unauthorized.repo, HALT_MARKER), 'utf8');
    const leaf = await unauthorized.git(['rev-parse', 'feat/daemon-demo']);
    expect(generation).toBeTruthy();
    expect(await daemonConsumeAuthorizations(unauthorized)).toEqual([]);
    await expect(entryPreflight(unauthorized)).resolves.toEqual({ kind: 'halted' });
    expect(await unauthorized.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).toBe(unauthorized.closed);
    expect(await unauthorized.git(['rev-parse', 'feat/daemon-demo'])).toBe(leaf);
    expect(await readFile(join(unauthorized.repo, HALT_MARKER), 'utf8')).toBe(halt);
    expect((await restackEntry(unauthorized))?.capEvidence?.haltGeneration).toBe(generation);
    await expect(unauthorized.git(['show-ref', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toThrow();
  });

  it('refuses restack adjustments without a cap halt or for a non-originating child and adjusts only the selected child entry', async () => {
    // No live cascade-cap halt and no restack cap evidence.
    const bare = await stackFixture();
    const bareRef = await cascadesSha(bare);
    expect(await runCli(bare, reset())).not.toBe(0);
    expect(await cascadesSha(bare)).toBe(bareRef);

    const subject = await stackFixture();
    await haltAtCascadeCap(subject);
    const haltedRef = await cascadesSha(subject);
    // Evidence names child 1; --child 2 is refused.
    expect(await runCli(subject, raise(2, '2'))).not.toBe(0);
    expect(await cascadesSha(subject)).toBe(haltedRef);

    // raise keeps child 1's count and leaves child 2's entry alone.
    expect(await runCli(subject, raise())).toBe(0);
    expect(await cascades(subject)).toMatchObject({ counts: { 1: 3, 2: 3 }, limits: { 1: 5 } });
    expect((await cascades(subject)).limits?.['2']).toBeUndefined();

    // Spend the raised allowance through real repairs until the cap halts again.
    expect(await daemonConsumeAuthorizations(subject)).toEqual(['demo']);
    await expect(entryPreflight(subject)).resolves.toEqual({ kind: 'repaired' });
    await subject.commit('second operator change', 'second.txt');
    await expect(entryPreflight(subject)).resolves.toEqual({ kind: 'repaired' });
    expect(await cascades(subject)).toMatchObject({ counts: { 1: 5, 2: 3 }, limits: { 1: 5 } });
    await subject.commit('third operator change', 'third.txt');
    await expect(entryPreflight(subject)).resolves.toEqual({ kind: 'halted' });
    await expect(access(join(subject.repo, HALT_MARKER))).resolves.toBeUndefined();

    // reset after the raise zeroes child 1's count and keeps the raised limit.
    expect(await runCli(subject, reset())).toBe(0);
    expect(await cascades(subject)).toMatchObject({ counts: { 1: 0, 2: 3 }, limits: { 1: 5 } });
    expect((await cascades(subject)).limits?.['2']).toBeUndefined();
  });

  it('accepts a restack raise in a recreated worktree without child 1 state and lists restack in the kickback-budget usage text', async () => {
    const subject = await stackFixture();
    await haltAtCascadeCap(subject);
    const ledgerPath = join(subject.repo, '.pipeline', 'children', '2', 'kickback-ledger.json');
    const ledger = await readFile(ledgerPath);
    const halt = await readFile(join(subject.repo, HALT_MARKER));
    const haltClass = await readFile(join(subject.repo, '.pipeline', 'HALT.class'));
    await subject.git(['worktree', 'remove', '--force', subject.repo]);
    await subject.git(['worktree', 'add', '-q', subject.repo, 'feat/daemon-demo']);
    await sealEnvelope(subject.repo, 'run-2');
    await mkdir(join(subject.repo, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(ledgerPath, ledger);
    await writeFile(join(subject.repo, HALT_MARKER), halt);
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), haltClass);
    await expect(access(join(subject.repo, '.pipeline', 'children', '1'))).rejects.toThrow();

    expect(await runCli(subject, raise())).toBe(0);
    expect(await cascades(subject)).toMatchObject({ counts: { 1: 3 }, limits: { 1: 5 } });

    const usage = createProgram().commands.find((command) => command.name() === 'kickback-budget')?.helpInformation() ?? '';
    expect(usage).toMatch(/--gate <gate>.*\brestack\b/s);
  });

  it('fails a restack raise whose cascades compare-and-swap loses to a concurrent write and keeps that write', async () => {
    const subject = await stackFixture();
    await haltAtCascadeCap(subject);
    let concurrent = '';
    const racingAppend: typeof appendCloseoutEvent = (worktree, event) => {
      appendCloseoutEvent(worktree, event);
      // Another process charges child 1 after staging, before the CLI's CAS.
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: subject.repo, input: JSON.stringify({ version: 1, counts: { 1: 4, 2: 3 } }),
      }).toString().trim();
      execFileSync('git', ['update-ref', cascadesRefFor('demo'), blob], { cwd: subject.repo });
      concurrent = blob;
    };

    expect(await runCli(subject, raise(), racingAppend)).not.toBe(0);
    expect(concurrent).not.toBe('');
    expect(await cascadesSha(subject)).toBe(concurrent);
    expect(await cascades(subject)).toEqual({ version: 1, counts: { 1: 4, 2: 3 } });
    expect((await restackEntry(subject))?.resumeAuthorization).toBeUndefined();
  });

  it('reconciles a restack raise that crashed between its authorization event and the cascades CAS exactly once on re-run', async () => {
    const subject = await stackFixture();
    await haltAtCascadeCap(subject);
    const before = await cascadesSha(subject);
    const crashingAppend: typeof appendCloseoutEvent = (worktree, event) => {
      appendCloseoutEvent(worktree, event);
      throw new Error('simulated crash after the authorization event');
    };

    expect(await runCli(subject, raise(), crashingAppend)).not.toBe(0);
    expect(await cascadesSha(subject)).toBe(before);
    const crashed = await restackEntry(subject);
    expect(crashed?.resumeAuthorization).toBeUndefined();
    const pendingId = crashed?.pendingAdjustment?.id;
    expect(pendingId).toBeTruthy();

    // Re-run the command: the pending adjustment is reconciled by its id.
    await runCli(subject, raise());
    const state = await cascades(subject);
    expect(state.limits?.['1']).toBe(5);
    expect(Object.keys(state.adjustments ?? {})).toEqual([pendingId]);
    const entry = await restackEntry(subject);
    expect(entry?.pendingAdjustment).toBeUndefined();
    expect(entry?.adjustments?.filter((adjustment) => adjustment.id === pendingId)).toHaveLength(1);
    expect(entry?.resumeAuthorization).toMatchObject({ adjustmentId: pendingId, consumed: false });

    // A further re-run never re-applies the reconciled adjustment.
    await runCli(subject, raise());
    expect(Object.keys((await cascades(subject)).adjustments ?? {})).toEqual([pendingId]);
    expect((await cascades(subject)).limits?.['1']).toBe(5);
  });
});

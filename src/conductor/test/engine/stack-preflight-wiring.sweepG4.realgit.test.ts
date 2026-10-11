// Covers: task:31
//
// Drives a REAL `Conductor.run()` with `resume: true` against a throwaway local
// Git stack (closed children 1 and 2, the active leaf `feat/daemon-demo`).  The
// restack phases, the child cursor and `classifyRebaseOperation` are
// pass-through spies that record their order and what they observed.  The
// classification spy then reports an integrity fault so the resumed run stops
// at the rebase fence with a sentinel HALT instead of driving the pipeline.
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
  trace: [] as string[],
  worktree: '',
  /** When set, the next `applying` rebase record write is the last act of a crashed process. */
  crashAfterApplyingRecord: undefined as undefined | (() => void),
  classifications: [] as Array<{ kind: string; journalPresent: boolean; haltPresent: boolean }>,
  cursorJournalPresent: [] as boolean[],
}));

async function journalPresent(): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/journal'], { cwd: probe.worktree }, (error) => resolve(!error));
  });
}

vi.mock('../../src/engine/restack/restack-recovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-recovery.js')>();
  return {
    ...actual,
    recoverRestackJournal: vi.fn(async (...args: Parameters<typeof actual.recoverRestackJournal>) => {
      const result = await actual.recoverRestackJournal(...args);
      probe.trace.push(`recovery:${result.kind}`);
      return result;
    }),
  };
});
vi.mock('../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-executor.js')>();
  return {
    ...actual,
    runRestack: vi.fn(async (...args: Parameters<typeof actual.runRestack>) => {
      probe.trace.push(`restack:${args[0].cause}`);
      return actual.runRestack(...args);
    }),
  };
});
vi.mock('../../src/engine/halt-record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/halt-record.js')>();
  return {
    ...actual,
    supersedeHaltRecord: vi.fn(async (...args: Parameters<typeof actual.supersedeHaltRecord>) => {
      probe.trace.push(`supersede:${args[2]}`);
      return actual.supersedeHaltRecord(args[0], args[1], args[2], {
        gh: async () => { throw new Error('no GitHub in this test'); },
      });
    }),
  };
});
vi.mock('../../src/engine/child-cursor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/child-cursor.js')>();
  return {
    ...actual,
    resolveActiveChild: vi.fn(async (...args: Parameters<typeof actual.resolveActiveChild>) => {
      const result = await actual.resolveActiveChild(...args);
      probe.trace.push(`cursor:${result.kind}`);
      probe.cursorJournalPresent.push(await journalPresent());
      return result;
    }),
  };
});
vi.mock('../../src/engine/gate-code-validity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/gate-code-validity.js')>();
  return {
    ...actual,
    classifyRebaseOperation: vi.fn(async (...args: Parameters<typeof actual.classifyRebaseOperation>) => {
      const result = await actual.classifyRebaseOperation(...args);
      probe.trace.push(`classify:${result.kind}`);
      probe.classifications.push({
        kind: result.kind,
        journalPresent: await journalPresent(),
        haltPresent: existsSync(join(probe.worktree, '.pipeline', 'HALT')),
      });
      // Stop the resumed run at the rebase fence: the pipeline beyond it is
      // not under test.
      return { kind: 'integrity-fault', reason: 'malformed-record' } as const;
    }),
  };
});
vi.mock('../../src/engine/gate-verdicts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/gate-verdicts.js')>();
  return {
    ...actual,
    writeVerdict: vi.fn(async (...args: Parameters<typeof actual.writeVerdict>) => {
      await actual.writeVerdict(...args);
      const crash = probe.crashAfterApplyingRecord;
      if (crash && args[1] === 'rebase' && args[2].rebaseOperation?.status === 'applying') {
        probe.crashAfterApplyingRecord = undefined;
        crash();
        // The process dies here: this frame never settles.
        await new Promise<never>(() => {});
      }
    }),
  };
});

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob } from '../../src/engine/restack/restack-journal.js';
import { runStackPreflight } from '../../src/engine/restack/stack-preflight.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

beforeEach(() => {
  probe.trace = [];
  probe.classifications = [];
  probe.cursorJournalPresent = [];
  probe.crashAfterApplyingRecord = undefined;
});

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function stack() {
  const root = await mkdtemp(join(tmpdir(), 'stack-preflight-resume-'));
  repositories.push(root);
  const primary = join(root, 'primary');
  const repo = join(root, 'demo');
  await mkdir(primary);
  let cwd = primary;
  const git = async (...args: string[]) => (await execFile('git', args, { cwd })).stdout.trim();
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), value);
    await git('add', path);
    await git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'resume@example.test');
  await git('config', 'user.name', 'Stack resume');
  await writeFile(join(primary, '.gitignore'), '.pipeline/\n.ai-conductor/\n');
  await git('add', '.gitignore');
  await commit('base', 'src/base.ts', 'export const base = 1;\n');
  await git('checkout', '-qb', 'feat/c1/demo');
  const c1 = await commit('closed one', 'src/one.ts', 'export const one = 1;\n');
  await git('update-ref', 'refs/conductor/demo/closed/c1', c1);
  await git('checkout', '-qb', 'feat/c2/demo');
  const c2 = await commit('closed two', 'src/two.ts', 'export const two = 2;\n');
  await git('update-ref', 'refs/conductor/demo/closed/c2', c2);
  await git('checkout', '-qb', 'feat/daemon-demo');
  await commit('leaf', 'src/leaf.ts', 'export const leaf = 3;\n');
  // The operator's commit X on child 1, past its closure.
  await git('checkout', '-q', 'feat/c1/demo');
  const x = await commit('operator change', 'operator.txt', 'X\n');
  await git('checkout', '-q', 'main');
  await git('worktree', 'add', '-q', repo, 'feat/daemon-demo');
  cwd = repo;
  probe.worktree = repo;
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  const statePath = join(repo, '.pipeline', 'conduct-state.json');
  const state: ConductState = { feature_desc: 'demo' };
  for (const step of ALL_STEPS) {
    if (step.name === 'rebase') break;
    (state as Record<string, unknown>)[step.name] = 'done';
  }
  await writeState(statePath, state);
  return { repo, git, statePath, c1, c2, x };
}

function recordEvents(events: ConductorEventEmitter, types: readonly ConductorEvent['type'][]): ConductorEvent[] {
  const seen: ConductorEvent[] = [];
  for (const type of types) events.on(type, (event) => { seen.push(event); });
  return seen;
}

async function resume(subject: Awaited<ReturnType<typeof stack>>, events: ConductorEventEmitter) {
  const runner: StepRunner = { run: vi.fn<StepRunner['run']>().mockResolvedValue({ success: true }) };
  const conductor = new Conductor({
    stateFilePath: subject.statePath,
    stepRunner: runner,
    events,
    projectRoot: subject.repo,
    mode: 'auto',
    resume: true,
  });
  await conductor.run();
  return runner;
}

async function haltBody(repo: string): Promise<string> {
  return readFile(join(repo, '.pipeline', 'HALT'), 'utf8').catch(() => '');
}

describe('stack preflight through a real conductor resume', () => {
  // Covers: S9.1, task:31
  it('conductor resume repairs an appended closed child inside the preflight, in phase order, before the cursor and classifyRebaseOperation, with no halt', async () => {
    const subject = await stack();
    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, ['restack_applied', 'restack_refused']);

    const runner = await resume(subject, events);

    // Preflight: recovery, supersede, recovery re-check, its own cursor read,
    // the repair; then the conductor's cursor, then the rebase fence.
    expect(probe.trace.slice(0, 5)).toEqual([
      'recovery:none',
      'supersede:stack-preflight',
      'recovery:none',
      'cursor:repair-pending',
      'restack:feature-repair',
    ]);
    const firstConductorCursor = probe.trace.indexOf('cursor:active', 5);
    const classify = probe.trace.findIndex((entry) => entry.startsWith('classify:'));
    expect(firstConductorCursor).toBeGreaterThan(4);
    expect(classify).toBeGreaterThan(firstConductorCursor);
    // No halt was written by the preflight or the cursor: the only HALT is
    // this test's sentinel stop at the fence.
    expect(probe.classifications[0]).toMatchObject({ haltPresent: false });
    expect(await haltBody(subject.repo)).toContain('rebase transition record is malformed');
    expect(seen.filter((event) => event.type === 'restack_refused')).toEqual([]);
    expect(seen.filter((event) => event.type === 'restack_applied').length).toBeGreaterThan(0);
    expect(await subject.git('rev-parse', 'refs/conductor/demo/closed/c1')).toBe(subject.x);
    expect(await subject.git('show', 'feat/c2/demo:operator.txt')).toBe('X');
    expect(await subject.git('show', 'feat/daemon-demo:operator.txt')).toBe('X');
    expect(runner.run).not.toHaveBeenCalled();
  });

  // Covers: S9.6, task:31
  it('conductor resume recovers an outstanding journal with closure refs moved and an applying record it wrote before judging the cursor or classifying the record', async () => {
    const subject = await stack();

    // A crashed preflight: the repair moved the closure refs, synced, and
    // wrote its `applying` rebase-operation record, then the process died.
    let crashed!: () => void;
    const reachedCrash = new Promise<void>((resolve) => { crashed = resolve; });
    probe.crashAfterApplyingRecord = crashed;
    void runStackPreflight({ worktree: subject.repo, slug: 'demo' });
    await reachedCrash;
    const stranded = await readRestackJournal(subject.repo, 'demo');
    if (stranded.kind !== 'journal') throw new Error(`expected a stranded journal, got ${stranded.kind}`);
    expect(stranded.journal.state).toBe('synced');
    const orphaned = await writeRestackJournalBlob(subject.repo, {
      ...stranded.journal,
      owner: { host: 'crashed-host', pid: 1, processStartTime: '0' },
    });
    await subject.git('update-ref', journalRefFor('demo'), orphaned, stranded.blob);
    // Closure refs already moved, and the record the journal wrote is applying.
    expect(await subject.git('rev-parse', 'refs/conductor/demo/closed/c1')).toBe(subject.x);
    expect((await readVerdict(subject.repo, 'rebase'))?.rebaseOperation?.status).toBe('applying');
    probe.trace = [];

    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, ['restack_recovered', 'restack_refused']);
    await resume(subject, events);

    expect(probe.trace[0]).toBe('recovery:recovered');
    expect(seen).toEqual([expect.objectContaining({ type: 'restack_recovered' })]);
    // Every cursor judgement and every classification happened after the
    // journal was gone; the record was not classified as interrupted.
    expect(probe.cursorJournalPresent.length).toBeGreaterThan(0);
    expect(probe.cursorJournalPresent.every((present) => !present)).toBe(true);
    expect(probe.classifications.length).toBeGreaterThan(0);
    expect(probe.classifications.every((entry) => !entry.journalPresent)).toBe(true);
    expect(probe.classifications.map((entry) => entry.kind)).not.toContain('applying');
    // No divergent halt: at the fence there was no HALT at all.
    expect(probe.classifications[0]).toMatchObject({ haltPresent: false });
    const halt = await haltBody(subject.repo);
    expect(halt).not.toMatch(/closed-child-rewritten|range-not-ancestor|divergent/);
    expect(await subject.git('rev-parse', 'refs/conductor/demo/closed/c1')).toBe(subject.x);
  });
});

// Covers: task:31, task:31.1
//
// Drives the REAL daemon per-feature dispatch closure (`runConductorInWorktree`
// in daemon-cli.ts) against a throwaway local Git stack.  `runDaemonMode` is
// real up to the point it hands its dependencies to the daemon loop: the loop
// (`runDaemon`) and the feature runner factory (`makeRunFeature`) are replaced
// by capture shims so the test can invoke the production dispatch and the
// production pre-dispatch authorization consumer directly.  The in-process
// `Conductor` is a recording fake (its `run()` must not drive a pipeline), and
// the restack phases are pass-through spies that record their order.
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  runnerDeps: undefined as undefined | Record<string, unknown>,
  daemonDeps: undefined as undefined | Record<string, unknown>,
  trace: [] as string[],
  conductorRun: undefined as undefined | ((label: string) => void),
  rekickAtResume: [] as boolean[],
  resumeResults: [] as string[],
  /** Journal/staging refs observed at each runRestack entry. */
  restackEntryRefs: [] as string[],
}));

vi.mock('../../src/engine/daemon-deps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-deps.js')>();
  return { ...actual, resolveDaemonBaseSha: vi.fn(async () => 'a'.repeat(40)) };
});
vi.mock('../../src/engine/work-order.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/work-order.js')>();
  return { ...actual, buildWorkOrder: vi.fn((input) => input) };
});
vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })),
}));
// The daemon loop is replaced by a capture: the dispatch under test is invoked
// directly, so no backlog, pick or concurrency machinery is involved.
vi.mock('../../src/engine/daemon.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon.js')>();
  return {
    ...actual,
    runDaemon: vi.fn(async (deps: Record<string, unknown>) => {
      captured.daemonDeps = deps;
      return { processed: [], stoppedReason: 'drained' };
    }),
  };
});
vi.mock('../../src/engine/daemon-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-runner.js')>();
  return {
    ...actual,
    makeRunFeature: (deps: Record<string, unknown>) => {
      captured.runnerDeps = deps;
      return async (item: { slug: string }) => ({ slug: item.slug, status: 'done' });
    },
  };
});
vi.mock('../../src/engine/conductor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/conductor.js')>();
  class RecordingConductor {
    async run(): Promise<void> {
      captured.trace.push('conductor.run');
    }
  }
  return { ...actual, Conductor: RecordingConductor };
});
vi.mock('../../src/engine/daemon-rekick.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-rekick.js')>();
  return {
    ...actual,
    resumeRebaseFirst: vi.fn(async (opts: Parameters<typeof actual.resumeRebaseFirst>[0]) => {
      captured.trace.push('resumeRebaseFirst');
      captured.rekickAtResume.push(existsSync(join(opts.worktreePath, actual.REKICK_SENTINEL)));
      const result = await actual.resumeRebaseFirst(opts);
      captured.resumeResults.push(result);
      return result;
    }),
  };
});
vi.mock('../../src/engine/restack/restack-recovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-recovery.js')>();
  return {
    ...actual,
    recoverRestackJournal: vi.fn(async (...args: Parameters<typeof actual.recoverRestackJournal>) => {
      const result = await actual.recoverRestackJournal(...args);
      captured.trace.push(`recovery:${result.kind}`);
      return result;
    }),
  };
});
vi.mock('../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-executor.js')>();
  return {
    ...actual,
    runRestack: vi.fn(async (...args: Parameters<typeof actual.runRestack>) => {
      captured.trace.push(`restack:${args[0].cause}`);
      const { execFile } = await import('node:child_process');
      captured.restackEntryRefs.push(await new Promise<string>((resolve) => {
        execFile('git', ['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/restack/'], { cwd: args[0].worktree }, (_error, stdout) => resolve(String(stdout).trim()));
      }));
      return actual.runRestack(...args);
    }),
  };
});
vi.mock('../../src/engine/halt-record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/halt-record.js')>();
  return {
    ...actual,
    supersedeHaltRecord: vi.fn(async (...args: Parameters<typeof actual.supersedeHaltRecord>) => {
      captured.trace.push(`supersede:${args[2]}`);
      // No remote exists in this fixture; keep the publication step local.
      return actual.supersedeHaltRecord(args[0], args[1], args[2], {
        gh: async () => { throw new Error('no GitHub in this test'); },
      });
    }),
  };
});

import { runDaemonMode } from '../../src/daemon-cli.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { clearMarker, REKICK_SENTINEL } from '../../src/engine/daemon-rekick.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import { __resetResolveCacheForTests, writeOperatorPark } from '../../src/engine/park-marker.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob } from '../../src/engine/restack/restack-journal.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

beforeEach(() => {
  captured.runnerDeps = undefined;
  captured.daemonDeps = undefined;
  captured.trace = [];
  captured.rekickAtResume = [];
  captured.resumeResults = [];
  captured.restackEntryRefs = [];
  __resetResolveCacheForTests();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A daemon project (`<root>/project`, primary checkout on `main`) whose feature
 * worktree `.worktrees/demo` is linked to the leaf branch of a three-child
 * stack: closed children 1 and 2 and the active leaf `feat/daemon-demo`.
 */
async function daemonStack() {
  const root = await mkdtemp(join(tmpdir(), 'stack-preflight-dispatch-'));
  roots.push(root);
  const project = join(root, 'project');
  const worktree = join(project, '.worktrees', 'demo');
  await mkdir(project);
  let cwd = project;
  const git = async (...args: string[]) => (await execFile('git', args, { cwd })).stdout.trim();
  const commit = async (message: string, path: string, content: string) => {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), content);
    await git('add', path);
    await git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'dispatch@example.test');
  await git('config', 'user.name', 'Stack dispatch');
  await writeFile(join(project, '.gitignore'), '.pipeline/\n.worktrees/\n.daemon/\n.ai-conductor/\n');
  await git('add', '.gitignore');
  await commit('base', 'base.txt', 'base\n');
  await git('checkout', '-qb', 'feat/c1/demo');
  const c1 = await commit('closed one', 'one.txt', 'one\n');
  await git('update-ref', 'refs/conductor/demo/closed/c1', c1);
  await git('checkout', '-qb', 'feat/c2/demo');
  const c2 = await commit('closed two', 'two.txt', 'two\n');
  await git('update-ref', 'refs/conductor/demo/closed/c2', c2);
  await git('checkout', '-qb', 'feat/daemon-demo');
  const leaf = await commit('leaf', 'leaf.txt', 'leaf\n');
  await git('checkout', '-q', 'main');
  await git('worktree', 'add', '-q', worktree, 'feat/daemon-demo');
  cwd = worktree;
  await mkdir(join(worktree, '.ai-conductor'), { recursive: true });
  await writeFile(join(worktree, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n  route_whole_feature_fixes: false\n');
  await writeCoverageBindingEnvelope(worktree, {
    version: 1, slug: 'demo', runId: 'dispatch', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);

  /** The operator's commit `X` on child 1, made from the primary checkout. */
  const appendOperatorCommit = async () => {
    cwd = project;
    await git('checkout', '-q', 'feat/c1/demo');
    const x = await commit('operator change', 'operator.txt', 'X\n');
    await git('checkout', '-q', 'main');
    cwd = worktree;
    return x;
  };
  const advanceDefault = async () => {
    cwd = project;
    const advanced = await commit('base advance', 'base.txt', 'advanced\n');
    cwd = worktree;
    return advanced;
  };
  const refs = () => git('for-each-ref', '--format=%(refname) %(objectname)');
  return { root, project, worktree, git, c1, c2, leaf, appendOperatorCommit, advanceDefault, refs };
}

type Stack = Awaited<ReturnType<typeof daemonStack>>;

/** Boot the real daemon-mode wiring once and capture its dispatch closures. */
async function bootDaemon(project: string) {
  await runDaemonMode({
    projectRoot: project,
    concurrency: 1,
    maxItems: 1,
    baseBranch: 'main',
    ensureFresh: async () => {},
    probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
    watch: false,
    workSource: { discover: async () => [] },
  });
  const runnerDeps = captured.runnerDeps;
  const daemonDeps = captured.daemonDeps;
  if (!runnerDeps || !daemonDeps) throw new Error('daemon wiring was not captured');
  type RunConductor = (
    worktree: { path: string; branch: string },
    item: { slug: string },
    providerExecution: undefined,
    events: ConductorEventEmitter,
    log: (message: string) => void,
  ) => Promise<unknown>;
  return {
    dispatch: (subject: Stack, events: ConductorEventEmitter) =>
      (runnerDeps.runConductor as RunConductor)(
        { path: subject.worktree, branch: 'feat/daemon-demo' },
        { slug: 'demo' },
        undefined,
        events,
        () => {},
      ),
    consumeResumeAuthorizations: daemonDeps.consumeResumeAuthorizations as () => Promise<void>,
  };
}

function recordEvents(events: ConductorEventEmitter, types: readonly ConductorEvent['type'][]): ConductorEvent[] {
  const seen: ConductorEvent[] = [];
  for (const type of types) events.on(type, (event) => { seen.push(event); });
  return seen;
}

const RESTACK_EVENTS: readonly ConductorEvent['type'][] = ['restack_planned', 'restack_applied', 'restack_refused', 'restack_recovered'];

describe('stack preflight through the real daemon dispatch', () => {
  // Covers: S9.1, task:31
  it('daemon dispatch repairs an appended closed child inside the preflight, in phase order, before resumeRebaseFirst and conductor.run, with no halt', async () => {
    const subject = await daemonStack();
    const x = await subject.appendOperatorCommit();
    const daemon = await bootDaemon(subject.project);
    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, RESTACK_EVENTS);

    await daemon.dispatch(subject, events);

    expect(captured.trace).toEqual([
      'recovery:none',
      'supersede:stack-preflight',
      'recovery:none',
      'restack:feature-repair',
      'resumeRebaseFirst',
      'conductor.run',
    ]);
    expect(await subject.git('rev-parse', 'refs/conductor/demo/closed/c1')).toBe(x);
    expect(await subject.git('show', 'feat/c2/demo:operator.txt')).toBe('X');
    expect(await subject.git('show', 'feat/daemon-demo:operator.txt')).toBe('X');
    expect(seen.filter((event) => event.type === 'restack_applied').length).toBeGreaterThan(0);
    expect(seen.filter((event) => event.type === 'restack_refused')).toEqual([]);
    expect(existsSync(join(subject.worktree, HALT_MARKER))).toBe(false);
  });

  // Covers: S9.4, task:31
  it('daemon dispatch of an operator-parked feature with an appended closed child runs no preflight restack and moves no ref', async () => {
    const subject = await daemonStack();
    await subject.appendOperatorCommit();
    await mkdir(join(subject.worktree, '.pipeline'), { recursive: true });
    await writeFile(join(subject.worktree, REKICK_SENTINEL), 'rekick\n');
    await writeOperatorPark(subject.project, 'demo');
    const daemon = await bootDaemon(subject.project);
    const before = await subject.refs();
    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, RESTACK_EVENTS);

    const termination = await daemon.dispatch(subject, events);

    expect(termination).toMatchObject({ kind: 'operator-parked' });
    expect(captured.trace).toEqual([]);
    expect(seen).toEqual([]);
    expect(await subject.refs()).toBe(before);
    expect(await subject.git('rev-parse', 'refs/conductor/demo/closed/c1')).toBe(subject.c1);
    expect(existsSync(join(subject.worktree, REKICK_SENTINEL))).toBe(true);
  });

  // Covers: S9.6, S7.17, task:31
  it('daemon dispatch after a crash mid the preflight chained base refresh runs only journal recovery and no second re-kick, while a dispatch with no preflight base refresh leaves REKICK for resumeRebaseFirst', async () => {
    const subject = await daemonStack();
    await subject.appendOperatorCommit();
    const advanced = await subject.advanceDefault();
    await mkdir(join(subject.worktree, '.pipeline'), { recursive: true });
    await writeFile(join(subject.worktree, REKICK_SENTINEL), 'rekick\n');
    const daemon = await bootDaemon(subject.project);

    // The crashing dispatch: the repair applies, then the process dies once
    // the chained base-refresh follow-on is planned.
    const crashing = new ConductorEventEmitter();
    let crashed!: () => void;
    const reachedCrash = new Promise<void>((resolve) => { crashed = resolve; });
    crashing.on('restack_planned', (event) => {
      if (event.type !== 'restack_planned' || event.cause !== 'base-refresh') return;
      crashed();
      return new Promise<void>(() => {});
    });
    void daemon.dispatch(subject, crashing);
    await reachedCrash;
    expect(captured.trace).toEqual(['recovery:none', 'supersede:stack-preflight', 'recovery:none', 'restack:feature-repair', 'restack:base-refresh']);
    // The preflight consumed REKICK before starting the follow-on.
    expect(existsSync(join(subject.worktree, REKICK_SENTINEL))).toBe(false);
    const stranded = await readRestackJournal(subject.worktree, 'demo');
    if (stranded.kind !== 'journal') throw new Error(`expected a stranded journal, got ${stranded.kind}`);
    expect(stranded.journal.cause).toBe('base-refresh');
    const orphaned = await writeRestackJournalBlob(subject.worktree, {
      ...stranded.journal,
      owner: { host: 'crashed-daemon-host', pid: 1, processStartTime: '0' },
    });
    await subject.git('update-ref', journalRefFor('demo'), orphaned, stranded.blob);
    captured.trace = [];

    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, RESTACK_EVENTS);
    await daemon.dispatch(subject, events);

    expect(captured.trace[0]).toBe('recovery:recovered');
    expect(captured.trace.filter((entry) => entry.startsWith('restack:'))).toEqual([]);
    expect(seen.map((event) => event.type)).toEqual(['restack_recovered']);
    // No second re-kick: resumeRebaseFirst found no REKICK and skipped.
    expect(captured.rekickAtResume).toEqual([false]);
    expect(captured.resumeResults).toEqual(['skipped']);
    expect(await readRestackJournal(subject.worktree, 'demo')).toEqual({ kind: 'missing' });
    for (const branch of ['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']) {
      await expect(subject.git('merge-base', '--is-ancestor', advanced, branch)).resolves.toBe('');
    }

    // A dispatch whose preflight runs no base refresh leaves REKICK in place.
    const quiet = await daemonStack();
    await mkdir(join(quiet.worktree, '.pipeline'), { recursive: true });
    await writeFile(join(quiet.worktree, REKICK_SENTINEL), 'rekick\n');
    captured.trace = [];
    captured.rekickAtResume = [];
    const quietDaemon = await bootDaemon(quiet.project);
    await quietDaemon.dispatch(quiet, new ConductorEventEmitter());
    expect(captured.trace.filter((entry) => entry.startsWith('restack:'))).toEqual([]);
    expect(captured.rekickAtResume).toEqual([true]);
  });
});

describe('stack preflight live-HALT gating through the real daemon dispatch', () => {
  // Covers: S9.10, task:31.1
  it('daemon dispatch with a live HALT runs only journal recovery, and after the daemon consumes a matching staged authorization the same dispatch runs the repair', async () => {
    const subject = await daemonStack();
    const x = await subject.appendOperatorCommit();
    const pipeline = join(subject.worktree, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(pipeline, 'HALT'), 'restack cascade cap reached for child 1\nKickback halt generation: g1\n');
    await writeFile(join(pipeline, 'HALT.class'), 'needs-human');
    const daemon = await bootDaemon(subject.project);
    const before = await subject.refs();

    await daemon.dispatch(subject, new ConductorEventEmitter());

    expect(captured.trace).toEqual(['recovery:none']);
    expect(await subject.refs()).toBe(before);
    await expect(subject.git('show', 'feat/daemon-demo:operator.txt')).rejects.toBeDefined();

    // Stage a resume authorization bound to the live halt generation.
    await writeFile(join(pipeline, 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: {
        restack: {
          count: 1, cumulative: 3, treeHash: null, lastReason: 'cascade cap', priorVerdict: false, resolvedBefore: 0,
          capEvidence: { gate: 'restack', consumed: 3, limit: 3, latestReason: 'cascade cap', haltGeneration: 'g1' },
          resumeAuthorization: { adjustmentId: 'adj-1', haltGeneration: 'g1', consumed: false },
        },
      },
    }));
    captured.trace = [];
    await daemon.consumeResumeAuthorizations();
    expect(existsSync(join(pipeline, 'HALT'))).toBe(false);
    const ledger = JSON.parse(await readFile(join(pipeline, 'kickback-ledger.json'), 'utf8')) as {
      gates: { restack: { resumeAuthorization: { consumed: boolean } } };
    };
    expect(ledger.gates.restack.resumeAuthorization.consumed).toBe(true);

    captured.trace = [];
    const authorized = new ConductorEventEmitter();
    const applied = recordEvents(authorized, ['restack_applied', 'restack_refused']);
    await daemon.dispatch(subject, authorized);

    expect(captured.trace).toContain('restack:feature-repair');
    // The repair moved closed/c1 to X (the daemon's halt clear also queued a
    // re-kick, so a base-refresh follow-on may rewrite the stack afterwards).
    expect(applied).toContainEqual(expect.objectContaining({ type: 'restack_applied', cause: 'feature-repair', child: 1, newTip: x }));
    expect(applied.filter((event) => event.type === 'restack_refused')).toEqual([]);
    expect(await subject.git('rev-parse', 'refs/conductor/demo/closed/c1')).toBe(await subject.git('rev-parse', 'feat/c1/demo'));
    expect(await subject.git('show', 'feat/daemon-demo:operator.txt')).toBe('X');
    expect(existsSync(join(pipeline, 'HALT'))).toBe(false);
  });

  // Covers: S9.11, task:31.1
  it('daemon dispatch ends when the preflight writes a closed-child-rewritten halt, with no resumeRebaseFirst and no conductor.run call', async () => {
    const subject = await daemonStack();
    // Rewrite child 1 so its branch no longer contains closed/c1.
    await subject.git('branch', '-f', 'feat/c1/demo', 'main');
    const daemon = await bootDaemon(subject.project);
    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, RESTACK_EVENTS);

    await daemon.dispatch(subject, events);

    expect(seen).toEqual([expect.objectContaining({ type: 'restack_refused', reason: 'closed-child-rewritten' })]);
    await expect(readFile(join(subject.worktree, HALT_MARKER), 'utf8')).resolves.toContain('closed-child-rewritten');
    expect(captured.trace).not.toContain('resumeRebaseFirst');
    expect(captured.trace).not.toContain('conductor.run');
    expect(captured.trace.filter((entry) => entry.startsWith('restack:'))).toEqual([]);
    expect(await subject.git('rev-parse', 'refs/conductor/demo/closed/c1')).toBe(subject.c1);
  });

  // Covers: S9.12, task:31.1
  it('daemon dispatch at the first resume after a restack halt clears supersedes the record before the repair, removes the leftover aborted journal first, and repairs without restack-outstanding or a new halt', async () => {
    const subject = await daemonStack();
    // X edits base.txt; the leaf worktree holds a dirty edit of the same path,
    // so the repair is refused dirty-overlap and halts.
    const project = (...args: string[]) => execFile('git', args, { cwd: subject.project });
    await project('checkout', '-q', 'feat/c1/demo');
    await writeFile(join(subject.project, 'base.txt'), 'X\n');
    await project('commit', '-qam', 'operator change');
    const x = (await project('rev-parse', 'HEAD')).stdout.trim();
    await project('checkout', '-q', 'main');
    await writeFile(join(subject.worktree, 'base.txt'), 'operator edit\n');
    const daemon = await bootDaemon(subject.project);

    await daemon.dispatch(subject, new ConductorEventEmitter());
    expect(await readFile(join(subject.worktree, HALT_MARKER), 'utf8')).toContain('dirty-overlap');
    expect(await subject.git('show', 'HEAD:.docs/halted/demo.md')).toMatch(/^Status:\s*halted\s*$/m);
    expect(await readRestackJournal(subject.worktree, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });

    // The operator resolves the overlap; the halt is cleared.
    await subject.git('checkout', '--', 'base.txt');
    await clearMarker(subject.worktree);
    captured.trace = [];
    captured.restackEntryRefs = [];
    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, RESTACK_EVENTS);

    await daemon.dispatch(subject, events);

    const supersede = captured.trace.indexOf('supersede:stack-preflight');
    const repair = captured.trace.indexOf('restack:feature-repair');
    expect(supersede).toBeGreaterThanOrEqual(0);
    expect(repair).toBeGreaterThan(supersede);
    expect(await subject.git('show', 'feat/daemon-demo:.docs/halted/demo.md')).toMatch(/^Status:\s*resolved\s*$/m);
    // No journal or staging ref survived to the repair's entry.
    expect(captured.restackEntryRefs[0]).toBe('');
    expect(seen.filter((event) => event.type === 'restack_refused')).toEqual([]);
    expect(existsSync(join(subject.worktree, HALT_MARKER))).toBe(false);
    // The clear queued a re-kick, so a base-refresh follow-on ran after the
    // repair; the repair itself moved closed/c1 to X.
    expect(seen).toContainEqual(expect.objectContaining({ type: 'restack_applied', cause: 'feature-repair', child: 1, newTip: x }));
    expect(await subject.git('show', 'feat/daemon-demo:base.txt')).toBe('X');
  });
});

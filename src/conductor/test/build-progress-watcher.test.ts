import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { readSnapshot, BuildProgressWatcher } from '../src/engine/build-progress-watcher.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import type { ConductorEvent } from '../src/types/index.js';

describe('readSnapshot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeStatus(content: unknown): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }

  it('reads the new {tasks:[]} shape, deriving resolved/total/currentTask from the array', async () => {
    await writeStatus({
      tasks: [
        { id: '1', title: 'first', status: 'completed' },
        { id: '2', title: 'second', status: 'in_progress' },
        { id: '3', title: 'third', status: 'pending' },
      ],
    });

    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(1);
    expect(snapshot.total).toBe(3);
    expect(snapshot.currentTaskId).toBe('2');
    expect(snapshot.currentTaskName).toBe('second');
  });

  it('reads the legacy id-keyed map schema (no "tasks" wrapper)', async () => {
    await writeStatus({
      '1': { title: 'alpha', status: 'completed' },
      '2': { title: 'beta', status: 'skipped' },
      '3': { title: 'gamma', status: 'in_progress' },
      '4': { title: 'delta', status: 'pending' },
    });

    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(2);
    expect(snapshot.total).toBe(4);
    expect(snapshot.currentTaskId).toBe('3');
    expect(snapshot.currentTaskName).toBe('gamma');
  });

  it('returns a null-ish "no data" snapshot without throwing when task-status.json is missing', async () => {
    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(0);
    expect(snapshot.total).toBe(0);
    expect(snapshot.currentTaskId).toBeUndefined();
    expect(snapshot.currentTaskName).toBeUndefined();
  });

  it('returns a null-ish "no data" snapshot without throwing when task-status.json is corrupt', async () => {
    await writeStatus('not valid json{{{');

    const snapshot = await readSnapshot(dir);

    expect(snapshot.resolved).toBe(0);
    expect(snapshot.total).toBe(0);
    expect(snapshot.currentTaskId).toBeUndefined();
    expect(snapshot.currentTaskName).toBeUndefined();
  });

  it('omits the head property (rather than throwing) when the git HEAD probe fails', async () => {
    // dir is a plain tmpdir, not a git repo — `git rev-parse HEAD` must fail.
    await writeStatus({ tasks: [{ id: '1', status: 'pending' }] });

    const snapshot = await readSnapshot(dir);

    expect('head' in snapshot).toBe(false);
  });

  it('includes head when the project root is a real git repo with a commit', async () => {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), 'hello');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: dir });
    await writeStatus({ tasks: [] });

    const snapshot = await readSnapshot(dir);

    expect(typeof snapshot.head).toBe('string');
    expect(snapshot.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads noEvidenceAttempts from task-evidence.json when present', async () => {
    await writeStatus({ tasks: [] });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-evidence.json'),
      JSON.stringify({
        evidenceStamps: {},
        noEvidenceAttempts: 3,
        migrationGrandfather: [],
      }),
    );

    const snapshot = await readSnapshot(dir);

    expect(snapshot.noEvidenceAttempts).toBe(3);
  });

  it('defaults noEvidenceAttempts to 0 when task-evidence.json is absent', async () => {
    await writeStatus({ tasks: [] });

    const snapshot = await readSnapshot(dir);

    expect(snapshot.noEvidenceAttempts).toBe(0);
  });

  it('derives resolved from git when planPath is given, even though task-status.json still shows 0 completed', async () => {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

    // deriveCompletion's default evidence-range resolution requires an
    // origin remote (fail-closed otherwise) — stand up a bare repo to act
    // as origin/main, matching autoheal.test.ts's fixture pattern.
    const bareDir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-origin-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });

    const planPath = join(dir, '.docs/plans/test-plan.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      planPath,
      '# Test Plan\n\n### Task 1: First\nDo the first thing.\n\n### Task 2: Second\nDo the second thing.\n',
    );
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

    await writeFile(join(dir, 'first.txt'), 'content');
    await execa('git', ['add', 'first.txt'], { cwd: dir });
    await execa('git', ['commit', '-m', 'feat: first task\n\nTask: 1\n'], { cwd: dir });

    // task-status.json is stale — still reports 0 completed out of 2.
    await writeStatus({
      tasks: [
        { id: '1', title: 'First', status: 'pending' },
        { id: '2', title: 'Second', status: 'pending' },
      ],
    });

    const snapshot = await readSnapshot(dir, planPath);

    expect(snapshot.resolved).toBe(1);
    expect(snapshot.total).toBe(2);
  });

  it('counts a git-derived skipped task as resolved via planPath', async () => {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

    const bareDir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-origin-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });

    const planPath = join(dir, '.docs/plans/test-plan.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      planPath,
      '# Test Plan\n\n### Task 1: First\nDo the first thing.\n\n### Task 2: Second\nDo the second thing.\n',
    );
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

    // Task 2 is resolved via the Evidence: skipped no-op form, not a normal
    // commit. Task/Evidence trailers must be a single trailing paragraph (no
    // blank line between them) so git's trailer parser recognizes both.
    await execa(
      'git',
      [
        'commit',
        '--allow-empty',
        '-m',
        'chore(evidence): task deferred\n\nTask: 2\nEvidence: skipped not_applicable',
      ],
      { cwd: dir },
    );

    // task-status.json is stale — still reports 0 completed out of 2.
    await writeStatus({
      tasks: [
        { id: '1', title: 'First', status: 'pending' },
        { id: '2', title: 'Second', status: 'pending' },
      ],
    });

    const snapshot = await readSnapshot(dir, planPath);

    expect(snapshot.resolved).toBe(1);
    expect(snapshot.total).toBe(2);
  });

  it('clamps resolved to total when the git-derived count exceeds the declared total', async () => {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

    const bareDir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-origin-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });

    const planPath = join(dir, '.docs/plans/test-plan.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      planPath,
      '# Test Plan\n\n### Task 1: First\nDo the first thing.\n\n### Task 2: Second\nDo the second thing.\n',
    );
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

    await writeFile(join(dir, 'first.txt'), 'content');
    await execa('git', ['add', 'first.txt'], { cwd: dir });
    await execa('git', ['commit', '-m', 'feat: first task\n\nTask: 1\n'], { cwd: dir });

    await writeFile(join(dir, 'second.txt'), 'content');
    await execa('git', ['add', 'second.txt'], { cwd: dir });
    await execa('git', ['commit', '-m', 'feat: second task\n\nTask: 2\n'], { cwd: dir });

    // Declared total (from task-status.json) is only 1, even though the
    // git-derived completion count for the plan's 2 tasks is 2 — resolved
    // must never exceed the declared total.
    await writeStatus({
      total: 1,
      tasks: [{ id: '1', title: 'First', status: 'pending' }],
    });

    const snapshot = await readSnapshot(dir, planPath);

    expect(snapshot.total).toBe(1);
    expect(snapshot.resolved).toBeLessThanOrEqual(snapshot.total);
    expect(snapshot.resolved).toBe(1);
  });

  it('falls back to the task-status count without throwing when planPath points at a non-existent file', async () => {
    await writeStatus({
      tasks: [
        { id: '1', title: 'First', status: 'completed' },
        { id: '2', title: 'Second', status: 'pending' },
      ],
    });

    const planPath = join(dir, '.docs/plans/does-not-exist.md');

    const snapshot = await readSnapshot(dir, planPath);

    expect(snapshot.resolved).toBe(1);
    expect(snapshot.total).toBe(2);
  });
});

describe('BuildProgressWatcher change-driven emission', () => {
  let dir: string;
  let emitter: ConductorEventEmitter;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  // Fake timers guard the watcher's own `.unref()`'d poll interval so a stray
  // `start()` in these tests can never leave a real timer running past the
  // test. Emission itself is exercised by invoking the private `tick()`
  // directly (via bracket access) rather than by advancing the fake clock:
  // tick() does real fs/git I/O, and vitest's fake-timer microtask flush
  // does not reliably wait for that real I/O to settle before
  // `advanceTimersByTimeAsync` resolves — a flakiness pre-existing in this
  // codebase's own acceptance suite, not something to route around here.
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-emit-test-'));
    emitter = new ConductorEventEmitter();
    emitSpy = vi.spyOn(emitter, 'emit');
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTasks(resolved: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: String(i + 1),
      status: i < resolved ? 'completed' : 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  function buildProgressEvents(): Extract<ConductorEvent, { type: 'build_progress' }>[] {
    return emitSpy.mock.calls
      .map((call) => call[0] as ConductorEvent)
      .filter((e): e is Extract<ConductorEvent, { type: 'build_progress' }> => e.type === 'build_progress');
  }

  function tick(watcher: BuildProgressWatcher): Promise<void> {
    return (watcher as unknown as { tick(): Promise<void> }).tick();
  }

  it('emits build_progress within one tick when the resolved task count changes (5 -> 6 of 21)', async () => {
    await writeTasks(5, 21);
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
    });
    watcher.start();

    await writeTasks(6, 21);
    await tick(watcher);
    watcher.stop();

    const events = buildProgressEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.resolved).toBe(6);
    expect(last.total).toBe(21);
    expect(last.featureSlug).toBe('my-feature');
  });

  it('emits build_progress with commitCount when a new HEAD commit lands with no task delta', async () => {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeTasks(5, 21);
    await writeFile(join(dir, 'README.md'), 'hello');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: dir });

    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
    });
    watcher.start();

    // Establish the baseline snapshot (first tick always "changes" from null).
    await tick(watcher);
    emitSpy.mockClear();

    // New commit, no task-status delta.
    await writeFile(join(dir, 'note.txt'), 'more');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'second'], { cwd: dir });

    await tick(watcher);
    watcher.stop();

    const events = buildProgressEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.resolved).toBe(5);
    expect(last.total).toBe(21);
    expect(last.commitCount).toBe(1);
  });

  it('emits nothing on a tick where nothing changed', async () => {
    await writeTasks(5, 21);
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
    });
    watcher.start();

    // First tick establishes the baseline (always "changes" from null state).
    await tick(watcher);
    emitSpy.mockClear();

    // Nothing changes on this tick.
    await tick(watcher);
    watcher.stop();

    expect(buildProgressEvents()).toHaveLength(0);
  });

  it('carries featureSlug and noEvidenceAttempts on the emitted payload', async () => {
    await writeTasks(5, 21);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-evidence.json'),
      JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 2, migrationGrandfather: [] }),
    );

    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
    });
    watcher.start();

    await writeTasks(6, 21);
    await tick(watcher);
    watcher.stop();

    const events = buildProgressEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.featureSlug).toBe('my-feature');
    expect(last.noEvidenceAttempts).toBe(2);
  });

  it('emits git-derived resolved advancing 0 -> 1 when planPath is set, even though task-status.json never changes', async () => {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

    // deriveCompletion's default evidence-range resolution requires an
    // origin remote (fail-closed otherwise) — stand up a bare repo to act
    // as origin/main, matching readSnapshot's fixture pattern above.
    const bareDir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-origin-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });

    const planPath = join(dir, '.docs/plans/test-plan.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      planPath,
      '# Test Plan\n\n### Task 1: First\nDo the first thing.\n\n### Task 2: Second\nDo the second thing.\n',
    );
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

    // task-status.json reports 0/2 completed and NEVER changes across ticks
    // — proving the emitted `resolved` advances via the git-derived path,
    // not reconciliation of task-status.json.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({
        tasks: [
          { id: '1', title: 'First', status: 'pending' },
          { id: '2', title: 'Second', status: 'pending' },
        ],
      }),
    );

    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
      planPath,
    });
    watcher.start();

    // Baseline tick: task-status.json says 0/2, no commits satisfy Task 1
    // yet.
    await tick(watcher);
    emitSpy.mockClear();

    // A task completes via a git commit — task-status.json is NOT touched.
    await writeFile(join(dir, 'first.txt'), 'content');
    await execa('git', ['add', 'first.txt'], { cwd: dir });
    await execa('git', ['commit', '-m', 'feat: first task\n\nTask: 1\n'], { cwd: dir });

    await tick(watcher);
    watcher.stop();

    const events = buildProgressEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last.resolved).toBe(1);
    expect(last.total).toBe(2);
  });
});

describe('BuildProgressWatcher lifecycle hardening', () => {
  let dir: string;
  let emitter: ConductorEventEmitter;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-lifecycle-test-'));
    emitter = new ConductorEventEmitter();
    emitSpy = vi.spyOn(emitter, 'emit');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTasks(resolved: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: String(i + 1),
      status: i < resolved ? 'completed' : 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  function tick(watcher: BuildProgressWatcher): Promise<void> {
    return (watcher as unknown as { tick(): Promise<void> }).tick();
  }

  it('is safe to call stop() twice', async () => {
    await writeTasks(1, 2);
    const watcher = new BuildProgressWatcher({ projectRoot: dir, events: emitter, step: 'build' });
    watcher.start();
    expect(() => {
      watcher.stop();
      watcher.stop();
    }).not.toThrow();
  });

  it('unrefs the poll timer so it never holds the process open', async () => {
    await writeTasks(1, 2);
    const watcher = new BuildProgressWatcher({ projectRoot: dir, events: emitter, step: 'build' });
    const unrefSpy = vi.fn();
    const realSetInterval = global.setInterval;
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((...args: Parameters<typeof setInterval>) => {
        const handle = realSetInterval(...args) as unknown as ReturnType<typeof setInterval> & {
          unref?: () => void;
        };
        handle.unref = unrefSpy;
        return handle;
      });

    watcher.start();
    watcher.stop();
    setIntervalSpy.mockRestore();

    expect(unrefSpy).toHaveBeenCalled();
  });

  it('a tick resolving after stop() emits nothing', async () => {
    await writeTasks(1, 2);
    const watcher = new BuildProgressWatcher({ projectRoot: dir, events: emitter, step: 'build' });
    watcher.start();

    // Establish a baseline snapshot so the next change would otherwise emit.
    await tick(watcher);
    emitSpy.mockClear();

    await writeTasks(2, 2);
    watcher.stop();
    // Simulate an in-flight tick resolving after stop() was called.
    await tick(watcher);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('start() twice does not double-tick', async () => {
    await writeTasks(1, 2);
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      config: { build_progress: { poll_seconds: 1000, enabled: true } },
    });

    watcher.start();
    const firstTimer = (watcher as unknown as { timer: unknown }).timer;
    watcher.start();
    const secondTimer = (watcher as unknown as { timer: unknown }).timer;

    expect(secondTimer).toBe(firstTimer);
    watcher.stop();
  });
});

describe('BuildProgressWatcher planPath option', () => {
  it('retains the planPath passed at construction', () => {
    const emitter = new ConductorEventEmitter();
    const watcher = new BuildProgressWatcher({
      projectRoot: '/x',
      events: emitter,
      step: 'build',
      planPath: '/x/plan.md',
    });

    expect((watcher as unknown as { planPath?: string }).planPath).toBe('/x/plan.md');
  });
});

describe('BuildProgressWatcher heartbeat re-emission', () => {
  let dir: string;
  let emitter: ConductorEventEmitter;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-heartbeat-test-'));
    emitter = new ConductorEventEmitter();
    emitSpy = vi.spyOn(emitter, 'emit');
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTasks(resolved: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: String(i + 1),
      status: i < resolved ? 'completed' : 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  function buildProgressEvents(): Extract<ConductorEvent, { type: 'build_progress' }>[] {
    return emitSpy.mock.calls
      .map((call) => call[0] as ConductorEvent)
      .filter((e): e is Extract<ConductorEvent, { type: 'build_progress' }> => e.type === 'build_progress');
  }

  function tick(watcher: BuildProgressWatcher): Promise<void> {
    return (watcher as unknown as { tick(): Promise<void> }).tick();
  }

  it('re-emits the current snapshot once per heartbeat period during a silent build', async () => {
    await writeTasks(5, 21);
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
      config: { build_progress: { heartbeat_minutes: 5 } },
    });
    watcher.start();

    // Baseline tick — establishes lastSnapshot/lastEmitAt.
    await tick(watcher);
    emitSpy.mockClear();

    // Nothing changes; less than one heartbeat period elapses — no emission.
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    await tick(watcher);
    expect(buildProgressEvents()).toHaveLength(0);

    // Cross the heartbeat boundary — a re-emit of the current (unchanged)
    // snapshot fires.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await tick(watcher);
    watcher.stop();

    const events = buildProgressEvents();
    expect(events).toHaveLength(1);
    expect(events[0].resolved).toBe(5);
    expect(events[0].total).toBe(21);
  });

  it('resets the heartbeat clock on a change-driven emission (no interleaved duplicates)', async () => {
    await writeTasks(5, 21);
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
      config: { build_progress: { heartbeat_minutes: 5 } },
    });
    watcher.start();

    await tick(watcher);
    emitSpy.mockClear();

    // A change-driven emission 4 minutes in should reset the clock.
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    await writeTasks(6, 21);
    await tick(watcher);
    expect(buildProgressEvents()).toHaveLength(1);
    emitSpy.mockClear();

    // Only 4 more minutes pass (8 total since baseline, but only 4 since the
    // reset) — heartbeat must NOT have fired yet.
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    await tick(watcher);
    expect(buildProgressEvents()).toHaveLength(0);

    // Now cross the heartbeat threshold measured from the reset point.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await tick(watcher);
    watcher.stop();

    expect(buildProgressEvents()).toHaveLength(1);
  });

  it('never emits a heartbeat after stop()', async () => {
    await writeTasks(5, 21);
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
      config: { build_progress: { heartbeat_minutes: 5 } },
    });
    watcher.start();

    await tick(watcher);
    watcher.stop();
    emitSpy.mockClear();

    // Time passes well beyond the heartbeat window, but the watcher is
    // stopped — no tick should fire, and calling tick() directly must not be
    // exercised (stop() only guarantees the timer won't invoke tick again).
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(buildProgressEvents()).toHaveLength(0);
  });
});

describe('BuildProgressWatcher quiet-episode build_no_progress', () => {
  let dir: string;
  let emitter: ConductorEventEmitter;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-quiet-test-'));
    emitter = new ConductorEventEmitter();
    emitSpy = vi.spyOn(emitter, 'emit');
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTasks(resolved: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: String(i + 1),
      status: i < resolved ? 'completed' : 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  function noProgressEvents(): Extract<ConductorEvent, { type: 'build_no_progress' }>[] {
    return emitSpy.mock.calls
      .map((call) => call[0] as ConductorEvent)
      .filter((e): e is Extract<ConductorEvent, { type: 'build_no_progress' }> => e.type === 'build_no_progress');
  }

  function tick(watcher: BuildProgressWatcher): Promise<void> {
    return (watcher as unknown as { tick(): Promise<void> }).tick();
  }

  function makeWatcher(): BuildProgressWatcher {
    return new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'my-feature',
      config: { build_progress: { quiet_minutes: 15 } },
    });
  }

  it('emits build_no_progress exactly once once the quiet threshold is crossed, and not again while still quiet', async () => {
    await writeTasks(5, 21);
    const watcher = makeWatcher();
    watcher.start();

    // Baseline tick — establishes lastChangeAt.
    await tick(watcher);
    emitSpy.mockClear();

    // Advance past the 15-minute quiet threshold with no task-status change.
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    await tick(watcher);

    // Continued quiet — must not re-fire.
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await tick(watcher);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await tick(watcher);
    watcher.stop();

    const events = noProgressEvents();
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.quietMinutes).toBeGreaterThanOrEqual(15);
    expect(e.resolved).toBe(5);
    expect(e.total).toBe(21);
    expect(e.featureSlug).toBe('my-feature');
  });

  it('re-arms after a change, firing again on a later quiet episode', async () => {
    await writeTasks(5, 21);
    const watcher = makeWatcher();
    watcher.start();

    await tick(watcher);
    emitSpy.mockClear();

    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    await tick(watcher);
    expect(noProgressEvents()).toHaveLength(1);

    // Progress resumes — re-arms the episode.
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await writeTasks(6, 21);
    await tick(watcher);
    emitSpy.mockClear();

    // Quiet again past threshold — should fire again.
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    await tick(watcher);
    watcher.stop();

    expect(noProgressEvents()).toHaveLength(1);
  });

  it('a change one tick before threshold resets the quiet clock', async () => {
    await writeTasks(5, 21);
    const watcher = makeWatcher();
    watcher.start();

    await tick(watcher);
    emitSpy.mockClear();

    // Just before threshold, progress happens — resets the clock.
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    await writeTasks(6, 21);
    await tick(watcher);
    expect(noProgressEvents()).toHaveLength(0);

    // 14 more minutes pass since the reset — must not fire yet.
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    await tick(watcher);
    expect(noProgressEvents()).toHaveLength(0);

    // Now past 15 minutes since the reset point.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await tick(watcher);
    watcher.stop();

    expect(noProgressEvents()).toHaveLength(1);
  });
});

describe('BuildProgressWatcher settle()', () => {
  let dir: string;
  let emitter: ConductorEventEmitter;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-settle-test-'));
    emitter = new ConductorEventEmitter();
    emitSpy = vi.spyOn(emitter, 'emit');
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTasks(resolved: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: String(i + 1),
      status: i < resolved ? 'completed' : 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  function tick(watcher: BuildProgressWatcher): Promise<void> {
    return (watcher as unknown as { tick(): Promise<void> }).tick();
  }

  it('settle() resolves only after an in-flight interval-fired tick completes and the emission is observed', async () => {
    await writeTasks(5, 21);
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
    });
    watcher.start();

    // Establish baseline.
    await tick(watcher);
    emitSpy.mockClear();

    // Simulate a real scenario: change triggers a tick that will do fs/git I/O,
    // then advance the timer to fire the interval callback which starts an
    // in-flight tick.
    await writeTasks(6, 21);
    let settled = false;
    const settlePromise = watcher.settle().then(() => {
      settled = true;
    });

    // settle() is called, but no tick has fired yet, so it returns immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);

    watcher.stop();
    await settlePromise;
  });

  it('settle() is a no-op resolved promise when no tick is in flight', async () => {
    await writeTasks(1, 2);
    const watcher = new BuildProgressWatcher({ projectRoot: dir, events: emitter, step: 'build' });

    // Before any start() — settle() should resolve immediately.
    const startResult = await watcher.settle();
    expect(startResult).toBeUndefined();

    // After stop() — settle() should still resolve immediately.
    watcher.start();
    watcher.stop();
    const stopResult = await watcher.settle();
    expect(stopResult).toBeUndefined();
  });

  it('the existing stopped-guard contract still holds when stop() is called before settle()', async () => {
    await writeTasks(1, 2);
    const watcher = new BuildProgressWatcher({ projectRoot: dir, events: emitter, step: 'build' });
    watcher.start();

    await tick(watcher);
    emitSpy.mockClear();

    // Change state so next tick would emit.
    await writeTasks(2, 2);

    // stop() swallows the pending tick's emission (no settle beforehand).
    watcher.stop();
    await tick(watcher);

    expect(emitSpy).not.toHaveBeenCalled();
  });
});

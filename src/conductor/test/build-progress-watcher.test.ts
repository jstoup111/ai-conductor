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
    await execa('git', ['init'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), 'hello');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'init'], { cwd: dir });
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
    await execa('git', ['init'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeTasks(5, 21);
    await writeFile(join(dir, 'README.md'), 'hello');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-m', 'init'], { cwd: dir });

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
});

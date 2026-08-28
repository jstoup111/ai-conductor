import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import {
  detectEngineerCommand,
  dispatchEngineer,
  persistEngineerHandoffBeforeCleanup,
} from '../src/engine/engineer-cli.js';
import {
  readEngineerRunMarker,
  writeEngineerRunMarker,
} from '../src/engine/engineer/run-marker.js';
import { EngineerRunStore } from '../src/engine/engineer/run-store.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

void describe('Engineer lifecycle CLI', () => {
  let engineerDir: string;
  let repoRoot: string;
  let output: string[];
  let errors: string[];

  beforeEach(async () => {
    engineerDir = await mkdtemp(join(tmpdir(), 'engineer-lifecycle-cli-'));
    repoRoot = await mkdtemp(join(tmpdir(), 'engineer-lifecycle-cli-repo-'));
    output = [];
    errors = [];
  });

  afterEach(async () => {
    await rm(engineerDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  });

  function parse(argv: string[]) {
    const command = detectEngineerCommand(['node', 'conduct-ts', 'engineer', ...argv]);
    assert.ok(command);
    return command;
  }

  async function dispatch(argv: string[]): Promise<{ code: number; json?: Record<string, unknown> }> {
    const code = await dispatchEngineer(parse(argv), {
      engineerDir,
      events: new ConductorEventEmitter(),
      print: (line) => output.push(line),
      printErr: (line) => errors.push(line),
    });
    const last = output.at(-1);
    return { code, ...(last ? { json: JSON.parse(last) } : {}) };
  }

  function requireJson(result: { json?: Record<string, unknown> }): Record<string, unknown> {
    assert.ok(result.json);
    return result.json;
  }

  function requireString(value: unknown): string {
    assert.equal(typeof value, 'string');
    return value as string;
  }

  void it('creates, inspects, replays, records, fails, and retries runs as JSON', async () => {
    const created = await dispatch([
      'run-create',
      '--repo-root', repoRoot,
      '--idea', 'Add health check',
      '--correlation-id', 'commission-1',
      '--attempt-key', 'launch-1',
    ]);
    assert.partialDeepStrictEqual(created, {
      code: 0,
      json: { schemaVersion: 1, attempt: 1, eventRevision: 1 },
    });
    const runId = requireString(requireJson(created).engineerRunId);

    output = [];
    assert.partialDeepStrictEqual(await dispatch(['run-record', '--run-id', runId, '--transition', 'run_started']), {
      code: 0,
      json: { engineerRunId: runId, state: 'authoring', eventRevision: 2 },
    });
    output = [];
    assert.partialDeepStrictEqual(await dispatch([
      'run-record', '--run-id', runId, '--transition', 'step_started', '--step', 'explore', '--provider', 'codex',
    ]), { code: 0, json: { eventRevision: 3 } });
    output = [];
    assert.partialDeepStrictEqual(await dispatch([
      'run-record', '--run-id', runId, '--transition', 'step_completed', '--step', 'explore', '--completion', 'accepted_result',
    ]), { code: 0, json: { steps: { explore: { status: 'completed' } } } });

    output = [];
    assert.partialDeepStrictEqual(await dispatch(['run-replay', '--run-id', runId, '--after-revision', '2']), {
      code: 0,
      json: { engineerRunId: runId, afterRevision: 2, events: [{ revision: 3 }, { revision: 4 }] },
    });

    output = [];
    assert.partialDeepStrictEqual(await dispatch(['run-inspect', '--run-id', runId]), {
      code: 0,
      json: { engineerRunId: runId, eventRevision: 4 },
    });

    output = [];
    assert.partialDeepStrictEqual(await dispatch(['run-fail', '--run-id', runId, '--error', 'host exited']), {
      code: 0,
      json: { state: 'failed', eventRevision: 5 },
    });

    output = [];
    const successor = await dispatch([
      'run-create',
      '--repo-root', repoRoot,
      '--idea', 'Add health check',
      '--correlation-id', 'commission-1',
      '--attempt-key', 'launch-2',
    ]);
    assert.partialDeepStrictEqual(successor, {
      code: 0,
      json: { attempt: 2, previousEngineerRunId: runId, eventRevision: 1 },
    });
  });

  void it('prints one capability JSON object and rejects unknown lifecycle flags', async () => {
    assert.deepEqual(await dispatch(['capabilities']), {
      code: 0,
      json: { schemaVersion: 1, engineerLifecycleEventsV1: true },
    });

    output = [];
    const result = await dispatch([
      'run-create', '--repo-root', repoRoot, '--idea', 'x', '--unknown', 'value',
    ]);
    assert.equal(result.code, 1);
    assert.match(errors.join('\n'), /unknown flag '--unknown'/);
  });

  void it('reserves land reconciliation completion evidence for the land path', async () => {
    const created = await dispatch([
      'run-create', '--repo-root', repoRoot, '--idea', 'x', '--attempt-key', 'a1',
    ]);
    const runId = requireString(requireJson(created).engineerRunId);
    output = [];
    await dispatch(['run-record', '--run-id', runId, '--transition', 'run_started']);
    output = [];
    await dispatch(['run-record', '--run-id', runId, '--transition', 'step_started', '--step', 'explore']);
    output = [];
    errors = [];

    const result = await dispatch([
      'run-record', '--run-id', runId, '--transition', 'step_completed', '--step', 'explore',
      '--completion', 'land_reconciliation',
    ]);

    assert.equal(result.code, 1);
    assert.match(errors.join('\n'), /land_reconciliation is reserved for verified land evidence/);
    assert.partialDeepStrictEqual(JSON.parse(errors.at(-1)!), {
      schemaVersion: 1,
      error: 'invalid_completion_evidence',
    });
  });

  void it('inspects ordered correlation lineage without sharing revision cursors', async () => {
    const first = await dispatch([
      'run-create', '--repo-root', repoRoot, '--idea', 'x', '--correlation-id', 'corr', '--attempt-key', 'a1',
    ]);
    output = [];
    await dispatch([
      'run-fail', '--run-id', requireString(requireJson(first).engineerRunId), '--error', 'retry',
    ]);
    output = [];
    await dispatch([
      'run-create', '--repo-root', repoRoot, '--idea', 'x', '--correlation-id', 'corr', '--attempt-key', 'a2',
    ]);
    output = [];
    const lineage = await dispatch(['run-inspect', '--repo-root', repoRoot, '--correlation-id', 'corr']);
    const runs = requireJson(lineage).runs as Array<{ attempt: number; eventRevision: number }>;
    assert.deepEqual(runs.map((run) => [run.attempt, run.eventRevision]), [[1, 2], [2, 1]]);

    const otherRepo = await mkdtemp(join(tmpdir(), 'engineer-lifecycle-cli-other-repo-'));
    try {
      output = [];
      const mismatched = await dispatch([
        'run-inspect', '--repo-root', otherRepo, '--correlation-id', 'corr',
      ]);
      assert.partialDeepStrictEqual(mismatched, { code: 0, json: { runs: [] } });
    } finally {
      await rm(otherRepo, { recursive: true, force: true });
    }
  });

  void it('writes and recovers an exact run marker without relying on the worktree name', async () => {
    const worktree = join(repoRoot, '.worktrees', 'arbitrary-name');
    await mkdir(worktree, { recursive: true });
    await writeEngineerRunMarker(worktree, {
      schemaVersion: 1,
      engineerRunId: 'run-123',
      repoRoot,
      planSlug: 'health-check',
      branch: 'spec/health-check',
    });

    assert.deepEqual(await readEngineerRunMarker(worktree), {
      schemaVersion: 1,
      engineerRunId: 'run-123',
      repoRoot,
      planSlug: 'health-check',
      branch: 'spec/health-check',
    });
    assert.partialDeepStrictEqual(
      JSON.parse(await readFile(join(worktree, '.pipeline', 'engineer-run.json'), 'utf-8')),
      {
        engineerRunId: 'run-123',
      },
    );
  });

  void it('refuses malformed and schema-incompatible worktree markers', async () => {
    await mkdir(join(repoRoot, '.pipeline'), { recursive: true });
    await writeFile(join(repoRoot, '.pipeline', 'engineer-run.json'), '{broken', 'utf-8');
    await assert.rejects(readEngineerRunMarker(repoRoot), /malformed/i);
    await writeFile(join(repoRoot, '.pipeline', 'engineer-run.json'), JSON.stringify({ schemaVersion: 2 }), 'utf-8');
    await assert.rejects(readEngineerRunMarker(repoRoot), /schema/i);
  });

  void it('retains old uncommissioned worktrees with no marker as a supported path', async () => {
    assert.equal(await readEngineerRunMarker(repoRoot), null);
    const store = new EngineerRunStore({ engineerDir, events: new ConductorEventEmitter() });
    assert.deepEqual(await store.inspectCorrelation({ repoRoot, correlationId: 'missing' }), []);
  });

  void it('persists exact handoff and terminal events before worktree cleanup', async () => {
    const events = new ConductorEventEmitter();
    const store = new EngineerRunStore({ engineerDir, events });
    const run = await store.create({ repoRoot, idea: 'x' });
    await store.record(run.engineerRunId, { kind: 'run_started' });
    await store.reconcileLand(run.engineerRunId, {
      planSlug: 'exact-plan',
      track: 'product',
      tier: 'S',
      completed: ['explore', 'complexity', 'prd', 'stories', 'plan'],
      skipped: ['architecture_diagram', 'architecture_review', 'conflict_check', 'coherence_check'],
    });
    const worktree = join(repoRoot, '.worktrees', 'not-derived-from-plan');
    await mkdir(worktree, { recursive: true });
    const marker = {
      schemaVersion: 1 as const,
      engineerRunId: run.engineerRunId,
      repoRoot,
      planSlug: 'exact-plan',
      branch: 'spec/exact-plan',
    };
    await writeEngineerRunMarker(worktree, marker);
    let persistedBeforeCleanup = false;

    const result = await persistEngineerHandoffBeforeCleanup({
      store,
      marker,
      prUrl: 'https://github.com/example/repo/pull/42',
      outcome: 'pr_opened',
      cleanup: async () => {
        const replay = await store.replay(run.engineerRunId, 0);
        assert.deepEqual(replay.slice(-2).map((event) => event.type), [
          'engineer_spec_handoff',
          'engineer_run_settled',
        ]);
        persistedBeforeCleanup = true;
        await rm(worktree, { recursive: true });
      },
    });

    assert.equal(result.cleanupError, null);
    assert.equal(result.persistenceError, null);
    assert.equal(persistedBeforeCleanup, true);
    await assert.rejects(
      readFile(worktree, 'utf-8'),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
    );
    assert.partialDeepStrictEqual(await store.inspectRun(run.engineerRunId), {
      state: 'settled',
      handoff: {
        planSlug: 'exact-plan',
        branch: 'spec/exact-plan',
        prUrl: 'https://github.com/example/repo/pull/42',
        outcome: 'pr_opened',
      },
    });
  });

  void it('retains the worktree and resumes an interrupted durable handoff finalization', async () => {
    const store = new EngineerRunStore({ engineerDir, events: new ConductorEventEmitter() });
    const run = await store.create({ repoRoot, idea: 'x' });
    await store.record(run.engineerRunId, { kind: 'run_started' });
    await store.reconcileLand(run.engineerRunId, {
      planSlug: 'exact-plan',
      track: 'product',
      tier: 'S',
      completed: ['explore', 'complexity', 'prd', 'stories', 'plan'],
      skipped: ['architecture_diagram', 'architecture_review', 'conflict_check', 'coherence_check'],
    });
    const marker = {
      schemaVersion: 1 as const,
      engineerRunId: run.engineerRunId,
      repoRoot,
      planSlug: 'exact-plan',
      branch: 'spec/exact-plan',
    };
    const cleanup = mock.fn(async () => {});
    const originalRecord = store.record.bind(store);
    let recordCalls = 0;
    const recordSpy = mock.method(store, 'record', async (...args: Parameters<EngineerRunStore['record']>) => {
      recordCalls += 1;
      if (recordCalls === 2) throw new Error('durable store unavailable');
      return originalRecord(...args);
    });

    const interrupted = await persistEngineerHandoffBeforeCleanup({
      store,
      marker,
      prUrl: 'https://github.com/example/repo/pull/42',
      outcome: 'pr_opened',
      cleanup,
    });
    assert.ok(interrupted.persistenceError instanceof Error);
    assert.equal(interrupted.persistenceError.message, 'durable store unavailable');
    assert.equal(interrupted.cleanupError, null);
    assert.equal(cleanup.mock.callCount(), 0);
    assert.partialDeepStrictEqual(await store.inspectRun(run.engineerRunId), {
      state: 'awaiting_spec_merge',
      handoff: { planSlug: 'exact-plan', branch: 'spec/exact-plan' },
    });

    recordSpy.mock.restore();
    const resumed = await persistEngineerHandoffBeforeCleanup({
      store,
      marker,
      prUrl: 'https://github.com/example/repo/pull/42',
      outcome: 'pr_opened',
      cleanup,
    });
    assert.deepEqual(resumed, { persistenceError: null, cleanupError: null });
    assert.equal(cleanup.mock.callCount(), 1);
    assert.partialDeepStrictEqual(await store.inspectRun(run.engineerRunId), { state: 'settled' });
  });
});

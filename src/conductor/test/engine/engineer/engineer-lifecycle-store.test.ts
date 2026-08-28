import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ENGINEER_LIFECYCLE_CAPABILITY,
  EngineerLifecycleError,
  EngineerRunStore,
  type EngineerRunSnapshot,
} from '../../../src/engine/engineer/run-store.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

describe('EngineerRunStore', () => {
  let engineerDir: string;
  let repoRoot: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    engineerDir = await mkdtemp(join(tmpdir(), 'engineer-lifecycle-'));
    repoRoot = await mkdtemp(join(tmpdir(), 'engineer-lifecycle-repo-'));
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(engineerDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  });

  function store(): EngineerRunStore {
    return new EngineerRunStore({ engineerDir, events });
  }

  async function create(
    overrides: Partial<{ correlationId: string; attemptKey: string; idea: string }> = {},
  ): Promise<EngineerRunSnapshot> {
    return store().create({
      repoRoot,
      idea: overrides.idea ?? 'Add a health check',
      correlationId: overrides.correlationId ?? 'corr-1',
      attemptKey: overrides.attemptKey ?? 'launch-1',
    });
  }

  it('advertises the complete machine-readable capability', () => {
    expect(ENGINEER_LIFECYCLE_CAPABILITY).toBe('engineerLifecycleEventsV1');
  });

  it('creates one durable run and is idempotent for the same correlation and attempt key', async () => {
    const first = await create();
    const second = await create();

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      correlationId: 'corr-1',
      attemptKey: 'launch-1',
      attempt: 1,
      previousEngineerRunId: null,
      repoRoot,
      idea: 'Add a health check',
      eventRevision: 1,
      state: 'created',
      capability: 'engineerLifecycleEventsV1',
    });
    expect(await store().replay(first.engineerRunId, 0)).toHaveLength(1);
  });

  it('refuses attempt-key input drift, cross-repository correlation reuse, and a second live attempt', async () => {
    await create();

    await expect(create({ idea: 'Different idea' })).rejects.toMatchObject({ code: 'attempt_key_collision' });

    const otherRepo = await mkdtemp(join(tmpdir(), 'engineer-lifecycle-other-'));
    try {
      await expect(store().create({
        repoRoot: otherRepo,
        idea: 'Add a health check',
        correlationId: 'corr-1',
        attemptKey: 'launch-2',
      })).rejects.toMatchObject({ code: 'correlation_repository_collision' });
    } finally {
      await rm(otherRepo, { recursive: true, force: true });
    }

    await expect(create({ attemptKey: 'launch-2' })).rejects.toMatchObject({ code: 'live_attempt_exists' });
  });

  it('creates an immutable correlated successor with its own revision cursor', async () => {
    const first = await create();
    await store().record(first.engineerRunId, { kind: 'run_started' });
    await store().record(first.engineerRunId, { kind: 'run_failed', error: 'host exited' });

    const second = await create({ attemptKey: 'launch-2' });
    expect(second).toMatchObject({
      attempt: 2,
      previousEngineerRunId: first.engineerRunId,
      eventRevision: 1,
      state: 'created',
    });
    expect(second.engineerRunId).not.toBe(first.engineerRunId);

    await expect(store().record(first.engineerRunId, { kind: 'run_started' })).rejects.toMatchObject({
      code: 'terminal_run',
    });
    expect(await store().replay(first.engineerRunId, 0)).toHaveLength(3);
    expect(await store().replay(second.engineerRunId, 0)).toHaveLength(1);
  });

  it('allocates strictly monotonic revisions under concurrent appends', async () => {
    const run = await create();
    await store().record(run.engineerRunId, { kind: 'run_started' });

    await Promise.all([
      store().record(run.engineerRunId, { kind: 'step_started', step: 'explore' }),
      store().record(run.engineerRunId, { kind: 'step_started', step: 'complexity' }),
      store().record(run.engineerRunId, { kind: 'step_started', step: 'prd' }),
    ]);

    const replay = await store().replay(run.engineerRunId, 0);
    expect(replay.map((event) => event.revision)).toEqual([1, 2, 3, 4, 5]);
    expect((await store().inspectRun(run.engineerRunId)).eventRevision).toBe(5);
  });

  it('does not scan unrelated historical metadata when creating a run', async () => {
    const historical = await create();
    await writeFile(
      join(engineerDir, 'lifecycle', 'runs', historical.engineerRunId, 'metadata.json'),
      '{broken',
      'utf-8',
    );

    await expect(create({
      correlationId: 'unrelated-correlation',
      attemptKey: 'unrelated-attempt',
      idea: 'Add another health check',
    })).resolves.toMatchObject({
      correlationId: 'unrelated-correlation',
      attemptKey: 'unrelated-attempt',
      attempt: 1,
    });
  });

  it('does not serialize lifecycle writes for unrelated runs', async () => {
    const first = await create();
    const second = await create({ correlationId: 'corr-2', attemptKey: 'launch-2', idea: 'Other work' });
    await store().record(first.engineerRunId, { kind: 'run_started' });
    await store().record(second.engineerRunId, { kind: 'run_started' });

    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
    events.on('engineer_step_started', async (event) => {
      if (event.type === 'engineer_step_started' && event.engineerRunId === first.engineerRunId) {
        firstEntered();
        await blocked;
      }
    });

    const firstWrite = store().record(first.engineerRunId, { kind: 'step_started', step: 'explore' });
    await entered;
    try {
      await expect(Promise.race([
        store().record(second.engineerRunId, { kind: 'step_started', step: 'explore' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('unrelated write stayed blocked')), 500)),
      ])).resolves.toMatchObject({ engineerRunId: second.engineerRunId, eventRevision: 3 });
    } finally {
      releaseFirst();
      await firstWrite;
    }
  });

  it('keeps unrelated concurrent spine events out of the run-local journal', async () => {
    events.on('engineer_run_created', async () => {
      await events.emit({ type: 'dashboard_refresh' });
    });

    const run = await create();
    const replay = await store().replay(run.engineerRunId, 0);

    expect(replay.map((event) => event.type)).toEqual(['engineer_run_created']);
  });

  it('requires accepted completion and validates step retry and terminal transitions', async () => {
    const run = await create();
    await store().record(run.engineerRunId, { kind: 'run_started' });
    await store().record(run.engineerRunId, {
      kind: 'step_started',
      step: 'explore',
      provider: 'codex',
      model: 'gpt-5.6-sol',
    });

    await expect(store().record(run.engineerRunId, {
      kind: 'step_completed',
      step: 'explore',
      completion: 'tool_return' as never,
    })).rejects.toMatchObject({ code: 'invalid_completion_evidence' });

    await store().record(run.engineerRunId, {
      kind: 'step_retried',
      step: 'explore',
      reason: 'artifact rejected',
    });
    const completed = await store().record(run.engineerRunId, {
      kind: 'step_completed',
      step: 'explore',
      completion: 'accepted_result',
    });
    expect(completed.steps.explore).toMatchObject({ status: 'completed', attempt: 2 });

    await expect(store().record(run.engineerRunId, {
      kind: 'step_started',
      step: 'not-a-step' as never,
    })).rejects.toBeInstanceOf(EngineerLifecycleError);
  });

  it('replays strictly after the caller revision and refuses regression', async () => {
    const run = await create();
    await store().record(run.engineerRunId, { kind: 'run_started' });
    await store().record(run.engineerRunId, { kind: 'routing_selected', project: 'api' });

    expect((await store().replay(run.engineerRunId, 1)).map((event) => event.revision)).toEqual([2, 3]);
    await expect(store().replay(run.engineerRunId, -1)).rejects.toMatchObject({ code: 'revision_regression' });
    await expect(store().replay(run.engineerRunId, 4)).rejects.toMatchObject({ code: 'revision_ahead' });
  });

  it('refuses run identities that could escape the durable runs directory', async () => {
    await expect(store().inspectRun('../../outside')).rejects.toMatchObject({ code: 'invalid_run_id' });
    await expect(store().replay('/tmp/outside', 0)).rejects.toMatchObject({ code: 'invalid_run_id' });
  });

  it.each([
    ['product', 'S', ['explore', 'complexity', 'prd', 'stories', 'plan'], ['architecture_diagram', 'architecture_review', 'conflict_check', 'coherence_check']],
    ['technical', 'M', ['explore', 'complexity', 'architecture_diagram', 'architecture_review', 'stories', 'conflict_check', 'plan', 'coherence_check'], ['prd']],
    ['product', 'L', ['explore', 'complexity', 'prd', 'architecture_diagram', 'architecture_review', 'stories', 'conflict_check', 'plan', 'coherence_check'], []],
  ] as const)(
    'reconciles artifact-proven %s tier %s completion and skip combinations',
    async (track, tier, completed, skipped) => {
      const run = await create({ correlationId: `${track}-${tier}`, attemptKey: `${track}-${tier}` });
      await store().record(run.engineerRunId, { kind: 'run_started' });
      const reconciled = await store().reconcileLand(run.engineerRunId, {
        planSlug: `${track}-${tier}`,
        track,
        tier,
        completed: [...completed],
        skipped: [...skipped],
      });

      expect(reconciled.reconciliation).toMatchObject({ planSlug: `${track}-${tier}`, track, tier });
      for (const step of completed) expect(reconciled.steps[step]?.status).toBe('completed');
      for (const step of skipped) expect(reconciled.steps[step]?.status).toBe('skipped');
    },
  );

  it('recovers the snapshot from the append-only journal when the compact snapshot is absent', async () => {
    const run = await create();
    await store().record(run.engineerRunId, { kind: 'run_started' });
    const snapshotPath = join(engineerDir, 'lifecycle', 'runs', run.engineerRunId, 'snapshot.json');
    await rm(snapshotPath);

    const recovered = await store().inspectRun(run.engineerRunId);
    expect(recovered).toMatchObject({ engineerRunId: run.engineerRunId, eventRevision: 2, state: 'authoring' });
    expect(JSON.parse(await readFile(snapshotPath, 'utf-8'))).toMatchObject({ eventRevision: 2 });
  });

  it('refuses corrupt journals and unsupported schema versions explicitly', async () => {
    const run = await create();
    const journal = join(engineerDir, 'lifecycle', 'runs', run.engineerRunId, 'events.jsonl');
    await appendFile(journal, '{broken-json\n', 'utf-8');
    await expect(store().inspectRun(run.engineerRunId)).rejects.toMatchObject({ code: 'journal_corrupt' });

    const schemaRun = await create({ correlationId: 'corr-2', attemptKey: 'launch-schema' });
    const schemaJournal = join(engineerDir, 'lifecycle', 'runs', schemaRun.engineerRunId, 'events.jsonl');
    const raw = await readFile(schemaJournal, 'utf-8');
    await writeFile(schemaJournal, raw.replace('"schemaVersion":1', '"schemaVersion":2'), 'utf-8');
    await expect(store().inspectRun(schemaRun.engineerRunId)).rejects.toMatchObject({ code: 'schema_mismatch' });
  });
});

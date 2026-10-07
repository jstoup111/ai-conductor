import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { MetricsListener } from '../../src/engine/otel/metrics-listener.js';
import type { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { readState, writeState } from '../../src/engine/state.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { applyRebaseTransition } from '../../src/engine/rebase-transition.js';
import { rewindState } from '../../src/engine/rewind.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';

const FEATURE_A_DECLARATION = {
  step: 'acceptance_specs' as const,
  reason: 'no new behavior to specify',
  decider: { author: 'Op Erator <operator@example.com>', committer: 'Merge Bot <bot@example.com>' },
  commit: 'abc123',
};

function allDoneExcept(step: StepName, extras: Partial<ConductState> = {}): ConductState {
  const names: StepName[] = [
    'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
    'conflict_check', 'plan', 'coherence_check', 'coverage_binding', 'architecture_diagram',
    'architecture_review', 'worktree', 'acceptance_specs', 'build', 'test_suite',
    'build_review', 'manual_test', 'prd_audit', 'architecture_review_as_built', 'rebase', 'finish',
  ];
  return {
    ...Object.fromEntries(names.map((name) => [name, name === step ? 'pending' : 'done'])),
    complexity_tier: 'L',
    track: 'product',
    ...extras,
  } as ConductState;
}

describe('Conductor feature applicability dispatch', () => {
  let projectRoot: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-feature-applicability-'));
    statePath = join(projectRoot, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function conductor(runner: StepRunner, fromStep: StepName): Conductor {
    return new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep,
      mode: 'auto',
      config: { feature_applicability: { enabled: true } },
    });
  }

  it('honors feature A acceptance_specs only, persists its event, and projects it to metrics', async () => {
    await writeState(statePath, allDoneExcept('acceptance_specs', {
      applicability_declarations: [FEATURE_A_DECLARATION],
    }));
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const onStepApplicability = vi.fn();
    const recorder = {
      forFeature: () => recorder,
      onStepApplicability,
    } as unknown as MetricsRecorder;
    const listener = new MetricsListener(recorder, undefined, 'feature-a');
    persister.start();
    listener.start(events);
    try {
      await conductor(runner, 'acceptance_specs').run();
    } finally {
      listener.stop();
      persister.stop();
    }

    expect(runner.run).not.toHaveBeenCalled();
    const state = await readState(statePath);
    expect(state.ok && state.value.acceptance_specs).toBe('skipped');
    expect(state.ok && state.value.feature_inapplicable).toEqual([FEATURE_A_DECLARATION]);
    expect(onStepApplicability).toHaveBeenCalledWith({ event: 'step_inapplicable', step: 'acceptance_specs' });

    const persisted = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(persisted.filter((event) => event.type === 'step_inapplicable')).toEqual([
      expect.objectContaining({ type: 'step_inapplicable', ...FEATURE_A_DECLARATION }),
    ]);
  });

  // Covers: task:2
  it('runs markerless acceptance_specs and manual_test identically with the toggle on or off', async () => {
    const disabledProjectRoot = await mkdtemp(join(tmpdir(), 'conductor-feature-applicability-'));
    const roots = [projectRoot, disabledProjectRoot];
    try {
      const results = await Promise.all([true, false].map(async (enabled, index) => {
        const root = roots[index];
        const path = join(root, 'conduct-state.json');
        const runEvents = new ConductorEventEmitter();
        const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
        const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), runEvents);
        await writeState(path, allDoneExcept('acceptance_specs', {
          manual_test: 'pending',
          applicability_declarations: [],
        }));
        const seed = await readState(path);
        expect(seed.ok && Object.entries(seed.value)
          .filter(([, status]) => status === 'pending')
          .map(([step]) => step)).toEqual(['acceptance_specs', 'manual_test']);
        persister.start();
        try {
          await new Conductor({
            projectRoot: root,
            stateFilePath: path,
            stepRunner: runner,
            events: runEvents,
            fromStep: 'acceptance_specs',
            mode: 'auto',
            config: { feature_applicability: { enabled } },
          }).run();
        } finally {
          persister.stop();
        }

        const state = await readState(path);
        const persisted = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
          .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
        return {
          steps: (runner.run as ReturnType<typeof vi.fn>).mock.calls.map(([step]) => step),
          statuses: state.ok ? {
            acceptance_specs: state.value.acceptance_specs,
            manual_test: state.value.manual_test,
          } : undefined,
          applicabilityEvents: persisted.filter((event) => [
            'step_inapplicable',
            'step_inapplicable_ignored',
            'step_inapplicable_refused',
          ].includes(event.type as string)),
        };
      }));

      expect(results[0].steps).toEqual(results[1].steps);
      expect(results[0].statuses).toEqual(results[1].statuses);
      expect(results[0].applicabilityEvents).toEqual([]);
      expect(results[1].applicabilityEvents).toEqual([]);
    } finally {
      await rm(disabledProjectRoot, { recursive: true, force: true });
    }
  });

  it('does not leak feature A declarations into feature B with an empty seed', async () => {
    await writeState(statePath, allDoneExcept('acceptance_specs', { applicability_declarations: [] }));
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'acceptance_specs').run();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.any(Object), expect.any(Object));
    const state = await readState(statePath);
    expect(state.ok && state.value.acceptance_specs).toBe('done');
    expect(state.ok && state.value.feature_inapplicable).toBeUndefined();
  });

  it('honors a pending manual_test declaration with an unknown decider', async () => {
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    await writeState(statePath, allDoneExcept('manual_test', { applicability_declarations: [declaration] }));
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'manual_test').run();

    expect(runner.run).not.toHaveBeenCalled();
    const state = await readState(statePath);
    expect(state.ok && state.value.manual_test).toBe('skipped');
    expect(state.ok && state.value.feature_inapplicable).toEqual([declaration]);
    expect((await readVerdict(projectRoot, 'manual_test'))?.reason).toContain('inapplicable: no browser surface');
  });

  it('does not label tier and config skips as inapplicable', async () => {
    await writeState(statePath, allDoneExcept('acceptance_specs', {
      complexity_tier: 'S',
      applicability_declarations: [],
    }));
    const emitted: string[] = [];
    events.on('step_inapplicable', (event) => { emitted.push((event as typeof FEATURE_A_DECLARATION).step); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const configured = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'acceptance_specs',
      mode: 'auto',
      config: {
        feature_applicability: { enabled: true },
        steps: { manual_test: { disable: true } },
      },
    });

    await configured.run();

    expect(emitted).toEqual([]);
  });

  it('reports a toggle-off seed but dispatches the declared step normally', async () => {
    await writeState(statePath, allDoneExcept('manual_test', {
      applicability_declarations: [],
      applicability_ignored: { cause: 'toggle-off', steps: ['manual_test'] },
    }));
    const ignored: unknown[] = [];
    events.on('step_inapplicable_ignored', (event) => { ignored.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const disabled = new Conductor({
      projectRoot, stateFilePath: statePath, stepRunner: runner, events,
      fromStep: 'manual_test', mode: 'auto', config: { feature_applicability: { enabled: false } },
    });

    await disabled.run();

    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.any(Object), expect.any(Object));
    expect(ignored).toEqual([expect.objectContaining({ cause: 'toggle-off', step: 'manual_test' })]);
  });

  it('refuses a failed manual_test declaration, retries it normally, and persists the refusal', async () => {
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    await writeState(statePath, allDoneExcept('manual_test', {
      manual_test: 'failed', applicability_declarations: [declaration],
    }));
    const refused: unknown[] = [];
    events.on('step_inapplicable_refused', (event) => { refused.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await conductor(runner, 'manual_test').run();
    } finally {
      persister.stop();
    }

    const state = await readState(statePath);
    expect(state.ok && state.value.manual_test).toBe('done');
    expect(refused).toEqual([expect.objectContaining({ step: 'manual_test', priorStatus: 'failed' })]);
    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.any(Object), expect.any(Object));
    const persisted = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(persisted.filter((event) => event.type === 'step_inapplicable_refused')).toEqual([
      expect.objectContaining({ step: 'manual_test', priorStatus: 'failed' }),
    ]);
  });

  it.each(['in_progress'] as const)(
    'refuses a late manual_test declaration with prior status %s without skipping it',
    async (priorStatus) => {
      const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
      await writeState(statePath, allDoneExcept('manual_test', {
        manual_test: priorStatus, applicability_declarations: [declaration],
      }));
      const refused: unknown[] = [];
      events.on('step_inapplicable_refused', (event) => { refused.push(event); });
      const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

      await conductor(runner, 'manual_test').run();

      const state = await readState(statePath);
      expect(state.ok && state.value.manual_test).toBe('done');
      expect(state.ok && state.value.feature_inapplicable).toBeUndefined();
      expect(refused).toEqual([expect.objectContaining({ step: 'manual_test', priorStatus })]);
      expect(runner.run).toHaveBeenCalledWith('manual_test', expect.any(Object), expect.any(Object));
    },
  );

  it('refuses a declaration for an in-progress manual_test when the feature is halted', async () => {
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.pipeline', 'HALT'), 'operator intervention required\n');
    await writeState(statePath, allDoneExcept('manual_test', {
      manual_test: 'in_progress', applicability_declarations: [declaration],
    }));
    const refused: unknown[] = [];
    events.on('step_inapplicable_refused', (event) => { refused.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'manual_test').run();

    const state = await readState(statePath);
    expect(state.ok && state.value.manual_test).toBe('done');
    expect(state.ok && state.value.feature_inapplicable).toBeUndefined();
    expect(refused).toEqual([expect.objectContaining({ step: 'manual_test', priorStatus: 'in_progress' })]);
    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.any(Object), expect.any(Object));
  });

  it('refuses a late acceptance_specs declaration without changing its done status', async () => {
    await writeState(statePath, allDoneExcept('manual_test', {
      acceptance_specs: 'done',
      applicability_declarations: [FEATURE_A_DECLARATION],
    }));
    const refused: unknown[] = [];
    events.on('step_inapplicable_refused', (event) => { refused.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'manual_test').run();

    const state = await readState(statePath);
    expect(state.ok && state.value.acceptance_specs).toBe('done');
    expect(refused).toEqual([expect.objectContaining({ step: 'acceptance_specs', priorStatus: 'done' })]);
  });

  it('leaves an already-honored declaration skipped on re-dispatch without refusing it', async () => {
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    await writeState(statePath, allDoneExcept('manual_test', {
      manual_test: 'skipped', applicability_declarations: [declaration], feature_inapplicable: [declaration],
    }));
    const refused: unknown[] = [];
    events.on('step_inapplicable_refused', (event) => { refused.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'manual_test').run();

    const state = await readState(statePath);
    expect(state.ok && state.value.manual_test).toBe('skipped');
    expect(runner.run).not.toHaveBeenCalled();
    expect(refused).toEqual([]);
  });

  it('preserves an honored manual_test skip through rebase transition and operator rewind', async () => {
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    const transitionStatePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeState(transitionStatePath, allDoneExcept('manual_test', {
      manual_test: 'skipped', applicability_declarations: [declaration], feature_inapplicable: [declaration],
      build_review: 'done', prd_audit: 'done', rebase: 'done', finish: 'done', last_step: 'finish',
    }));
    const store = createFilesystemConductStateStore(transitionStatePath);

    await applyRebaseTransition({
      projectRoot,
      stateStore: store,
      operationId: 'preserve-inapplicable-manual-test',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'], preserved: [], preservedCandidates: [],
    });
    let state = await readState(transitionStatePath);
    expect(state.ok && state.value.manual_test).toBe('skipped');

    await rewindState({
      state: state.ok ? state.value : (() => { throw new Error('state should be readable'); })(),
      config: {}, target: 'build', store,
      readCurrentState: async () => {
        const current = await readState(transitionStatePath);
        if (!current.ok) throw new Error('state should be readable');
        return current.value;
      },
    });
    state = await readState(transitionStatePath);
    expect(state.ok && state.value.manual_test).toBe('skipped');
  });

  it('never honors a declaration that appears only in the worktree marker', async () => {
    await mkdir(join(projectRoot, '.docs', 'applicability'), { recursive: true });
    await writeFile(join(projectRoot, '.docs', 'applicability', 'feature-a.md'), 'Inapplicable: acceptance_specs — local only\n');
    await writeState(statePath, allDoneExcept('acceptance_specs', {
      feature_desc: 'feature-a', applicability_declarations: [FEATURE_A_DECLARATION],
    }));
    const ignored: unknown[] = [];
    events.on('step_inapplicable_ignored', (event) => { ignored.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'acceptance_specs').run();

    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.any(Object), expect.any(Object));
    expect(ignored).toEqual([expect.objectContaining({ cause: 'branch-only' })]);
  });

  it('honors a declaration whose worktree marker matches the pinned base digest', async () => {
    const content = 'Inapplicable: manual_test — no browser surface\n';
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    await mkdir(join(projectRoot, '.docs', 'applicability'), { recursive: true });
    await writeFile(join(projectRoot, '.docs', 'applicability', 'feature-a.md'), content);
    await writeState(statePath, allDoneExcept('manual_test', {
      feature_desc: 'feature-a', applicability_declarations: [declaration],
      applicability_base_content_sha256: `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`,
    }));
    const ignored: unknown[] = [];
    events.on('step_inapplicable_ignored', (event) => { ignored.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'manual_test').run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(ignored).toEqual([]);
  });

  it('reports an interactive marker without skipping an unseeded run', async () => {
    await mkdir(join(projectRoot, '.docs', 'applicability'), { recursive: true });
    await writeFile(join(projectRoot, '.docs', 'applicability', 'feature-a.md'), 'Inapplicable: manual_test — local only\n');
    await writeState(statePath, allDoneExcept('manual_test', { feature_desc: 'feature-a' }));
    const ignored: unknown[] = [];
    events.on('step_inapplicable_ignored', (event) => { ignored.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'manual_test').run();

    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.any(Object), expect.any(Object));
    expect(ignored).toEqual([expect.objectContaining({ cause: 'interactive' })]);
  });

  it('detects an undated branch-only marker for a dated feature slug', async () => {
    await mkdir(join(projectRoot, '.docs', 'applicability'), { recursive: true });
    await writeFile(join(projectRoot, '.docs', 'applicability', 'feature-a.md'), 'Inapplicable: acceptance_specs — local only\n');
    await writeState(statePath, allDoneExcept('acceptance_specs', {
      feature_desc: '2026-10-04-feature-a', applicability_declarations: [FEATURE_A_DECLARATION],
    }));
    const ignored: unknown[] = [];
    events.on('step_inapplicable_ignored', (event) => { ignored.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'acceptance_specs').run();

    expect(runner.run).toHaveBeenCalledWith('acceptance_specs', expect.any(Object), expect.any(Object));
    expect(ignored).toEqual([expect.objectContaining({ cause: 'branch-only' })]);
  });

  it('rejects a persisted non-declarable declaration but still dispatches it', async () => {
    const declaration = { step: 'prd_audit' as const, reason: 'must run', decider: 'unknown' as const };
    await writeState(statePath, allDoneExcept('prd_audit', { applicability_declarations: [declaration] }));
    const ignored: unknown[] = [];
    events.on('step_inapplicable_ignored', (event) => { ignored.push(event); });
    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };

    await conductor(runner, 'prd_audit').run();

    expect(runner.run).toHaveBeenCalledWith('prd_audit', expect.any(Object), expect.any(Object));
    expect(ignored).toEqual([expect.objectContaining({ cause: 'invalid', step: 'prd_audit' })]);
  });

  it('keeps a declared config-disabled step as config_skip', async () => {
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    await writeState(statePath, allDoneExcept('manual_test', { applicability_declarations: [declaration] }));
    const applicability: unknown[] = [];
    events.on('step_inapplicable', (event) => { applicability.push(event); });
    const configured = new Conductor({
      projectRoot, stateFilePath: statePath, events, fromStep: 'manual_test', mode: 'auto',
      stepRunner: { run: vi.fn().mockResolvedValue({ success: true }) },
      config: { feature_applicability: { enabled: true }, steps: { manual_test: { disable: true } } },
    });

    await configured.run();

    const state = await readState(statePath);
    expect(state.ok && state.value.manual_test).toBe('skipped');
    expect(state.ok && state.value.feature_inapplicable).toBeUndefined();
    expect(applicability).toEqual([]);
  });
});

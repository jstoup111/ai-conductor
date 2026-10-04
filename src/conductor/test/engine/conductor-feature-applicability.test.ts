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

  it('refuses a late declaration without changing its established status', async () => {
    const declaration = { step: 'manual_test' as const, reason: 'no browser surface', decider: 'unknown' as const };
    await writeState(statePath, allDoneExcept('manual_test', {
      manual_test: 'failed', applicability_declarations: [declaration],
    }));
    const refused: unknown[] = [];
    events.on('step_inapplicable_refused', (event) => { refused.push(event); });

    const runner: StepRunner = { run: vi.fn().mockResolvedValue({ success: true }) };
    await conductor(runner, 'manual_test').run();

    const state = await readState(statePath);
    expect(state.ok && state.value.manual_test).toBe('done');
    expect(refused).toEqual([expect.objectContaining({ step: 'manual_test', priorStatus: 'failed' })]);
    expect(runner.run).toHaveBeenCalledWith('manual_test', expect.any(Object), expect.any(Object));
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

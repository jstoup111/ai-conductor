// Covers: task:20 — invalidated typed evidence cannot admit a repair lap.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('typed PRD-audit remediation admission', () => {
  it('does not admit or charge a matching-attempt FIXABLE verdict whose gate stamp was invalidated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-typed-'));
    roots.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(planPath, '### Task 1: Existing repair\n');
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await persistPrdAuditVerdict(root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'FIXABLE',
          evidence: 'The repair is otherwise owner-bound.', rationale: 'Fixture.',
          requirementAssociations: [], evidenceTaskIds: [], ownerTaskId: '1',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [], recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: 'reviewed-head' });

    const run = vi.fn(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      config: { gate_code_validity: { enabled: true } },
      git: async (args) => args[0] === 'merge-base'
        ? { exitCode: 0, stdout: '', stderr: '' }
        : { exitCode: 0, stdout: '.docs/stories/feature.md\n', stderr: '' },
    });
    (conductor as unknown as { currentRunId?: string }).currentRunId = 'current-audit';

    const outcome = await (conductor as unknown as {
      planRemediation(
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidence: Array<{ gate: StepName; evidenceFile: string }> },
      ): Promise<{ kind: string; reason?: string }>;
    }).planRemediation(
      { session_started_at: Date.now(), feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.json' }] },
    );

    expect(outcome).toMatchObject({ kind: 'none', reason: expect.stringContaining('fresh audit') });
    expect(run).not.toHaveBeenCalled();
  });

  // Covers: task:24
  // The PRD-audit caller receives the final planner fault
  // rather than a generic missing-plan result.
  it('returns the exhausted planner fault for PRD deterministic fallback rendering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-exhaustion-'));
    roots.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(planPath, '### Task 1: Existing repair\n');
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await persistPrdAuditVerdict(root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'FIXABLE',
          evidence: 'The requested behavior is incomplete.', rationale: 'Fixture.',
          requirementAssociations: [], evidenceTaskIds: [], ownerTaskId: '1',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [], recordedDispositions: [],
    }, { attemptId: 'current-audit', codeStamp: null });
    const runner = vi.fn(async (step: StepName) => {
      if (step === 'remediate') return { success: false, output: 'final typed planner fault' };
      return { success: true };
    });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: { run: runner },
      events: new ConductorEventEmitter(),
      maxRetries: 1,
    });
    (conductor as unknown as { currentRunId?: string }).currentRunId = 'current-audit';

    const outcome = await (conductor as unknown as {
      planRemediation(
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidence: Array<{ gate: StepName; evidenceFile: string }> },
      ): Promise<{ kind: string; reason?: string }>;
    }).planRemediation(
      { session_started_at: Date.now(), feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.json' }] },
    );

    expect(runner).toHaveBeenCalledWith('remediate', expect.anything(), expect.anything());
    expect(outcome).toMatchObject({ kind: 'none', reason: 'final typed planner fault' });
  });

  // Covers: task:24
  // Refusal remains the authoritative terminal shape even
  // when the typed planner has exhausted its attempts.
  it('keeps the refused-widening HALT and appends the final planner fault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-refusal-exhaustion-'));
    roots.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
    });

    const reason = await (conductor as unknown as {
      writeRefusalReworkHalt(
        detail: string,
        refused: Array<{ criterion: string; summary: string; relation: 'outside-visible' }>,
        plannerFault: string,
      ): Promise<string>;
    }).writeRefusalReworkHalt(
      'OVER_SCOPE visible behavior on S2.1.',
      [{ criterion: 'S2.1', summary: 'Outside approved intent.', relation: 'outside-visible' }],
      'final refused planner fault',
    );

    expect(reason).toContain('Refused — rework required: S2.1.');
    expect(reason).toContain('Remediation planner fault: final refused planner fault');
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('over-scope');
  });
});

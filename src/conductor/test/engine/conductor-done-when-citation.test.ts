// Covers: task:9, task:10, task:11
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('BUILD Done-when citation judgement boundary', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'conductor-done-when-citation-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'citation.md'), '### Task 7: First\nTask seven text\n\n### Task 9: Second\nTask nine text\n');
    await writeState(join(root, '.pipeline', 'conduct-state.json'), {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      build: 'pending', feature_desc: 'citation',
      session_started_at: Date.now() - 1_000, run_started_at: Date.now() - 1_000,
    });
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function run(status: unknown, judgement = vi.fn(async () => ({
    kind: 'valid' as const,
    verdicts: [
      { taskId: '7', checkIndex: 1, verdict: 'asserts' as const, reason: 'first assertion' },
      { taskId: '9', checkIndex: 1, verdict: 'asserts' as const, reason: 'second assertion' },
    ],
  }))) {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));
    const runner: StepRunner = {
      run: async () => {
        const completed = structuredClone(status) as { tasks?: Array<{ status?: string }> };
        for (const task of completed.tasks ?? []) task.status = 'completed';
        await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(completed));
        return { success: true };
      },
      dispatchDoneWhenCitationJudgement: judgement,
    };
    await new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: runner, events: new ConductorEventEmitter(), mode: 'auto', resume: true,
      fromStep: 'build', verifyArtifacts: true, maxRetries: 1,
    } as never).run();
    return judgement;
  }

  it('dispatches one batch before BUILD completion and stamps asserting close records judged', async () => {
    const dispatch = await run({ tasks: [
      { id: '7', status: 'pending', doneWhen: [{ check: '[test] first', evidence: 'test:test/one.test.ts::first', source: 'pending-judgement' }] },
      { id: '9', status: 'pending', doneWhen: [{ check: '[test] second', evidence: 'test:test/two.test.ts::second', source: 'pending-judgement' }] },
    ] });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ citations: [
      expect.objectContaining({ taskId: '7', checkIndex: 1 }),
      expect.objectContaining({ taskId: '9', checkIndex: 1 }),
    ] }));
    const status = JSON.parse(await readFile(join(root, '.pipeline', 'task-status.json'), 'utf8'));
    expect(status.tasks.map((task: { doneWhen: Array<unknown> }) => task.doneWhen[0])).toEqual([
      expect.objectContaining({ source: 'judged', verdict: 'asserts', reason: 'first assertion' }),
      expect.objectContaining({ source: 'judged', verdict: 'asserts', reason: 'second assertion' }),
    ]);
  });

  it('does not dispatch when BUILD ends with no pending citation', async () => {
    const dispatch = await run({ tasks: [{ id: '7', status: 'pending', doneWhen: [
      { check: '[test] proven', evidence: 'test:test/one.test.ts::proven', source: 'verified' },
    ] }] });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reopens a refused citation through one durable done-when-citation obligation', async () => {
    const dispatch = await run({ tasks: [{ id: '7', status: 'pending', doneWhen: [
      { check: '[test] first', evidence: 'test:test/one.test.ts::first', source: 'pending-judgement' },
    ] }] }, vi.fn(async () => ({
      kind: 'valid' as const,
      verdicts: [{ taskId: '7', checkIndex: 1, verdict: 'does-not-assert' as const, reason: 'the cited test proves another behavior' }],
    })));

    expect(dispatch).toHaveBeenCalledOnce();
    const status = JSON.parse(await readFile(join(root, '.pipeline', 'task-status.json'), 'utf8'));
    expect(status.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: '7', status: 'pending' })]));
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    const obligations = Object.values(engine.repairObligations.records) as Array<Record<string, unknown>>;
    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({
      source: { authority: 'done-when-citation' },
      taskIds: ['7'], tasks: { '7': { status: 'open' } },
    });
  });
});

// Covers: task:9, task:10, task:11, task:14, task:17
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('BUILD Done-when citation judgement boundary', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'conductor-done-when-citation-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'citation.md'), '### Task 7: First\nTask seven text\n\n**Done when:**\n- [test] first\n\n### Task 9: Second\nTask nine text\n\n**Done when:**\n- [test] second\n');
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
  })), events = new ConductorEventEmitter(), maxRetries = 1) {
    if (status !== undefined) await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));
    let dispatches = 0;
    const runner: StepRunner = {
      run: async () => {
        // A retry continues from the prior BUILD session's durable status; it
        // must not resurrect citations that the previous boundary settled.
        if (dispatches++ === 0) {
          const completed = structuredClone(status) as { tasks?: Array<{ status?: string }> } | undefined;
          for (const task of completed?.tasks ?? []) task.status = 'completed';
          await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(completed));
        }
        return { success: true };
      },
      dispatchDoneWhenCitationJudgement: judgement,
    };
    await new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: runner, events, mode: 'auto', resume: true,
      fromStep: 'build', verifyArtifacts: true, maxRetries,
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

  it('does not dispatch or fail when BUILD has no task-status file', async () => {
    const dispatch = await run(undefined);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch or fail when BUILD has no resolved plan', async () => {
    await rm(join(root, '.docs', 'plans', 'citation.md'));
    const dispatch = await run({ tasks: [{ id: '7', status: 'pending', doneWhen: [
      { check: '[test] pending', evidence: 'test:test/one.test.ts::pending', source: 'pending-judgement' },
    ] }] });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('demotes an unavailable citation judgement without admitting a repair obligation', async () => {
    const events = new ConductorEventEmitter();
    const observed: unknown[] = [];
    events.on('build_done_when_unverified', (event) => { observed.push(event); });
    const dispatch = await run({ tasks: [{ id: '7', status: 'pending', doneWhen: [
      { check: '[test] pending', evidence: 'test:test/one.test.ts::pending', source: 'pending-judgement' },
    ] }] }, vi.fn(async () => ({ kind: 'unavailable' as const, cause: 'native schema unsupported' })), events, 2);
    // The direct demotion produces the normal one unverified-check review lap
    // without dispatching a second citation judgement.
    expect(dispatch).toHaveBeenCalledOnce();
    const status = JSON.parse(await readFile(join(root, '.pipeline', 'task-status.json'), 'utf8'));
    expect(status.tasks[0].doneWhen[0]).toMatchObject({ source: 'unverified', reason: 'citation judgement unavailable: native schema unsupported' });
    // Demotion consumes the ordinary single BUILD nudge, even over a retry
    // budget with more than one attempt; it must not emit at demotion time.
    expect(observed).toHaveLength(1);
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    expect(engine.repairObligations).toBeUndefined();
  });

  it('persists one judgement event for verdicts', async () => {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await run({ tasks: [
        { id: '7', status: 'pending', doneWhen: [{ check: '[test] first', evidence: 'test:test/one.test.ts::first', source: 'pending-judgement' }] },
        { id: '9', status: 'pending', doneWhen: [{ check: '[test] second', evidence: 'test:test/two.test.ts::second', source: 'pending-judgement' }] },
      ] }, vi.fn(async () => ({ kind: 'valid' as const, verdicts: [
        { taskId: '7', checkIndex: 1, verdict: 'asserts' as const, reason: 'asserts' },
        { taskId: '9', checkIndex: 1, verdict: 'does-not-assert' as const, reason: 'refused' },
      ] })), events);
      const judged = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
        .map((line) => JSON.parse(line)).filter((event) => event.type === 'done_when_citation_judged');
      expect(judged).toHaveLength(1);
      expect(judged[0].citations).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: '7', check: 1, verdict: 'asserts' }),
        expect.objectContaining({ taskId: '9', check: 1, verdict: 'does-not-assert' }),
      ]));
    } finally {
      persister.stop();
    }
  });

  it('persists an unavailable cause in one judgement event for an unavailable demotion', async () => {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await run({ tasks: [{ id: '7', status: 'pending', doneWhen: [
        { check: '[test] pending', evidence: 'test:test/one.test.ts::pending', source: 'pending-judgement' },
      ] }] }, vi.fn(async () => ({ kind: 'unavailable' as const, cause: 'native schema unsupported' })), events);
      const judged = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
        .map((line) => JSON.parse(line)).filter((event) => event.type === 'done_when_citation_judged');
      expect(judged).toEqual([expect.objectContaining({ citations: [
        expect.objectContaining({ taskId: '7', check: 1, unavailable: 'native schema unsupported' }),
      ] })]);
    } finally {
      persister.stop();
    }
  });

  it('emits no judgement event when BUILD ends with no pending citation', async () => {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await run({ tasks: [{ id: '7', status: 'pending', doneWhen: [
        { check: '[test] proven', evidence: 'test:test/one.test.ts::proven', source: 'verified' },
      ] }] }, undefined, events);
      const judged = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
        .map((line) => JSON.parse(line)).filter((event) => event.type === 'done_when_citation_judged');
      expect(judged).toEqual([]);
    } finally {
      persister.stop();
    }
  });

  it('reopens a refused citation through one durable done-when-citation obligation', async () => {
    const dispatch = await run({ tasks: [{ id: '7', status: 'pending', doneWhen: [
      { check: '[test] first', evidence: 'test:test/one.test.ts::first', source: 'pending-judgement' },
    ] }] }, vi.fn(async () => ({
      kind: 'valid' as const,
      verdicts: [{ taskId: '7', checkIndex: 1, verdict: 'does-not-assert' as const, reason: 'the cited test proves another behavior' }],
    })));

    // The bounded follow-up BUILD session settles the refused citation without
    // sending a duplicate citation judgement.
    expect(dispatch).toHaveBeenCalledOnce();
    const status = JSON.parse(await readFile(join(root, '.pipeline', 'task-status.json'), 'utf8'));
    expect(status.tasks).toEqual(expect.arrayContaining([expect.objectContaining({
      id: '7', status: 'completed', doneWhen: [expect.objectContaining({ source: 'unverified' })],
    })]));
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    expect(engine.repairObligations).toBeUndefined();
  });
});

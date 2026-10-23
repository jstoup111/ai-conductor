// Covers: task:7
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const exec = promisify(execFile);

describe('BUILD remediation-closure judgement boundary', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'conductor-remediation-closure-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'closure.md'), [
      '### Task 4: Citation task', 'Citation text.', '', '**Done when:**', '- [test] cited check.', '',
      '### Task rem-as-built-R5: First remediation', 'Named repair one.', '', '**Done when:**', '- Repair one is committed.', '',
      '### Task rem-as-built-R11: Second remediation', 'Named repair two.', '', '**Done when:**', '- Repair two is committed.', '',
    ].join('\n'));
    await writeState(join(root, '.pipeline', 'conduct-state.json'), {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      build: 'pending', feature_desc: 'closure', session_started_at: Date.now() - 1_000, run_started_at: Date.now() - 1_000,
    });
    await exec('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await exec('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root });
    await writeFile(join(root, '.gitignore'), '.pipeline/\n');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-q', '-m', 'chore: fixture'], { cwd: root });
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('settles citations before judging every eligible remediation close and does not rejudge them', async () => {
    const status = { tasks: [
      { id: '4', status: 'pending', doneWhen: [{ check: '[test] cited check.', evidence: 'test:test/citation.test.ts::cited', source: 'pending-judgement' }] },
      { id: 'rem-as-built-R5', status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported deadbee', source: 'reported' }] },
      { id: 'rem-as-built-R11', status: 'completed', doneWhen: [{ check: 'Repair two is committed.', evidence: 'reported deadbee', source: 'reported' }] },
    ] };
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));
    const calls: string[] = [];
    const citations = vi.fn(async () => {
      calls.push('citation');
      return { kind: 'valid' as const, verdicts: [{ taskId: '4', checkIndex: 1, verdict: 'asserts' as const, reason: 'cited' }] };
    });
    const closures = vi.fn(async (input: { candidates: Array<{ taskId: string; citedCommits: unknown[] }> }) => {
      calls.push('closure');
      expect(input.candidates.map(({ taskId }) => taskId)).toEqual(['rem-as-built-R5', 'rem-as-built-R11']);
      expect(input.candidates.every(({ citedCommits }) => citedCommits.length === 0)).toBe(true);
      return { kind: 'valid' as const, attempts: 1, verdicts: input.candidates.map(({ taskId }) => ({ taskId, verdict: 'resolved' as const, rationale: 'Named repair is present.' })) };
    });
    const runner: StepRunner = {
      run: async () => {
        const current = JSON.parse(await readFile(join(root, '.pipeline', 'task-status.json'), 'utf8'));
        current.tasks[0].status = 'completed';
        await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(current));
        return { success: true };
      },
      dispatchDoneWhenCitationJudgement: citations,
      dispatchRemediationClosureJudgement: closures,
    };

    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

    expect(calls).toEqual(['citation', 'closure']);
    expect(citations).toHaveBeenCalledOnce();
    expect(closures).toHaveBeenCalledOnce();
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    const verdicts = engine.remediationClosure.plans['.docs/plans/closure.md'].tasks;
    expect(Object.values(verdicts).flatMap((task: any) => Object.values(task.verdicts))).toEqual([
      expect.objectContaining({ verdict: 'resolved', disposition: 'left-closed' }),
      expect.objectContaining({ verdict: 'resolved', disposition: 'left-closed' }),
    ]);
  });

  it('includes a remediation close demoted from pending citation evidence', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{
      id: 'rem-as-built-R5', status: 'completed', doneWhen: [
        { check: '[test] cited check.', evidence: 'test:test/citation.test.ts::cited', source: 'pending-judgement' },
      ],
    }] }));
    const closures = vi.fn(async (input: { candidates: Array<{ taskId: string }> }) => ({
      kind: 'valid' as const, attempts: 1,
      verdicts: input.candidates.map(({ taskId }) => ({ taskId, verdict: 'resolved' as const, rationale: 'Repair is present.' })),
    }));
    const runner: StepRunner = {
      run: async () => ({ success: true }),
      dispatchDoneWhenCitationJudgement: vi.fn(async () => ({ kind: 'unavailable' as const, cause: 'unavailable' })),
      dispatchRemediationClosureJudgement: closures,
    };
    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

    expect(closures).toHaveBeenCalledWith(expect.objectContaining({ candidates: [expect.objectContaining({ taskId: 'rem-as-built-R5' })] }));
  });

  it('excludes a remediation task whose citation was refused in this pass', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{
      id: 'rem-as-built-R5', status: 'completed', doneWhen: [
        { check: '[test] cited check.', evidence: 'test:test/citation.test.ts::cited', source: 'pending-judgement' },
      ],
    }] }));
    const closures = vi.fn();
    const runner: StepRunner = {
      run: async () => ({ success: true }),
      dispatchDoneWhenCitationJudgement: vi.fn(async () => ({
        kind: 'valid' as const,
        verdicts: [{ taskId: 'rem-as-built-R5', checkIndex: 1, verdict: 'does-not-assert' as const, reason: 'wrong test' }],
      })),
      dispatchRemediationClosureJudgement: closures,
    };
    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

    expect(closures).not.toHaveBeenCalled();
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    expect(Object.values(engine.repairObligations.records)).toHaveLength(1);
  });
});

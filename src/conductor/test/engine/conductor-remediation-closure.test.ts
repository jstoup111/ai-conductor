// Covers: task:7, task:8, task:9, task:10, task:11, task:12, task:14
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { applyRemediationClosureVerdicts, remediationCloseIdentity, replayRemediationClosureReopens, runRemediationClosurePass } from '../../src/engine/remediation-closure-judgement.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { readPlanGrowthBudget } from '../../src/engine/remediation-caps.js';
import { createRepairObligationStore } from '../../src/engine/repair-obligations.js';
import { restageExistingRemediationTaskStatuses } from '../../src/engine/repair-restage.js';
import { recordRemediationClosureVerdicts } from '../../src/engine/remediation-closure-state.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { resolveTaskIdsWithDiagnostics } from '../../src/engine/task-progress.js';
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

  it.each([
    ['a tracked modification', async () => writeFile(join(root, '.gitignore'), '.pipeline/\nchanged\n')],
    ['an untracked non-ignored file', async () => writeFile(join(root, 'untracked'), 'present\n')],
  ])('does not judge a close from a dirty tree (%s)', async (_caseName, makeDirty) => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{
      id: 'rem-as-built-R5', status: 'completed',
      doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported deadbee', source: 'reported' }],
    }] }));
    await makeDirty();
    const closures = vi.fn();
    const runner: StepRunner = {
      run: async () => ({ success: true }),
      dispatchRemediationClosureJudgement: closures,
    };
    const git = async (args: string[], options: { cwd: string }) => {
      const { stdout } = await exec('git', args, { cwd: options.cwd });
      return { stdout, exitCode: 0 };
    };

    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), git, mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

    expect(closures).not.toHaveBeenCalled();
    const state = JSON.parse(await readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8'));
    expect(state.build).not.toBe('done');
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    expect(engine.remediationClosure).toBeUndefined();
  });

  it('judges an eligible remediation close without the citation port', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{
      id: 'rem-as-built-R5', status: 'completed',
      doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported deadbee', source: 'reported' }],
    }] }));
    const closures = vi.fn(async (input: { candidates: Array<{ taskId: string }> }) => ({
      kind: 'valid' as const, attempts: 1,
      verdicts: input.candidates.map(({ taskId }) => ({ taskId, verdict: 'resolved' as const, rationale: 'Present.' })),
    }));
    const runner: StepRunner = { run: async () => ({ success: true }), dispatchRemediationClosureJudgement: closures };

    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

    expect(closures).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({ taskId: 'rem-as-built-R5' })],
    }));
  });

  it('does not send an ordinary reported task to the closure judge', async () => {
    await writeFile(join(root, '.docs', 'plans', 'no-rem.md'), [
      '### Task 4: Citation task', 'Citation text.', '', '**Done when:**', '- [test] cited check.', '',
    ].join('\n'));
    const state = JSON.parse(await readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8'));
    state.feature_desc = 'no-rem';
    await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify(state));
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{
      id: '4', status: 'completed',
      doneWhen: [{ check: 'cited check.', evidence: 'reported deadbee', source: 'reported' }],
    }] }));
    const closures = vi.fn();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const runner: StepRunner = { run: async () => ({ success: true }), dispatchRemediationClosureJudgement: closures };

    try {
      await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
        events, mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

      expect(closures).not.toHaveBeenCalled();
      const records = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
        .filter(Boolean).map((line) => JSON.parse(line));
      expect(records.filter((event) => event.type === 'remediation_closure_judged')).toEqual([]);
    } finally {
      persister.stop();
    }
  });

  it('records every close unjudged when the judge is unavailable after two attempts', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: '4', status: 'completed', doneWhen: [] },
      { id: 'rem-as-built-R5', status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported deadbee', source: 'reported' }] },
      { id: 'rem-as-built-R11', status: 'completed', doneWhen: [{ check: 'Repair two is committed.', evidence: 'reported deadbee', source: 'reported' }] },
    ] }));
    const closures = vi.fn(async () => ({ kind: 'unavailable' as const, attempts: 2, cause: 'provider failed twice' }));
    const retries: unknown[] = [];
    const runner: StepRunner = { run: async (_step, _state, options) => { retries.push(options?.retryReason); return { success: true }; }, dispatchRemediationClosureJudgement: closures };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();

    try {
      await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
        events, mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

      expect(closures).toHaveBeenCalledOnce();
      const [status, state, engine] = await Promise.all([
        readFile(join(root, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8').then(JSON.parse),
      ]);
      expect(status.tasks.filter((task: { id: string }) => task.id.startsWith('rem-as-built-'))
        .map((task: { status: string }) => task.status)).toEqual(['completed', 'completed']);
      expect([state.build, retries]).toEqual(['done', [undefined]]);
      expect(Object.values(engine.repairObligations?.records ?? {})).toEqual([]);
      expect(Object.values(engine.remediationClosure.plans['.docs/plans/closure.md'].tasks)
        .flatMap((task: any) => Object.values(task.verdicts))).toEqual([
        expect.objectContaining({ verdict: 'unjudged', disposition: 'left-closed', applied: false }),
        expect.objectContaining({ verdict: 'unjudged', disposition: 'left-closed', applied: false }),
      ]);
      const judged = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
        .filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.type === 'remediation_closure_judged');
      expect(judged).toEqual([expect.objectContaining({ outcome: 'unjudged', attempts: 2, candidates: [
        expect.objectContaining({ taskId: 'rem-as-built-R5', verdict: 'unjudged' }),
        expect.objectContaining({ taskId: 'rem-as-built-R11', verdict: 'unjudged' }),
      ] })]);
    } finally {
      persister.stop();
    }
  });

  it('records eligible closes unjudged when the runner has no closure-judgement port', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{
      id: 'rem-as-built-R5', status: 'completed',
      doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported deadbee', source: 'reported' }],
    }] }));
    const runner: StepRunner = { run: async () => ({ success: true }) };

    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

    const [status, engine] = await Promise.all([
      readFile(join(root, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse),
      readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8').then(JSON.parse),
    ]);
    expect(status.tasks[0].status).toBe('completed');
    expect(Object.values(engine.repairObligations?.records ?? {})).toEqual([]);
    expect(Object.values(engine.remediationClosure.plans['.docs/plans/closure.md'].tasks['rem-as-built-R5'].verdicts))
      .toEqual([expect.objectContaining({ verdict: 'unjudged', disposition: 'left-closed', applied: false })]);
  });

  it('does not rejudge a close recorded unjudged without a new close identity', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const planText = await readFile(planPath, 'utf8');
    const status = { tasks: [{
      id: 'rem-as-built-R5', status: 'completed',
      doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported deadbee', source: 'reported' }],
    }] };
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));

    await runRemediationClosurePass({ projectRoot: root, planPath, planText, status,
      scopeTaskIds: ['rem-as-built-R5'] });
    const dispatch = vi.fn(async () => ({ kind: 'valid' as const, verdicts: [{
      taskId: 'rem-as-built-R5', verdict: 'resolved' as const, rationale: 'Present.',
    }] }));
    await runRemediationClosurePass({ projectRoot: root, planPath, planText, status,
      scopeTaskIds: ['rem-as-built-R5'], dispatch });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('judges only the execution child\'s remediation close in a stacked feature', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const planText = await readFile(planPath, 'utf8');
    await writeFile(join(root, '.pipeline', 'coverage-binding.json'), JSON.stringify({
      version: 1, slug: 'closure', runId: 'run', status: 'done', entries: [],
      sliceMembership: { taskSlices: { '4': 2 }, titles: ['child two'] },
    }));
    await writeFile(planPath, planText.replace(
      'Named repair one.', 'Named repair one.\n\n**Child:** 1',
    ).replace(
      'Named repair two.', 'Named repair two.\n\n**Child:** 2',
    ));
    const closures = vi.fn(async (input: { candidates: Array<{ taskId: string }> }) => ({
      kind: 'valid' as const,
      verdicts: input.candidates.map(({ taskId }) => ({ taskId, verdict: 'resolved' as const, rationale: 'Present.' })),
    }));

    const status = { tasks: [
      { id: 'rem-as-built-R5', status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }] },
      { id: 'rem-as-built-R11', status: 'completed', doneWhen: [{ check: 'Repair two is committed.', evidence: 'reported', source: 'reported' }] },
    ] };
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));
    await runRemediationClosurePass({
      projectRoot: root, planPath, planText: await readFile(planPath, 'utf8'),
      status,
      scopeTaskIds: ['rem-as-built-R5', 'rem-as-built-R11'], activeChild: parseChildId(2)!, dispatch: closures,
    });

    expect(closures).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({ taskId: 'rem-as-built-R11' })],
    }));
  });

  it.each([
    ['a rebase rewrite', (row: Record<string, unknown>) => ({ ...row, commit: 'new-sha', startHead: 'new-head' })],
    ['done-when acceptance', (row: Record<string, unknown>) => ({ ...row, doneWhen: [{ ...(row.doneWhen as object[])[0], source: 'operator-accepted' }] })],
    ['citation settlement', (row: Record<string, unknown>) => ({ ...row, doneWhen: [{ ...(row.doneWhen as object[])[0], source: 'unverified' }] })],
  ])('does not rejudge an unchanged close after %s', async (_caseName, rewrite) => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const planText = await readFile(planPath, 'utf8');
    const row = { id: 'rem-as-built-R5', status: 'completed', commit: 'old-sha', startHead: 'old-head', doneWhen: [
      { check: 'Repair one is committed.', evidence: 'reported deadbee', source: 'reported' },
    ] };
    const closures = vi.fn(async (input: { candidates: Array<{ taskId: string }> }) => ({
      kind: 'valid' as const,
      verdicts: input.candidates.map(({ taskId }) => ({ taskId, verdict: 'resolved' as const, rationale: 'Present.' })),
    }));
    const pass = async (status: unknown) => {
      await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));
      return runRemediationClosurePass({
        projectRoot: root, planPath, planText, status, scopeTaskIds: ['rem-as-built-R5'], dispatch: closures,
      });
    };

    await pass({ tasks: [row] });
    await pass({ tasks: [rewrite(row)] });

    expect(closures).toHaveBeenCalledOnce();
  });

  it('does not judge a trailer-restored remediation task until it has fresh Done-when evidence', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const planText = await readFile(planPath, 'utf8');
    const closures = vi.fn(async (input: { candidates: Array<{ taskId: string }> }) => ({
      kind: 'valid' as const,
      verdicts: input.candidates.map(({ taskId }) => ({ taskId, verdict: 'resolved' as const, rationale: 'Present.' })),
    }));
    const pass = async (status: unknown) => {
      await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));
      return runRemediationClosurePass({
        projectRoot: root, planPath, planText, status, scopeTaskIds: ['rem-as-built-R5'], dispatch: closures,
      });
    };

    await pass({ tasks: [{ id: 'rem-as-built-R5', status: 'completed', restored_from: 'task-trailer', doneWhen: [] }] });
    await pass({ tasks: [{ id: 'rem-as-built-R5', status: 'completed', doneWhen: [
      { check: 'Repair one is committed.', evidence: 'fresh close', source: 'reported' },
    ] }] });

    expect(closures).toHaveBeenCalledOnce();
    expect(closures).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({ taskId: 'rem-as-built-R5' })],
    }));
  });

  it('reopens persists and partial verdicts through settled obligations while leaving resolved siblings closed', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const records = [
      { taskId: 'rem-as-built-R5', title: 'First remediation', closeRecords: [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }] },
      { taskId: 'rem-as-built-R11', title: 'Second remediation', closeRecords: [{ check: 'Repair two is committed.', evidence: 'reported', source: 'reported' }] },
    ].map((candidate) => ({ ...candidate, closeIdentity: remediationCloseIdentity(candidate.taskId, 0, candidate.closeRecords) }));
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: 'rem-as-built-R5', status: 'completed', doneWhen: records[0].closeRecords },
      { id: 'rem-as-built-R11', status: 'completed', doneWhen: records[1].closeRecords },
    ] }));

    const reopened = await applyRemediationClosureVerdicts({
      projectRoot: root, planPath, candidates: records,
      verdicts: [
        { taskId: 'rem-as-built-R5', verdict: 'persists', rationale: 'The named repair is absent.' },
        { taskId: 'rem-as-built-R11', verdict: 'partial', rationale: 'Only part of the named repair is present.' },
      ],
    });

    expect(reopened.map(({ taskId, reason }) => ({ taskId, reason }))).toEqual([
      { taskId: 'rem-as-built-R5', reason: 'Remediation closure reopened: Task rem-as-built-R5 "First remediation": The named repair is absent.' },
      { taskId: 'rem-as-built-R11', reason: 'Remediation closure reopened: Task rem-as-built-R11 "Second remediation": Only part of the named repair is present.' },
    ]);
    const [status, engine] = await Promise.all([
      readFile(join(root, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse),
      readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8').then(JSON.parse),
    ]);
    expect(status.tasks.filter((task: { id: string }) => task.id.startsWith('rem-')).map((task: { status: string }) => task.status)).toEqual(['pending', 'pending']);
    const obligations = Object.values(engine.repairObligations.records) as Array<any>;
    expect(obligations).toEqual(expect.arrayContaining(records.map((candidate, index) => expect.objectContaining({
      settlement: 'settled', source: expect.objectContaining({ authority: 'remediation-closure', findingId: candidate.closeIdentity, instruction: expect.stringContaining(index === 0 ? 'absent' : 'part') }),
    }))));
    expect(Object.values(engine.remediationClosure.plans['.docs/plans/closure.md'].tasks)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reopenCount: 1 }), expect.objectContaining({ reopenCount: 1 }),
    ]));
  });

  it('bounds remediation reopens at two per task and reports the terminal disposition', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const taskId = 'rem-as-built-R5';
    const close = async (number: number) => {
      const closeRecords = [{ check: 'Repair one is committed.', evidence: `reported close ${number}`, source: 'reported' }];
      const candidate = { taskId, title: 'First remediation', closeRecords, closeIdentity: remediationCloseIdentity(taskId, number, closeRecords) };
      await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: taskId, status: 'completed', doneWhen: closeRecords }] }));
      return applyRemediationClosureVerdicts({ projectRoot: root, planPath, candidates: [candidate], verdicts: [{ taskId, verdict: 'persists', rationale: 'The named repair is absent.' }] });
    };

    expect(await close(0)).toHaveLength(1);
    expect(await close(1)).toHaveLength(1);
    expect(await close(2)).toHaveLength(0);
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    const task = engine.remediationClosure.plans['.docs/plans/closure.md'].tasks[taskId];
    expect(task.reopenCount).toBe(2);
    expect(Object.values(task.verdicts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ disposition: 'bound-exhausted', applied: false }),
    ]));
  });

  it('hands off after two reopened closes and records the terminal bound-exhausted pass', async () => {
    const taskId = 'rem-as-built-R5';
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: '4', status: 'completed', doneWhen: [] },
      { id: taskId, status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported close 0', source: 'reported' }] },
      { id: 'rem-as-built-R11', status: 'completed', doneWhen: [] },
    ] }));
    let runs = 0;
    const closures = vi.fn(async (input: { candidates: Array<{ taskId: string }> }) => ({
      kind: 'valid' as const, attempts: 1,
      verdicts: input.candidates.map(({ taskId: candidateId }) => ({ taskId: candidateId, verdict: 'persists' as const, rationale: 'Repair is absent.' })),
    }));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: {
        run: async () => {
          runs += 1;
          if (runs > 1) {
            await writeFile(join(root, `repair-${runs}.txt`), `repair ${runs}\n`);
            await exec('git', ['add', `repair-${runs}.txt`], { cwd: root });
            await exec('git', ['commit', '-q', '-m', `repair ${runs}\n\nTask: ${taskId}`], { cwd: root });
            await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
              { id: '4', status: 'completed', doneWhen: [] },
              { id: taskId, status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: `reported close ${runs - 1}`, source: 'reported' }] },
              { id: 'rem-as-built-R11', status: 'completed', doneWhen: [] },
            ] }));
          }
          return { success: true };
        },
        dispatchRemediationClosureJudgement: closures,
      }, events, mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 3 } as never).run();

      const [status, state, engine, eventsText] = await Promise.all([
        readFile(join(root, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'),
      ]);
      expect([runs, closures.mock.calls.length, status.tasks[0].status, state.build]).toEqual([3, 3, 'completed', 'done']);
      expect(Object.values(engine.repairObligations?.records ?? {})).toHaveLength(2);
      const terminalIdentity = remediationCloseIdentity(taskId, 2, [{
        check: 'Repair one is committed.', evidence: 'reported close 2', source: 'reported',
      }]);
      expect(Object.values(engine.repairObligations.records)).not.toContainEqual(expect.objectContaining({
        source: expect.objectContaining({ authority: 'remediation-closure', findingId: terminalIdentity }),
      }));
      expect(eventsText.trim().split('\n').map(JSON.parse).filter((event) => event.type === 'remediation_closure_judged').at(-1))
        .toMatchObject({ outcome: 'judged', candidates: [expect.objectContaining({ taskId, disposition: 'bound-exhausted' })] });
    } finally {
      persister.stop();
    }
  });

  it('leaves a persists verdict closed on the last allowed BUILD attempt and hands off', async () => {
    const taskId = 'rem-as-built-R5';
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: '4', status: 'completed', doneWhen: [] },
      { id: taskId, status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported close', source: 'reported' }] },
      { id: 'rem-as-built-R11', status: 'completed', doneWhen: [] },
    ] }));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: {
        run: async () => ({ success: true }),
        dispatchRemediationClosureJudgement: async (input) => ({ kind: 'valid' as const, attempts: 1, verdicts: input.candidates.map(({ taskId: candidateId }) => ({ taskId: candidateId, verdict: 'persists' as const, rationale: 'Repair is absent.' })) }),
      }, events, mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();
      const [status, state, engine, eventsText] = await Promise.all([
        readFile(join(root, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'),
      ]);
      expect([status.tasks[0].status, state.build, Object.values(engine.repairObligations?.records ?? {})]).toEqual(['completed', 'done', []]);
      expect(eventsText.trim().split('\n').map(JSON.parse).filter((event) => event.type === 'remediation_closure_judged'))
        .toEqual([expect.objectContaining({ attempts: 1, candidates: [expect.objectContaining({ taskId, disposition: 'bound-exhausted' })] })]);
    } finally {
      persister.stop();
    }
  });

  it('applies verdicts returned on the second attempt and persists one judged event with each disposition', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: 'rem-as-built-R5', status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }] },
      { id: 'rem-as-built-R11', status: 'completed', doneWhen: [{ check: 'Repair two is committed.', evidence: 'reported', source: 'reported' }] },
    ] }));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: {
        run: async (_step, _state, options) => options?.retryReason ? { success: false } : { success: true },
        dispatchRemediationClosureJudgement: async () => ({ kind: 'valid' as const, attempts: 2, verdicts: [
          { taskId: 'rem-as-built-R11', verdict: 'persists' as const, rationale: 'Second repair is absent.' },
          { taskId: 'rem-as-built-R5', verdict: 'resolved' as const, rationale: 'First repair is present.' },
        ] }),
      }, events, mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 2 } as never).run();
      const judged = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
        .filter(Boolean).map(JSON.parse).filter((event) => event.type === 'remediation_closure_judged');
      expect(judged).toEqual([expect.objectContaining({ outcome: 'judged', attempts: 2, candidates: expect.arrayContaining([
        expect.objectContaining({ taskId: 'rem-as-built-R11', verdict: 'persists', rationale: 'Second repair is absent.', disposition: 'reopened' }),
        expect.objectContaining({ taskId: 'rem-as-built-R5', verdict: 'resolved', rationale: 'First repair is present.', disposition: 'left-closed' }),
      ]) })]);
    } finally {
      persister.stop();
    }
  });

  it('emits one structured pass result for a valid or unavailable closure judgement', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const planText = await readFile(planPath, 'utf8');
    const status = { tasks: [{ id: 'rem-as-built-R5', status: 'completed', doneWhen: [
      { check: 'Repair one is committed.', evidence: 'reported', source: 'reported' },
    ] }] };
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify(status));
    const passes: unknown[] = [];
    await runRemediationClosurePass({ projectRoot: root, planPath, planText, status, scopeTaskIds: ['rem-as-built-R5'],
      dispatch: async () => ({ kind: 'unavailable', attempts: 2, cause: 'provider failed twice' }),
      onJudged: (pass) => { passes.push(pass); },
    });
    expect(passes).toEqual([expect.objectContaining({ outcome: 'unjudged', attempts: 2, candidates: [
      expect.objectContaining({ taskId: 'rem-as-built-R5', verdict: 'unjudged', disposition: 'left-closed' }),
    ] })]);
  });

  it('keeps pre-reopen trailers, ledger and growth from resolving or charging, and binds a child reopen at its branch head', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const taskId = 'rem-as-built-R5';
    const closeRecords = [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }];
    const candidate = { taskId, title: 'First remediation', closeRecords, closeIdentity: remediationCloseIdentity(taskId, 0, closeRecords) };
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: taskId, status: 'completed', doneWhen: closeRecords }] }));
    await writeFile(join(root, 'old-repair.ts'), 'old repair\n');
    await exec('git', ['add', 'old-repair.ts'], { cwd: root });
    await exec('git', ['commit', '-q', '-m', `old repair\n\nTask: ${taskId}`], { cwd: root });
    const [ledgerBefore, growthBefore] = await Promise.all([
      readKickbackLedger(root), readPlanGrowthBudget(root, {}, { persist: true }),
    ]);
    await exec('git', ['branch', 'feat/c2/closure'], { cwd: root });

    await applyRemediationClosureVerdicts({
      projectRoot: root, planPath, candidates: [candidate], branch: 'feat/c2/closure',
      verdicts: [{ taskId, verdict: 'persists', rationale: 'The named repair is absent.' }],
    });

    expect((await resolveTaskIdsWithDiagnostics(root, [taskId])).resolved).toEqual(new Set());
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    const obligation = Object.values(engine.repairObligations.records)[0] as any;
    expect(obligation.baseline).toMatchObject({ branch: 'feat/c2/closure' });
    expect(obligation.baseline.head).toBe((await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim());
    await writeFile(join(root, 'fresh-repair.ts'), 'fresh repair\n');
    await exec('git', ['add', 'fresh-repair.ts'], { cwd: root });
    await exec('git', ['commit', '-q', '-m', `fresh repair\n\nTask: ${taskId}`], { cwd: root });
    await exec('git', ['branch', '-f', 'feat/c2/closure', 'HEAD'], { cwd: root });
    expect((await resolveTaskIdsWithDiagnostics(root, [taskId])).resolved).toEqual(new Set([taskId]));
    await expect(readKickbackLedger(root)).resolves.toEqual(ledgerBefore);
    await expect(readPlanGrowthBudget(root, {}, { persist: true })).resolves.toEqual(growthBefore);
  });

  it('puts a citation refusal before the closure reopen in the next BUILD retry hint', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: '4', status: 'completed', doneWhen: [{ check: '[test] cited check.', evidence: 'test:test/citation.test.ts::cited', source: 'pending-judgement' }] },
      { id: 'rem-as-built-R5', status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }] },
    ] }));
    const hints: string[] = [];
    const runner: StepRunner = {
      run: async (_step, _state, options: any) => { if (options?.retryReason) hints.push(options.retryReason); return { success: true }; },
      dispatchDoneWhenCitationJudgement: async () => ({ kind: 'valid' as const, verdicts: [{ taskId: '4', checkIndex: 1, verdict: 'does-not-assert' as const, reason: 'does not test the claim' }] }),
      dispatchRemediationClosureJudgement: async (input) => ({ kind: 'valid' as const, attempts: 1, verdicts: input.candidates.map(({ taskId }) => ({ taskId, verdict: 'persists' as const, rationale: 'Named repair absent.' })) }),
    };
    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 2 } as never).run();
    const retryHint = hints.find((hint) => hint.includes('Remediation closure reopened:'));
    expect(retryHint).toMatch(/Done-when citation refused:.*\nRemediation closure reopened:/s);
    expect(retryHint).toContain('rem-as-built-R5');
    expect(retryHint).toContain('Named repair absent.');
  });

  it.each(['verdict', 'admission', 'restage'] as const)(
    'replays a crash after the %s write exactly once',
    async (stopAfter) => {
      const planPath = join(root, '.docs', 'plans', 'closure.md');
      const taskId = 'rem-as-built-R5';
      const closeRecords = [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }];
      const closeIdentity = remediationCloseIdentity(taskId, 0, closeRecords);
      await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
        { id: taskId, status: 'completed', doneWhen: closeRecords },
      ] }));
      await recordRemediationClosureVerdicts(root, planPath, [{
        taskId, closeIdentity, verdict: 'persists', rationale: 'The named repair is absent.', disposition: 'reopened',
      }]);
      const repairs = createRepairObligationStore(root, join(root, '.pipeline', 'engine-state.json'));
      const admission = {
        id: `remediation-closure-${closeIdentity.slice(0, 16)}`,
        planPath,
        taskIds: [taskId],
        source: { findingId: closeIdentity, authority: 'remediation-closure', instruction: `Task ${taskId} "First remediation": The named repair is absent.` },
        baseline: { head: '', tree: '', resolvedTaskIds: [], resolvedCount: 1 },
      } as const;
      if (stopAfter !== 'verdict') {
        const admitted = await repairs.admitOrReplay(`remediation-closure:${closeIdentity}`, admission);
        expect(admitted.ok).toBe(true);
        if (admitted.ok) expect((await repairs.markSettled({ planPath, obligationId: admitted.obligation.id })).ok).toBe(true);
      }
      if (stopAfter === 'restage') {
        expect(await restageExistingRemediationTaskStatuses(root, planPath, new Set([taskId]))).toEqual({ kind: 'restaged' });
      }

      await replayRemediationClosureReopens({ projectRoot: root, planPath, planText: await readFile(planPath, 'utf8'), scopeTaskIds: [taskId] });

      const [status, engine] = await Promise.all([
        readFile(join(root, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse),
        readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8').then(JSON.parse),
      ]);
      expect(status.tasks[0].status).toBe('pending');
      expect(Object.values(engine.repairObligations.records)).toHaveLength(1);
      expect(engine.remediationClosure.plans['.docs/plans/closure.md'].tasks[taskId].reopenCount).toBe(1);
    },
  );

  it('blocks completion without dispatching when remediation-closure durable state is malformed', async () => {
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
      { id: 'rem-as-built-R5', status: 'completed', doneWhen: [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }] },
    ] }));
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ remediationClosure: { version: 0, plans: {} } }));
    const dispatch = vi.fn(async () => ({ kind: 'valid' as const, attempts: 1, verdicts: [] }));
    const hints: string[] = [];
    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: {
      run: async (_step, _state, options: any) => { hints.push(options?.retryReason ?? ''); return { success: true }; },
      dispatchRemediationClosureJudgement: dispatch,
    }, events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 2 } as never).run();
    expect(dispatch).not.toHaveBeenCalled();
    expect(hints.some((hint) => hint.includes('malformed remediation-closure verdict record'))).toBe(true);
    const state = JSON.parse(await readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8'));
    expect(state.build).not.toBe('done');
  });

  it('gives a fresh conductor the persisted remediation-closure repair hint', async () => {
    const planPath = join(root, '.docs', 'plans', 'closure.md');
    const taskId = 'rem-as-built-R5';
    const closeRecords = [{ check: 'Repair one is committed.', evidence: 'reported', source: 'reported' }];
    const candidate = { taskId, title: 'First remediation', closeRecords, closeIdentity: remediationCloseIdentity(taskId, 0, closeRecords) };
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: taskId, status: 'completed', doneWhen: closeRecords }] }));
    await applyRemediationClosureVerdicts({ projectRoot: root, planPath, candidates: [candidate], verdicts: [{ taskId, verdict: 'persists', rationale: 'The named repair is absent.' }] });
    const hints: string[] = [];
    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: {
      run: async (_step, _state, options: any) => { hints.push(options?.retryReason ?? ''); return { success: false }; },
    }, events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();
    expect(hints[0]).toContain(`Task ${taskId} "First remediation": The named repair is absent.`);
    const engine = JSON.parse(await readFile(join(root, '.pipeline', 'engine-state.json'), 'utf8'));
    expect(engine.remediationClosure.plans['.docs/plans/closure.md'].tasks[taskId].reopenCount).toBe(1);
  });
});

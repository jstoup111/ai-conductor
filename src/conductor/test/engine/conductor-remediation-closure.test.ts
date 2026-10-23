// Covers: task:7, task:8, task:9
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { applyRemediationClosureVerdicts, remediationCloseIdentity, runRemediationClosurePass } from '../../src/engine/remediation-closure-judgement.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { readPlanGrowthBudget } from '../../src/engine/remediation-caps.js';
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
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{
      id: '4', status: 'completed',
      doneWhen: [{ check: 'cited check.', evidence: 'reported deadbee', source: 'reported' }],
    }] }));
    const closures = vi.fn();
    const runner: StepRunner = { run: async () => ({ success: true }), dispatchRemediationClosureJudgement: closures };

    await new Conductor({ projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), mode: 'auto', resume: true, fromStep: 'build', verifyArtifacts: true, maxRetries: 1 } as never).run();

    expect(closures).not.toHaveBeenCalled();
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
});

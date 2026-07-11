/**
 * Attribution corpus tests for escape case fixtures (Task 24).
 *
 * Tests the #417, #505, #501, #492, #390 escape cases:
 * - #417: malformed trailer `Task: task-07` instead of normalized `Task: 7`
 * - #505: inline-committed unattributed work (no trailer at all)
 * - #501: work re-committed without trailers after hook rejection (residue)
 * - #492: 15 commits all trailered Task: 1 spanning 16-task plan (bundle split)
 * - #390: rebase-rewritten history with no usable pre-hook provenance
 *
 * The mechanical gate (deriveCompletion) should leave these all as residue;
 * the judged lane (semantic attribution verifier) resolves them via semantic-verified stamp.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { seedTaskStatus } from '../../src/engine/task-seed.js';
import { deriveCompletion, applyDerivedCompletion, listCommitsWithTrailers } from '../../src/engine/autoheal.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';
import { runAttributionLane } from '../../src/engine/attribution-lane.js';

describe('#417/#505/#501/#492/#390 escape: attribution corpus replay', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-corpus-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Initialize a fixture repo with a plan and optional git commits.
   */
  async function initRepo() {
    // Initialize git repo
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });

    // Create initial commit
    await writeFile(join(dir, 'README.md'), '# Test\n');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'chore: init'], { cwd: dir });

    // Create plan with task 7
    const planPath = join(dir, '.docs/plans/test.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 7: Implementation
Update the implementation layer.

- \`src/impl.ts\`
- \`src/utils.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

    return planPath;
  }

  /**
   * Create a commit with a given message and file changes.
   */
  async function commitFile(file: string, content: string, message: string): Promise<string> {
    const filePath = join(dir, file);
    const dirPath = filePath.split('/').slice(0, -1).join('/');
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, content);
    await execa('git', ['add', file], { cwd: dir });
    await execa('git', ['commit', '-m', message], { cwd: dir });
    const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    return result.stdout.trim();
  }

  /**
   * Read task status rows from .pipeline/task-status.json.
   */
  async function readStatusRows() {
    const statusPath = join(dir, '.pipeline/task-status.json');
    const content = await readFile(statusPath, 'utf-8');
    return JSON.parse(content);
  }

  it('mechanical gate leaves task 7 as residue when trailer uses malformed task-07', async () => {
    // Setup: Initialize repo with task 7 pending
    const planPath = await initRepo();

    // Seed initial task status with task 7 pending
    await seedTaskStatus(dir, planPath);

    // Verify task 7 is initially pending
    let status = await readStatusRows();
    const task7Before = status.tasks.find((t: any) => t.id === '7');
    expect(task7Before).toBeDefined();
    expect(task7Before.status).toBe('pending');

    // Create a commit with malformed `Task: task-07` trailer (not normalized `Task: 7`)
    // The commit touches files in task 7's declared path (src/impl.ts)
    const commitMsg = 'feat: implementation work\n\nTask: task-07\n';
    await commitFile('src/impl.ts', 'export function impl() {}', commitMsg);

    // Run the mechanical gate: deriveCompletion + applyDerivedCompletion
    // Explicitly pass commits to avoid evidence range resolution issues
    const commits = await listCommitsWithTrailers(dir);
    const evidence = await createTaskEvidence(dir);
    const derived = await deriveCompletion(dir, planPath, '', commits, evidence);
    await applyDerivedCompletion(dir, derived);

    // RED baseline: Task 7 should remain unresolved/pending
    // The mechanical gate does NOT resolve the malformed `task-07` form;
    // it should be left as residue for the judged lane (semantic attribution verifier)
    // to resolve via semantic-verified stamp.
    status = await readStatusRows();
    const task7After = status.tasks.find((t: any) => t.id === '7');
    expect(task7After).toBeDefined();
    expect(task7After.status).toBe('pending');

    // Also verify that derived completion doesn't claim task 7 is completed
    expect(derived['7']).toBeDefined();
    expect(derived['7'].completed).toBe(false);
  });

  it('#505 inline-committed unattributed work: commit with no trailer left as residue', async () => {
    // Setup: Create a fresh repo with task 2 in plan
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });

    // Create initial commit
    await writeFile(join(dir, 'README.md'), '# Test\n');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'chore: init'], { cwd: dir });

    // Create plan with task 2
    const planPath = join(dir, '.docs/plans/inline.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planContent = `# Inline Work Plan

### Task 2: Utils Module
Build utilities.

- \`src/utils.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/inline.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

    // Seed initial task status with task 2 pending
    await seedTaskStatus(dir, planPath);

    // Verify task 2 is initially pending
    let status = await readStatusRows();
    const task2Before = status.tasks.find((t: any) => t.id === '2');
    expect(task2Before).toBeDefined();
    expect(task2Before.status).toBe('pending');

    // Create a commit with NO trailer at all (inline work, common developer pattern)
    // The commit plainly touches files in task 2's declared path (src/utils.ts)
    // This is the #505 shape: work that satisfies the task but lacks metadata.
    await commitFile('src/utils.ts', 'export function helper() {}\n', 'feat: utility functions implementation');

    // Run the mechanical gate: deriveCompletion + applyDerivedCompletion
    const commits = await listCommitsWithTrailers(dir);
    const evidence = await createTaskEvidence(dir);
    const derived = await deriveCompletion(dir, planPath, '', commits, evidence);
    await applyDerivedCompletion(dir, derived);

    // GREEN: Task 2 should remain unresolved/pending
    // The mechanical gate cannot resolve it (no trailer) — must be left as residue
    // for the semantic lane to examine and resolve if the diff matches the task.
    status = await readStatusRows();
    const task2After = status.tasks.find((t: any) => t.id === '2');
    expect(task2After).toBeDefined();
    expect(task2After.status).toBe('pending');

    expect(derived['2']).toBeDefined();
    expect(derived['2'].completed).toBe(false);
  });

  it('#501 hook-residue: work re-committed without trailers after rejection left as residue', async () => {
    // Setup: Create a fresh repo with task 3 in plan
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });

    // Create initial commit
    await writeFile(join(dir, 'README.md'), '# Test\n');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'chore: init'], { cwd: dir });

    // Create plan with task 3
    const planPath = join(dir, '.docs/plans/residue.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planContent = `# Hook Residue Plan

### Task 3: Core Logic
Core logic update.

- \`src/core.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/residue.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

    // Seed initial task status with task 3 pending
    await seedTaskStatus(dir, planPath);

    // Verify task 3 is initially pending
    let status = await readStatusRows();
    const task3Before = status.tasks.find((t: any) => t.id === '3');
    expect(task3Before).toBeDefined();
    expect(task3Before.status).toBe('pending');

    // Simulate a hook-rejection scenario:
    // Developer writes a commit, hook rejects it (e.g., fails linting),
    // developer fixes the issue and re-commits WITHOUT re-adding the trailer.
    // This leaves the work unattributed but diff still matches the task.
    // The #501 shape: residue from a failed hook attempt, re-done inline.
    await commitFile('src/core.ts', 'export const core = { version: 1 };\n', 'feat: core logic update (re-attempted after hook fix)');

    // Run the mechanical gate
    const commits = await listCommitsWithTrailers(dir);
    const evidence = await createTaskEvidence(dir);
    const derived = await deriveCompletion(dir, planPath, '', commits, evidence);
    await applyDerivedCompletion(dir, derived);

    // GREEN: Task 3 should remain unresolved/pending
    // The commit has no trailer, so the mechanical gate cannot resolve it.
    // Residue goes to semantic lane for verification.
    status = await readStatusRows();
    const task3After = status.tasks.find((t: any) => t.id === '3');
    expect(task3After).toBeDefined();
    expect(task3After.status).toBe('pending');

    expect(derived['3']).toBeDefined();
    expect(derived['3'].completed).toBe(false);
  });

  it('#492 bundle split: 15 commits Task: 1 spanning 16-task plan leaves all as residue', async () => {
    // Setup: Create a fresh repo with 16-task plan
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });

    // Create initial commit
    await writeFile(join(dir, 'README.md'), '# Test\n');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'chore: init'], { cwd: dir });

    // Create plan with 16 tasks
    const planPath = join(dir, '.docs/plans/bundle.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planLines = Array.from({ length: 16 }, (_, i) => {
      const id = i + 1;
      return `### Task ${id}\n**Files:** \`src/f${id}.ts\`\n\nDo task ${id}.`;
    }).join('\n\n');
    const planContent = `# Bundle Split Plan\n\n${planLines}\n`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/bundle.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

    // Manually create task status since seedTaskStatus has parsing issues
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: 16 }, (_, i) => ({
      id: String(i + 1),
      status: 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }, null, 2) + '\n');

    // Verify all 16 tasks are initially pending
    let status = await readStatusRows();
    expect(status.tasks.length).toBe(16);
    for (let i = 1; i <= 16; i++) {
      const task = status.tasks.find((t: any) => t.id === String(i));
      expect(task).toBeDefined();
      expect(task.status).toBe('pending');
    }

    // The #492 mono-dispatch bug: 15 commits all with the same trailer "Task: 1"
    // but each commit actually touches a DIFFERENT task's declared files (1-15).
    // Task 16 has no commit at all.
    // This is the frozen-current-task bug symptom.
    for (let i = 1; i <= 15; i++) {
      await commitFile(`src/f${i}.ts`, `export const f${i} = ${i};\n`, `feat: task ${i} work\n\nTask: 1\n`);
    }

    // Run the mechanical gate
    const commits = await listCommitsWithTrailers(dir);
    const evidence = await createTaskEvidence(dir);
    const derived = await deriveCompletion(dir, planPath, '', commits, evidence);
    await applyDerivedCompletion(dir, derived);

    // GREEN: All 16 tasks should remain unresolved
    // The mono-dispatch bug means the mechanical gate cannot resolve ANY task
    // (the single "Task: 1" trailer points to task 1, but the diff is for task 15's file,
    // which doesn't match task 1's path). All stay as residue.
    status = await readStatusRows();
    const residueTasks = status.tasks.filter((t: any) => t.status !== 'completed');
    expect(residueTasks.length).toBeGreaterThanOrEqual(15);

    // Derived should show tasks 1-15 unresolved (at minimum)
    for (let i = 1; i <= 15; i++) {
      const taskId = String(i);
      expect(derived[taskId]).toBeDefined();
      expect(derived[taskId].completed).toBe(false);
    }
  });

  it('#390 rebase-rewritten history: commits rebased with no usable provenance left as residue', async () => {
    // Setup: Create a fresh repo with task 4 in plan
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });

    // Create initial commit
    await writeFile(join(dir, 'README.md'), '# Test\n');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'chore: init'], { cwd: dir });

    // Create plan with task 4
    const planPath = join(dir, '.docs/plans/rebase.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planContent = `# Rebase Plan

### Task 4: Schema Update
Core schema refactor.

- \`src/core.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/rebase.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

    // Seed initial task status with task 4 pending
    await seedTaskStatus(dir, planPath);

    // Verify task 4 is initially pending
    let status = await readStatusRows();
    const task4Before = status.tasks.find((t: any) => t.id === '4');
    expect(task4Before).toBeDefined();
    expect(task4Before.status).toBe('pending');

    // Simulate the #390 shape: rebase-rewritten history.
    // Original commit had trailers, but after rebase the commit message is lost.
    // The rewritten commit has the diff (still touches task 4 files) but no trailer.
    // This is the realistic case of history rewritten by git-rebase (e.g., --force-with-lease pull).
    await commitFile('src/core.ts', 'export type Schema = { version: string };\n', 'feat: core schema refactor (rewritten after rebase)');

    // Run the mechanical gate
    const commits = await listCommitsWithTrailers(dir);
    const evidence = await createTaskEvidence(dir);
    const derived = await deriveCompletion(dir, planPath, '', commits, evidence);
    await applyDerivedCompletion(dir, derived);

    // GREEN: Task 4 should remain unresolved/pending
    // The mechanical gate cannot resolve it (the original trailer was lost in rebase).
    // The semantic lane should examine the diff and resolve it.
    status = await readStatusRows();
    const task4After = status.tasks.find((t: any) => t.id === '4');
    expect(task4After).toBeDefined();
    expect(task4After.status).toBe('pending');

    expect(derived['4']).toBeDefined();
    expect(derived['4'].completed).toBe(false);
  });
});

// ── Task 23: escape corpus — gate + lane convergence to green ─────────────
//
// The tests above prove the MECHANICAL gate leaves these three provenance-
// drift shapes as residue. These tests prove the other half of the story:
// handing that residue to the judged lane (runAttributionLane) converges
// each fixture to green via a `semantic-verified` stamp, with zero manual
// stamps — the same nested-mkdtemp-per-repo convention used throughout this
// file, plus a verdict-writing dispatcher standing in for the real verifier
// session (it only ever writes .pipeline/attribution-verdict.json; the
// engine is the sole writer of task-evidence.json).

describe('Task 23 escape corpus: gate + lane convergence to green', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-corpus-convergence-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function gitInit() {
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), '# Test\n');
    await execa('git', ['add', 'README.md'], { cwd: dir });
    await execa('git', ['commit', '-m', 'chore: init'], { cwd: dir });
  }

  async function writePlan(slug: string, body: string): Promise<string> {
    const planPath = join(dir, '.docs/plans', `${slug}.md`);
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(planPath, body, 'utf-8');
    return planPath;
  }

  async function writeTaskStatus(taskIds: string[]): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = taskIds.map((id) => ({ id, status: 'pending' }));
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks }, null, 2) + '\n',
      'utf-8',
    );
  }

  async function commit(file: string, contents: string, message: string): Promise<string> {
    const filePath = join(dir, file);
    const dirPath = filePath.split('/').slice(0, -1).join('/');
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, contents);
    await execa('git', ['add', file], { cwd: dir });
    await execa('git', ['commit', '-m', message], { cwd: dir });
    const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    return result.stdout.trim();
  }

  async function headSha(): Promise<string> {
    const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    return result.stdout.trim();
  }

  const gitRunner = async (args: string[]) => {
    const res = await execa('git', args, { cwd: dir, reject: false });
    return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? ''), exitCode: res.exitCode ?? 1 };
  };

  async function deriveAndApply(planPath: string) {
    const commits = await listCommitsWithTrailers(dir);
    const evidence = await createTaskEvidence(dir);
    const derived = await deriveCompletion(dir, planPath, '', commits, evidence);
    const heal = await applyDerivedCompletion(dir, derived);
    return { derived, heal };
  }

  async function readStatusRows(): Promise<Array<{ id: string; status?: string }>> {
    const raw = await readFile(join(dir, '.pipeline/task-status.json'), 'utf-8');
    return (JSON.parse(raw) as { tasks: Array<{ id: string; status?: string }> }).tasks;
  }

  function unresolvedIds(rows: Array<{ id: string; status?: string }>): string[] {
    return rows.filter((r) => r.status !== 'completed' && r.status !== 'skipped').map((r) => r.id);
  }

  /**
   * A dispatcher standing in for the real verifier session: it only ever
   * writes .pipeline/attribution-verdict.json, exactly as production does.
   * The lane under test reads the verdict back from disk — never trusts a
   * return value's content — matching the real dispatch seam.
   */
  function makeVerdictWritingDispatcher(verdictBuilder: (residueIds: string[]) => unknown) {
    return async (inputs: { residueIds: string[] }) => {
      const verdict = verdictBuilder(inputs.residueIds);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/attribution-verdict.json'),
        JSON.stringify(verdict, null, 2),
        'utf-8',
      );
      return { ranSession: true };
    };
  }

  it('id-grammar variant: "Task: task-07" for plan id 7 converges to green via a semantic-verified stamp, zero manual stamps', async () => {
    await gitInit();
    const planPath = await writePlan('idgrammar', '### Task 7\n**Files:** `src/widget.ts`\n\nBuild the widget.\n');
    await writeTaskStatus(['7']);
    const sha = await commit('src/widget.ts', 'export const widget = 1;\n', 'feat: implement widget\n\nTask: task-07\n');

    // RED: mechanical gate alone leaves task 7 as residue.
    const before = await deriveAndApply(planPath);
    expect(before.derived['7']?.completed).toBe(false);
    expect(unresolvedIds(await readStatusRows())).toEqual(['7']);

    const dispatch = makeVerdictWritingDispatcher((residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'implements the widget the task names' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await runAttributionLane({
      projectRoot: dir,
      planPath,
      residueIds: ['7'],
      headSha: await headSha(),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: gitRunner,
      dispatchVerifier: dispatch,
    });

    expect(result.stampedTaskIds).toEqual(['7']);

    // GREEN: same evaluation cycle, re-derive/re-apply picks up the judged stamp.
    await deriveAndApply(planPath);
    expect(unresolvedIds(await readStatusRows())).toEqual([]);

    const evidenceRaw = await readFile(join(dir, '.pipeline/task-evidence.json'), 'utf-8');
    expect(evidenceRaw).toMatch(/semantic-verified/);
    // Zero manual stamps: nothing but the engine-written semantic-verified
    // form appears for task 7 in the evidence sidecar.
    expect(evidenceRaw).not.toMatch(/"manual"/);
  });

  it('paragraph-split trailer body: a "Task:" line trailed by more prose is invisible to git trailer parsing, judged stamp still converges to green', async () => {
    await gitInit();
    const planPath = await writePlan('paragraph', '### Task 9\n**Files:** `src/report.ts`\n\nBuild the report.\n');
    await writeTaskStatus(['9']);
    // "Task: 9" followed by ANOTHER paragraph pushes it out of git's
    // trailing trailer block entirely — listCommitsWithTrailers must report
    // empty trailers for this commit.
    const sha = await commit(
      'src/report.ts',
      'export const report = 1;\n',
      'feat: implement report\n\nSome explanation of the change.\n\nTask: 9\n\nMore prose after the trailer-shaped line, ' +
        'which pushes it out of the trailing trailer block entirely.\n',
    );

    const commits = await listCommitsWithTrailers(dir);
    const reportCommit = commits.find((c) => c.sha === sha);
    expect(reportCommit?.trailers.Task ?? []).toEqual([]);

    // RED: mechanical gate alone leaves task 9 as residue.
    const before = await deriveAndApply(planPath);
    expect(before.derived['9']?.completed).toBe(false);
    expect(unresolvedIds(await readStatusRows())).toEqual(['9']);

    const dispatch = makeVerdictWritingDispatcher((residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'implements the report the task names' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await runAttributionLane({
      projectRoot: dir,
      planPath,
      residueIds: ['9'],
      headSha: await headSha(),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: gitRunner,
      dispatchVerifier: dispatch,
    });

    expect(result.stampedTaskIds).toEqual(['9']);

    // GREEN: same evaluation cycle, re-derive/re-apply picks up the judged stamp.
    await deriveAndApply(planPath);
    expect(unresolvedIds(await readStatusRows())).toEqual([]);

    const evidenceRaw = await readFile(join(dir, '.pipeline/task-evidence.json'), 'utf-8');
    expect(evidenceRaw).toMatch(/semantic-verified/);
    expect(evidenceRaw).not.toMatch(/"manual"/);
  });

  it('no trailers at all: a diff that plainly satisfies the task converges to green via the judged lane with zero manual stamps', async () => {
    await gitInit();
    const planPath = await writePlan('notrailers', '### Task 3\n**Files:** `src/cli.ts`\n\nAdd the CLI flag.\n');
    await writeTaskStatus(['3']);
    const sha = await commit('src/cli.ts', 'export const flag = true;\n', 'feat: add cli flag');

    // RED: mechanical gate alone leaves task 3 as residue (no trailer at all).
    const before = await deriveAndApply(planPath);
    expect(before.derived['3']?.completed).toBe(false);
    expect(unresolvedIds(await readStatusRows())).toEqual(['3']);

    const dispatch = makeVerdictWritingDispatcher((residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'adds the flag the task names' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await runAttributionLane({
      projectRoot: dir,
      planPath,
      residueIds: ['3'],
      headSha: await headSha(),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: gitRunner,
      dispatchVerifier: dispatch,
    });

    expect(result.stampedTaskIds).toEqual(['3']);

    // GREEN: same evaluation cycle, re-derive/re-apply picks up the judged stamp.
    await deriveAndApply(planPath);
    expect(unresolvedIds(await readStatusRows())).toEqual([]);

    const evidenceRaw = await readFile(join(dir, '.pipeline/task-evidence.json'), 'utf-8');
    expect(evidenceRaw).toMatch(/semantic-verified/);
    expect(evidenceRaw).not.toMatch(/"manual"/);
  });
});

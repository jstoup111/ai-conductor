/**
 * Attribution corpus tests for id-grammar variant escape cases (Task 23).
 *
 * Tests the #417 escape case: malformed trailer `Task: task-07` instead of
 * normalized `Task: 7`. The mechanical gate (deriveCompletion) should leave
 * task 7 as residue; the judged lane (semantic attribution verifier) resolves it.
 *
 * Acceptance criteria:
 * - Fixture repo initialized with task 7 pending
 * - Commit uses malformed `Task: task-07` trailer (not normalized `Task: 7`)
 * - Commit diff satisfies the task (touches plan paths)
 * - deriveCompletion + applyDerivedCompletion (mechanical gate) runs
 * - Task 7 remains unresolved/pending (RED baseline: test fails because
 *   the malformed id-grammar is not yet handled by the mechanical gate)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { seedTaskStatus } from '../../src/engine/task-seed.js';
import { deriveCompletion, applyDerivedCompletion } from '../../src/engine/autoheal.js';

describe('#417 escape: id-grammar variant (malformed task-07)', () => {
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
    const derived = await deriveCompletion(dir, planPath);
    await applyDerivedCompletion(dir, derived);

    // RED baseline: Task 7 should remain unresolved/pending
    // The mechanical gate does NOT resolve the malformed `task-07` form;
    // it should be left as residue for the judged lane (semantic attribution verifier)
    // to resolve via semantic-verified stamp.
    status = await readStatusRows();
    const task7After = status.tasks.find((t: any) => t.id === '7');
    expect(task7After).toBeDefined();
    expect(task7After.status).toBe('pending');

    // Also verify that derived completion doesn't claim task 7 is completed.
    // Debug output to see what the actual value is
    console.log('Derived completion result for task 7:', JSON.stringify(derived['7'], null, 2));
    expect(derived['7']).toBeDefined();
    expect(derived['7'].completed).toBe(false);
  });
});

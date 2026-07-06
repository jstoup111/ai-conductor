import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for listCommitsWithTrailers (Task 2, autoheal trailer parsing).
//
// Tests parsing of Task: and Evidence: trailers from git commit bodies.
// Uses real git repos with temporary test commits.
//
// Acceptance criteria:
// 1. Body-only `Task: 3` trailer is parsed and read correctly
// 2. Two trailers in one commit yield both task IDs
// 3. Malformed forms (`Task:3`, `task: 3`, `Tasks: 3`) are NOT parsed as trailers
// 4. `Evidence:` trailer values are captured alongside `Task:` trailers
// 5. Uses git log format `%(trailers)` to extract trailers from commit bodies
// ─────────────────────────────────────────────────────────────────────────────

async function loadAutoheal() {
  return import('../../src/engine/autoheal.js');
}

let tmpDir: string;
let gitDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'autoheal-test-'));
  gitDir = tmpDir;

  // Initialize a git repo for testing
  await execa('git', ['init'], { cwd: gitDir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: gitDir });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: gitDir });

  // Create initial commit
  await writeFile(join(gitDir, 'README.md'), '# Test\n');
  await execa('git', ['add', 'README.md'], { cwd: gitDir });
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: gitDir });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('listCommitsWithTrailers', () => {
  it('parses a simple Task: trailer from commit body', async () => {
    const mod = await loadAutoheal();

    // Create a commit with Task: trailer
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: test feature\n\nTask: 3\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    // Find the test commit by subject
    const testCommit = result.find(c => c.subject === 'feat: test feature');
    expect(testCommit).toBeDefined();
    expect(testCommit!.trailers).toHaveProperty('Task');
    expect(testCommit!.trailers.Task).toEqual(['3']);
  });

  it('captures multiple Task trailers in one commit', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: multiple tasks\n\nTask: 2\nTask: 3\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    const testCommit = result.find(c => c.subject === 'feat: multiple tasks');
    expect(testCommit).toBeDefined();
    expect(testCommit!.trailers.Task).toEqual(['2', '3']);
  });

  it('captures Evidence trailers alongside Task trailers', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: with evidence\n\nTask: 3\nEvidence: automated-test-passed\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    const testCommit = result.find(c => c.subject === 'feat: with evidence');
    expect(testCommit).toBeDefined();
    expect(testCommit!.trailers.Task).toEqual(['3']);
    expect(testCommit!.trailers.Evidence).toEqual(['automated-test-passed']);
  });

  it('does not parse Task:3 (no space after colon) as a trailer', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: nospace\n\nTask:3\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    const testCommit = result.find(c => c.subject === 'feat: nospace');
    expect(testCommit).toBeDefined();
    // Should not have Task trailer or should be empty
    expect(testCommit!.trailers.Task).toBeUndefined();
  });

  it('does not parse task: 3 (lowercase) as a trailer', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: case test\n\nTask: 3\ntask: 4\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    const testCommit = result.find(c => c.subject === 'feat: case test');
    expect(testCommit).toBeDefined();
    // Only Task: 3 should be captured, not task: 4
    expect(testCommit!.trailers.Task).toEqual(['3']);
  });

  it('does not parse Tasks: 3 (plural) as a Task trailer', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: plural test\n\nTask: 3\nTasks: 4\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    const testCommit = result.find(c => c.subject === 'feat: plural test');
    expect(testCommit).toBeDefined();
    // Only Task: 3 should be captured, not Tasks: 4
    expect(testCommit!.trailers.Task).toEqual(['3']);
  });

  it('returns commit sha and subject along with trailers', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: meaningful work\n\nTask: 1\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    const testCommit = result.find(c => c.subject === 'feat: meaningful work');
    expect(testCommit).toBeDefined();
    expect(testCommit!).toHaveProperty('sha');
    expect(testCommit!).toHaveProperty('subject');
    expect(testCommit!.subject).toBe('feat: meaningful work');
    expect(testCommit!.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('handles commits with no trailers', async () => {
    const mod = await loadAutoheal();

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: work without trailers\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    const testCommit = result.find(c => c.subject === 'feat: work without trailers');
    expect(testCommit).toBeDefined();
    expect(testCommit!.trailers).toEqual({});
  });

  it('handles multiple commits with mixed trailer presence', async () => {
    const mod = await loadAutoheal();

    // First commit with trailers
    await writeFile(join(gitDir, 'file1.txt'), 'content1');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: first\n\nTask: 1\n'], { cwd: gitDir });

    // Second commit without trailers
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: second\n'], { cwd: gitDir });

    // Third commit with trailers
    await writeFile(join(gitDir, 'file3.txt'), 'content3');
    await execa('git', ['add', 'file3.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: third\n\nTask: 3\nEvidence: done\n'], { cwd: gitDir });

    const result = await mod.listCommitsWithTrailers(gitDir);

    // Should include the initial commit plus 3 new commits (but we only care about the 3 new ones)
    expect(result.length).toBeGreaterThanOrEqual(3);

    // Find commits with trailers
    const withTrailers = result.filter(c => Object.keys(c.trailers).length > 0);
    expect(withTrailers.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for parsePlanTasks (Task 4, plan task name extraction).
//
// Tests parsing of `### Task N: Title` headers from plan markdown.
// Extracts task ids, names, and paths from plan documents.
//
// Acceptance criteria:
// 1. Parser extracts `### Task N: Title` headers from plan markdown
// 2. Returns a map of task id → {name, paths} for each task
// 3. Existing path extraction logic is unchanged/reused
// 4. Numeric ids only for now (Task 18 will extend to alphanumeric)
// 5. Handles malformed headers gracefully (skip or error appropriately)
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePlanTasks', () => {
  it('extracts task id and name from a simple Task header', async () => {
    const mod = await loadAutoheal();

    const planText = '# My Plan\n\n### Task 1: Initialize project\n\nSome description here.\n';
    const result = mod.parsePlanTasks(planText);

    expect(result.has('1')).toBe(true);
    const task1 = result.get('1');
    expect(task1).toBeDefined();
    expect(task1!.name).toBe('Initialize project');
    expect(Array.isArray(task1!.paths)).toBe(true);
  });

  it('extracts task names for multiple tasks', async () => {
    const mod = await loadAutoheal();

    const planText = `# My Plan

### Task 1: Setup
Initial setup work.

### Task 2: Build core
Build the main feature.

### Task 3: Testing
Add tests and verify.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('1')).toBe(true);
    expect(result.has('2')).toBe(true);
    expect(result.has('3')).toBe(true);
    expect(result.get('1')!.name).toBe('Setup');
    expect(result.get('2')!.name).toBe('Build core');
    expect(result.get('3')!.name).toBe('Testing');
  });

  it('extracts paths alongside task names', async () => {
    const mod = await loadAutoheal();

    const planText = `# My Plan

### Task 1: Update API
Update the API layer.

- Modify \`src/api/handler.ts\`
- Update \`src/types/api.ts\`

### Task 2: Update UI
Update the user interface.

- Change \`src/components/Button.tsx\`
`;
    const result = mod.parsePlanTasks(planText);

    const task1 = result.get('1');
    expect(task1).toBeDefined();
    expect(task1!.name).toBe('Update API');
    expect(task1!.paths).toContain('src/api/handler.ts');
    expect(task1!.paths).toContain('src/types/api.ts');

    const task2 = result.get('2');
    expect(task2).toBeDefined();
    expect(task2!.name).toBe('Update UI');
    expect(task2!.paths).toContain('src/components/Button.tsx');
  });

  it('handles numeric-only task ids', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 18: Large task
Details.

### Task 100: Numbered task
More details.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('18')).toBe(true);
    expect(result.has('100')).toBe(true);
    expect(result.get('18')!.name).toBe('Large task');
    expect(result.get('100')!.name).toBe('Numbered task');
  });

  it('skips headers without a title after the task id', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Good title
Details.

### Task 2
This header has no title after the id.

### Task 3: Another good title
More details.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('1')).toBe(true);
    expect(result.has('2')).toBe(false);
    expect(result.has('3')).toBe(true);
  });

  it('handles headers at different markdown levels', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

## Task 1: H2 level
Details.

### Task 2: H3 level
More details.

#### Task 3: H4 level
Even more.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('1')).toBe(true);
    expect(result.has('2')).toBe(true);
    expect(result.has('3')).toBe(true);
  });

  it('preserves task name text exactly as written (including spaces)', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Multiple   Spaces   In   Name
Details.

### Task 2: Name with special chars (like this)
More details.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.get('1')!.name).toBe('Multiple   Spaces   In   Name');
    expect(result.get('2')!.name).toBe('Name with special chars (like this)');
  });

  it('does not match non-task headers', async () => {
    const mod = await loadAutoheal();

    const planText = `# My Plan

### Implementation Guide
Some guide content.

### Step 1: Do something
Another section.

### Task 1: The real task
The actual task.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.size).toBe(1);
    expect(result.has('1')).toBe(true);
  });

  it('extracts paths for tasks with matching path format', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Code changes
Work on code.

- \`src/index.ts\`
- \`src/utils.ts\`
- \`test/index.test.ts\`

### Task 2: Docs only
Update documentation.

- \`README.md\`
`;
    const result = mod.parsePlanTasks(planText);

    const task1Paths = result.get('1')!.paths;
    expect(task1Paths).toContain('src/index.ts');
    expect(task1Paths).toContain('src/utils.ts');
    expect(task1Paths).toContain('test/index.test.ts');

    const task2Paths = result.get('2')!.paths;
    expect(task2Paths).toContain('README.md');
  });

  it('returns empty paths array when no paths found for task', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: No files
This task mentions no files at all.

Just some regular text here.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.get('1')!.paths).toEqual([]);
  });
});

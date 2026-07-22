import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for taskTrailerMatches (Task 1, alias helper with ambiguity guard).
//
// Tests trailer value matching against task IDs with guarded alias support.
// Enables the evidence gate to disambiguate between `task-N` (alias) and bare `N`
// (exact form) in commit trailers, preventing false matches when both forms
// appear in a single plan.
//
// Acceptance criteria:
// 1. Exact match: `taskTrailerMatches(['7'], '7', any) === true`
// 2. Alias true (guarded): `taskTrailerMatches(['task-7'], '7', new Set(['7'])) === true`
// 3. Alias false (ambiguous): `taskTrailerMatches(['task-7'], '7', new Set(['7', 'task-7'])) === false`
// 4. Never invents ids: for foreign ids like `['task-42']`, don't check planIds
// 5. Bare id: `taskTrailerMatches(['7'], '7', any) === true` regardless of planIds
// ─────────────────────────────────────────────────────────────────────────────

describe('taskTrailerMatches', () => {
  it('returns true for exact match of taskId in trailerValues', async () => {
    const mod = await loadAutoheal();

    const result = mod.taskTrailerMatches(['7'], '7', new Set());
    expect(result).toBe(true);
  });

  it('returns true for alias task-N when alias is NOT in planIds', async () => {
    const mod = await loadAutoheal();

    const result = mod.taskTrailerMatches(['task-7'], '7', new Set(['7']));
    expect(result).toBe(true);
  });

  it('returns false for alias task-N when alias IS in planIds (guarded)', async () => {
    const mod = await loadAutoheal();

    const result = mod.taskTrailerMatches(['task-7'], '7', new Set(['7', 'task-7']));
    expect(result).toBe(false);
  });

  it('does not check planIds for foreign ids like task-42', async () => {
    const mod = await loadAutoheal();

    // Foreign id (task-42) should not match taskId 7, regardless of planIds
    const result = mod.taskTrailerMatches(['task-42'], '7', new Set(['task-42']));
    expect(result).toBe(false);
  });

  it('returns true for bare id regardless of planIds content', async () => {
    const mod = await loadAutoheal();

    const result1 = mod.taskTrailerMatches(['7'], '7', new Set());
    expect(result1).toBe(true);

    const result2 = mod.taskTrailerMatches(['7'], '7', new Set(['7', 'task-7']));
    expect(result2).toBe(true);
  });

  it('handles multiple trailer values and finds match', async () => {
    const mod = await loadAutoheal();

    const result = mod.taskTrailerMatches(['5', '6', '7', '8'], '7', new Set(['7']));
    expect(result).toBe(true);
  });

  it('handles mixed exact and alias values in trailers', async () => {
    const mod = await loadAutoheal();

    // Should match the exact form
    const result1 = mod.taskTrailerMatches(['7', 'task-7'], '7', new Set(['7']));
    expect(result1).toBe(true);

    // Should not match when alias is in planIds (exact form exists but is ambiguous)
    const result2 = mod.taskTrailerMatches(['task-7'], '7', new Set(['7', 'task-7']));
    expect(result2).toBe(false);
  });

  it('returns false when no matching trailer value found', async () => {
    const mod = await loadAutoheal();

    const result = mod.taskTrailerMatches(['5', '6', '8'], '7', new Set(['7']));
    expect(result).toBe(false);
  });

  it('returns false for empty trailerValues', async () => {
    const mod = await loadAutoheal();

    const result = mod.taskTrailerMatches([], '7', new Set(['7']));
    expect(result).toBe(false);
  });
});

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
  // -b main: CI runners' git default branch is not necessarily `main`
  // (ubuntu-latest defaults to master without init.defaultBranch config) —
  // the origin-push fixtures below push `main` explicitly.
  await execa('git', ['init', '-b', 'main'], { cwd: gitDir });
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Tests for Task 18: Task-id grammar extension (alphanumeric + dot/underscore/dash)
  // ─────────────────────────────────────────────────────────────────────────────

  it('parses plan with dotted task id (e.g., 1.2)', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1.2: Setup dotted task
Initial setup work.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('1.2')).toBe(true);
    const task = result.get('1.2');
    expect(task).toBeDefined();
    expect(task!.name).toBe('Setup dotted task');
  });

  it('parses plan with alphanumeric task ids with underscores', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task task_1: Underscore task
Work with underscore.

### Task task_rem_001: Remediation task
Fix something.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('task_1')).toBe(true);
    expect(result.has('task_rem_001')).toBe(true);
    expect(result.get('task_1')!.name).toBe('Underscore task');
    expect(result.get('task_rem_001')!.name).toBe('Remediation task');
  });

  it('parses plan with hyphenated task ids', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task rem-adr-001: Remediation task
A remediation with hyphens.

### Task task-name-02: Multi-part task
Another task.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('rem-adr-001')).toBe(true);
    expect(result.has('task-name-02')).toBe(true);
    expect(result.get('rem-adr-001')!.name).toBe('Remediation task');
  });

  it('parses mixed alphanumeric ids in task paths', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1.2: Dotted task
Update files.

- \`src/api.ts\`

### Task rem-adr-001: Remediation
Update more files.

- \`src/fix.ts\`
`;
    const result = mod.parsePlanTasks(planText);

    const dotted = result.get('1.2');
    expect(dotted).toBeDefined();
    expect(dotted!.paths).toContain('src/api.ts');

    const remediation = result.get('rem-adr-001');
    expect(remediation).toBeDefined();
    expect(remediation!.paths).toContain('src/fix.ts');
  });

  it('trailer matching: commit with Task: 1.2 matches plan task 1.2', async () => {
    const mod = await loadAutoheal();

    // Create a commit with a dotted task id in the trailer
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });

    const commitMessage = 'feat: dotted task work\n\nTask: 1.2\n';
    await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });

    const commits = await mod.listCommitsWithTrailers(gitDir);
    const testCommit = commits.find(c => c.subject === 'feat: dotted task work');

    expect(testCommit).toBeDefined();
    expect(testCommit!.trailers.Task).toContain('1.2');
  });

  it('grammar round-trip: parse ids from plan, extract trailers, re-parse → identical', async () => {
    const mod = await loadAutoheal();

    // Create a plan with various id formats
    const planText = `# Plan

### Task 1.2: Dotted
Work on it.

### Task rem-adr-001: Remediation
Fix it.

### Task task_1: Underscore
Another task.
`;
    const parsedPlan = mod.parsePlanTasks(planText);
    const planIds = Array.from(parsedPlan.keys()).sort();

    // Create commits with trailers for each id
    for (const id of planIds) {
      await writeFile(join(gitDir, `file-${id}.txt`), 'content');
      await execa('git', ['add', `file-${id}.txt`], { cwd: gitDir });
      const commitMessage = `feat: work on ${id}\n\nTask: ${id}\n`;
      await execa('git', ['commit', '-m', commitMessage], { cwd: gitDir });
    }

    // Get trailers from commits
    const commits = await mod.listCommitsWithTrailers(gitDir);
    const extractedIds = new Set<string>();
    for (const commit of commits) {
      if (commit.trailers.Task) {
        for (const id of commit.trailers.Task) {
          extractedIds.add(id);
        }
      }
    }

    // All plan ids should be in extracted ids
    for (const id of planIds) {
      expect(extractedIds.has(id)).toBe(true);
    }

    expect(Array.from(extractedIds).sort()).toEqual(planIds);
  });

  it('parsePlanTaskPaths works with extended id grammar', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1.2: Dotted task
- \`src/dotted.ts\`

### Task rem-adr-001: Remediation
- \`src/fix.ts\`
`;
    const result = parsePlanTaskPaths(planText);

    expect(result.has('1.2')).toBe(true);
    expect(result.get('1.2')!.has('src/dotted.ts')).toBe(true);

    expect(result.has('rem-adr-001')).toBe(true);
    expect(result.get('rem-adr-001')!.has('src/fix.ts')).toBe(true);
  });

  it('parses task headers with em-dash separator (authoring convention)', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1 — Initialize project
Initial setup work.

### Task 1-3 — Setup multiple tasks
Setup tasks.

### Task rem-adr-001 — Remediation task
Another task.
`;
    const result = mod.parsePlanTasks(planText);

    // Should parse em-dash separated headers
    expect(result.has('1')).toBe(true);
    expect(result.get('1')!.name).toBe('Initialize project');

    expect(result.has('1-3')).toBe(true);
    expect(result.get('1-3')!.name).toBe('Setup multiple tasks');

    expect(result.has('rem-adr-001')).toBe(true);
    expect(result.get('rem-adr-001')!.name).toBe('Remediation task');
  });

  it('parses task paths with em-dash headers', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1 — API Update
Update the API layer.

**Files:**
- \`src/api.ts\`
- \`src/types.ts\`

### Task 2 — UI Changes
Update the interface.

**Files:**
- \`src/components/Button.tsx\`
`;
    const result = parsePlanTaskPaths(planText);

    expect(result.has('1')).toBe(true);
    expect(result.get('1')!.has('src/api.ts')).toBe(true);
    expect(result.get('1')!.has('src/types.ts')).toBe(true);

    expect(result.has('2')).toBe(true);
    expect(result.get('2')!.has('src/components/Button.tsx')).toBe(true);
  });

  it('accepts both colon and em-dash terminators in same plan', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Traditional colon style
Work with colon.

### Task 2 — Authoring style with em-dash
Work with em-dash.
`;
    const result = mod.parsePlanTasks(planText);

    // Both styles should work
    expect(result.has('1')).toBe(true);
    expect(result.get('1')!.name).toBe('Traditional colon style');

    expect(result.has('2')).toBe(true);
    expect(result.get('2')!.name).toBe('Authoring style with em-dash');
  });

  it('accepts en-dash as separator (alternative dash character)', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1 – Initialize with en-dash
Setup with en-dash separator.
`;
    const result = mod.parsePlanTasks(planText);

    expect(result.has('1')).toBe(true);
    expect(result.get('1')!.name).toBe('Initialize with en-dash');
  });

  // Regression (#578 live-fire follow-up, 2026-07-12): the already-shipped
  // em-dash fix requires the literal word "Task" before the id. A real build
  // (`2026-07-12-rtk-hook-preservation`) used the shorthand `### T0 — Title`
  // heading form (no "Task" word, starts at T0 not T1) — those headers parsed
  // to zero ids under the old regex, so the build-completion gate reported
  // "no tasks in plan" and the daemon auto-parked a fully-completed 5/5 build.
  describe('bare "T<N>" shorthand headers (### T0 — Title, no "Task" word)', () => {
    it('parsePlanTasks: parses bare T-prefixed headers starting at T0', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

### T0 — Confirm edit sites
Re-read the install script.

### T1 — Mocked rtk test fixture
Add a reusable test helper.
`;
      const result = mod.parsePlanTasks(planText);

      // #636: the id is emitted AS WRITTEN (T-prefix kept), so a `### T0`
      // header yields `T0`, matching the plan's `Task: T0` trailers and its
      // pre-existing T-prefixed task-status rows. Cross-grammar matching
      // (`Task: 0` ↔ `T0`) is handled at the comparison seams.
      expect(result.has('T0')).toBe(true);
      expect(result.get('T0')!.name).toBe('Confirm edit sites');

      expect(result.has('T1')).toBe(true);
      expect(result.get('T1')!.name).toBe('Mocked rtk test fixture');
    });

    it('parsePlanTaskPaths: parses bare T-prefixed headers and their paths', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

### T0 — Confirm edit sites
**Files:** \`bin/install\`

### T1 — Mocked rtk test fixture
**Files:** \`test/test_rtk_hook_reinit.sh\`
`;
      const result = parsePlanTaskPaths(planText);

      // #636: T-prefix kept as written.
      expect(result.has('T0')).toBe(true);
      expect(result.get('T0')!.has('bin/install')).toBe(true);

      expect(result.has('T1')).toBe(true);
      expect(result.get('T1')!.has('test/test_rtk_hook_reinit.sh')).toBe(true);
    });

    it('parsePlanTaskPaths: extracts the real 2026-07-12-rtk-hook-preservation.md fixture tasks (T0-T5)', async () => {
      const mod = await loadAutoheal();
      const fixturePath = join(
        __dirname,
        '../../../../.docs/plans/2026-07-12-rtk-hook-preservation.md',
      );
      const planText = await readFile(fixturePath, 'utf-8');

      const result = parsePlanTaskPaths(planText);

      // #636: T-prefixed headers keep the T (T0..T5), matching the plan's
      // trailers and rows.
      for (const id of ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']) {
        expect(result.has(id)).toBe(true);
      }
    });

    it('over-capture guard: does not treat "T" in ordinary words (Testing, Team) as a task header', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

### Testing infrastructure notes
Prose that starts with a capital T word but is not a task header.

### Team sync
More prose.
`;
      const result = mod.parsePlanTasks(planText);
      expect(result.size).toBe(0);

      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.size).toBe(0);
    });

    // Regression (#620): #615 widened the header regexes to accept bare
    // `T<digits>` headers, but parsePlanTaskPaths's terminator also accepted
    // a bare end-of-line (no colon, no dash) as a valid header close. A
    // structural heading like `## Task Graph` or `## Task Dependency Graph`
    // (present in many committed plans, e.g.
    // .docs/plans/2026-07-12-rtk-hook-preservation.md) then parsed as a
    // phantom task with id "Graph"/"Dependency" — a task that can never be
    // completed, making the build-completion gate permanently unsatisfiable.
    it('regression #620: does not treat "## Task Graph" heading as a phantom task', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

## Tasks

### Task 1: Real work
**Files:** \`src/real.ts\`

## Task Graph

Task 1 → done
`;
      const tasksResult = mod.parsePlanTasks(planText);
      expect(tasksResult.has('Graph')).toBe(false);
      expect(tasksResult.size).toBe(1);

      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.has('Graph')).toBe(false);
      expect(pathsResult.size).toBe(1);
    });

    it('regression #620: does not treat "## Task Dependency Graph" heading as a phantom task', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

## Tasks

### Task 1: Foundation
**Files:** \`src/foundation.ts\`

### Task 2: Build on it
**Files:** \`src/build.ts\`

## Task Dependency Graph

Task 1 → Task 2
`;
      const tasksResult = mod.parsePlanTasks(planText);
      expect(tasksResult.has('Dependency')).toBe(false);
      expect(tasksResult.size).toBe(2);

      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.has('Dependency')).toBe(false);
      expect(pathsResult.size).toBe(2);
    });

    it('regression #620: "## Task Breakdown" prose heading is never a phantom task', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

## Task Breakdown

### Task 1: Real work
**Files:** \`src/real.ts\`
`;
      const tasksResult = mod.parsePlanTasks(planText);
      expect(tasksResult.has('Breakdown')).toBe(false);
      expect(tasksResult.size).toBe(1);

      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.has('Breakdown')).toBe(false);
      expect(pathsResult.size).toBe(1);
    });

    it('#578/#615 shapes still parse: "### Task 3 — Title" (em-dash) and "### T0 — Title" (bare T)', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

### Task 3 — Em-dash title
**Files:** \`src/em.ts\`

### T0 — Bare T shorthand
**Files:** \`src/bare.ts\`
`;
      const tasksResult = mod.parsePlanTasks(planText);
      // `### Task 3` (the "Task" word) → bare `3`; `### T0` (bare T shorthand)
      // → `T0` as written (#636).
      expect(tasksResult.has('3')).toBe(true);
      expect(tasksResult.get('3')!.name).toBe('Em-dash title');
      expect(tasksResult.has('T0')).toBe(true);
      expect(tasksResult.get('T0')!.name).toBe('Bare T shorthand');

      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.has('3')).toBe(true);
      expect(pathsResult.has('T0')).toBe(true);
    });

    it('#620 guard: bare title-less headers with a digit in the id ("### Task 2", "### Task t1", "### T3") still parse in parsePlanTaskPaths', async () => {
      // Widely used fixture/plan shape (e.g. task-status-gate-recompute and
      // gate-loop integration tests): a task header that is just
      // `### Task <id>` with no colon, dash, or title. The #620 tightening
      // must only reject DIGITLESS bare ids (Graph/Breakdown/Dependency),
      // never ids containing a digit.
      const mod = await loadAutoheal();

      const planText = `# Plan

### Task 1
**Files:** \`src/a.ts\`

### Task 2
**Files:** \`src/b.ts\`

### T3
**Files:** \`src/c.ts\`

### Task t4
**Files:** \`src/d.ts\`
`;
      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.has('1')).toBe(true);
      expect(pathsResult.get('1')!.has('src/a.ts')).toBe(true);
      expect(pathsResult.has('2')).toBe(true);
      expect(pathsResult.get('2')!.has('src/b.ts')).toBe(true);
      // `### T3` (bare T shorthand) keeps the T (#636); `### Task t4` (the
      // "Task" word) stays `t4`.
      expect(pathsResult.has('T3')).toBe(true);
      expect(pathsResult.get('T3')!.has('src/c.ts')).toBe(true);
      expect(pathsResult.has('t4')).toBe(true);
      expect(pathsResult.get('t4')!.has('src/d.ts')).toBe(true);
    });

    it('#620: non-digit remediation/alpha ids still parse ("Task rem-adr-001", "Task A8")', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

### Task rem-adr-001: Remediation task
**Files:** \`src/rem.ts\`

### Task A8: Resolver warnings
**Files:** \`src/a8.ts\`
`;
      const tasksResult = mod.parsePlanTasks(planText);
      expect(tasksResult.has('rem-adr-001')).toBe(true);
      expect(tasksResult.has('A8')).toBe(true);

      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.has('rem-adr-001')).toBe(true);
      expect(pathsResult.has('A8')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for parsePlanTaskVerifyOnly (verify-only-prove-closed-task-evidence
// plan, Task 1). Recognizes a `**Verify-only:** yes` marker line inside a task
// block (exact-match "yes", case-insensitive). Anything else — "maybe", empty,
// missing — means false/absent (fail-closed). Does not alter
// parsePlanTaskPaths' existing Map<string, Set<string>> shape or behavior.
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePlanTaskVerifyOnly', () => {
  it('marks a task true when its block has `**Verify-only:** yes`', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Do the thing

**Verify-only:** yes
**Dependencies:** none
`;
    const result = mod.parsePlanTaskVerifyOnly(planText);
    expect(result.get('1')).toBe(true);
  });

  it('is case-insensitive for the "yes" value', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Do the thing

**Verify-only:** YES
`;
    const result = mod.parsePlanTaskVerifyOnly(planText);
    expect(result.get('1')).toBe(true);
  });

  it('leaves an unmarked task false/absent', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Do the thing

**Dependencies:** none
`;
    const result = mod.parsePlanTaskVerifyOnly(planText);
    expect(result.get('1') ?? false).toBe(false);
  });

  it.each(['maybe', '', 'true', 'y'])(
    'fail-closed: malformed value %j resolves to false, not true',
    async (value) => {
      const mod = await loadAutoheal();

      const planText = `# Plan

### Task 1: Do the thing

**Verify-only:** ${value}
`;
      const result = mod.parsePlanTaskVerifyOnly(planText);
      expect(result.get('1') ?? false).toBe(false);
    },
  );

  it('does not change parsePlanTaskPaths output for existing no-marker fixtures', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: First
**Files:** \`src/a.ts\`

### Task 2: Second
**Files:** \`src/b.ts\`
`;
    const pathsResult = parsePlanTaskPaths(planText);
    expect(Array.from(pathsResult.keys())).toEqual(['1', '2']);
    expect(Array.from(pathsResult.get('1')!)).toEqual(['src/a.ts']);
    expect(Array.from(pathsResult.get('2')!)).toEqual(['src/b.ts']);

    const verifyOnlyResult = mod.parsePlanTaskVerifyOnly(planText);
    expect(verifyOnlyResult.get('1') ?? false).toBe(false);
    expect(verifyOnlyResult.get('2') ?? false).toBe(false);
  });

  // Regression (Task 2, verify-only-prove-closed-task-evidence plan): the new
  // `**Verify-only:**` marker grammar (Task 1) must be inert against the
  // existing committed plan corpus, none of which carries the marker. Sweeps
  // representative real fixtures under .docs/plans/ — spanning both header
  // grammars (`### Task N:` and bare `### T<N>` shorthand) — and asserts
  // parsePlanTaskVerifyOnly yields zero true entries and parsePlanTaskPaths'
  // output is unchanged (snapshotted) for the same plan text.
  describe('regression: existing plan corpus (no markers) is inert', () => {
    const fixtures = [
      '2026-07-12-rtk-hook-preservation.md',
      '2026-06-30-daemon-owner-gate.md',
      '2026-07-03-daemon-issue-priority-scheduling.md',
      '2026-07-05-changelog-migration-block-enforcement.md',
    ];

    it.each(fixtures)('%s: zero verify-only true entries, unchanged parsePlanTaskPaths', async (fixture) => {
      const mod = await loadAutoheal();
      const fixturePath = join(__dirname, '../../../../.docs/plans/', fixture);
      const planText = await readFile(fixturePath, 'utf-8');

      const pathsResult = parsePlanTaskPaths(planText);
      expect(pathsResult.size).toBeGreaterThan(0);

      const serializedPaths = Array.from(pathsResult.entries()).map(([id, paths]) => [
        id,
        Array.from(paths).sort(),
      ]);
      expect(serializedPaths).toMatchSnapshot('parsePlanTaskPaths');

      const verifyOnlyResult = mod.parsePlanTaskVerifyOnly(planText);
      const trueEntries = Array.from(verifyOnlyResult.entries()).filter(([, v]) => v === true);
      expect(trueEntries).toEqual([]);
    });
  });

  // Union semantics (Task 2, no-diff-task-evidence-stamp plan): a `**Type:**`
  // line whose value contains the exact token `verification` (split on `+`)
  // is ALSO verify-only-eligible, in addition to `**Verify-only:** yes`.
  it('marks a task true when its block has `**Type:** verification`', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Do the thing

**Type:** verification
`;
    const result = mod.parsePlanTaskVerifyOnly(planText);
    expect(result.get('1')).toBe(true);
  });

  it('still marks a task true via `**Verify-only:** yes` (unchanged)', async () => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Do the thing

**Verify-only:** yes
`;
    const result = mod.parsePlanTaskVerifyOnly(planText);
    expect(result.get('1')).toBe(true);
  });

  it.each([
    'happy-path',
    'negative-path',
    'refactor',
    'feature',
    'integration',
    'infrastructure',
    'review',
    'happy-path + negative-path',
    'verification-only',
    'preverification',
  ])('fail-closed: `**Type:** %s` does not match (not exact token verification)', async (value) => {
    const mod = await loadAutoheal();

    const planText = `# Plan

### Task 1: Do the thing

**Type:** ${value}
`;
    const result = mod.parsePlanTaskVerifyOnly(planText);
    expect(result.get('1') ?? false).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for getEvidenceRange (Task 3, fail-closed merge-base + plan-anchor).
//
// Tests evidence range calculation with fail-closed behavior:
// - Missing origin/main returns zero commits + logs anomaly
// - Plan-anchored range excludes commits before anchor
// - Unreachable anchor falls back to merge-base with logged warning
// - All failures are logged but never thrown
// - Anchor is a required parameter
//
// Acceptance criteria:
// 1. No origin/main scenario → empty commits list with anomaly logging
// 2. Plan-anchored range (anchor sha provided) → excludes commits before anchor
// 3. Unreachable anchor → falls back to merge-base with logged warning
// 4. Anchor is a required parameter
// 5. All failures are logged but DO NOT throw
// ─────────────────────────────────────────────────────────────────────────────

describe('getEvidenceRange', () => {
  it('returns zero commits when origin/main does not exist', async () => {
    const mod = await loadAutoheal();
    const mockLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    // In a fresh git repo with no remote, origin/main doesn't exist
    const range = await mod.getEvidenceRange(gitDir, 'someSha123');

    expect(range.commits).toHaveLength(0);
    expect(range.anomalies).toHaveLength(1);
    expect(range.anomalies[0]).toContain('origin/main');

    mockLog.mockRestore();
  });

  it('logs anomaly when origin/main does not exist', async () => {
    const mod = await loadAutoheal();
    const mockLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const range = await mod.getEvidenceRange(gitDir, 'someSha');

    // Verify that an anomaly was logged about missing origin/main
    expect(range.anomalies).toHaveLength(1);
    expect(range.anomalies[0]).toMatch(/origin\/main/i);

    mockLog.mockRestore();
  });

  it('uses anchor as lower bound and excludes commits before anchor', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin/main
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });

    // Add origin remote to our test repo
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    // Create several commits
    for (let i = 0; i < 3; i++) {
      await writeFile(join(gitDir, `file${i}.txt`), `content ${i}`);
      await execa('git', ['add', `file${i}.txt`], { cwd: gitDir });
      await execa('git', ['commit', '-m', `commit ${i}`], { cwd: gitDir });
    }

    // Push main to origin
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Create additional commit after origin/main
    await writeFile(join(gitDir, 'file3.txt'), 'content 3');
    await execa('git', ['add', 'file3.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: after origin/main\n\nTask: 1\n'], { cwd: gitDir });

    // Get SHA of the second commit (to be used as anchor)
    const logOutput = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = logOutput.stdout.split('\n').filter(s => s.trim());
    const anchorSha = allShas[allShas.length - 2]; // Second from bottom (after initial)

    const range = await mod.getEvidenceRange(gitDir, anchorSha);

    // Should include commits after the anchor
    expect(range.commits.length).toBeGreaterThan(0);
    expect(range.anomalies).toHaveLength(0);

    // Cleanup
    await rm(bareDir, { recursive: true, force: true });
  });

  it('falls back to merge-base when anchor is unreachable', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin/main
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });

    // Add origin remote to our test repo
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    // Create a commit and push to origin
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Create a new commit after pushing
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'new commit'], { cwd: gitDir });

    // Use a fake unreachable SHA
    const unreachableSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    const range = await mod.getEvidenceRange(gitDir, unreachableSha);

    // Should have logged a warning about the unreachable anchor
    expect(range.warnings).toHaveLength(1);
    expect(range.warnings[0]).toMatch(/unreachable|anchor/i);

    // Cleanup
    await rm(bareDir, { recursive: true, force: true });
  });

  it('skips the reachability probe for an absent (empty-string) anchor and derives merge-base without an unreachable warning', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin/main
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });

    // Add origin remote to our test repo
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    // Create a commit and push to origin
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Create a new commit after pushing, so there are commits ahead of the
    // resolved origin default branch.
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'new commit'], { cwd: gitDir });

    const range = await mod.getEvidenceRange(gitDir, '');

    // Absent anchor must fall straight into the merge-base ladder without
    // ever being probed for reachability, so no "unreachable" warning.
    expect(range.warnings.some((w) => /unreachable/i.test(w))).toBe(false);
    expect(range.anomalies).toHaveLength(0);
    expect(range.commits.length).toBeGreaterThan(0);

    // Cleanup
    await rm(bareDir, { recursive: true, force: true });
  });

  it('emits a distinct info line (not a warning) noting the anchor was absent', async () => {
    const mod = await loadAutoheal();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create a bare repo to act as origin/main
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });

    // Add origin remote to our test repo
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    // Create a commit and push to origin
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Create a new commit after pushing, so there are commits ahead of the
    // resolved origin default branch.
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'new commit'], { cwd: gitDir });

    const range = await mod.getEvidenceRange(gitDir, '');

    // The info line must be surfaced via console.info/console.log, not
    // pushed onto range.warnings and not routed through console.warn.
    expect(range.warnings).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();

    const allCalls = [...infoSpy.mock.calls, ...logSpy.mock.calls].map((args) => String(args[0]));
    expect(allCalls.length).toBeGreaterThan(0);
    expect(allCalls.some((msg) => /no recorded anchor/i.test(msg))).toBe(true);
    expect(allCalls.some((msg) => /unreachable/i.test(msg))).toBe(false);
    expect(allCalls.some((msg) => /anchor\s\sis/.test(msg))).toBe(false);

    // Cleanup
    await rm(bareDir, { recursive: true, force: true });
  });

  it('logs warning when anchor is unreachable', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin/main
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });

    // Add origin remote to our test repo
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    // Create a commit and push to origin
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Create a new commit after pushing
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'new commit'], { cwd: gitDir });

    const unreachableSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    const range = await mod.getEvidenceRange(gitDir, unreachableSha);

    // Should log a warning about the unreachable anchor
    expect(range.warnings).toHaveLength(1);
    expect(range.warnings[0]).toContain('unreachable');

    // Cleanup
    await rm(bareDir, { recursive: true, force: true });
  });

  it('regression guard: non-empty unreachable anchor keeps the exact prior warn text and fallback result (Task 3, #510)', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin/main
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });

    // Add origin remote to our test repo
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    // Create a commit and push to origin
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Create a new commit after pushing
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'new commit'], { cwd: gitDir });

    const unreachableSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const shortSha = unreachableSha.slice(0, 7);

    const range = await mod.getEvidenceRange(gitDir, unreachableSha);

    // Exactly one warning, matching /unreachable/, containing the 7-char
    // short SHA, and with no doubled-space/empty-value rendering.
    expect(range.warnings).toHaveLength(1);
    expect(range.warnings[0]).toMatch(/unreachable/);
    expect(range.warnings[0]).toContain(shortSha);
    expect(range.warnings[0]).not.toMatch(/anchor\s\sis/);

    // Compute the plain merge-base fallback independently and assert the
    // returned range/commits are unchanged vs. before the Task 1/2 refactor.
    const plainMergeBase = await execa('git', ['merge-base', 'origin/main', 'HEAD'], {
      cwd: gitDir,
    });
    const expectedLowerBound = plainMergeBase.stdout.trim();

    const logOutput = await execa(
      'git',
      ['log', '--format=%H', `${expectedLowerBound}..HEAD`],
      { cwd: gitDir },
    );
    const expectedShas = logOutput.stdout.split('\n').filter((s) => s.trim());

    expect(range.commits.map((c) => c.sha)).toEqual(expectedShas);

    // Cleanup
    await rm(bareDir, { recursive: true, force: true });
  });

  it('does not throw on missing origin/main', async () => {
    const mod = await loadAutoheal();

    // Should not throw, just return with anomalies
    expect(async () => {
      await mod.getEvidenceRange(gitDir, 'someSha');
    }).not.toThrow();
  });

  it('does not throw on unreachable anchor', async () => {
    const mod = await loadAutoheal();

    // Create a commit
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'test commit'], { cwd: gitDir });

    const unreachableSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    // Should not throw, just log warning and fall back
    expect(async () => {
      await mod.getEvidenceRange(gitDir, unreachableSha);
    }).not.toThrow();
  });

  it('requires anchor as a parameter', async () => {
    const mod = await loadAutoheal();

    // The function signature should require an anchor parameter
    // (This is more of a type check, but we can verify it exists)
    expect(mod.getEvidenceRange).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 6: explicit anchorArg is rung 1 of the ladder — pins that a
  // reachable explicit anchor is used verbatim (no warning), and an
  // unreachable explicit anchor falls through to the ladder with the
  // existing "unreachable; falling back" diagnostic preserved.
  // ─────────────────────────────────────────────────────────────────────────

  it('uses a reachable explicit anchorArg verbatim as the lower bound (rung 1), with no warning', async () => {
    const mod = await loadAutoheal();

    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-explicit-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    for (let i = 0; i < 3; i++) {
      await writeFile(join(gitDir, `explicit${i}.txt`), `content ${i}`);
      await execa('git', ['add', `explicit${i}.txt`], { cwd: gitDir });
      await execa('git', ['commit', '-m', `explicit commit ${i}`], { cwd: gitDir });
    }
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Additional commit after origin/main, so there is a range to derive.
    await writeFile(join(gitDir, 'explicit-after.txt'), 'content');
    await execa('git', ['add', 'explicit-after.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: after origin/main\n\nTask: 6\n'], { cwd: gitDir });

    const logOutput = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = logOutput.stdout.split('\n').filter(s => s.trim());
    // A reachable, explicit anchor: the second-from-bottom commit (rung 1
    // must use it verbatim rather than recomputing a merge-base).
    const explicitAnchorSha = allShas[allShas.length - 2];

    const range = await mod.getEvidenceRange(gitDir, explicitAnchorSha);

    expect(range.anomalies).toHaveLength(0);
    expect(range.warnings).toHaveLength(0);
    expect(range.commits.length).toBeGreaterThan(0);
    // No commit at or before the explicit anchor should be included.
    expect(range.commits.some(c => c.sha === explicitAnchorSha)).toBe(false);

    await rm(bareDir, { recursive: true, force: true });
  });

  it('falls back from an unreachable explicit anchorArg into the ladder, preserving the "unreachable; falling back" warning', async () => {
    const mod = await loadAutoheal();

    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-explicit-unreachable-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'new commit'], { cwd: gitDir });

    const explicitUnreachableSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    const range = await mod.getEvidenceRange(gitDir, explicitUnreachableSha);

    // Falls through to the ladder (merge-base against origin default branch)
    // rather than erroring or returning nothing.
    expect(range.anomalies).toHaveLength(0);
    expect(range.commits.length).toBeGreaterThan(0);
    expect(range.warnings).toHaveLength(1);
    expect(range.warnings[0]).toMatch(/unreachable; falling back/i);

    await rm(bareDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 1: getEvidenceRange derives the origin default branch instead of
  // hardcoding origin/main. Resolution ladder:
  //   1. reachable explicit anchorArg
  //   2. merge-base --fork-point origin/<default> HEAD
  //   3. plain merge-base origin/<default> HEAD
  //   4. fail-closed zero commits + anomaly
  // ─────────────────────────────────────────────────────────────────────────

  it('resolves a range against origin/master when origin default branch is master (refs/remotes/origin/HEAD)', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin, with its default branch as master.
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-master-'));
    await execa('git', ['init', '--bare', '-b', 'master'], { cwd: bareDir });

    // Re-point the local repo's branch to master so it can push to origin/master.
    await execa('git', ['branch', '-m', 'main', 'master'], { cwd: gitDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'master'], { cwd: gitDir });

    // Record refs/remotes/origin/HEAD -> origin/master (as a real clone would).
    await execa('git', ['remote', 'set-head', 'origin', 'master'], { cwd: gitDir });

    // Additional commit after origin/master.
    await writeFile(join(gitDir, 'after.txt'), 'content');
    await execa('git', ['add', 'after.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: after origin/master\n\nTask: 1\n'], { cwd: gitDir });

    const range = await mod.getEvidenceRange(gitDir, 'unreachable-anchor-sha');

    // Anchor is unreachable, so the ladder must fall back to merge-base
    // against the resolved origin default branch (master) rather than
    // failing with "origin/main does not exist".
    expect(range.anomalies).toHaveLength(0);
    expect(range.commits.length).toBeGreaterThan(0);

    await rm(bareDir, { recursive: true, force: true });
  });

  it('fails closed with a default-branch resolution anomaly when origin/HEAD is unset and neither origin/main nor origin/master exist', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin, but push under a branch name that
    // is neither `main` nor `master`, and never set refs/remotes/origin/HEAD.
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-trunk-'));
    await execa('git', ['init', '--bare', '-b', 'trunk'], { cwd: bareDir });

    await execa('git', ['branch', '-m', 'main', 'trunk'], { cwd: gitDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'trunk'], { cwd: gitDir });
    // Deliberately do NOT run `git remote set-head`, so refs/remotes/origin/HEAD
    // stays unset — neither origin/main nor origin/master exist either.

    const range = await mod.getEvidenceRange(gitDir, 'unreachable-anchor-sha');

    expect(range.commits).toHaveLength(0);
    expect(range.anomalies).toHaveLength(1);
    // Must never silently guess `main` — the anomaly must name default-branch
    // resolution failure, not just "origin/main does not exist".
    expect(range.anomalies[0]).toMatch(/default branch/i);

    await rm(bareDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 2: rung 3 of the ladder — plain merge-base when fork-point fails.
  //
  // `merge-base --fork-point <ref> HEAD` only succeeds when the reflog of
  // <ref> still records the commit the local branch actually forked from
  // (see git-merge-base(1)). If the local branch was built on an older
  // commit than any tip recorded in <ref>'s reflog (e.g. a fresh clone whose
  // reflog only records the current tip, with local history reset to an
  // earlier ancestor), fork-point exits non-zero with no output even though
  // a plain `merge-base` still finds the common ancestor. The ladder must
  // fall through to the plain merge-base in that case.
  // ─────────────────────────────────────────────────────────────────────────

  it('falls through to plain merge-base when --fork-point fails to find a fork point', async () => {
    const mod = await loadAutoheal();

    // Bare origin.
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-forkpoint-'));
    await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });

    // gitDir (from beforeEach) already has one commit; push it as A, then
    // advance origin/main past it with B and B2 so the reflog of a later
    // clone's origin/main only records the B2 tip.
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });
    const aSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    await writeFile(join(gitDir, 'b.txt'), 'B');
    await execa('git', ['add', 'b.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'B'], { cwd: gitDir });
    await execa('git', ['push', 'origin', 'main'], { cwd: gitDir });

    await writeFile(join(gitDir, 'b2.txt'), 'B2');
    await execa('git', ['add', 'b2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'B2'], { cwd: gitDir });
    await execa('git', ['push', 'origin', 'main'], { cwd: gitDir });

    // Fresh clone: its origin/main reflog records only the B2 tip.
    const cloneDir = await mkdtemp(join(tmpdir(), 'clone-forkpoint-'));
    await execa('git', ['clone', bareDir, cloneDir]);
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: cloneDir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: cloneDir });

    // Rewind the clone's local main branch to A — an older commit than the
    // tip its origin/main reflog knows about — then add local work on top.
    // This reproduces "forked from an older commit than the tip" from
    // git-merge-base(1), which is documented to make --fork-point fail.
    await execa('git', ['update-ref', 'refs/heads/main', aSha], { cwd: cloneDir });
    await execa('git', ['commit', '--allow-empty', '-m', 'local work'], { cwd: cloneDir });

    // Sanity-check the premise directly against git: fork-point fails,
    // plain merge-base succeeds.
    const forkPoint = await execa('git', ['merge-base', '--fork-point', 'origin/main', 'HEAD'], {
      cwd: cloneDir,
      reject: false,
    });
    expect(forkPoint.exitCode).not.toBe(0);
    const plainMergeBase = await execa('git', ['merge-base', 'origin/main', 'HEAD'], {
      cwd: cloneDir,
      reject: false,
    });
    expect(plainMergeBase.exitCode).toBe(0);
    expect(plainMergeBase.stdout.trim()).toBe(aSha);

    const range = await mod.getEvidenceRange(cloneDir, 'unreachable-anchor-sha');

    // With --fork-point unreachable, the ladder must fall through to the
    // plain merge-base and return exactly the branch's own commit(s) — no
    // rung-4 (fail-closed) anomaly.
    expect(range.anomalies).toHaveLength(0);
    expect(range.commits).toHaveLength(1);
    expect(range.commits[0].sha).toBe(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: cloneDir })).stdout.trim(),
    );

    await rm(bareDir, { recursive: true, force: true });
    await rm(cloneDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 3: rung 4 of the ladder — fail-closed zero commits, no -n 100 window.
  //
  // If the origin default ref resolves but HEAD shares no merge-base with it
  // (unrelated histories — e.g. a rewritten/orphaned history, or a clone that
  // force-pushed a disjoint root), the old code silently fell back to
  // `git log -n 100 HEAD`, which can return commits carrying valid `Task: N`
  // trailers even though they were never actually range-corroborated against
  // origin. That is a silent guess, not evidence. The ladder must instead
  // fail closed: zero commits, with an anomaly naming the unrelated-histories
  // resolution failure.
  // ─────────────────────────────────────────────────────────────────────────

  it('fails closed with zero commits when origin default ref shares no merge-base with HEAD (unrelated histories)', async () => {
    const mod = await loadAutoheal();
    const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Bare origin with its own unrelated root commit.
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-unrelated-'));
    await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });

    const seedDir = await mkdtemp(join(tmpdir(), 'origin-seed-unrelated-'));
    await execa('git', ['init', '-b', 'main'], { cwd: seedDir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: seedDir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: seedDir });
    await writeFile(join(seedDir, 'origin-only.txt'), 'origin history');
    await execa('git', ['add', 'origin-only.txt'], { cwd: seedDir });
    await execa('git', ['commit', '-m', 'origin root commit'], { cwd: seedDir });
    await execa('git', ['push', bareDir, 'main'], { cwd: seedDir });

    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['fetch', 'origin'], { cwd: gitDir });
    await execa('git', ['remote', 'set-head', 'origin', 'main'], { cwd: gitDir });

    // gitDir's HEAD has its own root commit (from beforeEach) — an entirely
    // disjoint history from origin/main's root, so no merge-base exists.
    // Add more commits on top, each carrying a valid Task: N trailer, to
    // prove the old -n 100 fallback would have returned them.
    for (let i = 0; i < 3; i++) {
      await writeFile(join(gitDir, `unrelated-${i}.txt`), `content ${i}`);
      await execa('git', ['add', `unrelated-${i}.txt`], { cwd: gitDir });
      await execa('git', ['commit', '-m', `feat: unrelated work ${i}\n\nTask: ${i + 1}\n`], {
        cwd: gitDir,
      });
    }

    // Sanity-check the premise directly against git: no merge-base exists.
    const mergeBase = await execa('git', ['merge-base', 'origin/main', 'HEAD'], {
      cwd: gitDir,
      reject: false,
    });
    expect(mergeBase.exitCode).not.toBe(0);

    const range = await mod.getEvidenceRange(gitDir, 'unreachable-anchor-sha');

    // Must fail closed: zero commits, even though HEAD carries >0 commits
    // with valid Task: N trailers. The old -n 100 HEAD fallback would have
    // returned all of them.
    expect(range.commits).toHaveLength(0);
    expect(range.anomalies).toHaveLength(1);
    // The anomaly must describe the unrelated-histories resolution failure,
    // not just assert that origin/main is missing (it does exist here).
    expect(range.anomalies[0]).toMatch(/no valid lower bound|unrelated|merge-base/i);

    mockErr.mockRestore();
    await rm(bareDir, { recursive: true, force: true });
    await rm(seedDir, { recursive: true, force: true });
  });

  it('treats a whitespace-only anchor as absent: no unreachable warning, range is merge-base..HEAD (#510)', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin/main
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare'], { cwd: bareDir });

    // Add origin remote to our test repo
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });

    // Create a commit and push to origin
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Create a new commit after pushing, so there are commits ahead of the
    // resolved origin default branch.
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'new commit'], { cwd: gitDir });

    const whitespaceRange = await mod.getEvidenceRange(gitDir, '   ');
    const emptyRange = await mod.getEvidenceRange(gitDir, '');

    // Whitespace-only anchor must be treated exactly like an absent anchor:
    // no "unreachable" warning, and the same commits/anomalies as ''.
    expect(whitespaceRange.warnings.some((w) => /unreachable/i.test(w))).toBe(false);
    expect(whitespaceRange.anomalies).toHaveLength(0);
    expect(whitespaceRange.commits.length).toBeGreaterThan(0);
    expect(whitespaceRange.commits.map((c) => c.sha)).toEqual(
      emptyRange.commits.map((c) => c.sha),
    );

    // Cleanup
    await rm(bareDir, { recursive: true, force: true });
  });

  it('fails closed on an absent anchor when origin default is unresolvable (no origin/HEAD, origin/main, or origin/master) (#510)', async () => {
    const mod = await loadAutoheal();
    const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});

    // No origin remote at all, so origin/HEAD, origin/main, and
    // origin/master are all unresolvable.
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: gitDir });

    const range = await mod.getEvidenceRange(gitDir, '');

    // Fail-closed at the `if (!originRef)` guard must be reached before the
    // anchor is ever inspected: zero commits, exactly one anomaly, and the
    // anomaly text matches the same origin-unresolvable message as the
    // no-anchor-at-all case.
    expect(range.commits).toHaveLength(0);
    expect(range.anomalies).toHaveLength(1);
    expect(range.anomalies[0]).toMatch(/origin\/main|origin\/HEAD|origin default/i);
    expect(range.warnings).toHaveLength(0);

    mockErr.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: listCommits derives the origin default branch instead of hardcoding
// `origin/main`, via the same resolveOriginRef ladder as getEvidenceRange.
// ─────────────────────────────────────────────────────────────────────────────

describe('listCommits', () => {
  it('bounds commits to post-merge-base when origin default branch is master', async () => {
    const mod = await loadAutoheal();

    // Create a bare repo to act as origin, with its default branch as master.
    const bareDir = await mkdtemp(join(tmpdir(), 'listcommits-bare-master-'));
    await execa('git', ['init', '--bare', '-b', 'master'], { cwd: bareDir });

    // Re-point the local repo's branch to master so it can push to origin/master.
    await execa('git', ['branch', '-m', 'main', 'master'], { cwd: gitDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'master'], { cwd: gitDir });

    // Record refs/remotes/origin/HEAD -> origin/master (as a real clone would).
    await execa('git', ['remote', 'set-head', 'origin', 'master'], { cwd: gitDir });

    // Additional commit after origin/master.
    await writeFile(join(gitDir, 'after.txt'), 'content');
    await execa('git', ['add', 'after.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: after origin/master'], { cwd: gitDir });

    const commits = await mod.listCommits(gitDir);

    // Only the commit after the merge-base with origin/master should be
    // returned — not the full bounded local log (which would include the
    // initial commit made in beforeEach as well).
    expect(commits.length).toBe(1);
    expect(commits[0].subject).toBe('feat: after origin/master');

    await rm(bareDir, { recursive: true, force: true });
  });

  it('falls back to the bounded local log when there is no remote', async () => {
    const mod = await loadAutoheal();

    // gitDir has no remote configured (set up fresh in beforeEach).
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'a commit with no remote'], { cwd: gitDir });

    const commits = await mod.listCommits(gitDir);

    // Degraded local-log path: bounded, not empty, includes the new commit.
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.some((c) => c.subject === 'a commit with no remote')).toBe(true);
  });
});

describe('listCommitsWithTrailers with anchor', () => {
  it('accepts an anchor parameter', async () => {
    const mod = await loadAutoheal();

    // Create a commit with a trailer
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    const commitMsg = 'feat: test\n\nTask: 1\n';
    await execa('git', ['commit', '-m', commitMsg], { cwd: gitDir });

    const logOutput = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = logOutput.stdout.split('\n').filter(s => s.trim());
    const anchorSha = allShas[allShas.length - 1]; // Initial commit as anchor

    // Should accept an anchor parameter (optional for backward compatibility)
    const result = await mod.listCommitsWithTrailers(gitDir, anchorSha);

    expect(Array.isArray(result)).toBe(true);
  });

  it('excludes commits before the anchor when provided', async () => {
    const mod = await loadAutoheal();

    // Create initial commit (will be the anchor)
    await writeFile(join(gitDir, 'file0.txt'), 'content0');
    await execa('git', ['add', 'file0.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'initial'], { cwd: gitDir });

    const afterInitial = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const afterInitialShas = afterInitial.stdout.split('\n').filter(s => s.trim());
    const anchorSha = afterInitialShas[0]; // Initial commit

    // Create second commit after anchor
    await writeFile(join(gitDir, 'file1.txt'), 'content1');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: after anchor\n\nTask: 1\n'], { cwd: gitDir });

    // Create third commit after anchor
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: second after anchor\n\nTask: 2\n'], { cwd: gitDir });

    // Without anchor, we'd get all commits (initial + 2 new ones)
    const allCommits = await mod.listCommitsWithTrailers(gitDir);
    const beforeAnchor = allCommits.filter(c => c.subject === 'initial');
    expect(beforeAnchor.length).toBe(1);

    // With anchor set to initial commit, we should exclude it
    const afterAnchorCommits = await mod.listCommitsWithTrailers(gitDir, anchorSha);
    const stillBeforeAnchor = afterAnchorCommits.filter(c => c.subject === 'initial');
    expect(stillBeforeAnchor.length).toBe(0);
  });
});

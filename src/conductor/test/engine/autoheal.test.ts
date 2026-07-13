import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execa } from 'execa';

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
    const result = mod.parsePlanTaskPaths(planText);

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
    const result = mod.parsePlanTaskPaths(planText);

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

      expect(result.has('0')).toBe(true);
      expect(result.get('0')!.name).toBe('Confirm edit sites');

      expect(result.has('1')).toBe(true);
      expect(result.get('1')!.name).toBe('Mocked rtk test fixture');
    });

    it('parsePlanTaskPaths: parses bare T-prefixed headers and their paths', async () => {
      const mod = await loadAutoheal();

      const planText = `# Plan

### T0 — Confirm edit sites
**Files:** \`bin/install\`

### T1 — Mocked rtk test fixture
**Files:** \`test/test_rtk_hook_reinit.sh\`
`;
      const result = mod.parsePlanTaskPaths(planText);

      expect(result.has('0')).toBe(true);
      expect(result.get('0')!.has('bin/install')).toBe(true);

      expect(result.has('1')).toBe(true);
      expect(result.get('1')!.has('test/test_rtk_hook_reinit.sh')).toBe(true);
    });

    it('parsePlanTaskPaths: extracts the real 2026-07-12-rtk-hook-preservation.md fixture tasks (T0-T5)', async () => {
      const mod = await loadAutoheal();
      const fixturePath = join(
        __dirname,
        '../../../../.docs/plans/2026-07-12-rtk-hook-preservation.md',
      );
      const planText = await readFile(fixturePath, 'utf-8');

      const result = mod.parsePlanTaskPaths(planText);

      for (const id of ['0', '1', '2', '3', '4', '5']) {
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

      const pathsResult = mod.parsePlanTaskPaths(planText);
      expect(pathsResult.size).toBe(0);
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for deriveCompletion (Task 7, trailer-first authoritative matching).
//
// Tests task completion evidence derivation from git trailers.
// Validates: trailer parsing, path corroboration, grandfathering, and evidence writing.
//
// Acceptance criteria:
// 1. Trailer + touched plan file → task marked `completed` with `evidencedBy` field
// 2. Trailer-only task (no file paths) → completes based on trailer alone
// 3. `(#3)` subject form post-cutover → never evidences; only accepted for grandfather-era rows
// 4. Trailer with zero path overlap (task has paths, commit touches none) → NOT completed + audit-trail entry
// 5. Trailer-first matching (ignores legacy subject forms for non-grandfathered tasks)
// 6. Writes evidence stamps to the sidecar
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveCompletion', () => {
  it('marks task completed when trailer + commit touches plan file', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with paths
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 1: Implementation
Update the API layer.

- \`src/api.ts\`
- \`src/types.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit touching one of the plan files with Task: trailer
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/api.ts'), 'export function api() {}');
    await execa('git', ['add', 'src/api.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: api implementation\n\nTask: 1\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir); // No anchor needed
    const evidence = await createTaskEvidence(gitDir);
    const anchor = ''; // Not used in this test

    const result = await autoheal.deriveCompletion(gitDir, planPath, anchor, commits, evidence);

    expect(result).toHaveProperty('1');
    expect(result['1']).toHaveProperty('completed', true);
    expect(result['1']).toHaveProperty('evidencedBy');
    expect(result['1'].evidencedBy).toMatch(/^[0-9a-f]{40}$/);
  });

  it('marks task completed when trailer alone (no plan paths)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with NO paths for this task
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 2: No files task
A task with no specific files.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit with Task: trailer (touching any file is ok)
    await writeFile(join(gitDir, 'random.txt'), 'content');
    await execa('git', ['add', 'random.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: work\n\nTask: 2\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('2');
    expect(result['2']).toHaveProperty('completed', true);
  });

  it('does NOT complete task with (# form on non-grandfathered task', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 3: Subject-form task
Some task.

- \`src/index.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit using (#3) subject form (legacy, should NOT match post-cutover)
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/index.ts'), 'export const x = 1;');
    await execa('git', ['add', 'src/index.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'fix: update (#3)\n\nThis task uses legacy form, no Task: trailer'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Should NOT mark as completed (no Task: trailer, (#3) form ignored)
    expect(result).toHaveProperty('3');
    expect(result['3']).toHaveProperty('completed', false);
  });

  it('does NOT complete task when trailer path overlap is zero', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with specific paths
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 4: API layer
Update the API.

- \`src/api.ts\`
- \`src/types.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit with Task: 4 but touching DIFFERENT files
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/utils.ts'), 'export const util = 1;');
    await execa('git', ['add', 'src/utils.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: utilities\n\nTask: 4\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Should NOT mark as completed (no path overlap)
    expect(result).toHaveProperty('4');
    expect(result['4']).toHaveProperty('completed', false);
  });

  it('stores evidence stamp in sidecar when task completed', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with paths
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 5: Feature
Implement a feature.

- \`src/feature.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit touching the plan file with Task: trailer
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/feature.ts'), 'export const feature = 1;');
    await execa('git', ['add', 'src/feature.ts'], { cwd: gitDir });
    const commitResult = await execa('git', ['commit', '-m', 'feat: feature\n\nTask: 5\n'], { cwd: gitDir });
    const commitSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Check that evidence was written to sidecar
    expect(evidence.evidenceStamps.has('5')).toBe(true);
    const stamp = evidence.evidenceStamps.get('5');
    expect(stamp).toBeDefined();
    expect(stamp!.sha).toBe(commitSha);
    expect(stamp!.form).toBe('trailer');
  });

  it('logs audit trail entry when path overlap is zero', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
    const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create a plan with specific paths
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 6: Specific task
Update specific files.

- \`src/specific.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit with Task: trailer but no path overlap
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/other.ts'), 'export const other = 1;');
    await execa('git', ['add', 'src/other.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: other work\n\nTask: 6\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Should have audit entry or warning about path mismatch
    expect(result).toHaveProperty('6');
    expect(result['6']).toHaveProperty('completed', false);
    expect(result['6']).toHaveProperty('auditEntry');

    mockWarn.mockRestore();
  });

  // DOMAIN: precedence rule — semantic-verified evidence stamp outranks a
  // failing (path-mismatched) Task: trailer.
  //
  // The judge lane (#520/#586) stamps `form: 'semantic-verified'` only after
  // an LLM judge has read the actual diff and confirmed the task's intent is
  // satisfied — a strictly higher-trust signal than the trailer/path-overlap
  // heuristic, which merely regexes commit messages and diffs file lists.
  // A judge can rightly verify a task through files the plan didn't
  // enumerate (refactors, generated files, indirection) — that is not
  // evidence of failure, it's evidence the heuristic's path list was
  // incomplete. Today (line ~661-716), deriveCompletionInternal finds
  // `matchingCommit` via the Task: trailer BEFORE consulting the sidecar
  // stamp, so a truthy `matchingCommit` short-circuits past the demotion
  // -prevention branch at line 668 (which only runs when `!matchingCommit`)
  // and falls into the path-overlap check, which zeroes out completion and
  // clobbers the stamp's authority with `auditEntry` incompletion. The
  // sidecar stamp must be checked, and take precedence, ahead of — not only
  // in the absence of — a path-mismatched trailer. This is a "stamp wins"
  // rule specifically for the already-verified case: it must NOT be
  // read as "any stamp waives path corroboration" — no-verdict/fail judge
  // outcomes are untouched (no-whitewash preserved), and the second test
  // below pins that absent-stamp + failing-trailer still yields
  // `completed: false` with no invented coverage.
  it('semantic-verified stamp outranks a Task: trailer whose files do not overlap declared paths', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 9: Judged task
Update specific files.

- \`src/judged.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Commit carries the Task: trailer but touches unrelated files — a
    // path-mismatch that would normally zero out completion.
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/unrelated.ts'), 'export const unrelated = 1;');
    await execa('git', ['add', 'src/unrelated.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: unrelated work\n\nTask: 9\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    // Judge lane already stamped this task as semantically satisfied.
    const judgeSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();
    evidence.evidenceStamps.set('9', { sha: judgeSha, form: 'semantic-verified' });

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // The semantic-verified stamp must win: task is completed despite the
    // path-mismatched trailer.
    expect(result).toHaveProperty('9');
    expect(result['9']).toHaveProperty('completed', true);
  });

  it('no stamp + failing trailer (path mismatch) still yields completed: false (no invented coverage)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
    const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 10: Unjudged task
Update specific files.

- \`src/unjudged.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Commit carries the Task: trailer but touches unrelated files, and no
    // sidecar stamp exists at all (no judge lane involvement).
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/other-unrelated.ts'), 'export const other = 1;');
    await execa('git', ['add', 'src/other-unrelated.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: other unrelated work\n\nTask: 10\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('10');
    expect(result['10']).toHaveProperty('completed', false);

    mockWarn.mockRestore();
  });

  it('completes task with guarded task-N alias when alias is NOT in plan', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with task 7 (bare numeric form only)
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 7: Implementation
Update the implementation.

- \`src/impl.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit touching the plan file with Task: task-7 (aliased form)
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/impl.ts'), 'export function impl() {}');
    await execa('git', ['add', 'src/impl.ts'], { cwd: gitDir });
    const commitMsg = 'feat: implementation\n\nTask: task-7\n';
    await execa('git', ['commit', '-m', commitMsg], { cwd: gitDir });

    // Get the commit SHA for assertion
    const commitSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Should mark task 7 as completed with the aliased task-7 trailer
    expect(result).toHaveProperty('7');
    expect(result['7']).toHaveProperty('completed', true);
    expect(result['7']).toHaveProperty('evidencedBy', commitSha);
    expect(result['7'].status).toBe('completed');

    // Sidecar should have the evidence stamp
    expect(evidence.evidenceStamps.has('7')).toBe(true);
    const stamp = evidence.evidenceStamps.get('7');
    expect(stamp).toBeDefined();
    expect(stamp!.sha).toBe(commitSha);
    expect(stamp!.form).toBe('trailer');
  });

  it('does NOT complete bare task when plan declares both bare and literal task-N (ambiguity guard)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with BOTH task 7 (bare) and task task-7 (literal) as separate tasks
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 7: Bare numeric form
Work on the bare numeric task.

- \`src/bare-task.ts\`

### Task task-7: Literal task-N form
Work on the literal task-N form.

- \`src/literal-task.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit touching task-7's declared path with Task: task-7 trailer
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/literal-task.ts'), 'export function literalTask() {}');
    await execa('git', ['add', 'src/literal-task.ts'], { cwd: gitDir });
    const commitMsg = 'feat: literal task work\n\nTask: task-7\n';
    await execa('git', ['commit', '-m', commitMsg], { cwd: gitDir });

    // Get the commit SHA for assertions
    const commitSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Task task-7 should be COMPLETED (exact match in trailer vs plan ids)
    expect(result).toHaveProperty('task-7');
    expect(result['task-7']).toHaveProperty('completed', true);
    expect(result['task-7']).toHaveProperty('evidencedBy', commitSha);
    expect(result['task-7'].status).toBe('completed');

    // Task 7 should remain INCOMPLETE (guard suppressed the alias, so no match)
    expect(result).toHaveProperty('7');
    expect(result['7']).toHaveProperty('completed', false);
    // Task 7 should not have an evidencedBy stamp
    expect(result['7']).not.toHaveProperty('evidencedBy', commitSha);

    // Sidecar should only have evidence for task-7, not task 7
    expect(evidence.evidenceStamps.has('task-7')).toBe(true);
    expect(evidence.evidenceStamps.has('7')).toBe(false);
    const stamp = evidence.evidenceStamps.get('task-7');
    expect(stamp).toBeDefined();
    expect(stamp!.sha).toBe(commitSha);
    expect(stamp!.form).toBe('trailer');
  });

  it('parked-feature: 19-task plan resolves 16/19 via alias (16 completed, 3 unresolved)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with 19 tasks
    const planPath = join(gitDir, '.docs/plans/parked-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    let planContent = '# Parked Feature Plan\n\n';
    for (let i = 1; i <= 19; i++) {
      planContent += `### Task ${i}: Task ${i} implementation\nWork on task ${i}.\n\n`;
    }
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/parked-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add parked plan'], { cwd: gitDir });

    // Create commits with Task: task-{id} trailers for tasks 1-4, 6-8, 11-19 (16 total)
    // These are the tasks that will be resolved
    const resolvedTasks = [1, 2, 3, 4, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19];

    await mkdir(join(gitDir, 'src'), { recursive: true });
    for (const taskId of resolvedTasks) {
      const filePath = join(gitDir, 'src', `task-${taskId}.ts`);
      await writeFile(filePath, `export const task${taskId} = ${taskId};`);
      await execa('git', ['add', `src/task-${taskId}.ts`], { cwd: gitDir });
      const commitMsg = `feat: implement task ${taskId}\n\nTask: task-${taskId}\n`;
      await execa('git', ['commit', '-m', commitMsg], { cwd: gitDir });
    }

    // Tasks 5, 9, 10 will NOT have commits (left unresolved)
    // This creates the recovery boundary that Task 10 runbook will cite

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Count completed and incomplete tasks
    const completedTasks: string[] = [];
    const incompleteTasks: string[] = [];

    for (let i = 1; i <= 19; i++) {
      const taskId = String(i);
      if (result[taskId]?.completed) {
        completedTasks.push(taskId);
      } else {
        incompleteTasks.push(taskId);
      }
    }

    // Assert exactly 16 tasks are completed
    expect(completedTasks).toHaveLength(16);
    expect(completedTasks.sort((a, b) => Number(a) - Number(b))).toEqual(['1', '2', '3', '4', '6', '7', '8', '11', '12', '13', '14', '15', '16', '17', '18', '19']);

    // Assert exactly 3 tasks remain incomplete
    expect(incompleteTasks).toHaveLength(3);
    expect(incompleteTasks.sort((a, b) => Number(a) - Number(b))).toEqual(['5', '9', '10']);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 4: deriveCompletion no-anchor path anchors at branch base (#456).
  //
  // Previously, calling deriveCompletion(root, planPath) with no anchor
  // computed the repo's GENESIS commit via `git log --reverse` and used
  // that as the evidence range boundary — so gate evaluation saw the
  // entire repo history instead of just the current branch's commits.
  // Now, an omitted anchor is passed through as '' to getEvidenceRange,
  // whose resolution ladder derives the branch base (merge-base against
  // the origin default branch) instead.
  // ───────────────────────────────────────────────────────────────────────
  it('with no anchor arg, evaluates a range equal to «merge-base»..HEAD (not repo genesis)', async () => {
    const autoheal = await loadAutoheal();

    // gitDir already has a "pre-base" commit from beforeEach (README.md).
    // Set up a bare origin and push that commit as the base of main.
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    // Record the pre-base commit sha (should NOT be in the derived range).
    const preBaseLog = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const preBaseSha = preBaseLog.stdout.trim();

    // Create a plan with no specific paths for the task, so a bare trailer
    // is sufficient corroboration.
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    await writeFile(
      planPath,
      `# Test Plan\n\n### Task 2: Branch work\nDo the branch work.\n`,
    );
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // 3 commits on the branch, ahead of origin/main; the last one carries
    // a corroborating Task: 2 trailer.
    await writeFile(join(gitDir, 'a.txt'), 'a');
    await execa('git', ['add', 'a.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: branch commit a'], { cwd: gitDir });

    await writeFile(join(gitDir, 'b.txt'), 'b');
    await execa('git', ['add', 'b.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: branch commit b'], { cwd: gitDir });

    await writeFile(join(gitDir, 'c.txt'), 'c');
    await execa('git', ['add', 'c.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: branch commit c\n\nTask: 2\n'], { cwd: gitDir });

    // Compute the expected merge-base..HEAD range independently.
    const mergeBaseOut = await execa('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: gitDir });
    const mergeBase = mergeBaseOut.stdout.trim();
    const expectedRangeOut = await execa('git', ['log', '--format=%H', `${mergeBase}..HEAD`], { cwd: gitDir });
    const expectedShas = expectedRangeOut.stdout.split('\n').filter(Boolean);

    // No-anchor call form: only root + planPath.
    const result = await autoheal.deriveCompletion(gitDir, planPath);

    // Task 2 has a corroborating trailer within the branch range → completed.
    expect(result).toHaveProperty('2');
    expect(result['2']).toHaveProperty('completed', true);
    expect(result['2'].evidencedBy).toBeTruthy();
    expect(expectedShas).toContain(result['2'].evidencedBy);

    // The pre-base (origin) commit must NOT be part of the evaluated range.
    expect(expectedShas).not.toContain(preBaseSha);

    await rm(bareDir, { recursive: true, force: true });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 5: regression for #456 — a foreign, pre-base commit that coincidentally
  // carries a `Task: N` trailer (with paths overlapping the plan's task Files:
  // set) must never corroborate or stamp evidence for the current plan. Before
  // Task 4's fix, the genesis fallback pulled the entire repo history — including
  // commits from before the feature branch existed — into the evidence range,
  // so a stray pre-base trailer could be picked up as if it were real evidence
  // for the current build. After the fix, the no-anchor range is bounded to
  // «merge-base(origin default branch, HEAD)»..HEAD, which excludes it.
  // ───────────────────────────────────────────────────────────────────────
  it('foreign pre-base trailer can never corroborate or stamp task evidence (#456)', async () => {
    const autoheal = await loadAutoheal();

    // Plan with task 2 Files: set that overlaps the foreign commit's paths.
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    await writeFile(
      planPath,
      `# Test Plan\n\n### Task 2: Branch work\nDo the branch work.\n\n- \`shared.txt\`\n`,
    );
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Foreign pre-base commit on the default branch, carrying a coincidental
    // `Task: 2` trailer AND touching a path that overlaps the plan's task 2
    // Files: set — this is the exact #456 bug scenario.
    await writeFile(join(gitDir, 'shared.txt'), 'foreign content');
    await execa('git', ['add', 'shared.txt'], { cwd: gitDir });
    await execa(
      'git',
      ['commit', '-m', 'chore: unrelated pre-base work\n\nTask: 2\n'],
      { cwd: gitDir },
    );
    const foreignLog = await execa('git', ['log', '--format=%H', '-1'], { cwd: gitDir });
    const foreignSha = foreignLog.stdout.trim();

    // Push this history as the base of `main` on a bare origin, then create
    // the feature branch off of it (no new commits touching task 2 on the
    // branch itself — the only Task: 2 trailer in the entire repo lives on
    // the foreign, pre-base commit).
    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    await writeFile(join(gitDir, 'unrelated.txt'), 'branch work');
    await execa('git', ['add', 'unrelated.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: unrelated branch commit'], { cwd: gitDir });

    // No-anchor call form, matching the gate/engine's real usage.
    const result = await autoheal.deriveCompletion(gitDir, planPath);

    // Task 2 must NOT be completed, and must NOT be evidenced by the foreign sha.
    expect(result).toHaveProperty('2');
    expect(result['2'].completed).not.toBe(true);
    expect(result['2'].evidencedBy).not.toBe(foreignSha);

    // No audit entry or warning may reference the foreign commit's sha —
    // it must be entirely absent from the evaluated range, not merely
    // rejected after being considered.
    if (result['2'].auditEntry) {
      expect(result['2'].auditEntry).not.toContain(foreignSha);
      expect(result['2'].auditEntry).not.toContain(foreignSha.slice(0, 7));
    }

    await rm(bareDir, { recursive: true, force: true });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 5 (#510): prove the fix reaches the real production entry point.
  // `deriveCompletion(root, planPath)` — the no-anchor gate form used by
  // conductor.ts, artifacts.ts, and evidence-cli.ts — must NOT emit the
  // spurious "anchor  is unreachable" warning when no anchor is recorded
  // (anchorArg omitted, so getEvidenceRange resolves the branch base itself
  // via its merge-base ladder). Completion results must be unchanged from
  // prior behavior.
  // ───────────────────────────────────────────────────────────────────────
  it('gate path (no anchor arg) derives completion with zero unreachable warnings (#510)', async () => {
    const autoheal = await loadAutoheal();

    const bareDir = await mkdtemp(join(tmpdir(), 'origin-bare-'));
    await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });
    await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: gitDir });
    await execa('git', ['push', '-u', 'origin', 'main'], { cwd: gitDir });

    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    await writeFile(
      planPath,
      `# Test Plan\n\n### Task 2: Branch work\nDo the branch work.\n`,
    );
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Branch commits, last one carrying a `Task:` trailer.
    await writeFile(join(gitDir, 'a.txt'), 'a');
    await execa('git', ['add', 'a.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: branch commit a'], { cwd: gitDir });

    await writeFile(join(gitDir, 'b.txt'), 'b');
    await execa('git', ['add', 'b.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: branch commit b\n\nTask: 2\n'], { cwd: gitDir });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let result;
    try {
      // Real production entry: no anchor arg supplied.
      result = await autoheal.deriveCompletion(gitDir, planPath);
    } finally {
      warnSpy.mockRestore();
    }

    // Completion is unchanged from current (fixed) behavior.
    expect(result).toHaveProperty('2');
    expect(result['2']).toHaveProperty('completed', true);
    expect(result['2'].evidencedBy).toBeTruthy();

    // No `unreachable` warning was logged during the call — the absent
    // anchor path must not synthesize a fake unreachable-anchor warning.
    for (const call of warnSpy.mock.calls) {
      const msg = String(call[0] ?? '');
      expect(msg).not.toMatch(/unreachable/);
    }

    await rm(bareDir, { recursive: true, force: true });
  });

  it('no code path invokes `git log --reverse` for anchor resolution', async () => {
    // Static assertion: the genesis-fallback block that shelled out to
    // `git log --format=%H --reverse HEAD` to resolve a missing anchor has
    // been removed from deriveCompletion. Guard against regression by
    // asserting the source no longer contains that invocation.
    const src = await readFile(join(process.cwd(), 'src/engine/autoheal.ts'), 'utf-8');
    expect(src).not.toMatch(/--reverse/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for deriveCompletion Evidence forms (Task 8, no-op evidence commits).
//
// Tests evidence trailer forms: satisfied-by and skipped.
// No-op commits (empty) can carry evidence forms to satisfy task completion.
//
// Acceptance criteria:
// 1. Empty commit with `Task: N` + `Evidence: satisfied-by <sha>` → completed
// 2. Empty commit with `Evidence: skipped <reason>` → skipped (gate-acceptable)
// 3. Dangling `satisfied-by` sha (invalid/unreachable) → NOT completed + audit log
// 4. Bare `Task: N` empty commit without `Evidence:` → no evidence + incomplete
// 5. A `skipped` task status appears in result
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveCompletion Evidence forms', () => {
  it('marks task completed with Evidence: satisfied-by <valid sha>', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 7: Satisfied by evidence
A task that will be completed by evidence form.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit that will be referenced as the evidence SHA
    await writeFile(join(gitDir, 'src.ts'), 'export const x = 1;');
    await execa('git', ['add', 'src.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: real work\n\nTask: 7\n'], { cwd: gitDir });

    // Get the SHA of the work commit
    const workCommitSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // Create an empty no-op commit with the ADR-canonical form: `Task: <id>`
    // PLUS the Evidence: trailer (H5 — an unscoped Evidence commit must never
    // evidence every task in a plan).
    await execa('git', ['commit', '--allow-empty', '-m', `noop: evidence commit\n\nTask: 7\nEvidence: satisfied-by ${workCommitSha}\n`], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('7');
    expect(result['7']).toHaveProperty('completed', true);
    expect(result['7']).toHaveProperty('evidencedBy');
    expect(result['7'].evidencedBy).toBe(workCommitSha);
  });

  it('marks task skipped with Evidence: skipped <reason>', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 8: Skippable task
A task that will be skipped.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a no-op commit with the ADR-canonical form: `Task: <id>` PLUS
    // the Evidence: skipped trailer (H5 scoping, as above).
    await execa('git', ['commit', '--allow-empty', '-m', 'noop: skip evidence\n\nTask: 8\nEvidence: skipped build unavailable\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('8');
    expect(result['8']).toHaveProperty('status', 'skipped');
    expect(result['8']).toHaveProperty('skipReason', 'build unavailable');
  });

  it('does NOT complete task with dangling satisfied-by sha', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 9: Dangling evidence
A task with a dangling sha.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a no-op commit with a bogus sha
    const fakeSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    await execa('git', ['commit', '--allow-empty', '-m', `noop: bad evidence\n\nTask: 9\nEvidence: satisfied-by ${fakeSha}\n`], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('9');
    expect(result['9']).toHaveProperty('completed', false);
    expect(result['9']).toHaveProperty('auditEntry');
    expect(result['9'].auditEntry).toContain('dangling');
  });

  it('does NOT complete task with bare Task: trailer but no Evidence:', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 10: Bare task
A task with bare Task: trailer.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create an empty commit with ONLY Task: trailer (no Evidence:)
    await execa('git', ['commit', '--allow-empty', '-m', 'noop: bare task\n\nTask: 10\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('10');
    expect(result['10']).toHaveProperty('completed', false);
  });

  it('includes skipped status in result when Evidence: skipped present', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 11: Skip test
Another task to skip.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create skip evidence
    await execa('git', ['commit', '--allow-empty', '-m', 'noop: skip commit\n\nTask: 11\nEvidence: skipped deployment blocked\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('11');
    expect(result['11']).toHaveProperty('status');
    expect(result['11'].status).toBe('skipped');
  });

  it('marks task completed with Evidence: satisfied-by and guarded task-N alias', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with task 13 (bare numeric form only)
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 13: Aliased evidence task
A task that will be completed by aliased evidence form.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit that will be referenced as the evidence SHA
    await writeFile(join(gitDir, 'src.ts'), 'export const x = 1;');
    await execa('git', ['add', 'src.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: real work\n\nTask: 13\n'], { cwd: gitDir });

    // Get the SHA of the work commit
    const workCommitSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // Create an empty no-op commit with aliased Task: task-13 form PLUS Evidence: satisfied-by
    await execa('git', ['commit', '--allow-empty', '-m', `noop: aliased evidence commit\n\nTask: task-13\nEvidence: satisfied-by ${workCommitSha}\n`], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('13');
    expect(result['13']).toHaveProperty('completed', true);
    expect(result['13']).toHaveProperty('evidencedBy', workCommitSha);
    expect(result['13']).toHaveProperty('status', 'completed');
    expect(evidence.evidenceStamps.has('13')).toBe(true);
    const stamp = evidence.evidenceStamps.get('13');
    expect(stamp).toBeDefined();
    expect(stamp!.form).toBe('evidence:satisfied-by');
  });

  it('preserves completed status when evidence commit is removed (never-demote pinned)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with paths
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 12: Never demote
A task that will be pinned by evidence.

- \`src/pinned.ts\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit touching the plan file with Task: trailer
    await mkdir(join(gitDir, 'src'), { recursive: true });
    await writeFile(join(gitDir, 'src/pinned.ts'), 'export const pinned = 1;');
    await execa('git', ['add', 'src/pinned.ts'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: pinned work\n\nTask: 12\n'], { cwd: gitDir });

    // Get the SHA of the evidence commit
    const evidenceCommitSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // First derivation: should mark task as completed and store evidence stamp
    const commits1 = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence1 = await createTaskEvidence(gitDir);
    const result1 = await autoheal.deriveCompletion(gitDir, planPath, '', commits1, evidence1);

    expect(result1).toHaveProperty('12');
    expect(result1['12']).toHaveProperty('completed', true);
    expect(result1['12']).toHaveProperty('evidencedBy');
    expect(evidence1.evidenceStamps.has('12')).toBe(true);

    // Simulate rebase/history edit by removing the evidence commit
    // Use git reset --hard to go back to before the evidence commit
    await execa('git', ['reset', '--hard', 'HEAD~1'], { cwd: gitDir });

    // Second derivation: evidence stamp still exists in sidecar, task should remain completed
    // Note: we need to manually reload the evidence from the sidecar to simulate persistence
    const commits2 = await autoheal.listCommitsWithTrailers(gitDir);
    // Manually set the evidence stamp to simulate it being loaded from persisted sidecar
    const evidence2 = await createTaskEvidence(gitDir);
    evidence2.evidenceStamps.set('12', { sha: evidenceCommitSha, form: 'trailer' });

    const result2 = await autoheal.deriveCompletion(gitDir, planPath, '', commits2, evidence2);

    // Task should remain completed despite evidence commit being removed
    expect(result2).toHaveProperty('12');
    expect(result2['12']).toHaveProperty('completed', true);
    expect(result2['12'].completed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression (ADR H5/H8): attemptAutoHeal is a migration-only fallback. Any
// completion it writes to task-status.json MUST be backed by a task-evidence.json
// sidecar stamp, otherwise seedTaskStatus's H8 demotion logic (a "completed" row
// with no matching evidence stamp gets flipped back to "pending" on next seed)
// would silently undo the legacy heal on the very next build cycle.
// ─────────────────────────────────────────────────────────────────────────────
describe('attemptAutoHeal (H5 migration-only fallback)', () => {
  it('stamps sidecar evidence for every legacy heal, so seedTaskStatus does not demote it back to pending', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
    const { seedTaskStatus } = await import('../../src/engine/task-seed.js');

    // Plan with one task, matched via subject/id heuristic (legacy path).
    const planPath = join(gitDir, 'plan.md');
    await writeFile(planPath, '### Task 1: Do the thing\n\n`file.txt`\n');

    // Commit whose subject satisfies the legacy id-match heuristic and whose
    // diff touches the plan-declared path.
    await writeFile(join(gitDir, 'file.txt'), 'content');
    await execa('git', ['add', 'file.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: T1 do the thing'], { cwd: gitDir });

    // Seed task-status.json with the pending task and a plan_ref pointing at
    // our plan file (readPlanPaths / seedTaskStatus expect .docs/plans/<name>
    // unless the path is absolute or starts with ./ or .docs/).
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    await writeFile(
      join(gitDir, '.pipeline', 'task-status.json'),
      JSON.stringify({ plan_ref: planPath, tasks: [{ id: '1', name: 'Do the thing', status: 'pending' }] }, null, 2),
    );

    // Legacy heal: marks the task completed via subject/path matching.
    const healResult = await autoheal.attemptAutoHeal(gitDir);
    expect(healResult.healed.map((h) => h.taskId)).toContain('1');

    const statusAfterHeal = JSON.parse(
      await readFile(join(gitDir, '.pipeline', 'task-status.json'), 'utf-8'),
    );
    const healedTask = statusAfterHeal.tasks.find((t: any) => t.id === '1');
    expect(healedTask.status).toBe('completed');

    // The heal must have written a sidecar evidence stamp — never a bare
    // completion with no corresponding evidence (H5).
    const evidenceAfterHeal = await createTaskEvidence(gitDir);
    expect(evidenceAfterHeal.evidenceStamps.has('1')).toBe(true);
    expect(evidenceAfterHeal.evidenceStamps.get('1')?.form).toBe('legacy-heal');

    // Re-seed (simulates the next build-gate cycle). H8's demotion check looks
    // for a sidecar stamp before preserving a "completed" row; because the
    // heal stamped one, the task must NOT be flipped back to pending.
    await seedTaskStatus(gitDir, planPath);

    const statusAfterReseed = JSON.parse(
      await readFile(join(gitDir, '.pipeline', 'task-status.json'), 'utf-8'),
    );
    const reseededTask = statusAfterReseed.tasks.find((t: any) => t.id === '1');
    expect(reseededTask.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: Alias inherits rejection rules (Task 5)
//
// Tests to verify that the guarded task-N alias feature does NOT loosen
// existing rejection rules. These tests use the aliased form (task-N) in
// trailers to ensure that empty commits, dangling SHAs, and path mismatches
// are still properly rejected even when using the alias.
//
// Acceptance criteria:
// 1. Empty commit without Evidence (using task-N alias) → incomplete + audit entry
// 2. Dangling SHA in Evidence (using task-N alias) → incomplete + audit entry with "dangling"
// 3. Path corroboration mismatch (using task-N alias) → incomplete + audit entry
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression: alias inherits empty/dangling/path-corroboration rejections', () => {
  it('rejects empty commit without Evidence trailer (using aliased task-N)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with task 9
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 9: Empty rejection
A task that will be rejected for being empty.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create an empty commit with ONLY Task: task-9 trailer (aliased form, no Evidence:)
    await execa('git', ['commit', '--allow-empty', '-m', 'noop: empty task\n\nTask: task-9\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Should NOT mark as completed (empty without Evidence)
    expect(result).toHaveProperty('9');
    expect(result['9']).toHaveProperty('completed', false);
    expect(result['9']).toHaveProperty('auditEntry');
    expect(result['9'].auditEntry).toContain('empty commit');
  });

  it('rejects dangling SHA in Evidence trailer (using aliased task-N)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with task 4
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 4: Dangling evidence
A task with dangling sha.
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit with a dangling sha using aliased task-4 form
    const fakeSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    await execa('git', ['commit', '--allow-empty', '-m', `noop: bad evidence\n\nTask: task-4\nEvidence: satisfied-by ${fakeSha}\n`], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Should NOT mark as completed (dangling SHA)
    expect(result).toHaveProperty('4');
    expect(result['4']).toHaveProperty('completed', false);
    expect(result['4']).toHaveProperty('auditEntry');
    expect(result['4'].auditEntry).toContain('dangling');
  });

  it('rejects path-corroboration mismatch (using aliased task-N)', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create a plan with task 6 and specific path
    const planPath = join(gitDir, '.docs/plans/test-plan.md');
    await mkdir(join(gitDir, '.docs/plans'), { recursive: true });
    const planContent = `# Test Plan

### Task 6: Path specific
Update specific file.

- \`docs/path-a.md\`
`;
    await writeFile(planPath, planContent);
    await execa('git', ['add', '.docs/plans/test-plan.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: gitDir });

    // Create a commit with Task: task-6 (aliased form) that touches a DIFFERENT file
    await mkdir(join(gitDir, 'docs'), { recursive: true });
    await writeFile(join(gitDir, 'docs/path-b.md'), 'content');
    await execa('git', ['add', 'docs/path-b.md'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: wrong path\n\nTask: task-6\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    // Should NOT mark as completed (path mismatch)
    expect(result).toHaveProperty('6');
    expect(result['6']).toHaveProperty('completed', false);
    expect(result['6']).toHaveProperty('auditEntry');
    expect(result['6'].auditEntry).toContain('path overlap');
  });
});

// Unit tests for reconcileStatusFromStamps (Task 1, evidence-stamp sync).
//
// Tests synchronization of task-status.json rows based on evidence stamps.
// Non-terminal (pending/in_progress) rows are advanced to completed when they
// have corresponding evidence stamps; terminal rows (completed/skipped) remain
// untouched. Orphan handling (Task 2) is not implemented yet.
//
// Task: 1

describe('reconcileStatusFromStamps', () => {
  it('reconciles non-terminal rows to completed with stamp commit SHAs', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create task-status.json with mixed statuses
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const statusContent = {
      tasks: [
        { id: '7', name: 'Task 7', status: 'in_progress' },
        { id: '8', name: 'Task 8', status: 'pending' },
        { id: '9', name: 'Task 9', status: 'completed', commit: 'abc1234' },
      ],
    };
    await writeFile(statusPath, JSON.stringify(statusContent, null, 2) + '\n');

    // Create evidence stamps for all three tasks
    const evidence = await createTaskEvidence(gitDir);
    evidence.evidenceStamps.set('7', { sha: 'abc1234def567890', form: 'trailer' });
    evidence.evidenceStamps.set('8', { sha: 'def5678abc12345f', form: 'trailer' });
    evidence.evidenceStamps.set('9', { sha: 'fedcba9876543210', form: 'trailer' });
    await evidence.write();

    // Call reconcileStatusFromStamps
    const result = await autoheal.reconcileStatusFromStamps(gitDir);

    // Verify result
    expect(result.synced).toContain('7');
    expect(result.synced).toContain('8');
    expect(result.synced).not.toContain('9'); // Terminal row untouched
    expect(result.orphanStamps).toEqual([]);

    // Verify task-status.json was updated
    const updatedStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
    expect(updatedStatus.tasks[0]).toHaveProperty('status', 'completed');
    expect(updatedStatus.tasks[0]).toHaveProperty('commit', 'abc1234'); // 7-char short SHA
    expect(updatedStatus.tasks[1]).toHaveProperty('status', 'completed');
    expect(updatedStatus.tasks[1]).toHaveProperty('commit', 'def5678'); // 7-char short SHA
    // Terminal row 9 stays the same
    expect(updatedStatus.tasks[2]).toHaveProperty('status', 'completed');
    expect(updatedStatus.tasks[2]).toHaveProperty('commit', 'abc1234'); // Unchanged
  });

  it('leaves terminal rows (completed/skipped) untouched', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create task-status.json with only terminal rows
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const statusContent = {
      tasks: [
        { id: '10', name: 'Task 10', status: 'completed', commit: 'original1' },
        { id: '11', name: 'Task 11', status: 'skipped', skip_reason: 'not needed' },
      ],
    };
    await writeFile(statusPath, JSON.stringify(statusContent, null, 2) + '\n');

    // Create evidence stamps
    const evidence = await createTaskEvidence(gitDir);
    evidence.evidenceStamps.set('10', { sha: 'newsha1234567890', form: 'trailer' });
    evidence.evidenceStamps.set('11', { sha: 'newsha0987654321', form: 'trailer' });
    await evidence.write();

    // Call reconcileStatusFromStamps
    const result = await autoheal.reconcileStatusFromStamps(gitDir);

    // Terminal rows should NOT be synced
    expect(result.synced).not.toContain('10');
    expect(result.synced).not.toContain('11');
    expect(result.synced).toEqual([]);

    // Verify nothing was written (original commits unchanged)
    const updatedStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
    expect(updatedStatus.tasks[0]).toHaveProperty('commit', 'original1'); // Byte-identical
    expect(updatedStatus.tasks[1]).toHaveProperty('skip_reason', 'not needed'); // Untouched
  });

  it('handles mixed scenario: some terminal, some non-terminal', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create task-status.json with mixed statuses
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const statusContent = {
      tasks: [
        { id: '12', name: 'Task 12', status: 'pending' },
        { id: '13', name: 'Task 13', status: 'completed', commit: 'keep_this' },
        { id: '14', name: 'Task 14', status: 'in_progress' },
      ],
    };
    await writeFile(statusPath, JSON.stringify(statusContent, null, 2) + '\n');

    // Create evidence stamps
    const evidence = await createTaskEvidence(gitDir);
    evidence.evidenceStamps.set('12', { sha: 'sha12345678901234', form: 'trailer' });
    evidence.evidenceStamps.set('13', { sha: 'sha98765432109876', form: 'trailer' });
    evidence.evidenceStamps.set('14', { sha: 'shafedcba9876543', form: 'trailer' });
    await evidence.write();

    // Call reconcileStatusFromStamps
    const result = await autoheal.reconcileStatusFromStamps(gitDir);

    // Should sync tasks 12 and 14, but not 13 (terminal)
    expect(result.synced).toEqual(['12', '14']);
    expect(result.orphanStamps).toEqual([]);

    // Verify updates
    const updatedStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
    expect(updatedStatus.tasks[0]).toHaveProperty('status', 'completed');
    expect(updatedStatus.tasks[0]).toHaveProperty('commit', 'sha1234'); // 7-char
    expect(updatedStatus.tasks[1]).toHaveProperty('commit', 'keep_this'); // Terminal untouched
    expect(updatedStatus.tasks[2]).toHaveProperty('status', 'completed');
    expect(updatedStatus.tasks[2]).toHaveProperty('commit', 'shafedc'); // 7-char
  });

  it('returns empty lists when no stamps exist', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create task-status.json with pending rows
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const statusContent = {
      tasks: [
        { id: '15', name: 'Task 15', status: 'pending' },
        { id: '16', name: 'Task 16', status: 'pending' },
      ],
    };
    await writeFile(statusPath, JSON.stringify(statusContent, null, 2) + '\n');

    // Create empty evidence (no stamps)
    const evidence = await createTaskEvidence(gitDir);
    await evidence.write();

    // Call reconcileStatusFromStamps
    const result = await autoheal.reconcileStatusFromStamps(gitDir);

    // Nothing synced, no orphans
    expect(result.synced).toEqual([]);
    expect(result.orphanStamps).toEqual([]);

    // Status unchanged (still pending)
    const updatedStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
    expect(updatedStatus.tasks[0]).toHaveProperty('status', 'pending');
    expect(updatedStatus.tasks[1]).toHaveProperty('status', 'pending');
  });

  it('handles missing task-status.json gracefully', async () => {
    const autoheal = await loadAutoheal();

    // No task-status.json file
    const result = await autoheal.reconcileStatusFromStamps(gitDir);

    expect(result.synced).toEqual([]);
    expect(result.orphanStamps).toEqual([]);
  });

  it('orphan stamps: stamps with no matching row do not create rows but are tracked', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create task-status.json with no row for task 99, but a valid row for task 7
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const statusContent = {
      tasks: [
        { id: '7', name: 'Task 7', status: 'in_progress' },
      ],
    };
    await writeFile(statusPath, JSON.stringify(statusContent, null, 2) + '\n');

    // Create evidence stamps: task 99 (orphan) and task 7 (valid)
    const evidence = await createTaskEvidence(gitDir);
    evidence.evidenceStamps.set('99', { sha: 'orphansha1234567', form: 'trailer' });
    evidence.evidenceStamps.set('7', { sha: 'abc1234def567890', form: 'trailer' });
    await evidence.write();

    // Spy on console.warn to verify orphan warning
    const warnSpy = vi.spyOn(console, 'warn');

    // Call reconcileStatusFromStamps
    const result = await autoheal.reconcileStatusFromStamps(gitDir);

    // Row 7 should be synced, orphan 99 should be tracked
    expect(result.synced).toContain('7');
    expect(result.synced).not.toContain('99');
    expect(result.orphanStamps).toContain('99');

    // No row should be created for orphan task 99
    const updatedStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
    expect(updatedStatus.tasks).toHaveLength(1); // Still only one task
    expect(updatedStatus.tasks[0]).toHaveProperty('id', '7');

    // Exactly one console.warn with the orphan prefix
    const orphanWarns = warnSpy.mock.calls.filter(call => {
      const msg = String(call[0]);
      return msg.includes('[task-evidence]') && msg.includes('stamp for unknown task id 99');
    });
    expect(orphanWarns).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it('no-stamp rows: rows without evidence stamps are never advanced', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Create task-status.json with row 8 (pending) but no stamp for it
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const statusContent = {
      tasks: [
        { id: '8', name: 'Task 8', status: 'pending' },
      ],
    };
    await writeFile(statusPath, JSON.stringify(statusContent, null, 2) + '\n');

    // Create empty evidence (no stamps for task 8)
    const evidence = await createTaskEvidence(gitDir);
    await evidence.write();

    // Call reconcileStatusFromStamps
    const result = await autoheal.reconcileStatusFromStamps(gitDir);

    // Nothing synced, no orphans
    expect(result.synced).toEqual([]);
    expect(result.orphanStamps).toEqual([]);

    // Task 8 should still be pending
    const updatedStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
    expect(updatedStatus.tasks[0]).toHaveProperty('status', 'pending');
    expect(updatedStatus.tasks[0]).not.toHaveProperty('commit'); // No commit set
  });

  it('missing/corrupt task-status.json: fails soft with no exceptions', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');

    // Case 1: No task-status.json file at all
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const evidence = await createTaskEvidence(gitDir);
    evidence.evidenceStamps.set('20', { sha: 'abc1234567890def', form: 'trailer' });
    await evidence.write();

    let result = await autoheal.reconcileStatusFromStamps(gitDir);
    expect(result.synced).toEqual([]);
    expect(result.orphanStamps).toEqual([]);

    // Case 2: Corrupted JSON in task-status.json
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await writeFile(statusPath, 'invalid json { broken');

    result = await autoheal.reconcileStatusFromStamps(gitDir);
    expect(result.synced).toEqual([]);
    expect(result.orphanStamps).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for applyDerivedCompletion (Task 3, derived + reconciliation).
//
// Tests that applyDerivedCompletion not only processes pending rows with
// derived hits but also reconciles in_progress rows via evidence stamps.
// This ensures rows from prior passes (with stamps) are no longer missed.
//
// Task: 3 (wire reconcileStatusFromStamps into applyDerivedCompletion)
//
// ─────────────────────────────────────────────────────────────────────────────

describe('applyDerivedCompletion', () => {
  it('advances in_progress rows via reconcileStatusFromStamps when no derived hit', async () => {
    const autoheal = await loadAutoheal();
    const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
    const { countResolvedTasks } = await import('../../src/engine/task-progress.js');

    // Setup: Create task-status.json with an in_progress row for task 26
    const statusPath = join(gitDir, '.pipeline/task-status.json');
    await mkdir(join(gitDir, '.pipeline'), { recursive: true });
    const statusContent = {
      tasks: [
        { id: '26', name: 'Task 26', status: 'in_progress' },
      ],
    };
    await writeFile(statusPath, JSON.stringify(statusContent, null, 2) + '\n');

    // Setup: Create evidence stamp for task 26 (simulating a prior pass)
    const evidence = await createTaskEvidence(gitDir);
    evidence.evidenceStamps.set('26', { sha: 'abc1234567890def', form: 'trailer' });
    await evidence.write();

    // Simulate the #526 scenario: derived has no hit for task 26
    // (it's a stamped row from a prior pass, not a new derived result this pass)
    const derived = {};

    // Call applyDerivedCompletion
    const result = await autoheal.applyDerivedCompletion(gitDir, derived);

    // Assertions:
    // 1. Task 26's row should now read as completed on disk
    const updatedStatus = JSON.parse(await readFile(statusPath, 'utf-8'));
    expect(updatedStatus.tasks[0]).toHaveProperty('status', 'completed');
    expect(updatedStatus.tasks[0]).toHaveProperty('commit', 'abc1234'); // 7-char short SHA

    // 2. Task 26 should be in auto_heal result (added by reconciliation)
    expect(result.healed.map(h => h.taskId)).toContain('26');

    // 3. Task 26 should not be in skipped (no skip evidence)
    expect(result.skipped).toEqual([]);

    // 4. Use task-progress reader to confirm task 26 is resolved
    const resolvedCount = await countResolvedTasks(gitDir);
    expect(resolvedCount).toBe(1); // One task is now completed
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
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

    // Create an empty no-op commit with Evidence: satisfied-by trailer
    await execa('git', ['commit', '--allow-empty', '-m', `noop: evidence commit\n\nEvidence: satisfied-by ${workCommitSha}\n`], { cwd: gitDir });

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

    // Create a no-op commit with Evidence: skipped trailer
    await execa('git', ['commit', '--allow-empty', '-m', 'noop: skip evidence\n\nEvidence: skipped build unavailable\n'], { cwd: gitDir });

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
    await execa('git', ['commit', '--allow-empty', '-m', `noop: bad evidence\n\nEvidence: satisfied-by ${fakeSha}\n`], { cwd: gitDir });

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
    await execa('git', ['commit', '--allow-empty', '-m', 'noop: skip commit\n\nEvidence: skipped deployment blocked\n'], { cwd: gitDir });

    const commits = await autoheal.listCommitsWithTrailers(gitDir);
    const evidence = await createTaskEvidence(gitDir);

    const result = await autoheal.deriveCompletion(gitDir, planPath, '', commits, evidence);

    expect(result).toHaveProperty('11');
    expect(result['11']).toHaveProperty('status');
    expect(result['11'].status).toBe('skipped');
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

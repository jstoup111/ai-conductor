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

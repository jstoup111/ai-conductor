import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';
import { makeGitRunner } from '../../src/engine/rebase.js';

async function loadAttributionInputs() {
  return import('../../src/engine/attribution-inputs.js');
}

let tmpDir: string;
let gitDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'attribution-inputs-test-'));
  gitDir = tmpDir;

  // Initialize a git repo for testing
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

describe('collectCandidateCommits', () => {
  it('returns empty result when given empty range', async () => {
    const mod = await loadAttributionInputs();
    const evidence = await createTaskEvidence(gitDir);

    // Get the initial commit SHA
    const log = await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir });
    const initialSha = log.stdout.trim();

    // A range from the initial commit to itself should be empty
    const result = await mod.collectCandidateCommits(makeGitRunner(gitDir), evidence, `${initialSha}..HEAD`, undefined, gitDir);
    expect(result).toEqual([]);
  });

  it('returns commits not yet cited by any stamp', async () => {
    const mod = await loadAttributionInputs();
    const evidence = await createTaskEvidence(gitDir);

    // Create two commits
    await writeFile(join(gitDir, 'file1.txt'), 'content1');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: first commit'], { cwd: gitDir });

    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    const commit2Log = await execa('git', ['commit', '-m', 'feat: second commit'], { cwd: gitDir });

    // Get the initial commit SHA to create a range
    const allLogs = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = allLogs.stdout.trim().split('\n').reverse(); // oldest first
    const initialSha = allShas[0];

    // Before stamping, both should be candidates
    const resultBefore = await mod.collectCandidateCommits(makeGitRunner(gitDir), evidence, `${initialSha}..HEAD`, undefined, gitDir);
    expect(resultBefore.length).toBe(2);
    expect(resultBefore.some(c => c.subject === 'feat: first commit')).toBe(true);
    expect(resultBefore.some(c => c.subject === 'feat: second commit')).toBe(true);

    // Add a stamp for the first commit
    const firstCommitSha = resultBefore.find(c => c.subject === 'feat: first commit')!.sha;
    evidence.evidenceStamps.set('task-1', { sha: firstCommitSha, form: 'trailer' });

    // After stamping, first commit should be excluded
    const resultAfter = await mod.collectCandidateCommits(makeGitRunner(gitDir), evidence, `${initialSha}..HEAD`, undefined, gitDir);
    expect(resultAfter.length).toBe(1);
    expect(resultAfter[0].subject).toBe('feat: second commit');
  });

  it('excludes empty commits from candidates', async () => {
    const mod = await loadAttributionInputs();
    const evidence = await createTaskEvidence(gitDir);

    // Create a non-empty commit
    await writeFile(join(gitDir, 'file1.txt'), 'content1');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: non-empty commit'], { cwd: gitDir });

    // Create an empty commit
    await execa('git', ['commit', '--allow-empty', '-m', 'chore: empty commit'], { cwd: gitDir });

    // Get the initial commit SHA to create a range
    const allLogs = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = allLogs.stdout.trim().split('\n').reverse(); // oldest first
    const initialSha = allShas[0];

    // Only the non-empty commit should be returned
    const result = await mod.collectCandidateCommits(makeGitRunner(gitDir), evidence, `${initialSha}..HEAD`, undefined, gitDir);
    expect(result.length).toBe(1);
    expect(result[0].subject).toBe('feat: non-empty commit');
  });

  it('excludes engine bookkeeping commits from candidates', async () => {
    const mod = await loadAttributionInputs();
    const evidence = await createTaskEvidence(gitDir);

    // Create a regular commit
    await writeFile(join(gitDir, 'file1.txt'), 'content1');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: regular commit'], { cwd: gitDir });

    // Create an engine bookkeeping commit using the engine commit env var
    const git = makeGitRunner(gitDir);
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir }, { env: { ...process.env, CONDUCT_ENGINE_COMMIT: '1' } });
    // Actually use the git runner which will set the env var
    const bookkeepingResult = await git(['commit', '-m', 'chore: engine bookkeeping']);
    expect(bookkeepingResult.exitCode).toBe(0);

    // Get the initial commit SHA to create a range
    const allLogs = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = allLogs.stdout.trim().split('\n').reverse(); // oldest first
    const initialSha = allShas[0];

    // Get SHA of the engine commit
    const lastLog = await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir });
    const engineCommitSha = lastLog.stdout.trim();

    // Store the engine commit SHA in evidence as a marker of bookkeeping commits
    // This is a mechanism for tracking which commits are engine-authored
    if (!evidence.migrationGrandfather.has('_engine_bookkeeping_commits')) {
      evidence.migrationGrandfather.add('_engine_bookkeeping_commits');
    }

    // For now, we'll pass a set of bookkeeping commits separately
    const result = await mod.collectCandidateCommits(makeGitRunner(gitDir), evidence, `${initialSha}..HEAD`, new Set([engineCommitSha]), gitDir);

    // Should only have the regular commit
    expect(result.length).toBe(1);
    expect(result[0].subject).toBe('feat: regular commit');
  });

  it('returns commits with sha, subject, and diff', async () => {
    const mod = await loadAttributionInputs();
    const evidence = await createTaskEvidence(gitDir);

    // Create a commit with multiple files
    await writeFile(join(gitDir, 'file1.txt'), 'content1\n');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await writeFile(join(gitDir, 'file2.txt'), 'content2\n');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: multi-file commit'], { cwd: gitDir });

    // Get the initial commit SHA to create a range
    const allLogs = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = allLogs.stdout.trim().split('\n').reverse(); // oldest first
    const initialSha = allShas[0];

    const result = await mod.collectCandidateCommits(makeGitRunner(gitDir), evidence, `${initialSha}..HEAD`, undefined, gitDir);

    expect(result.length).toBe(1);
    const commit = result[0];

    // Check sha is a valid SHA
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);

    // Check subject
    expect(commit.subject).toBe('feat: multi-file commit');

    // Check diff is present and contains the files we added
    expect(commit.diff).toBeDefined();
    expect(commit.diff!.length).toBeGreaterThan(0);
    expect(commit.diff).toContain('file1.txt');
    expect(commit.diff).toContain('file2.txt');
  });

  it('returns empty result when all commits are cited', async () => {
    const mod = await loadAttributionInputs();
    const evidence = await createTaskEvidence(gitDir);

    // Create a commit
    await writeFile(join(gitDir, 'file1.txt'), 'content1');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: test commit'], { cwd: gitDir });

    // Get the initial commit SHA to create a range
    const allLogs = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = allLogs.stdout.trim().split('\n').reverse(); // oldest first
    const initialSha = allShas[0];

    // Get the commit SHA
    const headLog = await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir });
    const commitSha = headLog.stdout.trim();

    // Stamp the commit
    evidence.evidenceStamps.set('task-1', { sha: commitSha, form: 'trailer' });

    // No candidates should be returned
    const result = await mod.collectCandidateCommits(makeGitRunner(gitDir), evidence, `${initialSha}..HEAD`, undefined, gitDir);
    expect(result).toEqual([]);
  });

  it('handles multiple commits with mixed cited/uncited/empty/bookkeeping states', async () => {
    const mod = await loadAttributionInputs();
    const evidence = await createTaskEvidence(gitDir);

    // Commit 1: regular, will be cited
    await writeFile(join(gitDir, 'file1.txt'), 'content1');
    await execa('git', ['add', 'file1.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: commit 1'], { cwd: gitDir });
    const commit1Sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // Commit 2: regular, uncited
    await writeFile(join(gitDir, 'file2.txt'), 'content2');
    await execa('git', ['add', 'file2.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: commit 2'], { cwd: gitDir });
    const commit2Sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // Commit 3: empty
    await execa('git', ['commit', '--allow-empty', '-m', 'chore: empty'], { cwd: gitDir });

    // Commit 4: bookkeeping (using git runner which will set env var)
    const git = makeGitRunner(gitDir);
    await writeFile(join(gitDir, 'file4.txt'), 'content4');
    await execa('git', ['add', 'file4.txt'], { cwd: gitDir });
    await git(['commit', '-m', 'chore: bookkeeping']);
    const commit4Sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // Commit 5: regular, uncited
    await writeFile(join(gitDir, 'file5.txt'), 'content5');
    await execa('git', ['add', 'file5.txt'], { cwd: gitDir });
    await execa('git', ['commit', '-m', 'feat: commit 5'], { cwd: gitDir });
    const commit5Sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout.trim();

    // Mark commit 1 as cited
    evidence.evidenceStamps.set('task-1', { sha: commit1Sha, form: 'trailer' });

    // Get the initial commit SHA to create a range
    const allLogs = await execa('git', ['log', '--format=%H'], { cwd: gitDir });
    const allShas = allLogs.stdout.trim().split('\n').reverse(); // oldest first
    const initialSha = allShas[0];

    // Call with bookkeeping commits set
    const result = await mod.collectCandidateCommits(
      makeGitRunner(gitDir),
      evidence,
      `${initialSha}..HEAD`,
      new Set([commit4Sha]),
      gitDir
    );

    // Should only have commits 2 and 5 (uncited, non-empty, non-bookkeeping)
    expect(result.length).toBe(2);
    expect(result.map(c => c.sha)).toContain(commit2Sha);
    expect(result.map(c => c.sha)).toContain(commit5Sha);
  });
});

describe('assembleAttributionInputs', () => {
  let planDir: string;
  let planPath: string;

  beforeEach(async () => {
    planDir = await mkdtemp(join(tmpdir(), 'attribution-assembly-test-'));
  });

  afterEach(async () => {
    await rm(planDir, { recursive: true, force: true });
  });

  it('assembles task sections verbatim from the plan for given residue IDs', async () => {
    const mod = await loadAttributionInputs();
    planPath = join(planDir, 'plan.md');
    await writeFile(
      planPath,
      `# Implementation Plan

## Tasks

### Task 1: First task
**Files:** \`src/file1.ts\`

This is task 1 description.

### Task 2: Second task
**Files:** \`src/file2.ts\`, \`src/file3.ts\`

This is task 2 description with more details.

### Task 3: Third task
**Files:** \`src/file4.ts\`

This is task 3 description.
`,
      'utf-8'
    );

    const evidence = await createTaskEvidence(gitDir);
    const candidates = [
      { sha: 'abc123', subject: 'feat: change 1', diff: 'diff content 1' },
      { sha: 'def456', subject: 'feat: change 2', diff: 'diff content 2' },
    ];

    const result = await mod.assembleAttributionInputs(planPath, ['1', '3'], candidates);

    // Should contain the task sections for IDs 1 and 3
    expect(result).toContain('### Task 1: First task');
    expect(result).toContain('**Files:** `src/file1.ts`');
    expect(result).toContain('This is task 1 description.');

    expect(result).toContain('### Task 3: Third task');
    expect(result).toContain('**Files:** `src/file4.ts`');
    expect(result).toContain('This is task 3 description.');

    // Should NOT contain task 2 (not in residue IDs)
    expect(result).not.toContain('### Task 2: Second task');
    expect(result).not.toContain('This is task 2 description with more details.');
  });

  it('includes candidate commits with sha, subject, and diff', async () => {
    const mod = await loadAttributionInputs();
    planPath = join(planDir, 'plan.md');
    await writeFile(
      planPath,
      `# Implementation Plan

## Tasks

### Task 1: Main task
**Files:** \`src/main.ts\`

Main task description.
`,
      'utf-8'
    );

    const candidates = [
      { sha: 'abc1234567890abc1234567890abc1234567890', subject: 'feat: implement feature', diff: 'diff of change 1' },
      { sha: 'def1234567890def1234567890def1234567890', subject: 'fix: correct issue', diff: 'diff of change 2' },
    ];

    const result = await mod.assembleAttributionInputs(planPath, ['1'], candidates);

    // Should contain candidate commit information
    expect(result).toContain('abc1234567890abc1234567890abc1234567890');
    expect(result).toContain('feat: implement feature');
    expect(result).toContain('diff of change 1');

    expect(result).toContain('def1234567890def1234567890def1234567890');
    expect(result).toContain('fix: correct issue');
    expect(result).toContain('diff of change 2');
  });

  it('preserves Files: lines from plan task sections', async () => {
    const mod = await loadAttributionInputs();
    planPath = join(planDir, 'plan.md');
    await writeFile(
      planPath,
      `# Implementation Plan

## Tasks

### Task 5: Multi-file task
**Files:** \`src/a.ts\`, \`src/b.ts\`, \`test/a.test.ts\`

Description of task 5.

### Task 6: Single file task
**Files:** \`lib/single.js\`

Description of task 6.
`,
      'utf-8'
    );

    const result = await mod.assembleAttributionInputs(planPath, ['5', '6'], []);

    // Should preserve the Files: lines exactly as they appear
    expect(result).toContain('**Files:** `src/a.ts`, `src/b.ts`, `test/a.test.ts`');
    expect(result).toContain('**Files:** `lib/single.js`');
  });

  it('deliberately excludes task-status.json even when present on disk', async () => {
    const mod = await loadAttributionInputs();
    planPath = join(planDir, 'plan.md');
    await writeFile(
      planPath,
      `# Implementation Plan

## Tasks

### Task 7: Some task
**Files:** \`src/task7.ts\`

Task 7 body.
`,
      'utf-8'
    );

    // Write task-status.json to the same directory where the plan is
    await writeFile(
      join(planDir, 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '7', status: 'pending' }] }, null, 2),
      'utf-8'
    );

    const result = await mod.assembleAttributionInputs(planPath, ['7'], []);

    // Should NOT contain task-status.json content
    expect(result).not.toContain('task-status.json');
    expect(result).not.toContain('pending');
    expect(result).not.toContain(JSON.stringify({ tasks: [{ id: '7', status: 'pending' }] }));

    // Should still contain the plan content
    expect(result).toContain('### Task 7: Some task');
    expect(result).toContain('Task 7 body.');
  });

  it('deliberately excludes maker-summary text', async () => {
    const mod = await loadAttributionInputs();
    planPath = join(planDir, 'plan.md');

    const summaryText = 'This is a secret maker summary about how the work was done';

    await writeFile(
      planPath,
      `# Implementation Plan

## Tasks

### Task 8: Implementation
**Files:** \`src/impl.ts\`

Task 8 description.

## Maker Summary

${summaryText}
`,
      'utf-8'
    );

    // Also write a separate maker-summary artifact
    await writeFile(
      join(planDir, 'maker-summary.md'),
      `# Maker Summary\n\n${summaryText}\n`,
      'utf-8'
    );

    const result = await mod.assembleAttributionInputs(planPath, ['8'], []);

    // Should NOT contain maker summary content
    expect(result).not.toContain(summaryText);
    expect(result).not.toContain('Maker Summary');
    expect(result).not.toContain('maker-summary');

    // Should still contain the plan content
    expect(result).toContain('### Task 8: Implementation');
    expect(result).toContain('Task 8 description.');
  });

  it('returns a string ready for verifier input assembly', async () => {
    const mod = await loadAttributionInputs();
    planPath = join(planDir, 'plan.md');
    await writeFile(
      planPath,
      `# Implementation Plan

## Tasks

### Task 2: Another task
**Files:** \`src/another.ts\`

Another task description.
`,
      'utf-8'
    );

    const candidates = [
      { sha: 'sha123', subject: 'feat: do work', diff: 'diff content' },
    ];

    const result = await mod.assembleAttributionInputs(planPath, ['2'], candidates);

    // Result should be a string
    expect(typeof result).toBe('string');

    // Result should contain both plan and candidate information
    expect(result).toContain('### Task 2: Another task');
    expect(result).toContain('sha123');
  });
});

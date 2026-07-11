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

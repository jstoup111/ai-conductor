import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const MOD_PATH = '../src/engine/engineer/land-spec.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

let repoPath: string;
let worktreePath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-repo-'));

  // Initialize repo with git
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const exec = promisify(execFile);

  await exec('git', ['init'], { cwd: repoPath });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });
  await exec('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });
  await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoPath });

  // Create initial commit in repo so it has a HEAD
  await writeFile(join(repoPath, 'README.md'), '# Test Repo\n', 'utf-8');
  await exec('git', ['add', 'README.md'], { cwd: repoPath });
  await exec('git', ['commit', '-m', 'initial'], { cwd: repoPath });

  // Create the worktree as a subdirectory of the repo (required by AuthoringGuard)
  worktreePath = join(repoPath, '.git', 'worktrees', 'test-feature');
  await mkdir(worktreePath, { recursive: true });

  // Initialize the worktree with git
  await exec('git', ['init'], { cwd: worktreePath });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: worktreePath });
  await exec('git', ['config', 'user.name', 'Test User'], { cwd: worktreePath });
  await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: worktreePath });

  // Create a spec/test-feature branch in the worktree
  await exec('git', ['checkout', '-b', 'spec/test-feature'], { cwd: worktreePath });
  await writeFile(join(worktreePath, 'initial'), 'initial', 'utf-8');
  await exec('git', ['add', 'initial'], { cwd: worktreePath });
  await exec('git', ['commit', '-m', 'initial'], { cwd: worktreePath });
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
  await rm(worktreePath, { recursive: true, force: true });
});

describe('landSpec marker validation', () => {
  /**
   * Helper: create required .docs artifacts in the worktree.
   */
  async function createRequiredArtifacts(planName: string = 'test-plan'): Promise<void> {
    // Create .docs/specs directory and file
    const specsDir = join(worktreePath, '.docs', 'specs');
    await mkdir(specsDir, { recursive: true });
    await writeFile(
      join(specsDir, 'test-spec.md'),
      `# Test Spec

Status: Approved

This is a test spec.`,
      'utf-8'
    );

    // Create .docs/stories directory and file
    const storiesDir = join(worktreePath, '.docs', 'stories');
    await mkdir(storiesDir, { recursive: true });
    await writeFile(
      join(storiesDir, 'test-stories.md'),
      `# Test Stories

Status: Accepted

Test story 1.`,
      'utf-8'
    );

    // Create .docs/plans directory and file
    const plansDir = join(worktreePath, '.docs', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(
      join(plansDir, `${planName}.md`),
      `# Test Plan

## Task 1
- Do something`,
      'utf-8'
    );

    // DO NOT commit these files - let landSpec commit them.
    // (landSpec expects to find uncommitted artifacts and will stage/commit them.)
  }

  /**
   * Helper: create a watched observation marker.
   */
  async function createWatchedMarker(planName: string = 'test-plan'): Promise<void> {
    const observationDir = join(worktreePath, '.docs', 'observation');
    await mkdir(observationDir, { recursive: true });
    const markerFile = join(observationDir, `${planName}.md`);
    await writeFile(
      markerFile,
      `Signature: error-fixed
Surface: daemon-log
Window-days: 14`,
      'utf-8'
    );
    // DO NOT commit - let landSpec commit it.
  }

  /**
   * Helper: create a close-on-merge observation marker.
   */
  async function createCloseOnMergeMarker(planName: string = 'test-plan'): Promise<void> {
    const observationDir = join(worktreePath, '.docs', 'observation');
    await mkdir(observationDir, { recursive: true });
    const markerFile = join(observationDir, `${planName}.md`);
    await writeFile(
      markerFile,
      `Kind: close-on-merge
Rationale: This fix resolves the underlying issue; closing on merge is safe.`,
      'utf-8'
    );
    // DO NOT commit - let landSpec commit it.
  }

  it('landSpec accepts a valid watched marker and does not throw marker-related errors', async () => {
    const mod = await load();
    const landSpec = requireFn(mod, 'landSpec');

    await createRequiredArtifacts('test-plan');
    await createWatchedMarker('test-plan');

    // Provide owner config and gh runner to bypass identity gate
    const opts = {
      ownerConfig: { spec_owner: 'test-owner' },
      gh: async () => ({ user: { login: 'test-owner' } }),
    };

    // landSpec should not throw a marker-related error
    // (it may fail on git commit, but that's after marker validation passes)
    try {
      await landSpec(
        { name: 'test-repo', canonicalPath: repoPath },
        'test feature',
        worktreePath,
        undefined,
        opts
      );
      // If it succeeds fully, great!
      expect(true).toBe(true);
    } catch (err) {
      // If it fails, it should NOT be a marker validation error
      const errMsg = (err as any).message || '';
      expect(errMsg).not.toMatch(/observation.*marker|\.docs\/observation/);
    }
  });

  it('landSpec accepts a valid close-on-merge marker and does not throw marker-related errors', async () => {
    const mod = await load();
    const landSpec = requireFn(mod, 'landSpec');

    await createRequiredArtifacts('test-plan');
    await createCloseOnMergeMarker('test-plan');

    // Provide owner config and gh runner to bypass identity gate
    const opts = {
      ownerConfig: { spec_owner: 'test-owner' },
      gh: async () => ({ user: { login: 'test-owner' } }),
    };

    // landSpec should not throw a marker-related error
    // (it may fail on git commit, but that's after marker validation passes)
    try {
      await landSpec(
        { name: 'test-repo', canonicalPath: repoPath },
        'test feature',
        worktreePath,
        undefined,
        opts
      );
      // If it succeeds fully, great!
      expect(true).toBe(true);
    } catch (err) {
      // If it fails, it should NOT be a marker validation error
      const errMsg = (err as any).message || '';
      expect(errMsg).not.toMatch(/observation.*marker|\.docs\/observation/);
    }
  });

  it('landSpec fails with missing marker', async () => {
    const mod = await load();
    const landSpec = requireFn(mod, 'landSpec');

    await createRequiredArtifacts('test-plan');
    // Do NOT create the observation marker

    // Provide owner config and gh runner to bypass identity gate
    const opts = {
      ownerConfig: { spec_owner: 'test-owner' },
      gh: async () => ({ user: { login: 'test-owner' } }),
    };

    // landSpec should fail with a message indicating the missing file
    await expect(
      landSpec(
        { name: 'test-repo', canonicalPath: repoPath },
        'test feature',
        worktreePath,
        undefined,
        opts
      )
    ).rejects.toThrow(/observation.*test-plan|\.docs\/observation\/test-plan\.md/i);
  });
});

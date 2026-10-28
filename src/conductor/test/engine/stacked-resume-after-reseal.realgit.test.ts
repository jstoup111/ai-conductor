// Covers: #3408
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProtectedArtifactSeal, resealProtectedArtifactSeal, type ProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { runStackPreflight } from '../../src/engine/restack/stack-preflight.js';
import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const planPath = '.docs/plans/demo.md';

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function plan(prose = ''): string {
  return [
    '# Implementation Plan: demo', '', '**Stories:** .docs/stories/demo.md', '', prose,
    '## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |',
    '| 1 | Closed | 1 |', '| 2 | Leaf | 2 |', '',
    '### Task 1: Closed', '**Story:** Story 1', '**Dependencies:** none', '',
    '### Task 2: Leaf', '**Story:** Story 2', '**Dependencies:** none', '',
  ].join('\n');
}

function doneState(): ConductState {
  const state: ConductState = { feature_desc: 'demo', complexity_tier: 'M' };
  for (const step of ALL_STEPS) state[step.name] = 'done';
  return state;
}

/** A stacked feature mid-BUILD on its leaf child whose DECIDE plan an operator amended and resealed. */
async function resealedFixture(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stacked-resume-after-reseal-'));
  repositories.push(repo);
  const git = async (...args: string[]) => (await execFile('git', args, { cwd: repo })).stdout.trim();
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'reseal@example.test');
  await git('config', 'user.name', 'Reseal');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n');
  await writeFile(join(repo, planPath), plan());
  await writeFile(join(repo, '.docs', 'stories', 'demo.md'), '## Story 1: Closed\n\n## Story 2: Leaf\n');
  await git('add', '.');
  await git('commit', '-qm', 'seed stacked topology');
  const base = await git('rev-parse', 'HEAD');
  await git('branch', 'feat/c1/demo', base);
  await git('update-ref', 'refs/conductor/demo/closed/c1', base);
  await git('checkout', '-qb', 'feat/daemon-demo');
  await writeFile(join(repo, 'positions.json'), '[1,2]');
  await git('update-ref', 'refs/conductor/demo/positions', await git('hash-object', '-w', 'positions.json'));
  await rm(join(repo, 'positions.json'));
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await writeState(join(repo, '.pipeline', 'conduct-state.json'), doneState());
  await writeState(join(repo, '.pipeline', 'children', '2', 'conduct-state.json'), { acceptance_specs: 'done', build: 'pending' });
  await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: await git('rev-parse', 'HEAD') });

  await writeFile(join(repo, planPath), plan('Operator clarified the leaf scope.'));
  await git('add', planPath);
  await git('commit', '-qm', 'operator amendment');
  const seal = JSON.parse(await readFile(join(repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8')) as ProtectedArtifactSeal;
  await resealProtectedArtifactSeal({
    projectRoot: repo, seal, toCommit: await git('rev-parse', 'HEAD'), trigger: 'operator-reseal',
    paths: [planPath], reason: 'Approve the amended plan.', featureDesc: 'demo', baseBranch: 'main',
  });
  return repo;
}

describe('stacked resume after a DECIDE reseal', () => {
  it('stack preflight is clear: the cursor re-derives from the resealed plan instead of reporting unavailable', async () => {
    const repo = await resealedFixture();

    await expect(runStackPreflight({ worktree: repo, slug: 'demo', git: makeGitRunner(repo) })).resolves.toEqual({ kind: 'clear' });
    await expect(access(join(repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rewind resolves the active child rather than refusing the cursor', async () => {
    const repo = await resealedFixture();
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => { errors.push(String(message)); });

    await dispatchRewindCommand({ kind: 'rewind', target: 'build' }, repo);

    expect(errors.join('\n')).not.toContain('active child resolution refused');
  });

  it('still fails closed with a HALT when the sealed plan is gone but durable child state remains', async () => {
    const repo = await resealedFixture();
    await rm(join(repo, planPath));

    await expect(runStackPreflight({ worktree: repo, slug: 'demo', git: makeGitRunner(repo) })).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('plan-missing'),
    });
    await expect(readFile(join(repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('plan-missing');
  });
});

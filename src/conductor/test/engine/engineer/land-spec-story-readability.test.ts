// Covers: task:4
// The land boundary must refuse Accepted stories that its downstream criterion
// consumers cannot read, before it writes an intake marker or commits.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);
const gh: GhRunner = async () => ({ stdout: 'operator\n' });

let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function seedSmallLandFixture(stories: string): Promise<string> {
  const idea = 'readable stories only';
  const worktreePath = (await createEngineerWorktree(repoPath, idea)).worktreePath;
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'track'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'readable-stories-only.md'), '# PRD\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'readable-stories-only.md'), stories);
  await writeFile(join(worktreePath, '.docs', 'plans', 'readable-stories-only.md'), [
    '# Implementation Plan',
    '',
    '**Stories:** .docs/stories/readable-stories-only.md',
    '',
    '### Task 1: Validate readable stories',
    '**Story:** Story 1',
    '',
    '**Done when:**',
    '- Given a valid story, when land runs, then it commits the artifacts.',
    '- Given an unreadable story, when land runs, then it refuses before committing.',
    '',
    '## Coverage Check',
    '',
    '| Criterion | Task ids | Quote | Disposition |',
    '| --- | --- | --- | --- |',
    '| Story 1 happy: Given a valid story, when land runs, then it commits the artifacts. | 1 | "Given a valid story, when land runs, then it commits the artifacts." | diff-local |',
    '',
  ].join('\n'));
  await writeFile(join(worktreePath, '.docs', 'track', 'readable-stories-only.md'), '# Track\n\nTrack: technical\n');
  await writeFile(join(worktreePath, '.docs', 'complexity', 'readable-stories-only.md'), '# Complexity\n\nTier: S\n');
  return worktreePath;
}

async function expectUnreadableStoriesRefusal(stories: string): Promise<void> {
  const worktreePath = await seedSmallLandFixture(stories);
  const before = await git(['rev-parse', 'HEAD'], worktreePath);

  await expect(landSpec(
    { name: 'fixture', canonicalPath: repoPath },
    'readable stories only',
    worktreePath,
    undefined,
    { ownerConfig: {}, gh },
  )).rejects.toMatchObject({ gate: 'stories-unreadable' });

  expect(await git(['rev-parse', 'HEAD'], worktreePath)).toBe(before);
  await expect(execFile('git', ['show', '--quiet', '--format=', 'HEAD'], { cwd: worktreePath })).resolves.toBeDefined();
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-story-readability-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test User']);
  await writeFile(join(repoPath, 'README.md'), '# fixture\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'initial']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('landSpec accepted-story readability gate', () => {
  it('refuses Story 3 whose bold clause-list cannot yield a criterion', async () => {
    await expectUnreadableStoriesRefusal([
      '# Stories: readable stories only',
      '',
      '**Status:** Accepted',
      '',
      '## Story 3: Clause-list formatting',
      '#### Happy Path',
      '- **Given:** a reviewer opens the story',
      '- **When:** land checks the artifact',
      '- **Then:** the artifact has a derived criterion',
      '',
      '#### Negative Paths',
      '- **Given:** the clauses are split across bullets',
      '- **Then:** land refuses the artifact',
      '',
    ].join('\n'));
  });

  it('refuses Small zero-criteria stories without requiring a coherence artifact or committing', async () => {
    await expectUnreadableStoriesRefusal([
      '# Stories: readable stories only',
      '',
      '**Status:** Accepted',
      '',
      '## Story 1: No criteria',
      '#### Happy Path',
      '- The operation is described but has no criterion clauses.',
      '',
      '#### Negative Paths',
      '- The failure is described but has no criterion clauses.',
      '',
    ].join('\n'));
  });

  it('refuses Story 2 whose Given-only rows omit Then clauses', async () => {
    await expectUnreadableStoriesRefusal([
      '# Stories: readable stories only',
      '',
      '**Status:** Accepted',
      '',
      '## Story 2: Incomplete clauses',
      '#### Happy Path',
      '- Given an operator starts land, when validation begins.',
      '',
      '#### Negative Paths',
      '- Given validation finds an incomplete criterion, when it evaluates the story.',
      '',
    ].join('\n'));
  });
});

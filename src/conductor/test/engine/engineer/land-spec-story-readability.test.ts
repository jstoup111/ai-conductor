// Covers: task:4, task:5
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

async function seedSmallLandFixture(
  stories: string,
  idea = 'readable stories only',
  plan = defaultPlan('readable-stories-only'),
): Promise<string> {
  const stem = idea.replaceAll(' ', '-');
  const worktreePath = (await createEngineerWorktree(repoPath, idea)).worktreePath;
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'track'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', `${stem}.md`), '# PRD\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', `${stem}.md`), stories);
  await writeFile(join(worktreePath, '.docs', 'plans', `${stem}.md`), plan);
  await writeFile(join(worktreePath, '.docs', 'track', `${stem}.md`), '# Track\n\nTrack: technical\n');
  await writeFile(join(worktreePath, '.docs', 'complexity', `${stem}.md`), '# Complexity\n\nTier: S\n');
  return worktreePath;
}

function defaultPlan(stem: string): string {
  return [
    '# Implementation Plan',
    '',
    `**Stories:** .docs/stories/${stem}.md`,
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
  ].join('\n');
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

function readableStories(storyCount = 1): string {
  return [
    '# Stories: readable stories only',
    '',
    '**Status:** Accepted',
    '',
    Array.from({ length: storyCount }, (_, index) => [
      `## Story ${index + 1}: Readable story ${index + 1}`,
      '### Acceptance Criteria',
      '#### Happy Path',
      `- Given an operator reads Story ${index + 1}, when land validates it, then the criterion is readable.`,
      '',
      '#### Negative Paths',
      `- Given Story ${index + 1} has invalid input, when land validates it, then the criterion remains readable.`,
      '',
    ].join('\n')).join('\n'),
  ].join('\n');
}

function readablePlan(stem: string, storyCount: number): string {
  const criteria = Array.from({ length: storyCount }, (_, index) => [
    `Given an operator reads Story ${index + 1}, when land validates it, then the criterion is readable.`,
    `Given Story ${index + 1} has invalid input, when land validates it, then the criterion remains readable.`,
  ]).flat();
  return [
    '# Implementation Plan',
    '',
    `**Stories:** .docs/stories/${stem}.md`,
    '',
    '### Task 1: Validate readable stories',
    '**Story:** Story 1',
    '',
    '**Done when:**',
    ...criteria.map((criterion) => `- ${criterion}`),
    '',
    '## Coverage Check',
    '',
    '| Criterion | Task ids | Quote | Disposition |',
    '| --- | --- | --- | --- |',
    ...criteria.map((criterion, index) =>
      `| Story ${Math.floor(index / 2) + 1} ${index % 2 === 0 ? 'happy' : 'negative'}: ${criterion} | 1 | "${criterion}" | diff-local |`),
    '',
  ].join('\n');
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
  it('states the required single-line Given/When/Then shape in its refusal', async () => {
    const worktreePath = await seedSmallLandFixture([
      '# Stories: readable stories only',
      '',
      '**Status:** Accepted',
      '',
      '## Story 1: Missing criterion',
      '#### Happy Path',
      '- A statement without criterion clauses.',
      '',
      '#### Negative Paths',
      '- Another statement without criterion clauses.',
      '',
    ].join('\n'));

    await expect(landSpec(
      { name: 'fixture', canonicalPath: repoPath },
      'readable stories only',
      worktreePath,
      undefined,
      { ownerConfig: {}, gh },
    )).rejects.toThrow(
      'Each criterion must be one single-line Given/When/Then bullet under a headed Happy Path or Negative Paths section.',
    );
  });

  it('commits a fully readable worktree without a readability refusal', async () => {
    const stories = readableStories();
    const worktreePath = await seedSmallLandFixture(stories, 'readable stories only', readablePlan('readable-stories-only', 1));
    const before = await git(['rev-parse', 'HEAD'], worktreePath);

    await expect(landSpec(
      { name: 'fixture', canonicalPath: repoPath },
      'readable stories only',
      worktreePath,
      undefined,
      { ownerConfig: {}, gh },
    )).resolves.toMatchObject({ repoPath: worktreePath });

    expect(await git(['rev-parse', 'HEAD'], worktreePath)).not.toBe(before);
  });

  it('keeps approval and plan-reference refusals ahead of readability for five readable stories', async () => {
    const approvalWorktree = await seedSmallLandFixture(readableStories(5).replace('**Status:** Accepted', '**Status:** Proposed'));
    const referenceIdea = 'readable stories reference';
    const referenceWorktree = await seedSmallLandFixture(readableStories(5), referenceIdea);
    await writeFile(join(referenceWorktree, '.docs', 'plans', 'readable-stories-reference.md'), [
      '# Implementation Plan',
      '',
      '**Stories:** .docs/stories/not-the-selected-artifact.md',
    ].join('\n'));

    await expect(landSpec(
      { name: 'fixture', canonicalPath: repoPath },
      'readable stories only',
      approvalWorktree,
      undefined,
      { ownerConfig: {}, gh },
    )).rejects.toMatchObject({ gate: 'stories-not-approved' });
    await expect(landSpec(
      { name: 'fixture', canonicalPath: repoPath },
      'readable stories only',
      referenceWorktree,
      undefined,
      { ownerConfig: {}, gh },
    )).rejects.toMatchObject({ gate: 'plan-stories-reference' });
  });

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

  it('refuses Story 2 when one Given-only bullet accompanies four readable criteria', async () => {
    await expectUnreadableStoriesRefusal([
      '# Stories: readable stories only',
      '',
      '**Status:** Accepted',
      '',
      '## Story 2: One incomplete criterion',
      '#### Happy Path',
      '- Given an operator starts land, when validation begins, then the artifact is checked.',
      '- Given the artifact is accepted, when land reads it, then the first criterion is derived.',
      '- Given a story is complete, when land validates it, then the second criterion is derived.',
      '- Given an incomplete artifact.',
      '',
      '#### Negative Paths',
      '- Given validation finds invalid input, when it evaluates the story, then land refuses it.',
      '',
    ].join('\n'));
  });
});

/**
 * RED acceptance coverage for the land-time Done when: gate.
 *
 * Story 1 owns the externally observable flow covered here: an operator lands
 * an accepted technical spec through the real landSpec entry point, and the
 * gate either commits a criteria-bearing plan or refuses a malformed plan
 * without deleting its worktree. Parser permutations and every build_review,
 * store, rendering, and daemon-filing contract remain at the narrower tests
 * assigned by plan Tasks 2-19.
 *
 * Verify-claims: the accepted story and plan pin every assertion below. No
 * unconfirmed load-bearing assumption is encoded in this spec.
 */

import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const gh: GhRunner = async () => ({ stdout: 'acceptance-operator\n' });

const ACCEPTED_STORIES = [
  '# Stories: done-when gate',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: land a bounded plan',
  '### Acceptance Criteria',
  '- Given a bounded plan, when it lands, then it succeeds.',
  '',
].join('\n');

function plan(taskThreeBlock: readonly string[], fencedExample = false): string {
  return [
    '# Implementation Plan: done-when gate',
    '',
    '**Stories:** .docs/stories/done-when-gate.md',
    '',
    '### Task 1: first task',
    '**Done when:**',
    '- first result is observable',
    '- first failure is observable',
    '',
    ...(fencedExample ? [
      '```markdown',
      '**Done when:**',
      '- fenced examples do not count',
      '- fenced examples remain inert',
      '```',
      '',
    ] : []),
    '### Task 3: guarded task',
    ...(taskThreeBlock.length > 0 ? ['**Done when:**', ...taskThreeBlock] : []),
    '',
    '## Task Dependency Graph',
    '```',
    '1 → 3',
    '```',
    '',
  ].join('\n');
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: root });
  return stdout.trim();
}

async function seed(planBody: string, tier: 'S' | 'M' = 'M'): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'done-when-land-acceptance-'));
  roots.push(root);
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'acceptance@example.test');
  await git(root, 'config', 'user.name', 'Acceptance Test');
  await writeFile(join(root, 'README.md'), '# fixture\n');
  await git(root, 'add', 'README.md');
  await git(root, 'commit', '-qm', 'fixture root');

  const { worktreePath } = await createEngineerWorktree(root, 'done when gate');
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'track'), { recursive: true }),
    ...(tier === 'M' ? [
      mkdir(join(worktreePath, '.docs', 'conflicts'), { recursive: true }),
      mkdir(join(worktreePath, '.docs', 'architecture'), { recursive: true }),
      mkdir(join(worktreePath, '.docs', 'decisions'), { recursive: true }),
    ] : []),
  ]);
  await Promise.all([
    writeFile(join(worktreePath, '.docs', 'stories', 'done-when-gate.md'), ACCEPTED_STORIES),
    writeFile(join(worktreePath, '.docs', 'plans', 'done-when-gate.md'), planBody),
    writeFile(join(worktreePath, '.docs', 'complexity', 'done-when-gate.md'), `Tier: ${tier}\n`),
    writeFile(
      join(worktreePath, '.docs', 'track', 'done-when-gate.md'),
      '# Track: done-when gate\n\nTrack: technical\n\n**Status:** Accepted\n',
    ),
    ...(tier === 'M' ? [
      writeFile(join(worktreePath, '.docs', 'conflicts', 'done-when-gate.md'), '# Conflicts\n\nNone.\n'),
      writeFile(join(worktreePath, '.docs', 'architecture', 'done-when-gate.md'), '# Architecture\n\nApproved.\n'),
      writeFile(join(worktreePath, '.docs', 'decisions', 'done-when-gate.md'), '# Review\n\nApproved.\n'),
    ] : []),
  ]);
  return { root, worktree: worktreePath };
}

beforeEach(() => {
  roots.length = 0;
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('acceptance: plan tasks require falsifiable Done when criteria at land', () => {
  it('lands when every real task has two to five non-empty criteria', async () => {
    const fixture = await seed(plan([
      '- the guarded result is observable',
      '- the guarded failure is observable',
    ]));

    await expect(landSpec(
      { name: 'fixture', canonicalPath: fixture.root },
      'done when gate',
      fixture.worktree,
      undefined,
      { ownerConfig: {}, gh },
    )).resolves.toMatchObject({ slug: 'done-when-gate' });
  });

  it('rejects a missing real block, ignores a fenced example, and retains the worktree', async () => {
    const fixture = await seed(plan([], true));

    await expect(landSpec(
      { name: 'fixture', canonicalPath: fixture.root },
      'done when gate',
      fixture.worktree,
      undefined,
      { ownerConfig: {}, gh },
    )).rejects.toThrow(/landSpec:.*task 3.*Done when.*missing|landSpec:.*task 3.*no Done when/i);
    await expect(access(fixture.worktree)).resolves.toBeUndefined();
  });

  it('applies the same missing-block refusal to a Small-tier spec', async () => {
    const fixture = await seed(plan([]), 'S');

    await expect(landSpec(
      { name: 'fixture', canonicalPath: fixture.root },
      'done when gate',
      fixture.worktree,
      undefined,
      { ownerConfig: {}, gh },
    )).rejects.toThrow(/landSpec:.*task 3.*Done when.*missing|landSpec:.*task 3.*no Done when/i);
  });
});

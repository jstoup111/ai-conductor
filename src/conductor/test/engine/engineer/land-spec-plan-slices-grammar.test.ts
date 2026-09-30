// Covers: task:5
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { validatePlanSlices } from '../../../src/engine/plan-slices.js';
import type { OwnerConfig } from '../../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);
const IDEA = 'plan slices grammar';
let repoPath: string;

const STORIES = [
  '# Stories: plan slices grammar', '', '**Status:** Accepted', '', '## Story 1: grammar',
  '### Acceptance Criteria', '#### Happy Path', '- Given a plan, when land runs, then it commits.',
  '#### Negative Paths', '- Given an invalid plan, when land runs, then it refuses.', '',
].join('\n');

function task(id: number): string {
  return [
    `### Task ${id}: Task ${id}`,
    '**Story:** Story 1',
    '**Dependencies:** none',
    '**Done when:**',
    '- Given a plan, when land runs, then it commits.',
    '- Given an invalid plan, when land runs, then it refuses.',
  ].join('\n');
}

function plan(prefix: string, tasks = [task(1)]): string {
  return ['# Implementation Plan: plan slices grammar', '', '**Stories:** .docs/stories/plan-slices-grammar.md', '', prefix, '', ...tasks].join('\n');
}

const TABLE = [
  '## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |', '| 1 | First | 1 |',
].join('\n');

const FIXTURES = [
  { name: 'placement', plan: () => plan([task(1), TABLE].join('\n\n')), message: /Slices section.*before.*first task/i },
  { name: 'trailing table-less placement', plan: () => plan('', [task(1), '## Slices']), message: /Slices section.*before.*first task/i },
  { name: 'content-free section', plan: () => plan('## Slices', []), message: /must contain a pipe table/ },
  { name: 'final header without delimiter', plan: () => plan(['## Slices', '', '| Slice | Title | Tasks |'].join('\n'), []), message: /must contain a pipe table/ },
  { name: 'header', plan: () => plan(TABLE.replace('| Slice | Title | Tasks |', '| Slice | Name | Tasks |')), message: /Slice, Title, Tasks/ },
  { name: 'delimiter', plan: () => plan(TABLE.replace('| --- | --- | --- |', '| a | b | c |')), message: /\| a \| b \| c \|/ },
  { name: 'wide row', plan: () => plan(`${TABLE}\n| 3 | Extra | 4 | x |`), message: /\| 3 \| Extra \| 4 \| x \|/ },
  { name: 'empty title', plan: () => plan(TABLE.replace('| 1 | First | 1 |', '| 1 |  | 1 |')), message: /slice 1.*empty.*Title/i },
  { name: 'position', plan: () => plan(TABLE.replace('| 1 | First | 1 |', '| two | First | 1 |')), message: /positive integer/i },
  { name: 'second section', plan: () => plan(`${TABLE}\n\n${TABLE.replace('| 1 | First | 1 |', '| 2 | Second | 1 |')}`), message: /at most one Slices section/i },
  { name: 'Tasks cell', plan: () => plan(TABLE.replace('| 1 | First | 1 |', '| 1 | First | 1,,2 |'), [task(1), task(2)]), message: /slice 1.*malformed Tasks cell/i },
];

async function git(args: string[], cwd = repoPath): Promise<string> {
  const result = await execFile('git', args, { cwd });
  return result.stdout;
}

async function seed(planContent: string): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'plan-slices-grammar.md'), '# PRD: grammar\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'plan-slices-grammar.md'), STORIES);
  await writeFile(join(worktreePath, '.docs', 'plans', 'plan-slices-grammar.md'), planContent);
  return worktreePath;
}

function options(enabled: boolean): { ownerConfig: OwnerConfig } {
  return { ownerConfig: { spec_owner: 'test-owner', stacked_prs: { enabled } } as OwnerConfig };
}

async function refusal(planContent: string, enabled = false): Promise<Error> {
  const worktreePath = await seed(planContent);
  const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options(enabled))
    .catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(LandGateError);
  expect(error).toMatchObject({ gate: 'plan-slices' });
  expect(await git(['log', '--format=%s'])).toBe('init\n');
  await git(['worktree', 'remove', '--force', worktreePath]);
  return error as Error;
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-plan-slices-grammar-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('plan-slices grammar land rung', () => {
  it.each(FIXTURES)('refuses malformed $name manifests without a spec commit', async ({ plan: fixture, message }) => {
    const planContent = fixture();
    const validation = validatePlanSlices(planContent);
    if (validation.kind !== 'invalid') throw new Error('fixture must be invalid');

    const error = await refusal(planContent);
    expect(error.message).toMatch(message);
    expect(error.message).toContain(validation.violations[0].message);
  });

  it('refuses placement identically with stacked_prs disabled and enabled', async () => {
    const fixture = FIXTURES[0];
    const disabled = await refusal(fixture.plan(), false);
    const enabled = await refusal(fixture.plan(), true);

    expect(disabled.message).toBe(enabled.message);
  });

  it('uses the validator message in the land refusal', async () => {
    const fixture = FIXTURES[5];
    const validation = validatePlanSlices(fixture.plan());
    if (validation.kind !== 'invalid') throw new Error('fixture must be invalid');

    const error = await refusal(fixture.plan());
    expect(error.message).toContain(validation.violations[0].message);
  });
});

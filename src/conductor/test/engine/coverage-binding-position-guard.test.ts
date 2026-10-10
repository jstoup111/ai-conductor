// Covers: task:36
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const directories: string[] = [];

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

function plan(positions: readonly number[], reownStoryTwo = false): string {
  const rows = positions.map((position) => {
    if (position === 1) return positions.includes(2) ? '| 1 | First | 1, 3 |' : '| 1 | First | 1, 2, 3, 4 |';
    if (position === 2) return '| 2 | Second | 2, 4 |';
    return `| ${position} | Child ${position} | ${position + 2} |`;
  });
  const tasks = [
    '### Task 1: First story', '**Story:** 1', '**Dependencies:** none', '',
    '### Task 2: Second story', ...(reownStoryTwo ? [] : ['**Story:** 2']), '**Dependencies:** none', '',
    '### Task 3: Re-ownable work', ...(reownStoryTwo ? ['**Story:** 2'] : []), '**Dependencies:** none', '',
    '### Task 4: Supporting work', '**Dependencies:** none', '',
    ...positions.filter((position) => position > 2).flatMap((position) => [
      `### Task ${position + 2}: Child ${position} work`, '**Dependencies:** none', '',
    ]),
  ];
  return [
    '# Implementation Plan: demo', '', '**Stories:** .docs/stories/demo.md', '',
    '## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |', ...rows, '', ...tasks,
  ].join('\n');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'coverage-binding-position-guard-'));
  directories.push(root);
  const planPath = join(root, '.docs', 'plans', 'demo.md');
  await git(root, ['init', '-q', '-b', 'feat/daemon-demo']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test User']);
  await Promise.all([
    mkdir(join(root, '.ai-conductor'), { recursive: true }),
    mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    mkdir(join(root, '.docs', 'stories'), { recursive: true }),
    mkdir(join(root, '.docs', 'complexity'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n'),
    writeFile(join(root, '.docs', 'stories', 'demo.md'), [
      '# Stories: demo', '', '## Story 1: One', '', '## Story 2: Two', '',
    ].join('\n')),
    writeFile(join(root, '.docs', 'complexity', 'demo.md'), 'Tier: M\nStacked-Delivery: approved\n'),
    writeFile(planPath, plan([1, 2])),
    writeFile(join(root, 'tracked.txt'), 'base\n'),
  ]);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'base']);

  const provider: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: vi.fn() };
  const makeRunner = (events?: ConductorEventEmitter) => new DefaultStepRunner(provider, 'position-guard', root, {
    featureDesc: 'demo', planPath, projectRoot: root,
    config: { coverage_binding: { judge: { enabled: false } }, stacked_prs: { enabled: false } },
    events,
  });
  await expect(makeRunner().run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
  return { root, planPath, makeRunner };
}

async function recordPositions(root: string, positions: readonly number[]): Promise<void> {
  const file = join(root, 'positions.json');
  await writeFile(file, JSON.stringify(positions));
  const blob = (await git(root, ['hash-object', '-w', file])).trim();
  await git(root, ['update-ref', 'refs/conductor/demo/positions', blob]);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('coverage_binding stacked position immutability', () => {
  it('refuses added or removed positions after child state exists without changing the envelope', async () => {
    const added = await fixture();
    await recordPositions(added.root, [1, 2]);
    await git(added.root, ['branch', 'feat/c1/demo']);
    const envelopePath = join(added.root, '.pipeline', 'coverage-binding.json');
    const beforeAddition = await readFile(envelopePath, 'utf8');
    await writeFile(added.planPath, plan([1, 2, 3]));

    const addition = await added.makeRunner().run('coverage_binding', { complexity_tier: 'M' });
    expect(addition).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    expect(addition.refusal?.reason).toContain('position 3');
    await expect(readFile(envelopePath, 'utf8')).resolves.toBe(beforeAddition);

    const removed = await fixture();
    await recordPositions(removed.root, [1, 2]);
    await mkdir(join(removed.root, '.pipeline', 'children', '2'), { recursive: true });
    const beforeRemoval = await readFile(join(removed.root, '.pipeline', 'coverage-binding.json'), 'utf8');
    await writeFile(removed.planPath, plan([1]));

    const removal = await removed.makeRunner().run('coverage_binding', { complexity_tier: 'M' });
    expect(removal).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
    expect(removal.refusal?.reason).toContain('position 2');
    await expect(readFile(join(removed.root, '.pipeline', 'coverage-binding.json'), 'utf8')).resolves.toBe(beforeRemoval);
  });

  it('allows unchanged positions and emits story_reowned when ownership changes without a task move', async () => {
    const subject = await fixture();
    await recordPositions(subject.root, [1, 2]);
    const head = (await git(subject.root, ['rev-parse', 'HEAD'])).trim();
    await git(subject.root, ['update-ref', 'refs/conductor/demo/closed/c1', head]);
    await writeFile(subject.planPath, plan([1, 2], true));
    const emitter = new ConductorEventEmitter();
    const events: unknown[] = [];
    emitter.on('story_reowned', (event) => { events.push(event); });

    await expect(subject.makeRunner(emitter).run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
    expect(events).toContainEqual({ type: 'story_reowned', story: '2', from: 2, to: 1 });
  });
});

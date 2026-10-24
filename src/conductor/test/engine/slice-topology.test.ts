// Covers: task:1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSliceTopology } from '../../src/engine/slice-topology.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);
const directories: string[] = [];

const STORIES = [
  '# Stories: demo',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: Foundation',
  '',
  '## Story 2: Delivery',
  '',
].join('\n');

function slicedPlan(positions: readonly number[] = [1, 2]): string {
  const rows = positions.map((position) => {
    if (position === 1) return '| 1 | Foundation | 1, rem-1 |';
    if (position === 2) return '| 2 | Delivery | 2 |';
    return `| ${position} | Slice ${position} | ${position} |`;
  });
  const taskBlocks = positions.flatMap((position) => {
    if (position === 1) return [
      '### Task 1: Foundation', '**Story:** Story 1', '**Dependencies:** none', '',
      '### Task rem-1: Remediation', '**Dependencies:** 1', '',
    ];
    if (position === 2) return [
      '### Task 2: Delivery', '**Story:** Story 2', '**Dependencies:** 1', '',
    ];
    return [`### Task ${position}: Slice ${position}`, '**Story:** Story 2', '**Dependencies:** none', ''];
  });
  return [
    '# Implementation Plan: demo',
    '',
    '**Stories:** .docs/stories/demo.md',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...taskBlocks,
  ].join('\n');
}

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

async function fixture(options: { plan?: string; stories?: string; git?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'slice-topology-'));
  directories.push(root);
  await Promise.all([
    mkdir(join(root, '.ai-conductor'), { recursive: true }),
    mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    mkdir(join(root, '.docs', 'stories'), { recursive: true }),
    mkdir(join(root, '.docs', 'complexity'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n'),
    writeFile(join(root, '.docs', 'complexity', 'demo.md'), 'Tier: M\nStacked-Delivery: approved\n'),
    ...(options.plan === undefined ? [writeFile(join(root, '.docs', 'plans', 'demo.md'), slicedPlan())] : options.plan === '' ? [] : [writeFile(join(root, '.docs', 'plans', 'demo.md'), options.plan)]),
    ...(options.stories === undefined ? [writeFile(join(root, '.docs', 'stories', 'demo.md'), STORIES)] : options.stories === '' ? [] : [writeFile(join(root, '.docs', 'stories', 'demo.md'), options.stories)]),
  ]);
  if (options.git) {
    await git(root, ['init', '-q', '-b', 'feat/daemon-demo']);
    await git(root, ['config', 'user.email', 'topology@example.test']);
    await git(root, ['config', 'user.name', 'Topology test']);
    await git(root, ['add', '.']);
    await git(root, ['commit', '-qm', 'fixture']);
  }
  return root;
}

async function recordPositions(root: string, positions: readonly number[]): Promise<void> {
  const path = join(root, 'positions.json');
  await writeFile(path, JSON.stringify(positions));
  const blob = (await git(root, ['hash-object', '-w', path])).trim();
  await git(root, ['update-ref', 'refs/conductor/demo/positions', blob]);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('loadSliceTopology', () => {
  it('returns unsliced when the plan has no Slices section', async () => {
    const root = await fixture({ plan: '# Implementation Plan: demo\n\n### Task 1: Flat\n**Dependencies:** none\n' });

    await expect(loadSliceTopology(root, 'demo')).resolves.toEqual({ kind: 'unsliced' });
  });

  it('derives ordered positions, membership, titles, and story ownership from the sealed artifacts', async () => {
    const root = await fixture();

    await expect(loadSliceTopology(root, 'demo')).resolves.toMatchObject({
      kind: 'sliced',
      positions: [1, 2],
      sliceMembership: {
        taskSlices: { '1': 1, '2': 2 },
        titles: ['Foundation', 'Delivery'],
      },
      storyOwnership: { '1': 1, '2': 2 },
      stackEligibility: { kind: 'eligible' },
    });
  });

  it('excludes engine-appended remediation tasks from slice membership', async () => {
    const root = await fixture();

    const result = await loadSliceTopology(root, 'demo');
    expect(result).toMatchObject({ kind: 'sliced', sliceMembership: { taskSlices: { '1': 1, '2': 2 } } });
    expect(result.kind === 'sliced' && result.sliceMembership.taskSlices).not.toHaveProperty('rem-1');
  });

  it('refuses malformed slices and missing stories as plan-invalid with their diagnostics', async () => {
    const malformed = await fixture({ plan: slicedPlan().replace('| 2 | Delivery | 2 |', '| 2 | Delivery |') });
    await expect(loadSliceTopology(malformed, 'demo')).resolves.toMatchObject({
      kind: 'unavailable', cause: 'plan-invalid', violations: expect.arrayContaining([
        expect.objectContaining({ code: 'malformed-row' }),
      ]),
    });

    const missingStories = await fixture({ stories: '' });
    await expect(loadSliceTopology(missingStories, 'demo')).resolves.toMatchObject({
      kind: 'unavailable', cause: 'plan-invalid', storiesPath: '.docs/stories/demo.md',
    });
  });

  it('reports a missing plan with its conventional feature path', async () => {
    const root = await fixture({ plan: '' });

    await expect(loadSliceTopology(root, 'demo')).resolves.toMatchObject({
      kind: 'unavailable', cause: 'plan-missing', planPath: '.docs/plans/demo.md',
    });
  });

  it('refuses position changes and unreadable position refs after child state exists', async () => {
    const changed = await fixture({ plan: slicedPlan([1, 3]), git: true });
    await mkdir(join(changed, '.pipeline', 'children', '1'), { recursive: true });
    await recordPositions(changed, [1, 2]);
    await expect(loadSliceTopology(changed, 'demo')).resolves.toMatchObject({
      kind: 'unavailable', cause: 'positions-changed', recordedPositions: [1, 2], planPositions: [1, 3],
    });

    const unreadable = await fixture({ git: true });
    await mkdir(join(unreadable, '.pipeline', 'children', '1'), { recursive: true });
    await expect(loadSliceTopology(unreadable, 'demo')).resolves.toMatchObject({
      kind: 'unavailable', cause: 'positions-ref-unreadable', positionsRef: 'refs/conductor/demo/positions',
    });
  });

  it('reports git-error when the durable-state or positions-ref probe fails', async () => {
    const durableProbe = await fixture({ git: true });
    const unavailableGit: GitRunner = async () => ({ exitCode: 2, stdout: '', stderr: 'git unavailable' });
    await expect(loadSliceTopology(durableProbe, 'demo', { git: unavailableGit })).resolves.toEqual({
      kind: 'unavailable', cause: 'git-error',
    });

    const positionRead = await fixture({ git: true });
    await mkdir(join(positionRead, '.pipeline', 'children', '1'), { recursive: true });
    const realGit = makeGitRunner(positionRead);
    const failingPositionRead: GitRunner = async (args, options) => {
      if (args[0] === 'cat-file') throw new Error('read failed');
      return realGit(args, options);
    };
    await expect(loadSliceTopology(positionRead, 'demo', { git: failingPositionRead })).resolves.toEqual({
      kind: 'unavailable', cause: 'git-error',
    });
  });
});

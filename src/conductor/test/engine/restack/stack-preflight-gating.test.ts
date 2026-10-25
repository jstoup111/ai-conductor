// Covers: task:9, task:31.1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-gating-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'preflight@example.test']);
  await git(['config', 'user.name', 'Stack preflight']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
  await writeFile(join(repo, '.docs', 'stories', 'demo.md'), '# Stories: demo\n\n## Story 1: One\n\n## Story 2: Two\n');
  await writeFile(join(repo, '.docs', 'plans', 'demo.md'), [
    '# Implementation Plan: demo', '', '**Stories:** .docs/stories/demo.md', '', '## Slices', '',
    '| Slice | Title | Tasks |', '| --- | --- | --- |', '| 1 | One | 1 |', '| 2 | Leaf | 2 |', '',
    '### Task 1: One', '**Story:** Story 1', '**Dependencies:** none', '',
    '### Task 2: Two', '**Story:** Story 2', '**Dependencies:** none', '',
  ].join('\n'));
  await writeFile(join(repo, 'positions.json'), '[1,2]');
  const positionsBlob = (await git(['hash-object', '-w', 'positions.json'])).stdout.trim();
  await git(['update-ref', 'refs/conductor/demo/positions', positionsBlob]);
  return { repo, git, commit, closed };
}

async function appendRepair(subject: Awaited<ReturnType<typeof fixture>>) {
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  await subject.commit('operator change', 'operator.txt', 'X\n');
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
}

describe('stack preflight live-HALT gate', () => {
  it('keeps a non-Git N=1 fixture on the flat path without probing journal refs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-preflight-non-git-'));
    repositories.push(root);
    const git = async () => { throw new Error('journal probe must not run'); };

    await expect(runStackPreflight({ worktree: root, slug: 'demo', git })).resolves.toEqual({ kind: 'no-stack' });
  });

  it('recovers only and leaves an appended child unreplayed while HALT is live', async () => {
    const subject = await fixture();
    await appendRepair(subject);
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'operator action required\n');

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(subject.closed);
    await expect(subject.git(['show', 'feat/daemon-demo:operator.txt'])).rejects.toThrow();
  });

  it('halts a stack whose sealed topology cannot be resolved after authorization', async () => {
    const subject = await fixture();
    await appendRepair(subject);
    let liveHalt = true;
    let prepared = false;

    await expect(runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      git: makeGitRunner(subject.repo),
      hasLiveHalt: async () => liveHalt,
      hasMatchingResumeAuthorization: async () => true,
      prepareResume: async () => { prepared = true; liveHalt = false; },
    })).resolves.toMatchObject({ kind: 'halted' });
    expect(prepared).toBe(true);
  });

  it('writes actionable topology details for changed and unreadable sealed positions', async () => {
    const changed = await fixture();
    const planPath = join(changed.repo, '.docs', 'plans', 'demo.md');
    const plan = await readFile(planPath, 'utf8');
    await writeFile(planPath, plan.replace('| 2 | Leaf | 2 |', '| 3 | Leaf | 2 |'));

    await expect(runStackPreflight({ worktree: changed.repo, slug: 'demo', git: makeGitRunner(changed.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    await expect(readFile(join(changed.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('recorded positions [1,2]; plan positions [1,3]');
    await expect(readFile(join(changed.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'ai-conductor reseal --slug demo --path .docs/plans/demo.md --reason',
    );

    const unreadable = await fixture();
    await unreadable.git(['update-ref', '-d', 'refs/conductor/demo/positions']);
    await expect(runStackPreflight({ worktree: unreadable.repo, slug: 'demo', git: makeGitRunner(unreadable.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    await expect(readFile(join(unreadable.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      `git update-ref refs/conductor/demo/positions "$(printf '%s' '[1,2]' | git hash-object -w --stdin)"`,
    );
  });

  it.each([
    ['plan-missing', async (subject: Awaited<ReturnType<typeof fixture>>) => unlink(join(subject.repo, '.docs', 'plans', 'demo.md')), '.docs/plans/demo.md'],
    ['plan-invalid', async (subject: Awaited<ReturnType<typeof fixture>>) => writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), '# broken\n\n## Slices\n\nnot a table\n'), 'plan-invalid'],
  ] as const)('halts and emits loop_halt for %s instead of returning unavailable', async (_cause, arrange, expectedText) => {
    const subject = await fixture();
    await arrange(subject);
    const events: string[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('loop_halt', () => events.push('loop_halt'));

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo), events: emitter }))
      .resolves.toEqual({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toContain('needs-human');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(expectedText);
    expect(events).toContain('loop_halt');
  });

  it('runs the printed positions-ref recovery and clears preflight to child 2', async () => {
    const subject = await fixture();
    await subject.git(['update-ref', '-d', 'refs/conductor/demo/positions']);
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    // Hash the exact durable positions that the recovery command renders.
    await writeFile(join(subject.repo, 'positions-recovered.json'), '[1,2]');
    const recoveredBlob = (await subject.git(['hash-object', '-w', 'positions-recovered.json'])).stdout.trim();
    await subject.git(['update-ref', 'refs/conductor/demo/positions', recoveredBlob]);
    await unlink(join(subject.repo, '.pipeline', 'HALT'));
    await unlink(join(subject.repo, '.pipeline', 'HALT.class'));

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'clear' });
  });

  it('prioritizes detached-head recovery over reseal discovery', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', '--detach']);
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('git switch feat/daemon-demo');
  });
});

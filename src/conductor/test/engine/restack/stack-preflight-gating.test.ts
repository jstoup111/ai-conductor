// Covers: task:2, task:9, task:31.1, task:rem-as-built-1-r2
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { resolveActiveChild } from '../../../src/engine/child-cursor.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { runDaemonRekickStackPreflight } from '../../../src/daemon-cli.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
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

async function expectCursorRefusal(
  subject: Awaited<ReturnType<typeof fixture>>,
  cause: string,
  expectedRecovery: string,
  git: GitRunner = makeGitRunner(subject.repo),
): Promise<void> {
  const events = new ConductorEventEmitter();
  const loopHalts: string[] = [];
  events.on('loop_halt', (event) => { if (event.type === 'loop_halt') loopHalts.push(event.reason); });

  // A caller can enter a child BUILD region only after a clear preflight.
  // Keeping this assertion at the preflight boundary proves the refusal is
  // terminal rather than an `unavailable` result which a daemon could mishandle.
  await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git, events }))
    .resolves.toMatchObject({ kind: 'halted', detail: expect.any(String) });

  const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
  expect(halt).toContain(cause);
  expect(halt).toContain(expectedRecovery);
  await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  expect(loopHalts).toEqual([expect.stringContaining(cause)]);
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
      .resolves.toMatchObject({ kind: 'halted', detail: expect.any(String) });
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

  it('writes the exact recorded and planned positions with the reseal recovery for changed sealed positions', async () => {
    const changed = await fixture();
    const planPath = join(changed.repo, '.docs', 'plans', 'demo.md');
    const plan = await readFile(planPath, 'utf8');
    await writeFile(planPath, plan.replace('| 2 | Leaf | 2 |', '| 3 | Leaf | 2 |'));

    await expectCursorRefusal(
      changed,
      'positions-changed',
      'ai-conductor reseal --slug demo --path .docs/plans/demo.md --reason "«why»" --clear-halt',
    );
    await expect(readFile(join(changed.repo, '.pipeline', 'HALT'), 'utf8')).resolves
      .toContain('recorded positions [1,2]; plan positions [1,3]');
  });

  it.each([
    ['an unsliced plan', async (planPath: string) => writeFile(planPath, '# Implementation Plan: demo\n\n### Task 1: Flat\n**Dependencies:** none\n')],
    ['a singleton plan', async (planPath: string) => {
      const plan = await readFile(planPath, 'utf8');
      await writeFile(planPath, plan.replace('| 1 | One | 1 |\n| 2 | Leaf | 2 |', '| 1 | One | 1, 2 |'));
    }],
  ] as const)('halts instead of returning no-stack for %s after a two-child stack was sealed', async (_label, rewrite) => {
    const subject = await fixture();
    await rewrite(join(subject.repo, '.docs', 'plans', 'demo.md'));

    await expectCursorRefusal(
      subject,
      'positions-changed',
      'ai-conductor reseal --slug demo --path .docs/plans/demo.md --reason "«why»" --clear-halt',
    );
  });

  it.each([
    ['plan-missing', async (subject: Awaited<ReturnType<typeof fixture>>) => unlink(join(subject.repo, '.docs', 'plans', 'demo.md')), '.docs/plans/demo.md'],
    ['plan-invalid', async (subject: Awaited<ReturnType<typeof fixture>>) => writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), '# broken\n\n## Slices\n\nnot a table\n'), 'plan-invalid'],
  ] as const)('halts needs-human and emits loop_halt for %s instead of returning unavailable', async (cause, arrange, expectedText) => {
    const subject = await fixture();
    await arrange(subject);
    await expectCursorRefusal(subject, cause, expectedText);
  });

  it('halts needs-human and emits loop_halt when the positions ref cannot be read', async () => {
    const subject = await fixture();
    await subject.git(['update-ref', '-d', 'refs/conductor/demo/positions']);
    await expectCursorRefusal(
      subject,
      'positions-ref-unreadable',
      `git update-ref refs/conductor/demo/positions "$(printf '%s' '[1,2]' | git hash-object -w --stdin)"`,
    );
  });

  it('halts needs-human and emits loop_halt when Git fails at the durable-child-state probe', async () => {
    const subject = await fixture();
    const realGit = makeGitRunner(subject.repo);
    const git: GitRunner = async (args, options) => {
      if (args.join('\0') === ['for-each-ref', '--format=%(refname)', 'refs/heads/feat'].join('\0')) {
        return { exitCode: 2, stdout: '', stderr: 'injected durable-state failure' };
      }
      return realGit(args, options);
    };

    await expectCursorRefusal(subject, 'git-error', 'rm -f .pipeline/HALT .pipeline/HALT.class', git);
  });

  it('halts needs-human and emits loop_halt when Git throws while reading sealed positions', async () => {
    const subject = await fixture();
    const realGit = makeGitRunner(subject.repo);
    const git: GitRunner = async (args, options) => {
      if (args.join('\0') === ['cat-file', '-p', 'refs/conductor/demo/positions'].join('\0')) {
        throw new Error('injected positions-ref read failure');
      }
      return realGit(args, options);
    };

    await expectCursorRefusal(subject, 'git-error', 'rm -f .pipeline/HALT .pipeline/HALT.class', git);
  });

  it('runs the printed positions-ref recovery and clears preflight to child 2', async () => {
    const subject = await fixture();
    await subject.git(['update-ref', '-d', 'refs/conductor/demo/positions']);
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'halted', detail: expect.any(String) });
    // Hash the exact durable positions that the recovery command renders.
    await writeFile(join(subject.repo, 'positions-recovered.json'), '[1,2]');
    const recoveredBlob = (await subject.git(['hash-object', '-w', 'positions-recovered.json'])).stdout.trim();
    await subject.git(['update-ref', 'refs/conductor/demo/positions', recoveredBlob]);
    await unlink(join(subject.repo, '.pipeline', 'HALT'));
    await unlink(join(subject.repo, '.pipeline', 'HALT.class'));

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'clear' });
    await expect(resolveActiveChild(subject.repo, 'demo', { git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'active', child: 2, position: 2 });
  });

  it('prioritizes detached-head recovery over reseal discovery', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', '--detach']);
    await expectCursorRefusal(subject, 'detached-head', 'git switch feat/daemon-demo');
  });
});

describe('stack preflight dispatch boundaries', () => {
  type Cause = 'positions-changed' | 'positions-ref-unreadable' | 'plan-missing' | 'plan-invalid' | 'detached-head' | 'git-error';
  type Arrange = (subject: Awaited<ReturnType<typeof fixture>>) => Promise<GitRunner | undefined>;

  const cases: readonly [Cause, Arrange][] = [
    ['positions-changed', async (subject) => {
      const path = join(subject.repo, '.docs', 'plans', 'demo.md');
      await writeFile(path, (await readFile(path, 'utf8')).replace('| 2 | Leaf | 2 |', '| 3 | Leaf | 2 |'));
      return undefined;
    }],
    ['positions-ref-unreadable', async (subject) => {
      await subject.git(['update-ref', '-d', 'refs/conductor/demo/positions']);
      return undefined;
    }],
    ['plan-missing', async (subject) => {
      await unlink(join(subject.repo, '.docs', 'plans', 'demo.md'));
      return undefined;
    }],
    ['plan-invalid', async (subject) => {
      await writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), '# broken\n\n## Slices\n\nnot a table\n');
      return undefined;
    }],
    ['detached-head', async (subject) => {
      await subject.git(['checkout', '-q', '--detach']);
      return undefined;
    }],
    ['git-error', async (subject) => {
      const realGit = makeGitRunner(subject.repo);
      return async (args, options) => args.join('\0') === ['for-each-ref', '--format=%(refname)', 'refs/heads/feat'].join('\0')
        ? { exitCode: 2, stdout: '', stderr: 'injected durable-state failure' }
        : realGit(args, options);
    }],
  ];

  it.each(cases)('daemon re-kick writes this dispatch\'s %s HALT without a generic no-marker/unavailable log', async (cause, arrange) => {
    const subject = await fixture();
    const git = await arrange(subject);
    const log: string[] = [];

    await expect(runDaemonRekickStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      ...(git ? { git } : {}),
    }, (line) => log.push(line))).resolves.toMatchObject({ kind: 'halted', detail: expect.any(String) });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(cause);
    expect(log.join('\n')).not.toContain('loop ended without DONE or HALT marker');
    expect(log.join('\n')).not.toContain('stack preflight: unavailable');
  });

  it.each(cases)('a fresh Conductor dispatch writes its own %s HALT before entering a child region', async (cause, arrange) => {
    const subject = await fixture();
    const git = await arrange(subject);
    const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'conduct-state.json'), JSON.stringify({
      ...state, feature_desc: 'demo', complexity_tier: 'M',
    }));
    const dispatched: string[] = [];
    await new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      resume: true,
      mode: 'auto',
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      ...(git ? { stackPreflight: (options: Parameters<typeof runStackPreflight>[0]) => runStackPreflight({ ...options, git }) } : {}),
      stepRunner: { run: async (step) => { dispatched.push(step); return { success: true }; } },
    }).run();

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(cause);
    expect(dispatched).toEqual([]);
  });
});

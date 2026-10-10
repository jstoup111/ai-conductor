// Covers: task:35
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { REKICK_SENTINEL, resumeRebaseFirst } from '../../src/engine/daemon-rekick.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

let repository: string;

async function git(...args: string[]): Promise<string> {
  return (await execFile('git', ['-C', repository, ...args])).stdout.trim();
}

async function seal(positions: readonly number[]): Promise<void> {
  await writeCoverageBindingEnvelope(repository, {
    version: 1,
    slug: 'demo',
    runId: 'stack-guard',
    status: 'done',
    entries: [],
    sliceMembership: {
      taskSlices: Object.fromEntries(positions.map((position) => [String(position), position])),
      titles: positions.map((position) => `Child ${position}`),
    },
    storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])),
  }, envelopeFilesystem);
}

async function writeSentinel(): Promise<void> {
  await mkdir(join(repository, '.pipeline'), { recursive: true });
  await writeFile(join(repository, REKICK_SENTINEL), 'rekick\n', 'utf8');
}

async function initializeStack(activeChild: 2 | 3): Promise<void> {
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'stack-guard@example.test');
  await git('config', 'user.name', 'Stack guard test');
  await writeFile(join(repository, 'README.md'), 'base\n');
  await git('add', 'README.md');
  await git('commit', '-qm', 'base');
  await git('switch', '-qc', 'feat/daemon-demo');
  await mkdir(join(repository, '.ai-conductor'), { recursive: true });
  await writeFile(join(repository, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
  await seal([1, 2, 3]);
  await git('add', '.ai-conductor/config.yml', '.pipeline/coverage-binding.json');
  await git('commit', '-qm', 'seal stacked region');

  const tip = await git('rev-parse', 'HEAD');
  await git('branch', 'feat/c1/demo', tip);
  await git('update-ref', 'refs/conductor/demo/closed/c1', tip);
  await git('branch', 'feat/c2/demo', tip);
  if (activeChild === 3) await git('update-ref', 'refs/conductor/demo/closed/c2', tip);
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'rekick-stack-guard-'));
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe('resumeRebaseFirst stacked-region guard', () => {
  it('consumes a re-kick sentinel without rebasing while an intermediate child is active', async () => {
    await initializeStack(2);
    await writeSentinel();
    const childOneBefore = await git('rev-parse', 'feat/c1/demo');
    const childTwoBefore = await git('rev-parse', 'feat/c2/demo');
    const events = new ConductorEventEmitter();
    const skipped: Array<{ child: number; reason: string }> = [];
    events.on('rebase_skipped_for_stack', (event) => {
      if (event.type === 'rebase_skipped_for_stack') skipped.push(event);
    });
    let rebaseCalls = 0;

    await expect(resumeRebaseFirst({
      worktreePath: repository,
      localBase: 'main',
      events,
      ranManualTest: false,
      slug: 'demo',
      performRebase: async () => {
        rebaseCalls += 1;
        throw new Error('intermediate child must never rebase');
      },
    })).resolves.toBe('rebased');

    expect(rebaseCalls).toBe(0);
    expect(skipped).toEqual([{
      type: 'rebase_skipped_for_stack', child: 2, reason: 'active child is not the leaf',
    }]);
    expect(await git('rev-parse', 'feat/c1/demo')).toBe(childOneBefore);
    expect(await git('rev-parse', 'feat/c2/demo')).toBe(childTwoBefore);
    await expect(readFile(join(repository, REKICK_SENTINEL), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rebases the leaf worktree after the intermediate children close', async () => {
    await initializeStack(3);
    const childOneBefore = await git('rev-parse', 'feat/c1/demo');
    const childTwoBefore = await git('rev-parse', 'feat/c2/demo');
    await git('switch', 'main');
    await writeFile(join(repository, 'base-advance.md'), 'advance\n');
    await git('add', 'base-advance.md');
    await git('commit', '-qm', 'advance base');
    const baseTip = await git('rev-parse', 'HEAD');
    await git('switch', 'feat/daemon-demo');
    await writeSentinel();
    const events = new ConductorEventEmitter();
    const skipped: unknown[] = [];
    events.on('rebase_skipped_for_stack', (event) => skipped.push(event));

    await expect(resumeRebaseFirst({
      worktreePath: repository,
      localBase: 'main',
      events,
      ranManualTest: false,
      slug: 'demo',
    })).resolves.toBe('rebased');

    await expect(execFile('git', ['-C', repository, 'merge-base', '--is-ancestor', baseTip, 'feat/daemon-demo'])).resolves.toBeDefined();
    expect(await git('rev-parse', 'feat/c1/demo')).toBe(childOneBefore);
    expect(await git('rev-parse', 'feat/c2/demo')).toBe(childTwoBefore);
    expect(skipped).toEqual([]);
  });

  it('keeps the established rebase path for a feature with no child state', async () => {
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 'stack-guard@example.test');
    await git('config', 'user.name', 'Stack guard test');
    await writeFile(join(repository, 'README.md'), 'base\n');
    await git('add', 'README.md');
    await git('commit', '-qm', 'base');
    await git('switch', '-qc', 'feature/plain');
    await writeSentinel();
    const events = new ConductorEventEmitter();
    const skipped: unknown[] = [];
    events.on('rebase_skipped_for_stack', (event) => skipped.push(event));
    let rebaseCalls = 0;

    await expect(resumeRebaseFirst({
      worktreePath: repository,
      localBase: 'main',
      events,
      ranManualTest: false,
      slug: 'plain',
      performRebase: async () => {
        rebaseCalls += 1;
        return { kind: 'noop' };
      },
    })).resolves.toBe('rebased');

    expect(rebaseCalls).toBe(1);
    expect(skipped).toEqual([]);
  });
});

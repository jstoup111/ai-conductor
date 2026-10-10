// Covers: task:32
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import { detectTaskCommand, dispatchTaskCommand } from '../../src/engine/task-cli.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8').then(() => undefined),
  rename,
};

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function stackedFixture(): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'recovery-cli-child-default-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'recovery@example.test']);
  await git(root, ['config', 'user.name', 'Recovery CLI']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-qm', 'base']);
  await git(root, ['branch', 'feat/daemon-feature']);
  const worktree = join(root, '.worktrees', 'feature');
  await git(root, ['worktree', 'add', '-q', worktree, 'feat/daemon-feature']);
  await git(worktree, ['branch', 'feat/c1/feature', 'feat/daemon-feature']);
  const tip = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
  await git(worktree, ['update-ref', 'refs/conductor/feature/closed/c1', tip]);
  await mkdir(join(worktree, '.ai-conductor'), { recursive: true });
  await writeFile(join(worktree, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n');
  await writeCoverageBindingEnvelope(worktree, {
    version: 1,
    slug: 'feature',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { T1: 1, T3: 2 }, titles: ['First', 'Second'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  const childState = {
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
  };
  const flatState = {
    worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
    architecture_diagram: 'done', architecture_review: 'done', stories: 'done', conflict_check: 'done', plan: 'done',
    coherence_check: 'done', coverage_binding: 'done', acceptance_specs: 'done', build: 'done', test_suite: 'done',
    build_review: 'done', manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done', rebase: 'done',
    finish: 'done', last_step: 'finish',
  };
  await Promise.all([1, 2].map(async (child) => {
    const path = join(worktree, '.pipeline', 'children', String(child));
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'conduct-state.json'), `${JSON.stringify(childState)}\n`);
  }));
  await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), `${JSON.stringify(flatState)}\n`);
  await writeFile(join(worktree, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
    { id: 'T1', status: 'pending' }, { id: 'T3', status: 'pending' },
  ] }));
  await writeFile(join(worktree, '.pipeline', 'children', '2', 'kickback-ledger.json'), JSON.stringify({ version: 1, gates: {} }));
  return { root, worktree };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('recovery CLIs default to the active child', () => {
  it('rewinds child 2 by default and refuses a closed child without changing state', async () => {
    const { worktree } = await stackedFixture();
    const childOnePath = join(worktree, '.pipeline', 'children', '1', 'conduct-state.json');
    const beforeChildOne = await readFile(childOnePath, 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, worktree, {
        preflightDerivedRecords: async () => {}, clearDerivedRecords: async () => {}, emit: async () => {},
      })).resolves.toBe(0);
      expect(await readFile(childOnePath, 'utf8')).toBe(beforeChildOne);
      expect(JSON.parse(await readFile(join(worktree, '.pipeline', 'children', '2', 'conduct-state.json'), 'utf8'))).toMatchObject({
        build: 'stale', test_suite: 'stale', build_review: 'stale', last_step: 'acceptance_specs',
      });
    } finally {
      log.mockRestore();
    }

    const before = await readFile(childOnePath, 'utf8');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build', child: '1' }, worktree)).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith('rewind: child 1 is closed and cannot be rewound (#2943)');
      expect(await readFile(childOnePath, 'utf8')).toBe(before);
    } finally {
      error.mockRestore();
    }
  });

  it('uses child 2 task ownership when --child is omitted', async () => {
    const { worktree } = await stackedFixture();
    const accepted = detectTaskCommand(['node', 'conduct', 'task', 'start', 'T3']);
    await expect(dispatchTaskCommand(accepted!, worktree)).resolves.toBe(0);

    const refused = detectTaskCommand(['node', 'conduct', 'task', 'start', 'T1']);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchTaskCommand(refused!, worktree)).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith('[task-cli] task T1 belongs to child 1, not child 2');
    } finally {
      error.mockRestore();
    }
  });

  it('reads child 2’s kickback ledger when inspect omits --child', async () => {
    const { root } = await stackedFixture();
    const output: string[] = [];
    await expect(dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' },
      { cwd: root, resolveMainRoot: async () => root, print: (line) => output.push(line) },
    )).resolves.toBe(0);
    expect(JSON.parse(output.join('\n'))).toMatchObject({ feature: 'feature', child: 2 });
  });
});

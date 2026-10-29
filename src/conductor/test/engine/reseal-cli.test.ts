// Covers: task:2, task:3, task:5, task:8, task:rem-as-built-1-r2, task:rem-as-built-8-r1, task:rem-as-built-8-r2
import { describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createProgram } from '../../src/cli.js';
import { describeResealRecovery, detectResealCommand, dispatchResealCommand } from '../../src/engine/reseal-cli.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { createProtectedArtifactSeal, PROTECTED_ARTIFACT_SEAL_PATH, verifyProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { initTestRepo } from '../fixtures/git-repo.js';

// argv is process.argv: [node, entry, subcommand, ...arguments].
const argv = (...arguments_: string[]) => ['node', 'conduct', 'reseal', ...arguments_];
const execFile = promisify(execFileCallback);

describe('CLI surface — conduct reseal', () => {
  it('exposes the reseal command with its planned flags', () => {
    expect(
      createProgram()
        .commands.find((command) => command.name() === 'reseal')
        ?.options.map((option) => option.long),
    ).toEqual(['--slug', '--path', '--reason', '--clear-halt']);
  });
});

describe('detectResealCommand', () => {
  it('parses a valid reseal invocation for dispatch', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair-protected-plan',
          '--path',
          '.docs/plans/repair.md',
          '--path',
          '.docs/stories/repair.md',
          '--reason',
          'Corrected the accepted plan after review.',
          '--clear-halt',
        ),
      ),
    ).toEqual({
      kind: 'reseal',
      slug: 'repair-protected-plan',
      paths: ['.docs/plans/repair.md', '.docs/stories/repair.md'],
      reason: 'Corrected the accepted plan after review.',
      clearHalt: true,
    });
  });

  it('returns null when --reason is missing', () => {
    expect(detectResealCommand(argv('--slug', 'repair', '--path', '.docs/plans/repair.md'))).toBeNull();
  });

  it('returns null when a flag token is supplied where --reason needs a value', () => {
    expect(
      detectResealCommand(
        argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', '--clear-halt'),
      ),
    ).toBeNull();
  });

  it('defaults clearHalt to false when --clear-halt is absent', () => {
    expect(
      detectResealCommand(
        argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
      ),
    ).toEqual({
      kind: 'reseal',
      slug: 'repair',
      paths: ['.docs/plans/repair.md'],
      reason: 'Corrected after review.',
      clearHalt: false,
    });
  });

  it('returns null when --slug is missing', () => {
    expect(
      detectResealCommand(argv('--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.')),
    ).toBeNull();
  });

  it('returns null when --path is missing', () => {
    expect(detectResealCommand(argv('--slug', 'repair', '--reason', 'Corrected after review.'))).toBeNull();
  });

  it('preserves an explicitly supplied whitespace-only --reason for refusal dispatch', () => {
    expect(
      detectResealCommand(argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', '   ')),
    ).toEqual({
      kind: 'reseal',
      slug: 'repair',
      paths: ['.docs/plans/repair.md'],
      reason: '   ',
      clearHalt: false,
    });
  });

  it('returns null when --reason has no value', () => {
    expect(
      detectResealCommand(argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', '')),
    ).toBeNull();
  });

  it('returns null when a flag is duplicated with a conflicting value', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--slug',
          'different-repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
        ),
      ),
    ).toBeNull();
  });

  it('returns null when --slug is duplicated with an identical value', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
        ),
      ),
    ).toBeNull();
  });

  it.each(['Corrected after review.', 'A second rationale.'])('returns null when --reason is duplicated: %s', (secondReason) => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
          '--reason',
          secondReason,
        ),
      ),
    ).toBeNull();
  });

  it('returns null when --clear-halt is duplicated', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
          '--clear-halt',
          '--clear-halt',
        ),
      ),
    ).toBeNull();
  });

  it('returns null when an unknown flag is supplied', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
          '--force',
        ),
      ),
    ).toBeNull();
  });

  it.each(['nested/repair', 'nested\\repair', '.', '..', 'nested/./repair', 'nested/../repair'])(
    'returns null when --slug contains an unsafe segment: %s',
    (slug) => {
      expect(
        detectResealCommand(
          argv('--slug', slug, '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
        ),
      ).toBeNull();
    },
  );
});

describe('describeResealRecovery', () => {
  async function makeRecoveryFixture(
    paths: Record<string, string>,
    layout = '.worktrees',
  ): Promise<{ root: string; worktree: string }> {
    const root = await mkdtemp(join(tmpdir(), 'reseal-recovery-'));
    const worktree = join(root, layout, 'feat-x');
    const git = (args: string[]) => execFile('git', args, { cwd: worktree });
    try {
      await mkdir(worktree, { recursive: true });
      await initTestRepo(worktree);
      for (const path of Object.keys(paths)) {
        await mkdir(dirname(join(worktree, path)), { recursive: true });
        await writeFile(join(worktree, path), 'approved\n');
      }
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'approved artifacts']);
      await createProtectedArtifactSeal({ projectRoot: worktree, baselineCommit: (await git(['rev-parse', 'HEAD'])).stdout.trim() });
      await git(['checkout', '-q', '-b', 'feat-x']);
      for (const [path, content] of Object.entries(paths)) await writeFile(join(worktree, path), content);
      await git(['add', '.docs']);
      await git(['commit', '-q', '-m', 'amend approved artifacts']);
      return { root, worktree };
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  it('renders the exact operator recovery command for one committed sealed change', async () => {
    const path = '.docs/decisions/adr-2026-10-17-example.md';
    const { root, worktree } = await makeRecoveryFixture({ [path]: 'corrected\n' });
    try {
      await expect(describeResealRecovery(worktree, path)).resolves.toBe([
        'Approve this change as an operator amendment by running, from the repository root that contains .worktrees/feat-x, in an interactive terminal:',
        '  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-example.md --reason "«why»" --clear-halt',
      ].join('\n'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accumulates every committed sealed change in path order', async () => {
    const first = '.docs/decisions/adr-2026-10-17-a.md';
    const second = '.docs/decisions/adr-2026-10-17-b.md';
    const { root, worktree } = await makeRecoveryFixture({ [first]: 'corrected a\n', [second]: 'corrected b\n' });
    try {
      await expect(describeResealRecovery(worktree, first)).resolves.toBe([
        'Approve this change as an operator amendment by running, from the repository root that contains .worktrees/feat-x, in an interactive terminal:',
        '  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-a.md --path .docs/decisions/adr-2026-10-17-b.md --reason "«why»" --clear-halt',
      ].join('\n'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('shell-quotes a changed path that contains a space', async () => {
    const path = '.docs/decisions/adr 2026 space.md';
    const { root, worktree } = await makeRecoveryFixture({ [path]: 'corrected\n' });
    try {
      await expect(describeResealRecovery(worktree, path)).resolves.toContain("--slug feat-x --path '.docs/decisions/adr 2026 space.md'");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns undefined outside the .worktrees layout', async () => {
    const path = '.docs/decisions/adr-2026-10-17-example.md';
    const { root, worktree } = await makeRecoveryFixture({ [path]: 'corrected\n' }, 'work');
    try {
      await expect(describeResealRecovery(worktree, path)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function noApprovalState(worktree: string, path: string): Promise<{
    seal: string;
    events: boolean;
    hint: string | undefined;
  }> {
    const sealPath = join(worktree, PROTECTED_ARTIFACT_SEAL_PATH);
    const hint = await describeResealRecovery(worktree, path);
    return {
      seal: await readFile(sealPath, 'utf8'),
      events: await readFile(join(worktree, '.pipeline/events.jsonl'), 'utf8').then(() => true, () => false),
      hint,
    };
  }

  it('returns no hint or approval for an added unsealed protected artifact', async () => {
    const path = '.docs/decisions/adr-2026-10-17-a.md';
    const added = '.docs/decisions/adr-2026-10-17-new.md';
    const { root, worktree } = await makeRecoveryFixture({ [path]: 'corrected\n' });
    try {
      await writeFile(join(worktree, added), 'new decision\n');
      await execFile('git', ['add', '.docs'], { cwd: worktree });
      await execFile('git', ['commit', '-q', '-m', 'add unsealed decision'], { cwd: worktree });
      const before = await readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');

      await expect(noApprovalState(worktree, path)).resolves.toEqual({ seal: before, events: false, hint: undefined });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns no hint or approval for an uncommitted sealed change', async () => {
    const path = '.docs/decisions/adr-2026-10-17-a.md';
    const { root, worktree } = await makeRecoveryFixture({ [path]: 'corrected\n' });
    try {
      await writeFile(join(worktree, path), 'uncommitted correction\n');
      const before = await readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');

      await expect(noApprovalState(worktree, path)).resolves.toEqual({ seal: before, events: false, hint: undefined });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns no hint or approval for a feature-branch deletion', async () => {
    const path = '.docs/decisions/adr-2026-10-17-a.md';
    const { root, worktree } = await makeRecoveryFixture({ [path]: 'corrected\n' });
    try {
      await unlink(join(worktree, path));
      await execFile('git', ['add', '-A'], { cwd: worktree });
      await execFile('git', ['commit', '-q', '-m', 'delete protected decision'], { cwd: worktree });
      const before = await readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');

      await expect(noApprovalState(worktree, path)).resolves.toEqual({ seal: before, events: false, hint: undefined });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns undefined without throwing for an unreadable seal or non-Git worktree', async () => {
    const path = '.docs/decisions/adr-2026-10-17-a.md';
    const fixture = await makeRecoveryFixture({ [path]: 'corrected\n' });
    const nonGitRoot = await mkdtemp(join(tmpdir(), 'reseal-recovery-non-git-'));
    const nonGitWorktree = join(nonGitRoot, '.worktrees', 'feat-x');
    try {
      await writeFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'not json');
      await mkdir(join(nonGitWorktree, '.pipeline'), { recursive: true });
      await writeFile(join(nonGitWorktree, PROTECTED_ARTIFACT_SEAL_PATH), JSON.stringify({
        version: 2, baselineCommit: 'base', protectedArtifacts: [{ path, fingerprint: 'sha256:before' }], rebaselines: [],
      }));

      await expect(Promise.all([
        describeResealRecovery(fixture.worktree, path),
        describeResealRecovery(nonGitWorktree, path),
      ])).resolves.toEqual([undefined, undefined]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await rm(nonGitRoot, { recursive: true, force: true });
    }
  });

  it('does not approve the successful two-path recovery preview', async () => {
    const first = '.docs/decisions/adr-2026-10-17-a.md';
    const second = '.docs/decisions/adr-2026-10-17-b.md';
    const { root, worktree } = await makeRecoveryFixture({ [first]: 'corrected a\n', [second]: 'corrected b\n' });
    try {
      const before = await readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');

      await expect(noApprovalState(worktree, first)).resolves.toEqual({
        seal: before,
        events: false,
        hint: expect.stringContaining('--path .docs/decisions/adr-2026-10-17-b.md'),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('dispatchResealCommand', () => {
  it('refuses a malformed manifest-backed feature without changing its seal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-malformed-manifest-'));
    const worktree = join(root, '.worktrees', 'repair');
    const planPath = '.docs/plans/repair.md';
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', planPath, '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.docs', 'repair'), { recursive: true });
      await mkdir(join(worktree, '.docs', 'plans'), { recursive: true });
      await initTestRepo(worktree);
      await Promise.all([
        writeFile(join(worktree, '.docs', 'repair', 'manifest.json'), '{ not json\n'),
        writeFile(join(worktree, planPath), '# Plan\n'),
      ]);
      await execFile('git', ['add', '.docs'], { cwd: worktree });
      await execFile('git', ['commit', '-qm', 'malformed manifest feature'], { cwd: worktree });
      await createProtectedArtifactSeal({
        projectRoot: worktree,
        baselineCommit: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim(),
      });
      const sealBefore = await readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');
      const err = vi.fn();

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        err,
        resolveBaseBranch: vi.fn().mockResolvedValue('main'),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(1);

      expect(err).toHaveBeenCalledWith(expect.stringContaining('Feature artifact manifest is malformed:'));
      await expect(readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8')).resolves.toBe(sealBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function stackFixture(
    slices: Readonly<Record<number, readonly number[]>>,
    recordedPositions: readonly number[],
  ): Promise<{ root: string; worktree: string; planPath: string }> {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-stack-'));
    const worktree = join(root, '.worktrees', 'repair');
    const planPath = '.docs/plans/repair.md';
    await mkdir(worktree, { recursive: true });
    await initTestRepo(worktree);
    await Promise.all([
      mkdir(join(worktree, '.pipeline', 'children', '1'), { recursive: true }),
      mkdir(join(worktree, '.ai-conductor'), { recursive: true }),
      mkdir(join(worktree, '.docs', 'plans'), { recursive: true }),
      mkdir(join(worktree, '.docs', 'stories'), { recursive: true }),
      mkdir(join(worktree, '.docs', 'complexity'), { recursive: true }),
    ]);
    const positions = Object.keys(slices).map(Number).sort((left, right) => left - right);
    const taskBlocks = positions.flatMap((position) => slices[position].flatMap((task) => [
      `### Task ${task}: Task ${task}`,
      `**Story:** Story ${position}`,
      '**Dependencies:** none',
      '',
    ]));
    await Promise.all([
      writeFile(join(worktree, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n'),
      writeFile(join(worktree, planPath), [
        '# Implementation Plan: repair', '', '**Stories:** .docs/stories/repair.md', '', '## Slices', '',
        '| Slice | Title | Tasks |', '| --- | --- | --- |',
        ...positions.map((position) => `| ${position} | Slice ${position} | ${slices[position].join(', ')} |`),
        '', ...taskBlocks,
      ].join('\n')),
      writeFile(join(worktree, '.docs', 'stories', 'repair.md'), positions.map((position) => `## Story ${position}: Slice ${position}`).join('\n\n')),
      writeFile(join(worktree, '.docs', 'complexity', 'repair.md'), 'Tier: M\nStacked-Delivery: approved\n'),
    ]);
    await writeFile(join(worktree, 'positions.json'), JSON.stringify(recordedPositions));
    const blob = (await execFile('git', ['hash-object', '-w', 'positions.json'], { cwd: worktree })).stdout.trim();
    await execFile('git', ['update-ref', 'refs/conductor/repair/positions', blob], { cwd: worktree });
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
      baselineCommit: 'base', protectedArtifacts: [{ path: planPath, fingerprint: 'sha256:before' }], rebaselines: [], version: 2,
    }));
    return { root, worktree, planPath };
  }

  it('does not change retired coverage-binding state after resealing a changed feature ADR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-coverage-void-'));
    const worktree = join(root, '.worktrees', 'repair');
    const adrPath = '.docs/decisions/adr-repair.md';
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', adrPath, '--reason', 'Corrected the governing decision.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: adrPath, fingerprint: 'sha256:before' }],
        rebaselines: [], version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'coverage-binding.json'), JSON.stringify({
        version: 1, slug: 'repair', runId: 'coverage-run', status: 'done', entries: [],
      }) + '\n');
      await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), JSON.stringify({
        build: 'done', last_step: 'build',
      }) + '\n');
      const coverageBefore = await readFile(join(worktree, '.pipeline', 'coverage-binding.json'), 'utf8');
      const stateBefore = await readFile(join(worktree, '.pipeline', 'conduct-state.json'), 'utf8');
      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        resolveHead: vi.fn().mockResolvedValue('target'),
        resolveBaseBranch: vi.fn().mockResolvedValue('main'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: adrPath, fingerprint: 'sha256:after' }],
          rebaselines: [], version: 2,
        }),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'coverage-binding.json'), 'utf8')).resolves.toBe(coverageBefore);
      await expect(readFile(join(worktree, '.pipeline', 'conduct-state.json'), 'utf8')).resolves.toBe(stateBefore);
      expect(JSON.parse(stateBefore)).not.toHaveProperty('coverage_binding');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['adds a slice', { 1: [1, 2], 2: [3], 3: [4] }, [1, 2, 3]],
    ['removes a slice', { 2: [3, 4] }, [2]],
  ] as const)('refuses resealing a plan that %s after children exist', async (_label, slices, proposed) => {
    const fixture = await stackFixture(slices, [1, 2]);
    const command = detectResealCommand(argv('--slug', 'repair', '--path', fixture.planPath, '--reason', 'Correct plan.', '--clear-halt'));
    if (!command) throw new Error('expected valid reseal command');
    try {
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      const sealBefore = await readFile(join(fixture.worktree, '.pipeline', 'protected-artifact-seal.json'), 'utf8');
      const reseal = vi.fn();
      const err = vi.fn();

      await expect(dispatchResealCommand(command, {
        cwd: fixture.root, isInteractive: true, err, reseal, events: new ConductorEventEmitter(),
      })).resolves.toBe(1);

      expect(err).toHaveBeenCalledWith(`reseal: cannot change sealed stack positions: recorded [1,2] and proposed [${proposed.join(',')}].`);
      expect(reseal).not.toHaveBeenCalled();
      await expect(readFile(join(fixture.worktree, '.pipeline', 'protected-artifact-seal.json'), 'utf8')).resolves.toBe(sealBefore);
      await expect(readFile(join(fixture.worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['removes all slices', async (worktree: string, planPath: string) =>
      writeFile(join(worktree, planPath), '# Implementation Plan: repair\n\n### Task 1: Flat\n**Dependencies:** none\n'), []],
    ['shrinks to one slice', async (worktree: string, planPath: string) => {
      const plan = await readFile(join(worktree, planPath), 'utf8');
      await writeFile(join(worktree, planPath), plan
        .replace('| 1 | Slice 1 | 1 |\n| 2 | Slice 2 | 2 |', '| 1 | Slice 1 | 1, 2 |'));
    }, [1]],
  ] as const)('refuses resealing a plan that %s from a durable two-child stack', async (_label, rewrite, proposed) => {
    const fixture = await stackFixture({ 1: [1], 2: [2] }, [1, 2]);
    const command = detectResealCommand(argv('--slug', 'repair', '--path', fixture.planPath, '--reason', 'Correct plan.', '--clear-halt'));
    if (!command) throw new Error('expected valid reseal command');
    try {
      await rewrite(fixture.worktree, fixture.planPath);
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      const sealBefore = await readFile(join(fixture.worktree, '.pipeline', 'protected-artifact-seal.json'), 'utf8');
      const reseal = vi.fn();
      const err = vi.fn();

      await expect(dispatchResealCommand(command, {
        cwd: fixture.root, isInteractive: true, err, reseal, events: new ConductorEventEmitter(),
      })).resolves.toBe(1);

      expect(err).toHaveBeenCalledWith(`reseal: cannot change sealed stack positions: recorded [1,2] and proposed [${proposed.join(',')}].`);
      expect(reseal).not.toHaveBeenCalled();
      await expect(readFile(join(fixture.worktree, '.pipeline', 'protected-artifact-seal.json'), 'utf8')).resolves.toBe(sealBefore);
      await expect(readFile(join(fixture.worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['a membership error', (plan: string) => plan.replace('| 1 | Slice 1 | 1 |', '| 1 | Slice 1 | 1, 2 |')],
    ['a dependency error', (plan: string) => plan.replace('### Task 1: Task 1\n**Story:** Story 1\n**Dependencies:** none', '### Task 1: Task 1\n**Story:** Story 1\n**Dependencies:** 2')],
  ])('refuses before resealing when changed positions also carry %s', async (_label, invalidate) => {
    const fixture = await stackFixture({ 1: [1], 3: [2] }, [1, 2]);
    const command = detectResealCommand(argv('--slug', 'repair', '--path', fixture.planPath, '--reason', 'Correct plan.', '--clear-halt'));
    if (!command) throw new Error('expected valid reseal command');
    try {
      const plan = await readFile(join(fixture.worktree, fixture.planPath), 'utf8');
      await writeFile(join(fixture.worktree, fixture.planPath), invalidate(plan));
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      const sealBefore = await readFile(join(fixture.worktree, '.pipeline', 'protected-artifact-seal.json'), 'utf8');
      const reseal = vi.fn();
      const err = vi.fn();

      await expect(dispatchResealCommand(command, {
        cwd: fixture.root, isInteractive: true, err, reseal, events: new ConductorEventEmitter(),
      })).resolves.toBe(1);

      expect(err).toHaveBeenCalledWith('reseal: cannot establish proposed sealed stack positions: recorded [1,2]; cause plan-invalid.');
      expect(reseal).not.toHaveBeenCalled();
      await expect(readFile(join(fixture.worktree, '.pipeline', 'protected-artifact-seal.json'), 'utf8')).resolves.toBe(sealBefore);
      await expect(readFile(join(fixture.worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('refuses a position change before an unrelated unknown Story ID can mask it', async () => {
    const fixture = await stackFixture({ 1: [1], 3: [3] }, [1, 2]);
    const command = detectResealCommand(argv('--slug', 'repair', '--path', fixture.planPath, '--reason', 'Correct plan.'));
    if (!command) throw new Error('expected valid reseal command');
    try {
      const plan = await readFile(join(fixture.worktree, fixture.planPath), 'utf8');
      await writeFile(join(fixture.worktree, fixture.planPath), plan.replace('**Story:** Story 3', '**Story:** Story 999'));
      const err = vi.fn();
      const reseal = vi.fn();

      await expect(dispatchResealCommand(command, {
        cwd: fixture.root, isInteractive: true, err, reseal, events: new ConductorEventEmitter(),
      })).resolves.toBe(1);

      expect(err).toHaveBeenCalledWith('reseal: cannot change sealed stack positions: recorded [1,2] and proposed [1,3].');
      expect(reseal).not.toHaveBeenCalled();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('reseals a plan that moves a task between its existing positions', async () => {
    const fixture = await stackFixture({ 1: [1, 2, 4], 2: [3] }, [1, 2]);
    const command = detectResealCommand(argv('--slug', 'repair', '--path', fixture.planPath, '--reason', 'Move task four.'));
    if (!command) throw new Error('expected valid reseal command');
    const reseal = vi.fn().mockResolvedValue({
      baselineCommit: 'target', protectedArtifacts: [{ path: fixture.planPath, fingerprint: 'sha256:after' }], rebaselines: [], version: 2,
    });
    try {
      await expect(dispatchResealCommand(command, {
        cwd: fixture.root, isInteractive: true, reseal, resolveHead: vi.fn().mockResolvedValue('target'), events: new ConductorEventEmitter(),
      })).resolves.toBe(0);
      expect(reseal).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('reseals a known worktree and reports the named paths without starting the pipeline', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();
    const reseal = vi.fn().mockResolvedValue({
      baselineCommit: 'target',
      protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
      rebaselines: [],
      version: 2,
    });

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        out,
        access: vi.fn().mockResolvedValue(undefined),
        isInteractive: true,
        readFile: vi.fn().mockResolvedValue(JSON.stringify({
          baselineCommit: 'base',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
          rebaselines: [],
          version: 2,
        })),
        resolveHead: vi.fn().mockResolvedValue('target'),
        resolveBaseBranch: vi.fn().mockResolvedValue('trunk'),
        reseal,
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(0);

    expect({
      reseal: reseal.mock.calls,
      out: out.mock.calls,
    }).toEqual({
      reseal: [[{
        projectRoot: '/project/.worktrees/repair',
        seal: {
          baselineCommit: 'base',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
          rebaselines: [],
          version: 2,
        },
        toCommit: 'target',
        trigger: 'operator-reseal',
        paths: ['.docs/plans/repair.md'],
        reason: 'Corrected after review.',
        featureDesc: 'repair',
        baseBranch: 'trunk',
        onRebaseline: expect.any(Function),
      }]],
      out: [['Resealed protected artifacts: .docs/plans/repair.md']],
    });
  });

  it('passes the operator rationale and resolved provenance through the public dispatcher', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', ' Keep exact whitespace. '),
    );
    if (!command) throw new Error('expected valid reseal command');
    const reseal = vi.fn().mockResolvedValue({
      baselineCommit: 'target',
      protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
      rebaselines: [],
      version: 2,
    });

    await expect(dispatchResealCommand(command, {
      cwd: '/project',
      access: vi.fn().mockResolvedValue(undefined),
      isInteractive: true,
      readFile: vi.fn().mockResolvedValue(JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      })),
      resolveHead: vi.fn().mockResolvedValue('target'),
      resolveBaseBranch: vi.fn().mockResolvedValue('main'),
      reseal,
      events: new ConductorEventEmitter(),
    })).resolves.toBe(0);

    expect(reseal).toHaveBeenCalledWith(expect.objectContaining({
      reason: ' Keep exact whitespace. ',
      featureDesc: 'repair',
      baseBranch: 'main',
    }));
  });

  it('preserves and clears a protected-artifact halt after a successful reseal with --clear-halt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-clear-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT.cleared'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(access(join(worktree, '.pipeline', 'HALT'))).rejects.toThrow();
      await expect(access(join(worktree, '.pipeline', 'HALT.class'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves halt markers untouched after a successful reseal without --clear-halt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-keep-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a non-protected halt intact and reports why after a successful --clear-halt reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-unrelated-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'awaiting an operator\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'needs-human');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        out,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('awaiting an operator\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
      expect(out).toHaveBeenCalledWith('Halt was not cleared: its class is needs-human.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports that there is no halt to clear after a successful --clear-halt reseal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();

    await expect(dispatchResealCommand(command, {
      cwd: '/project',
      isInteractive: true,
      out,
      access: vi.fn().mockImplementation(async (path: string) => {
        if (path.endsWith('/.pipeline/HALT')) throw new Error('missing');
      }),
      readFile: vi.fn().mockResolvedValue(JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      })),
      resolveHead: vi.fn().mockResolvedValue('target'),
      reseal: vi.fn().mockResolvedValue({
        baselineCommit: 'target',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
        rebaselines: [],
        version: 2,
      }),
      events: new ConductorEventEmitter(),
    })).resolves.toBe(0);

    expect(out).toHaveBeenCalledWith('No halt to clear.');
  });

  it('leaves an unclassified halt intact after a successful --clear-halt reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-unclassified-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'legacy halt\n');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        out,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('legacy halt\n');
      await expect(access(join(worktree, '.pipeline', 'HALT.class'))).rejects.toThrow();
      expect(out).toHaveBeenCalledWith('Halt was not cleared: it is unclassified.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves halt markers untouched when a --clear-halt reseal is refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-refused-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        err: vi.fn(),
        isInteractive: true,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockRejectedValue(new Error('unlisted protected artifact changed')),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(1);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports a partial halt-clear failure after a successful reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-partial-clear-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();
    const clearHalt = vi.fn(async (path: string) => {
      await writeFile(join(path, '.pipeline', 'HALT.cleared'), 'protected artifact changed\n');
      throw new Error('HALT.class could not be removed');
    });

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        out,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        clearHalt,
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT.cleared'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
      expect({ clearHalt: clearHalt.mock.calls, out: out.mock.calls }).toEqual({
        clearHalt: [[worktree]],
        out: [
          ['Resealed protected artifacts: .docs/plans/repair.md'],
          ['Halt was not fully cleared: HALT.class could not be removed.'],
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('constructs the audit sink at the resolved worktree and records the performed reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-audit-'));
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await expect(
        dispatchResealCommand(command, {
          cwd: root,
          isInteractive: true,
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue(JSON.stringify({
            baselineCommit: 'base',
            protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
            rebaselines: [],
            version: 2,
          })),
          resolveHead: vi.fn().mockResolvedValue('target'),
          reseal: vi.fn().mockResolvedValue({
            baselineCommit: 'target',
            protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
            rebaselines: [],
            version: 2,
          }),
        }),
      ).resolves.toBe(0);

      const audit = await readFile(
        join(root, '.worktrees', 'repair', '.pipeline', 'audit-trail', 'events.jsonl'),
        'utf8',
      );
      expect(JSON.parse(audit) as Record<string, unknown>).toMatchObject({
        origin: 'operator',
        event: 'reseal',
        reason: 'Corrected after review.',
        fromCommit: 'base',
        toCommit: 'target',
        paths: [{
          path: '.docs/plans/repair.md',
          priorFingerprint: 'sha256:before',
          newFingerprint: 'sha256:after',
        }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces a performed-reseal audit failure without recording a false refusal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const events = new ConductorEventEmitter();
    const refused = vi.fn();
    events.on('protected_artifact_reseal', () => {
      throw new Error('durable audit sink failed');
    });
    events.on('protected_artifact_reseal_refused', refused);

    await expect(dispatchResealCommand(command, {
      cwd: '/project',
      isInteractive: true,
      access: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      })),
      resolveHead: vi.fn().mockResolvedValue('target'),
      reseal: vi.fn().mockResolvedValue({
        baselineCommit: 'target',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
        rebaselines: [],
        version: 2,
      }),
      events,
    })).rejects.toThrow('durable audit sink failed');

    expect(refused).not.toHaveBeenCalled();
  });

  it('refuses to reseal from a non-interactive terminal without changing the seal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const sealJson = JSON.stringify({ baselineCommit: 'base' });
    const err = vi.fn();
    const readFile = vi.fn().mockResolvedValue(sealJson);
    const reseal = vi.fn().mockResolvedValue(undefined);

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err,
        access: vi.fn().mockResolvedValue(undefined),
        isInteractive: false,
        readFile,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal,
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(1);

    expect({
      err: err.mock.calls,
      readFile: readFile.mock.calls,
      reseal: reseal.mock.calls,
      sealJson,
    }).toEqual({
      err: [['reseal: requires an interactive terminal.']],
      readFile: [],
      reseal: [],
      sealJson: JSON.stringify({ baselineCommit: 'base' }),
    });
  });

  it('refuses reseal when an autonomous step subprocess has non-interactive stdin', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();
    const reseal = vi.fn();

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        // DefaultStepRunner's autonomous provider path supplies ignored or
        // piped stdin, so a nested CLI sees no TTY.
        isInteractive: false,
        err,
        access: vi.fn().mockResolvedValue(undefined),
        reseal,
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(1);

    expect({
      err: err.mock.calls,
      reseal: reseal.mock.calls,
    }).toEqual({
      err: [['reseal: requires an interactive terminal.']],
      reseal: [],
    });
  });

  it('refuses an autonomous-step reseal attempt without clearing its protected-artifact violation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-in-step-violation-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();
    const reseal = vi.fn();

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'Protected artifact changed: .docs/plans/repair.md\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        err,
        isInteractive: false,
        reseal,
      })).resolves.toBe(1);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
        'Protected artifact changed: .docs/plans/repair.md\n',
      );
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
      expect({ err: err.mock.calls, reseal: reseal.mock.calls }).toEqual({
        err: [['reseal: requires an interactive terminal.']],
        reseal: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits a refusal event for unlisted protected-artifact drift', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const events = new ConductorEventEmitter();
    const refused = vi.fn();
    events.on('protected_artifact_reseal_refused', refused);

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err: vi.fn(),
        isInteractive: true,
        access: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(JSON.stringify({
          baselineCommit: 'base',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
          rebaselines: [],
          version: 2,
        })),
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockRejectedValue(
          new Error('Protected artifact changed: .docs/stories/unlisted.md'),
        ),
        events,
      }),
    ).resolves.toBe(1);

    expect(refused).toHaveBeenCalledWith({
      type: 'protected_artifact_reseal_refused',
      reason: 'Corrected after review.',
      condition: 'Protected artifact changed: .docs/stories/unlisted.md',
      path: '.docs/stories/unlisted.md',
    });
  });

  it('records parser-produced whitespace rationale and non-interactive refusals in the resolved worktree audit trail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-refusal-audit-'));
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    const whitespaceReasonCommand = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', '   '),
    );
    if (!command || !whitespaceReasonCommand) throw new Error('expected parseable reseal commands');
    const seal = JSON.stringify({
      baselineCommit: 'base',
      protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
      rebaselines: [],
      version: 2,
    });

    try {
      await expect(
        dispatchResealCommand(whitespaceReasonCommand, {
          cwd: root,
          err: (line) => expect(line).toBe('reseal: missing rationale.'),
          isInteractive: true,
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue(seal),
        }),
      ).resolves.toBe(1);
      await expect(
        dispatchResealCommand(command, {
          cwd: root,
          err: vi.fn(),
          isInteractive: false,
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue(seal),
        }),
      ).resolves.toBe(1);

      const audit = await readFile(
        join(root, '.worktrees', 'repair', '.pipeline', 'audit-trail', 'events.jsonl'),
        'utf8',
      );
      expect(audit.split('\n').filter(Boolean).map((line) => JSON.parse(line))).toMatchObject([
        { origin: 'operator', event: 'reseal_refused', condition: 'missing rationale' },
        { origin: 'operator', event: 'reseal_refused', condition: 'requires an interactive terminal' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an unknown feature worktree', async () => {
    const command = detectResealCommand(
      argv('--slug', 'missing', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err,
        isInteractive: true,
        access: vi.fn().mockRejectedValue(new Error('missing')),
      }),
    ).resolves.toBe(1);

    expect(err).toHaveBeenCalledWith("reseal: unknown feature worktree 'missing'.");
  });

  it('does not create an audit-trail directory for an unknown feature worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-unknown-worktree-'));
    const command = detectResealCommand(
      argv('--slug', 'missing', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await expect(dispatchResealCommand(command, {
        cwd: root,
        err: vi.fn(),
        isInteractive: true,
      })).resolves.toBe(1);

      await expect(access(join(root, '.worktrees', 'missing'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces an audit persistence failure for a known worktree refusal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-audit-write-failure-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline', 'audit-trail', 'events.jsonl'), { recursive: true });

      await expect(dispatchResealCommand(command, {
        cwd: root,
        err: vi.fn(),
        isInteractive: false,
      })).rejects.toThrow(/failed to append audit record/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a known worktree without a protected artifact seal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err,
        isInteractive: true,
        access: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockRejectedValue(new Error('missing')),
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(1);

    expect(err).toHaveBeenCalledWith("reseal: protected artifact seal is missing for 'repair'.");
  });

  it('wires reseal into the pre-boot chain before normal pipeline parsing', async () => {
    const source = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/from ['"]\.\/engine\/reseal-cli\.js['"]/);
    expect(source).toMatch(/detectResealCommand\(process\.argv\)/);
    expect(source.indexOf('detectResealCommand(process.argv)')).toBeLessThan(source.indexOf('opts = parseArgs(rest)'));
  });

  it('recovers the #1752 shape through the public reseal dispatcher', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-inherited-deletion-'));
    const worktree = join(root, '.worktrees', 'repair');
    const git = (args: string[]) => execFile('git', args, { cwd: worktree });
    const retired = '.docs/plans/retired.md';
    const own = '.docs/plans/repair.md';
    const put = async (path: string, content: string) => {
      await mkdir(dirname(join(worktree, path)), { recursive: true });
      await writeFile(join(worktree, path), content, 'utf8');
    };
    try {
      await mkdir(worktree, { recursive: true });
      await initTestRepo(worktree);
      await put('.gitignore', '.pipeline/\n');
      await put(retired, 'retired\n');
      await put(own, 'approved\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'approved artifacts']);
      await git(['checkout', '-q', '-b', 'repair']);
      await put('src/work.ts', 'work\n');
      await git(['add', '.']);
      await git(['commit', '-q', '-m', 'feature work']);
      await createProtectedArtifactSeal({ projectRoot: worktree, baselineCommit: (await git(['rev-parse', 'HEAD'])).stdout.trim() });
      await git(['checkout', '-q', 'main']);
      await unlink(join(worktree, retired));
      await git(['add', '-A']);
      await git(['commit', '-q', '-m', 'retire inherited plan']);
      await git(['checkout', '-q', 'repair']);
      await git(['rebase', '-q', 'main']);

      const command = detectResealCommand(argv('--slug', 'repair', '--path', retired, '--reason', 'Approved correction.'));
      if (!command) throw new Error('expected valid reseal command');
      const events = new ConductorEventEmitter();
      const rebaselines: unknown[] = [];
      events.on('protected_artifact_rebaseline', (event) => { rebaselines.push(event); });
      await expect(dispatchResealCommand(command, {
        cwd: root, isInteractive: true, events,
      })).resolves.toBe(0);
      expect(rebaselines).toEqual([{
        type: 'protected_artifact_rebaseline',
        fromCommit: expect.any(String),
        toCommit: expect.any(String),
        trigger: 'inherited-base-deletion',
        paths: [retired],
        deletedBy: { [retired]: (await git(['rev-parse', 'main'])).stdout.trim() },
      }]);
      await expect(verifyProtectedArtifactSeal({ projectRoot: worktree, baseBranch: 'main' }))
        .resolves.toMatchObject({ ok: true });
      const seal = JSON.parse(await readFile(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8')) as { protectedArtifacts: { path: string }[] };
      expect(seal.protectedArtifacts.map(({ path }) => path)).not.toContain(retired);
      await expect(access(join(worktree, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});

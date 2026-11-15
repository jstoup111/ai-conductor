import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

import { switchToChild, noOpChildLifecycleEvents } from '../../src/engine/child-lifecycle.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { listUntrackedPaths, quarantineValidatorResidue } from '../../src/engine/validator-residue.js';

// Covers: task:1
describe('validator residue quarantine', () => {
  let repository: string;
  let git: ReturnType<typeof makeGitRunner>;

  const runGit = async (args: string[]) => execa('git', args, { cwd: repository });
  const child = { child: 1 as const, position: 1 as const, branch: 'validator-child' };

  beforeEach(async () => {
    repository = await mkdtemp(join(tmpdir(), 'validator-residue-'));
    await runGit(['init', '-q', '-b', 'main']);
    await runGit(['config', 'user.email', 'test@example.com']);
    await runGit(['config', 'user.name', 'Test User']);
    await runGit(['config', 'status.showUntrackedFiles', 'all']);
    await mkdir(join(repository, 'src'), { recursive: true });
    await writeFile(join(repository, '.gitignore'), '.pipeline/\n');
    await writeFile(join(repository, 'src', 'app.ts'), 'export const app = 1;\n');
    await runGit(['add', '.']);
    await runGit(['commit', '-qm', 'initial']);
    await runGit(['branch', child.branch]);
    git = makeGitRunner(repository);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(repository, { recursive: true, force: true });
  });

  it('moves only untracked files created after the baseline into a per-dispatch directory', async () => {
    const baseline = await listUntrackedPaths(git);
    const relativePath = 'docs/reports/manual-test-step17/report.html';
    const contents = '<html>report</html>\n';
    await mkdir(join(repository, 'docs/reports/manual-test-step17'), { recursive: true });
    await writeFile(join(repository, relativePath), contents);

    const result = await quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test' });

    expect(result).toMatchObject({
      kind: 'moved',
      paths: [relativePath],
      directory: expect.stringMatching(/^\.pipeline\/validator-residue\/manual_test-/),
    });
    if (result.kind !== 'moved') throw new Error('expected residue to move');
    await expect(readFile(join(repository, result.directory, relativePath), 'utf8')).resolves.toBe(contents);
    await expect(git(['status', '--porcelain'])).resolves.toMatchObject({ stdout: '' });
  });

  it('leaves baseline untracked paths and tracked edits in place', async () => {
    await writeFile(join(repository, 'notes.txt'), 'already here\n');
    const baseline = await listUntrackedPaths(git);
    await writeFile(join(repository, 'src/app.ts'), 'export const app = 2;\n');
    await mkdir(join(repository, 'docs/reports/manual-test-step17'), { recursive: true });
    await writeFile(join(repository, 'docs/reports/manual-test-step17/report.html'), 'new report\n');

    const result = await quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test' });

    expect(result).toMatchObject({ kind: 'moved', paths: ['docs/reports/manual-test-step17/report.html'] });
    await expect(readFile(join(repository, 'notes.txt'), 'utf8')).resolves.toBe('already here\n');
    await expect(readFile(join(repository, 'src/app.ts'), 'utf8')).resolves.toBe('export const app = 2;\n');
    await expect(switchToChild(repository, child, noOpChildLifecycleEvents, undefined, { git })).resolves.toMatchObject(
      {
        kind: 'refused',
        reason: expect.stringMatching(
          /^worktree is dirty:.*src\/app\.ts.*notes\.txt|^worktree is dirty:.*notes\.txt.*src\/app\.ts/,
        ),
      },
    );
  });

  it('refuses every move when a destination already exists', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:34:56.789Z'));
    const baseline = await listUntrackedPaths(git);
    const report = 'docs/reports/manual-test-step17/report.html';
    const second = 'docs/reports/manual-test-step17/second.html';
    await mkdir(join(repository, 'docs/reports/manual-test-step17'), { recursive: true });
    await writeFile(join(repository, report), 'report\n');
    await writeFile(join(repository, second), 'second\n');
    await mkdir(
      join(
        repository,
        '.pipeline/validator-residue/manual_test-2026-11-15T12-34-56.789Z/docs/reports/manual-test-step17',
      ),
      { recursive: true },
    );
    await writeFile(
      join(repository, '.pipeline/validator-residue/manual_test-2026-11-15T12-34-56.789Z', report),
      'existing\n',
    );

    const result = await quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test' });

    expect(result).toMatchObject({ kind: 'refused', reason: expect.any(String) });
    await expect(readFile(join(repository, report), 'utf8')).resolves.toBe('report\n');
    await expect(readFile(join(repository, second), 'utf8')).resolves.toBe('second\n');
    await expect(switchToChild(repository, child, noOpChildLifecycleEvents, undefined, { git })).resolves.toMatchObject(
      {
        kind: 'refused',
        reason: expect.stringContaining(report),
      },
    );
  });

  it('refuses every move when the validator residue root is a regular file', async () => {
    const baseline = await listUntrackedPaths(git);
    const report = 'docs/reports/manual-test-step17/report.html';
    const second = 'docs/reports/manual-test-step17/second.html';
    await mkdir(join(repository, 'docs/reports/manual-test-step17'), { recursive: true });
    await writeFile(join(repository, report), 'report\n');
    await writeFile(join(repository, second), 'second\n');
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline/validator-residue'), 'not a directory\n');

    const result = await quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test' });

    expect(result).toMatchObject({ kind: 'refused', reason: expect.any(String) });
    await expect(readFile(join(repository, report), 'utf8')).resolves.toBe('report\n');
    await expect(readFile(join(repository, second), 'utf8')).resolves.toBe('second\n');
    await expect(switchToChild(repository, child, noOpChildLifecycleEvents, undefined, { git })).resolves.toMatchObject(
      {
        kind: 'refused',
        reason: expect.stringContaining(report),
      },
    );
  });

  it('refuses every move when git reports a newly untracked path that vanished', async () => {
    const baseline = await listUntrackedPaths(git);
    const report = 'docs/reports/manual-test-step17/report.html';
    const second = 'docs/reports/manual-test-step17/second.html';
    await mkdir(join(repository, 'docs/reports/manual-test-step17'), { recursive: true });
    await writeFile(join(repository, report), 'report\n');
    await writeFile(join(repository, second), 'second\n');
    const ghostGit: GitRunner = async (args, options) => {
      const result = await git(args, options);
      if (args[0] === 'status' && !args.includes('--')) return { ...result, stdout: `${result.stdout}?? ghost.txt\0` };
      return result;
    };

    const result = await quarantineValidatorResidue({
      projectRoot: repository,
      git: ghostGit,
      baseline,
      source: 'manual_test',
    });

    expect(result).toMatchObject({ kind: 'refused', reason: expect.any(String) });
    await expect(readFile(join(repository, report), 'utf8')).resolves.toBe('report\n');
    await expect(readFile(join(repository, second), 'utf8')).resolves.toBe('second\n');
    await expect(switchToChild(repository, child, noOpChildLifecycleEvents, undefined, { git })).resolves.toMatchObject(
      {
        kind: 'refused',
        reason: expect.stringContaining(report),
      },
    );
  });

  it('does nothing when the dispatch created only ignored pipeline output', async () => {
    const baseline = await listUntrackedPaths(git);
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline/manual-test-results.md'), 'ignored evidence\n');

    await expect(
      quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test' }),
    ).resolves.toEqual({ kind: 'none' });
    await expect(access(join(repository, '.pipeline/validator-residue'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

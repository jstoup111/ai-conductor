import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

import { switchToChild, noOpChildLifecycleEvents } from '../../src/engine/child-lifecycle.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import {
  captureValidatorResidueBaseline,
  listUntrackedPaths,
  quarantineValidatorResidue,
} from '../../src/engine/validator-residue.js';
import { parseChildId } from '../../src/engine/child-context.js';

// Covers: task:1
describe('validator residue quarantine', () => {
  let repository: string;
  let git: ReturnType<typeof makeGitRunner>;

  const runGit = async (args: string[]) => execa('git', args, { cwd: repository });
  const child = { child: parseChildId(1)!, position: parseChildId(1)!, branch: 'validator-child' };
  const refusalReport = 'docs/reports/manual-test-step17/report.html';
  const residueNow = new Date('2026-11-15T12:34:56.789Z');

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
    await rm(repository, { recursive: true, force: true });
  });

  it('moves only untracked files created after the baseline into a per-dispatch directory', async () => {
    const baseline = await listUntrackedPaths(git);
    const relativePath = 'docs/reports/manual-test-step17/report.html';
    const contents = '<html>report</html>\n';
    await mkdir(join(repository, 'docs/reports/manual-test-step17'), { recursive: true });
    await writeFile(join(repository, relativePath), contents);

    const result = await quarantineValidatorResidue({
      projectRoot: repository,
      git,
      baseline,
      source: 'manual_test',
      now: residueNow,
    });

    expect(result).toEqual({
      kind: 'moved',
      paths: [relativePath],
      directory: '.pipeline/validator-residue/manual_test-2026-11-15T12-34-56.789Z',
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

    const result = await quarantineValidatorResidue({
      projectRoot: repository,
      git,
      baseline,
      source: 'manual_test',
      now: residueNow,
    });

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

  it('leaves baseline files in place when Git later reports their directory as an untracked nested repository', async () => {
    await mkdir(join(repository, 'existing'), { recursive: true });
    await writeFile(join(repository, 'existing/notes.txt'), 'already here\n');
    const baseline = await listUntrackedPaths(git);
    await runGit(['init', '-q', 'existing']);

    await expect(
      quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test', now: residueNow }),
    ).resolves.toEqual({ kind: 'none' });
    await expect(readFile(join(repository, 'existing/notes.txt'), 'utf8')).resolves.toBe('already here\n');
    await expect(switchToChild(repository, child, noOpChildLifecycleEvents, undefined, { git })).resolves.toMatchObject(
      {
        kind: 'refused',
        reason: expect.stringMatching(/^worktree is dirty:.*existing/),
      },
    );
  });

  it('leaves files beneath an opaque baseline nested repository in place after it becomes an ordinary directory', async () => {
    await mkdir(join(repository, 'existing'), { recursive: true });
    await writeFile(join(repository, 'existing/notes.txt'), 'already here\n');
    await runGit(['init', '-q', 'existing']);
    const baseline = await listUntrackedPaths(git);
    expect(baseline).toContain('existing/');
    await rm(join(repository, 'existing/.git'), { recursive: true });
    await mkdir(join(repository, 'docs/reports'), { recursive: true });
    await writeFile(join(repository, 'docs/reports/report.html'), 'new report\n');

    const result = await quarantineValidatorResidue({
      projectRoot: repository,
      git,
      baseline,
      source: 'manual_test',
      now: residueNow,
    });

    expect(result).toMatchObject({ kind: 'moved', paths: ['docs/reports/report.html'] });
    await expect(readFile(join(repository, 'existing/notes.txt'), 'utf8')).resolves.toBe('already here\n');
    if (result.kind !== 'moved') throw new Error('expected residue to move');
    await expect(readFile(join(repository, result.directory, 'docs/reports/report.html'), 'utf8')).resolves.toBe(
      'new report\n',
    );
  });

  it('quarantines a dangling symlink as a present untracked entry', async () => {
    const baseline = await listUntrackedPaths(git);
    await symlink('missing-target', join(repository, 'dangling-link'));
    await mkdir(join(repository, 'docs/reports'), { recursive: true });
    await writeFile(join(repository, 'docs/reports/report.html'), 'new report\n');

    const result = await quarantineValidatorResidue({
      projectRoot: repository,
      git,
      baseline,
      source: 'manual_test',
      now: residueNow,
    });

    expect(result).toMatchObject({ kind: 'moved', paths: ['dangling-link', 'docs/reports/report.html'] });
    if (result.kind !== 'moved') throw new Error('expected residue to move');
    const quarantinedLink = join(repository, result.directory, 'dangling-link');
    const linkStats = await lstat(quarantinedLink);
    expect(linkStats.isSymbolicLink()).toBe(true);
    await expect(readlink(quarantinedLink)).resolves.toBe('missing-target');
  });

  it('ignores the old-path field of a staged rename while listing new residue', async () => {
    await writeFile(join(repository, 'old.txt'), 'old\n');
    await runGit(['add', 'old.txt']);
    await runGit(['commit', '-qm', 'add old']);
    await runGit(['mv', 'old.txt', 'renamed.txt']);
    const baseline = await listUntrackedPaths(git);
    await mkdir(join(repository, 'docs/reports'), { recursive: true });
    await writeFile(join(repository, 'docs/reports/report.html'), 'report\n');

    await expect(
      quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test', now: residueNow }),
    ).resolves.toMatchObject({ kind: 'moved', paths: ['docs/reports/report.html'] });
    await expect(git(['status', '--porcelain'])).resolves.toMatchObject({ stdout: 'R  old.txt -> renamed.txt' });
  });

  it('confirms glob-shaped untracked names literally', async () => {
    const baseline = await listUntrackedPaths(git);
    await mkdir(join(repository, 'docs/reports'), { recursive: true });
    await writeFile(join(repository, 'docs/reports/report[1].html'), 'bracket\n');
    await writeFile(join(repository, 'docs/reports/report1.html'), 'plain\n');

    const result = await quarantineValidatorResidue({
      projectRoot: repository,
      git,
      baseline,
      source: 'manual_test',
      now: residueNow,
    });

    expect(result).toMatchObject({
      kind: 'moved',
      paths: ['docs/reports/report1.html', 'docs/reports/report[1].html'],
    });
  });

  it('rolls back earlier moves when a later source directory cannot be renamed', async () => {
    const baseline = await listUntrackedPaths(git);
    await writeFile(join(repository, 'a-first.txt'), 'first\n');
    await mkdir(join(repository, 'z-locked'), { recursive: true });
    await writeFile(join(repository, 'z-locked', 'second.txt'), 'second\n');
    await chmod(join(repository, 'z-locked'), 0o500);

    try {
      await expect(
        quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test', now: residueNow }),
      ).resolves.toMatchObject({ kind: 'refused', reason: expect.any(String) });
      await expect(readFile(join(repository, 'a-first.txt'), 'utf8')).resolves.toBe('first\n');
      await expect(readFile(join(repository, 'z-locked', 'second.txt'), 'utf8')).resolves.toBe('second\n');
    } finally {
      await chmod(join(repository, 'z-locked'), 0o700);
    }
  });

  it.each([
    {
      name: 'a destination already exists',
      setup: async () => {
        await mkdir(
          join(
            repository,
            '.pipeline/validator-residue/manual_test-2026-11-15T12-34-56.789Z/docs/reports/manual-test-step17',
          ),
          { recursive: true },
        );
        await writeFile(
          join(repository, '.pipeline/validator-residue/manual_test-2026-11-15T12-34-56.789Z', refusalReport),
          'existing\n',
        );
        return git;
      },
    },
    {
      name: 'the validator residue root is a regular file',
      setup: async () => {
        await mkdir(join(repository, '.pipeline'), { recursive: true });
        await writeFile(join(repository, '.pipeline/validator-residue'), 'not a directory\n');
        return git;
      },
    },
    {
      name: 'Git reports a newly untracked path that vanished',
      setup: async () => {
        const ghostGit: GitRunner = async (args, options) => {
          const result = await git(args, options);
          if (args[0] === 'ls-files') return { ...result, stdout: `${result.stdout}ghost.txt\0` };
          return result;
        };
        return ghostGit;
      },
    },
  ])('refuses every move when $name', async ({ setup }) => {
    const report = refusalReport;
    const second = 'docs/reports/manual-test-step17/second.html';
    const baseline = await listUntrackedPaths(git);
    await mkdir(join(repository, 'docs/reports/manual-test-step17'), { recursive: true });
    await writeFile(join(repository, report), 'report\n');
    await writeFile(join(repository, second), 'second\n');
    const runner = await setup();

    const result = await quarantineValidatorResidue({
      projectRoot: repository,
      git: runner,
      baseline,
      source: 'manual_test',
      now: residueNow,
    });

    expect(result).toMatchObject({ kind: 'refused', reason: expect.any(String) });
    if (result.kind !== 'refused') throw new Error('expected residue refusal');
    expect(result.reason).not.toBe('');
    await expect(readFile(join(repository, report), 'utf8')).resolves.toBe('report\n');
    await expect(readFile(join(repository, second), 'utf8')).resolves.toBe('second\n');
    await expect(switchToChild(repository, child, noOpChildLifecycleEvents, undefined, { git })).resolves.toMatchObject(
      {
        kind: 'refused',
        reason: expect.stringMatching(new RegExp(`^worktree is dirty:.*${report}`)),
      },
    );
  });

  it('does nothing when the dispatch created only ignored pipeline output', async () => {
    const baseline = await listUntrackedPaths(git);
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline/manual-test-results.md'), 'ignored evidence\n');

    await expect(
      quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'manual_test', now: residueNow }),
    ).resolves.toEqual({ kind: 'none' });
    await expect(access(join(repository, '.pipeline/validator-residue'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to quarantine pipeline evidence when the worktree forgot to ignore it', async () => {
    const baseline = await listUntrackedPaths(git);
    await writeFile(join(repository, '.gitignore'), '');
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline/prd-audit.json'), '{"complete":true}\n');

    await expect(
      quarantineValidatorResidue({ projectRoot: repository, git, baseline, source: 'prd_audit', now: residueNow }),
    ).resolves.toMatchObject({ kind: 'refused', reason: expect.any(String) });
    await expect(readFile(join(repository, '.pipeline/prd-audit.json'), 'utf8')).resolves.toBe('{"complete":true}\n');
    await expect(switchToChild(repository, child, noOpChildLifecycleEvents, undefined, { git })).resolves.toMatchObject(
      {
        kind: 'refused',
        reason: expect.stringMatching(/^worktree is dirty:.*\.pipeline\/prd-audit\.json/),
      },
    );
  });

  it('reports an unavailable baseline inspection without throwing into the validation flow', async () => {
    const unavailable: GitRunner = async () => ({ exitCode: 128, stdout: '', stderr: 'not a git repository' });

    await expect(captureValidatorResidueBaseline(unavailable)).resolves.toEqual({
      kind: 'refused',
      reason: 'cannot inspect untracked worktree paths',
    });
  });
});

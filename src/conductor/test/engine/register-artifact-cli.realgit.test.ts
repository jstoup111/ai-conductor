// Covers: task:19
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { dispatchRegisterArtifactCommand } from '../../src/engine/register-artifact-cli.js';
import { parseFeatureManifest } from '../../src/engine/feature-manifest.js';
import { writeGitHooksAndWire } from '../../src/engine/worktree-prepare.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'register-artifact-realgit-'));
  roots.push(root);
  const worktree = join(root, '.worktrees', 'f');
  const manifestPath = join(worktree, '.docs', 'f', 'manifest.json');
  const sealPath = join(worktree, '.pipeline', 'protected-artifact-seal.json');
  await mkdir(worktree, { recursive: true });
  await initTestRepo(worktree);

  await Promise.all([
    mkdir(dirname(manifestPath), { recursive: true }),
    mkdir(join(worktree, '.docs', 'plans'), { recursive: true }),
    mkdir(join(worktree, '.docs', 'stories'), { recursive: true }),
    mkdir(dirname(sealPath), { recursive: true }),
  ]);
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    slug: 'f',
    artifacts: [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'stories', path: '.docs/stories/f.md' },
    ],
  }, null, 2));
  await writeFile(join(worktree, '.docs', 'plans', 'f.md'), '# Plan\n');
  await writeFile(join(worktree, '.docs', 'stories', 'f.md'), '# Stories\n');
  await writeFile(sealPath, '{"protectedArtifacts":[]}\n');
  await execa('git', ['add', '-A'], { cwd: worktree });
  await execa('git', ['commit', '-m', 'base'], { cwd: worktree });
  await writeFile(join(worktree, '.docs', 'stories', 'extra.md'), '# Extra stories\n');
  await writeGitHooksAndWire(worktree);

  return { root, worktree, manifestPath, sealPath };
}

async function register(root: string): Promise<{ code: number; errors: string[] }> {
  const errors: string[] = [];
  const code = await dispatchRegisterArtifactCommand({
    slug: 'f',
    artifactKind: 'stories',
    path: '.docs/stories/extra.md',
    reason: 'split story file',
    clearHalt: false,
  }, { cwd: root, err: (line) => errors.push(line) });
  return { code, errors };
}

describe('register-artifact commit (real local Git)', () => {
  it('commits the new artifact and canonical manifest through the installed hook', async () => {
    const subject = await fixture();
    const before = (await execa('git', ['rev-parse', 'HEAD'], { cwd: subject.worktree })).stdout;

    await expect(register(subject.root)).resolves.toEqual({ code: 0, errors: [] });

    const manifest = parseFeatureManifest(await readFile(subject.manifestPath, 'utf8'), '.docs/f/manifest.json', 'f');
    expect(manifest).toMatchObject({
      kind: 'parsed',
      manifest: {
        artifacts: [
          { kind: 'plan', path: '.docs/plans/f.md' },
          { kind: 'stories', path: '.docs/stories/extra.md' },
          { kind: 'stories', path: '.docs/stories/f.md' },
        ],
      },
    });
    await expect(execa('git', ['rev-list', '--count', `${before}..HEAD`], { cwd: subject.worktree }))
      .resolves.toMatchObject({ stdout: '1' });
    const changedPaths = (await execa('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
      cwd: subject.worktree,
    })).stdout.trim().split('\n');
    expect(changedPaths).toEqual(['.docs/f/manifest.json', '.docs/stories/extra.md']);
  });

  it('restores the manifest and leaves the seal untouched when its engine commit fails', async () => {
    const subject = await fixture();
    const manifestBefore = await readFile(subject.manifestPath);
    const sealBefore = await readFile(subject.sealPath);
    const headBefore = (await execa('git', ['rev-parse', 'HEAD'], { cwd: subject.worktree })).stdout;
    const postCommitHook = join(subject.worktree, '.pipeline', 'git-hooks', 'post-commit');
    await writeFile(postCommitHook, '#!/bin/sh\nexit 1\n');
    await chmod(postCommitHook, 0o755);

    await expect(register(subject.root)).resolves.toMatchObject({ code: 1 });

    await expect(readFile(subject.manifestPath)).resolves.toEqual(manifestBefore);
    await expect(readFile(subject.sealPath)).resolves.toEqual(sealBefore);
    await expect(execa('git', ['rev-parse', 'HEAD'], { cwd: subject.worktree }))
      .resolves.toMatchObject({ stdout: headBefore });
  });

  it('does not rewind an intervening commit after a post-commit failure', async () => {
    const subject = await fixture();
    const manifestBefore = await readFile(subject.manifestPath);
    const sealBefore = await readFile(subject.sealPath);
    const headBefore = (await execa('git', ['rev-parse', 'HEAD'], { cwd: subject.worktree })).stdout;
    const postCommitHook = join(subject.worktree, '.pipeline', 'git-hooks', 'post-commit');
    await writeFile(postCommitHook, [
      '#!/bin/sh',
      'tree=$(git write-tree)',
      'commit=$(printf "concurrent\\n" | git commit-tree "$tree" -p HEAD^)',
      'git update-ref HEAD "$commit"',
      'exit 1',
      '',
    ].join('\n'));
    await chmod(postCommitHook, 0o755);

    await expect(register(subject.root)).resolves.toMatchObject({ code: 1 });

    await expect(readFile(subject.manifestPath)).resolves.toEqual(manifestBefore);
    await expect(readFile(subject.sealPath)).resolves.toEqual(sealBefore);
    await expect(execa('git', ['rev-parse', 'HEAD'], { cwd: subject.worktree }))
      .resolves.not.toMatchObject({ stdout: headBefore });
  });
});

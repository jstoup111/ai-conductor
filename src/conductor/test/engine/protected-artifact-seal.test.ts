import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProtectedArtifactSeal,
  classifyMutationTarget,
  isActiveStepArtifactException,
  verifyProtectedArtifactSeal,
} from '../../src/engine/protected-artifact-seal.js';

const execFile = promisify(execFileCallback);
const scratches: string[] = [];

async function git(repo: string, args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd: repo });
  return result.stdout.trim();
}

async function writeProjectFile(repo: string, path: string, content: string): Promise<void> {
  const destination = join(repo, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function makeRepo(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'protected-artifact-seal-'));
  scratches.push(repo);
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test']);
  for (const [path, content] of Object.entries(files)) {
    await writeProjectFile(repo, path, content);
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-q', '-m', 'approved decide artifacts']);
  return repo;
}

afterEach(async () => {
  while (scratches.length > 0) await rm(scratches.pop()!, { recursive: true, force: true });
});

describe('createProtectedArtifactSeal', () => {
  it('persists committed product, architecture, story, and plan content under its approved baseline', async () => {
    const repo = await makeRepo({
      '.docs/specs/feature.md': 'approved prd\n',
      '.docs/architecture/feature.md': 'approved architecture\n',
      '.docs/stories/feature.md': 'approved stories\n',
      '.docs/plans/feature.md': 'approved plan\n',
      '.docs/notes/unprotected.md': 'not a decide artifact\n',
    });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    await writeProjectFile(repo, '.docs/specs/feature.md', 'mutated workspace copy\n');

    const seal = await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });

    expect(seal).toEqual({
      version: 1,
      baselineCommit,
      protectedArtifacts: [
        {
          path: '.docs/architecture/feature.md',
          fingerprint: `sha256:${createHash('sha256').update('approved architecture\n').digest('hex')}`,
        },
        {
          path: '.docs/plans/feature.md',
          fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
        },
        {
          path: '.docs/specs/feature.md',
          fingerprint: `sha256:${createHash('sha256').update('approved prd\n').digest('hex')}`,
        },
        {
          path: '.docs/stories/feature.md',
          fingerprint: `sha256:${createHash('sha256').update('approved stories\n').digest('hex')}`,
        },
      ],
    });
    await expect(readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(seal, null, 2)}\n`,
    );
  });

  it('reuses the original durable baseline instead of resealing a later commit', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    const originalCommit = await git(repo, ['rev-parse', 'HEAD']);
    const original = await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: originalCommit });
    await writeProjectFile(repo, '.docs/plans/feature.md', 'later committed plan\n');
    await git(repo, ['add', '.docs/plans/feature.md']);
    await git(repo, ['commit', '-q', '-m', 'later decide mutation']);

    await expect(
      createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: await git(repo, ['rev-parse', 'HEAD']) }),
    ).resolves.toEqual(original);
  });
});

describe('verifyProtectedArtifactSeal', () => {
  it('rejects a changed protected artifact against the durable original seal', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await writeProjectFile(repo, '.docs/plans/feature.md', 'dirty replacement\n');

    await expect(verifyProtectedArtifactSeal({ projectRoot: repo })).resolves.toEqual({
      ok: false,
      reason: 'Protected artifact changed: .docs/plans/feature.md',
    });
  });

  it.each([
    ['deleted', async (repo: string) => rm(join(repo, '.docs/plans/feature.md')),
      'Protected artifact deleted: .docs/plans/feature.md'],
    ['recreated', async (repo: string) => {
      await rm(join(repo, '.docs/plans/feature.md'));
      await writeProjectFile(repo, '.docs/plans/feature.md', 'recreated plan\n');
    }, 'Protected artifact changed: .docs/plans/feature.md'],
    ['new', async (repo: string) => writeProjectFile(repo, '.docs/plans/new.md', 'new plan\n'),
      'Protected artifact added: .docs/plans/new.md'],
  ])('rejects a %s protected artifact without refreshing the seal', async (_kind, mutate, reason) => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });

    await mutate(repo);

    await expect(verifyProtectedArtifactSeal({ projectRoot: repo })).resolves.toEqual({ ok: false, reason });
  });
});

describe('isActiveStepArtifactException', () => {
  it('permits only a protected target under the exact active step prefix', () => {
    expect(
      isActiveStepArtifactException({
        phase: 'SHIP',
        step: 'retro',
        target: '.docs/stories/retro-907.md',
      }),
    ).toBe(true);
  });

  it('rejects a sibling path that merely resembles the active step prefix', () => {
    expect(
      isActiveStepArtifactException({
        phase: 'SHIP',
        step: 'retro',
        target: '.docs/stories-unrelated/retro-907.md',
      }),
    ).toBe(false);
  });

  it('does not let a later step reuse a prior step protected-artifact permission', () => {
    expect(
      isActiveStepArtifactException({
        phase: 'SHIP',
        step: 'manual_test',
        target: '.docs/stories/retro-907.md',
      }),
    ).toBe(false);
  });
});

describe('classifyMutationTarget', () => {
  const projectRoot = '/workspace/feature-907';

  it.each([
    ['known unprotected', 'src/conductor.ts', 'BUILD', 'build', {
      kind: 'unprotected', target: 'src/conductor.ts',
    }],
    ['exact allowed', '.docs/stories/retro-907.md', 'SHIP', 'retro', {
      kind: 'allowed', target: '.docs/stories/retro-907.md',
    }],
    ['protected', '.docs/plans/frozen.md', 'BUILD', 'build', {
      kind: 'protected', target: '.docs/plans/frozen.md',
    }],
    ['canonical in-workspace', '/workspace/feature-907/src/./conductor.ts', 'BUILD', 'build', {
      kind: 'unprotected', target: 'src/conductor.ts',
    }],
  ] as const)('classifies a %s target', (_name, target, phase, step, expected) => {
    expect(classifyMutationTarget({ projectRoot, target, phase, step })).toEqual(expected);
  });
});

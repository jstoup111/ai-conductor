import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
  it('returns an empty self-amendment list for a clean workspace', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });

    await expect(verifyProtectedArtifactSeal({ projectRoot: repo })).resolves.toEqual(expect.objectContaining({
      ok: true,
      selfAmendments: [],
    }));
  });

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

  describe('own-feature self-amendment durable reporting behavior', () => {
    it('tolerates a feature changing its own protected artifact when featureDesc matches', async () => {
      const repo = await makeRepo({ '.docs/architecture/feature.md': 'approved architecture\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/architecture/feature.md', 'self-amended architecture\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature' }),
      ).resolves.toEqual(expect.objectContaining({
        ok: true,
        selfAmendments: [{
          path: '.docs/architecture/feature.md',
          sealedFingerprint: `sha256:${createHash('sha256').update('approved architecture\n').digest('hex')}`,
          currentFingerprint: `sha256:${createHash('sha256').update('self-amended architecture\n').digest('hex')}`,
        }],
      }));
    });

    it('tolerates the match across a dated-vs-undated stem, mirroring #1024', async () => {
      const repo = await makeRepo({
        '.docs/architecture/2026-07-27-widget.md': 'approved architecture\n',
      });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/architecture/2026-07-27-widget.md', 'self-amended architecture\n');

      // featureDesc carries no date prefix; artifact stem does — still the same feature.
      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'widget' }),
      ).resolves.toEqual(expect.objectContaining({
        ok: true,
        selfAmendments: [{
          path: '.docs/architecture/2026-07-27-widget.md',
          sealedFingerprint: `sha256:${createHash('sha256').update('approved architecture\n').digest('hex')}`,
          currentFingerprint: `sha256:${createHash('sha256').update('self-amended architecture\n').digest('hex')}`,
        }],
      }));
    });

    it('reports no self-amendment when its changed artifact exactly matches the base tip', async () => {
      const repo = await makeRepo({ '.docs/architecture/feature.md': 'approved architecture\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/architecture/feature.md', 'base-tip architecture\n');
      await git(repo, ['add', '.docs/architecture/feature.md']);
      await git(repo, ['commit', '-q', '-m', 'base updates architecture']);

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature', baseBranch: 'main' }),
      ).resolves.toEqual(expect.objectContaining({ ok: true, selfAmendments: [] }));
    });

    it('reports only its own tolerated amendment when base-tip content also matches', async () => {
      const repo = await makeRepo({
        '.docs/architecture/feature.md': 'approved architecture\n',
        '.docs/plans/feature.md': 'approved plan\n',
      });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/architecture/feature.md', 'base-tip architecture\n');
      await git(repo, ['add', '.docs/architecture/feature.md']);
      await git(repo, ['commit', '-q', '-m', 'base updates architecture']);
      await writeProjectFile(repo, '.docs/plans/feature.md', 'self-amended plan\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature', baseBranch: 'main' }),
      ).resolves.toMatchObject({
        ok: true,
        selfAmendments: [{
          path: '.docs/plans/feature.md',
          sealedFingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
          currentFingerprint: `sha256:${createHash('sha256').update('self-amended plan\n').digest('hex')}`,
        }],
      });
    });

    it('still rejects a changed artifact belonging to a DIFFERENT feature', async () => {
      const repo = await makeRepo({ '.docs/architecture/feature.md': 'approved architecture\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/architecture/feature.md', 'tampered by someone else\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'unrelated-other-feature' }),
      ).resolves.toEqual({ ok: false, reason: 'Protected artifact changed: .docs/architecture/feature.md' });
    });

    it('still rejects an ADDED artifact even when it names the current feature', async () => {
      const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/architecture/feature.md', 'unexpected new architecture doc\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature' }),
      ).resolves.toEqual({ ok: false, reason: 'Protected artifact added: .docs/architecture/feature.md' });
    });

    it('still rejects a DELETED artifact even when it names the current feature', async () => {
      const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await rm(join(repo, '.docs/plans/feature.md'));

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature' }),
      ).resolves.toEqual({ ok: false, reason: 'Protected artifact deleted: .docs/plans/feature.md' });
    });
  });

  // #976 base-inheritance tolerance. A feature's seal baseline goes stale the
  // moment ANOTHER feature's PR merges to the base branch and this feature
  // rebases onto it. `advanceBase` models exactly that post-rebase state: the
  // base branch tip carries the new content, and the workspace matches it.
  describe('base-branch inheritance tolerance', () => {
    async function advanceBase(
      repo: string,
      files: Record<string, string>,
    ): Promise<void> {
      for (const [path, content] of Object.entries(files)) {
        await writeProjectFile(repo, path, content);
      }
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-q', '-m', "another feature's merged PR"]);
    }

    it("tolerates ANOTHER feature's artifact changed to exactly the base branch tip", async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await advanceBase(repo, { '.docs/plans/other-feature.md': 'amended by its owner\n' });

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("tolerates ANOTHER feature's artifact ADDED by the base branch tip", async () => {
      const repo = await makeRepo({ '.docs/plans/mine.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await advanceBase(repo, { '.docs/plans/other-feature.md': 'a newly merged plan\n' });

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: true });
    });

    it('STILL HALTS when the content does not match the base branch tip', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await advanceBase(repo, { '.docs/plans/other-feature.md': 'amended by its owner\n' });
      // An in-worktree mutation ON TOP of the inherited content: the base branch
      // does not vouch for this, so tamper detection must still fire.
      await writeProjectFile(repo, '.docs/plans/other-feature.md', 'tampered by the build agent\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact changed: .docs/plans/other-feature.md',
      });
    });

    it('STILL HALTS on an ADDED artifact the base branch does not contain', async () => {
      const repo = await makeRepo({ '.docs/plans/mine.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/plans/invented.md', 'authored in-worktree\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact added: .docs/plans/invented.md',
      });
    });

    it('applies NO tolerance when no baseBranch is supplied (prior behavior)', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await advanceBase(repo, { '.docs/plans/other-feature.md': 'amended by its owner\n' });

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact changed: .docs/plans/other-feature.md',
      });
    });

    it('applies NO tolerance when the base branch ref does not exist', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await advanceBase(repo, { '.docs/plans/other-feature.md': 'amended by its owner\n' });

      await expect(
        verifyProtectedArtifactSeal({
          projectRoot: repo,
          featureDesc: 'mine',
          baseBranch: 'no-such-branch',
        }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact changed: .docs/plans/other-feature.md',
      });
    });

    it('still HALTS on a deletion even when the base branch tip also lacks the file', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await rm(join(repo, '.docs/plans/other-feature.md'));
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-q', '-m', 'base removes the plan']);

      // Deliberately out of scope for this fix — see the follow-up intake.
      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact deleted: .docs/plans/other-feature.md',
      });
    });
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

  it.each([
    ['missing', undefined],
    ['malformed', ''],
    ['dynamic', '$WORKSPACE/.docs/plans/frozen.md'],
    ['outside workspace', '/workspace/another-feature/.docs/plans/frozen.md'],
    ['traversal', '.docs/plans/../plans/frozen.md'],
  ])('fails closed for a %s target', (_name, target) => {
    expect(classifyMutationTarget({
      projectRoot,
      target,
      phase: 'BUILD',
      step: 'build',
    })).toMatchObject({ kind: 'indeterminate' });
  });
});

describe('verifyProtectedArtifactSeal target containment', () => {
  it('fails closed when a protected artifact is replaced by a symlink outside the workspace', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    const outside = join(await mkdtemp(join(tmpdir(), 'protected-artifact-outside-')), 'replacement.md');
    scratches.push(dirname(outside));
    await writeFile(outside, 'approved plan\n');
    await rm(join(repo, '.docs/plans/feature.md'));
    await symlink(outside, join(repo, '.docs/plans/feature.md'));

    await expect(verifyProtectedArtifactSeal({ projectRoot: repo })).resolves.toMatchObject({
      ok: false,
      reason: 'Indeterminate protected artifact target: .docs/plans/feature.md',
    });
  });
});

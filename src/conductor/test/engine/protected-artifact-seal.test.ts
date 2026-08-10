import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROTECTED_ARTIFACT_DIRECTORIES,
  createProtectedArtifactSeal,
  createScopedProtectedArtifactSeal,
  classifyMutationTarget,
  evaluateProtectedArtifactSealRotation,
  evaluateProtectedArtifactSealRotationInRepository,
  isActiveStepArtifactException,
  isProtectedArtifactPath,
  namesOwnFeature,
  resealProtectedArtifactSeal,
  rotateProtectedArtifactSeal,
  verifyProtectedArtifactSeal,
} from '../../src/engine/protected-artifact-seal.js';

const { gitInvocations, failGitDiff } = vi.hoisted(() => ({
  gitInvocations: [] as string[][],
  failGitDiff: { value: false },
}));

vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    execa: (...args: Parameters<typeof actual.execa>) => {
      if (args[0] === 'git' && Array.isArray(args[1])) gitInvocations.push(args[1]);
      if (args[0] === 'git' && Array.isArray(args[1]) && args[1][0] === 'diff' && failGitDiff.value) {
        return Promise.resolve({
          exitCode: 2,
          stdout: '',
          stderr: 'forced git diff probe failure',
        }) as unknown as ReturnType<typeof actual.execa>;
      }
      return actual.execa(...args);
    },
  };
});

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
  failGitDiff.value = false;
  while (scratches.length > 0) await rm(scratches.pop()!, { recursive: true, force: true });
});

it('exports protected artifact directory and feature-name helpers', () => {
  expect({ PROTECTED_ARTIFACT_DIRECTORIES, namesOwnFeature }).toEqual({
    PROTECTED_ARTIFACT_DIRECTORIES: ['.docs/architecture', '.docs/decisions', '.docs/plans', '.docs/specs', '.docs/stories'],
    namesOwnFeature: expect.any(Function),
  });
});

it('classifies decision records as protected wherever protected artifacts are selected', () => {
  const path = '.docs/decisions/adr-x.md';

  expect(isProtectedArtifactPath(path)).toBe(true);
  expect(classifyMutationTarget({
    projectRoot: '/workspace/feature-907',
    target: path,
    phase: 'BUILD',
    step: 'build',
  })).toEqual({ kind: 'protected', target: path });
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
      version: 2,
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
      rebaselines: [],
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

  it('normalizes v1 seals to v2 in memory while preserving the invalid-seal error contract', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
    const v1Seal = {
      version: 1,
      baselineCommit,
      protectedArtifacts: [{
        path: '.docs/plans/feature.md',
        fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
      }],
    };
    await mkdir(dirname(sealPath), { recursive: true });
    await writeFile(sealPath, `${JSON.stringify(v1Seal)}\n`);
    const normalized = await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });
    await writeFile(sealPath, '{"version":1}\n');
    const invalid = await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit })
      .then(() => 'resolved', (error: Error) => error.message);

    expect({ normalized, invalid }).toEqual({
      normalized: { ...v1Seal, version: 2, rebaselines: [] },
      invalid: 'Protected artifact seal is invalid',
    });
  });
});

describe('createScopedProtectedArtifactSeal', () => {
  it('re-fingerprints only the enumerated protected artifact at the target commit', async () => {
    const repo = await makeRepo({
      '.docs/plans/p1.md': 'incorrect plan\n',
      '.docs/plans/p2.md': 'sealed plan two\n',
      '.docs/plans/p3.md': 'sealed plan three\n',
    });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    const seal = {
      version: 2 as const,
      baselineCommit,
      protectedArtifacts: [
        {
          path: '.docs/plans/p1.md',
          fingerprint: `sha256:${createHash('sha256').update('incorrect plan\n').digest('hex')}`,
        },
        { path: '.docs/plans/p2.md', fingerprint: 'sha256:sealed-p2' },
        { path: '.docs/plans/p3.md', fingerprint: 'sha256:sealed-p3' },
      ],
      rebaselines: [],
    };
    await writeProjectFile(repo, '.docs/plans/p1.md', 'corrected plan\n');
    await git(repo, ['add', '.docs/plans/p1.md']);
    await git(repo, ['commit', '-q', '-m', 'correct protected plan']);
    const toCommit = await git(repo, ['rev-parse', 'HEAD']);

    await expect(createScopedProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit,
      paths: ['.docs/plans/p1.md'],
    })).resolves.toEqual({
      ...seal,
      protectedArtifacts: [
        {
          path: '.docs/plans/p1.md',
          fingerprint: `sha256:${createHash('sha256').update('corrected plan\n').digest('hex')}`,
        },
        seal.protectedArtifacts[1],
        seal.protectedArtifacts[2],
      ],
    });
  });

  it.each([
    ['an empty path set', [], undefined, 'Scoped protected artifact reseal requires at least one path'],
    ['a path absent from the seal', ['.docs/plans/missing.md'], undefined,
      'Protected artifact reseal target is not sealed: .docs/plans/missing.md'],
    ['a path outside the protected directories', ['README.md'], undefined,
      'Protected artifact reseal target is not protected: README.md'],
    ['a path with uncommitted changes', ['.docs/plans/p1.md'], async (repo: string) => {
      await writeProjectFile(repo, '.docs/plans/p1.md', 'dirty correction\n');
    }, 'Protected artifact reseal target has uncommitted changes: .docs/plans/p1.md\nCommit the protected artifact before resealing.'],
    ['a deleted path', ['.docs/plans/p1.md'], async (repo: string) => {
      await rm(join(repo, '.docs/plans/p1.md'));
    }, 'Protected artifact reseal target is deleted: .docs/plans/p1.md'],
    ['an unresolvable target commit', ['.docs/plans/p1.md'], undefined,
      'Protected artifact reseal target commit is unresolvable: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
  ] as const)('refuses %s without changing the seal', async (_name, paths, mutate, message) => {
    const repo = await makeRepo({ '.docs/plans/p1.md': 'approved plan\n' });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    const seal = {
      version: 2 as const,
      baselineCommit,
      protectedArtifacts: [{
        path: '.docs/plans/p1.md',
        fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
      }],
      rebaselines: [],
    };
    const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
    const originalBytes = `${JSON.stringify(seal, null, 2)}\n`;
    await mkdir(dirname(sealPath), { recursive: true });
    await writeFile(sealPath, originalBytes);
    await mutate?.(repo);

    const rejection = await createScopedProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit: _name === 'an unresolvable target commit'
        ? 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
        : baselineCommit,
      paths: [...paths],
    }).then(() => 'resolved', (error: Error) => error.message);

    expect({
      rejection,
      persistedBytes: await readFile(sealPath, 'utf8'),
      seal,
    }).toEqual({
      rejection: message,
      persistedBytes: originalBytes,
      seal: JSON.parse(originalBytes),
    });
  });

  it('advances the baseline, records scoped lineage, and verifies every sealed entry', async () => {
    const repo = await makeRepo({
      '.docs/plans/p1.md': 'incorrect plan\n',
      '.docs/plans/p2.md': 'approved plan two\n',
    });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    const seal = {
      version: 2 as const,
      baselineCommit,
      protectedArtifacts: [
        {
          path: '.docs/plans/p1.md',
          fingerprint: `sha256:${createHash('sha256').update('incorrect plan\n').digest('hex')}`,
        },
        {
          path: '.docs/plans/p2.md',
          fingerprint: `sha256:${createHash('sha256').update('approved plan two\n').digest('hex')}`,
        },
      ],
      rebaselines: [],
    };
    const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
    await mkdir(dirname(sealPath), { recursive: true });
    await writeFile(sealPath, `${JSON.stringify(seal, null, 2)}\n`);
    await writeProjectFile(repo, '.docs/plans/p1.md', 'corrected plan\n');
    await git(repo, ['add', '.docs/plans/p1.md']);
    await git(repo, ['commit', '-q', '-m', 'correct protected plan']);
    const toCommit = await git(repo, ['rev-parse', 'HEAD']);

    const resealed = await resealProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit,
      trigger: 'operator-reseal',
      paths: ['.docs/plans/p1.md'],
    });
    const persisted = JSON.parse(await readFile(sealPath, 'utf8'));
    const verification = await verifyProtectedArtifactSeal({ projectRoot: repo });

    expect({ resealed, persisted, verification }).toEqual({
      resealed: {
        version: 2,
        baselineCommit: toCommit,
        protectedArtifacts: [
          {
            path: '.docs/plans/p1.md',
            fingerprint: `sha256:${createHash('sha256').update('corrected plan\n').digest('hex')}`,
          },
          seal.protectedArtifacts[1],
        ],
        rebaselines: [{
          fromCommit: baselineCommit,
          toCommit,
          trigger: 'operator-reseal',
          paths: ['.docs/plans/p1.md'],
        }],
      },
      persisted: resealed,
      verification: {
        ok: true,
        seal: resealed,
        selfAmendments: [],
      },
    });
  });

  it('permits only the enumerated artifact to differ', async () => {
    const repo = await makeRepo({
      '.docs/plans/p1.md': 'incorrect plan\n',
      '.docs/plans/p2.md': 'approved plan two\n',
    });
    const seal = await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await writeProjectFile(repo, '.docs/plans/p1.md', 'corrected plan\n');
    await git(repo, ['add', '.docs/plans/p1.md']);
    await git(repo, ['commit', '-q', '-m', 'correct protected plan']);

    const resealed = await resealProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit: await git(repo, ['rev-parse', 'HEAD']),
      trigger: 'operator-reseal',
      paths: ['.docs/plans/p1.md'],
    });

    expect(resealed.protectedArtifacts).toEqual([
      {
        path: '.docs/plans/p1.md',
        fingerprint: `sha256:${createHash('sha256').update('corrected plan\n').digest('hex')}`,
      },
      seal.protectedArtifacts[1],
    ]);
  });

  it('permits an unlisted artifact inherited from the base tip without replacing its seal entry', async () => {
    const repo = await makeRepo({
      '.docs/plans/p1.md': 'incorrect plan\n',
      '.docs/plans/p2.md': 'approved plan two\n',
    });
    const seal = await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await git(repo, ['checkout', '-q', '-b', 'feature']);
    await git(repo, ['checkout', '-q', 'main']);
    await writeProjectFile(repo, '.docs/plans/p2.md', 'base-tip plan two\n');
    await git(repo, ['add', '.docs/plans/p2.md']);
    await git(repo, ['commit', '-q', '-m', 'base updates plan two']);
    await git(repo, ['checkout', '-q', 'feature']);
    await writeProjectFile(repo, '.docs/plans/p1.md', 'corrected plan\n');
    await writeProjectFile(repo, '.docs/plans/p2.md', 'base-tip plan two\n');
    await git(repo, ['add', '.docs']);
    await git(repo, ['commit', '-q', '-m', 'rebase inherited plan and correct p1']);
    gitInvocations.length = 0;

    const resealed = await resealProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit: await git(repo, ['rev-parse', 'HEAD']),
      trigger: 'operator-reseal',
      paths: ['.docs/plans/p1.md'],
      baseBranch: 'main',
    });

    expect({
      protectedArtifacts: resealed.protectedArtifacts,
      gitInvocations,
    }).toEqual({
      protectedArtifacts: [
        {
          path: '.docs/plans/p1.md',
          fingerprint: `sha256:${createHash('sha256').update('corrected plan\n').digest('hex')}`,
        },
        seal.protectedArtifacts[1],
      ],
      gitInvocations: expect.arrayContaining([
        ['show', 'main:.docs/plans/p2.md'],
      ]),
    });
  });

  it('permits a tolerated unlisted self-amendment without replacing its seal entry', async () => {
    const repo = await makeRepo({
      '.docs/plans/p1.md': 'incorrect plan\n',
      '.docs/plans/feature.md': 'approved feature plan\n',
    });
    const seal = await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await writeProjectFile(repo, '.docs/plans/p1.md', 'corrected plan\n');
    await writeProjectFile(repo, '.docs/plans/feature.md', 'self-amended feature plan\n');
    await git(repo, ['add', '.docs']);
    await git(repo, ['commit', '-q', '-m', 'correct p1 and amend feature plan']);

    const resealed = await resealProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit: await git(repo, ['rev-parse', 'HEAD']),
      trigger: 'operator-reseal',
      paths: ['.docs/plans/p1.md'],
      featureDesc: 'feature',
    });

    expect(resealed.protectedArtifacts).toEqual([
      seal.protectedArtifacts[0],
      {
        path: '.docs/plans/p1.md',
        fingerprint: `sha256:${createHash('sha256').update('corrected plan\n').digest('hex')}`,
      },
    ]);
  });
});

describe('evaluateProtectedArtifactSealRotation', () => {
  it('permits a non-ancestor rotation when every workspace and HEAD path is inherited from the base tip', () => {
    const deletedPath = '.docs/plans/deleted.md';
    const addedPath = '.docs/plans/added.md';
    const deletedBytes = Buffer.from('approved plan\n');
    const addedBytes = Buffer.from('base-added plan\n');
    const seal = {
      version: 2 as const,
      baselineCommit: 'sealed-head',
      protectedArtifacts: [{
        path: deletedPath,
        fingerprint: `sha256:${createHash('sha256').update(deletedBytes).digest('hex')}`,
      }],
      rebaselines: [],
    };

    const result = evaluateProtectedArtifactSealRotation({
      seal,
      baselineAncestry: 'non-ancestor',
      workspaceArtifacts: new Map([[addedPath, addedBytes]]),
      headArtifacts: new Map([[addedPath, addedBytes]]),
      baseTipArtifacts: new Map([[addedPath, addedBytes]]),
    });

    expect(result).toEqual({ permitted: true, paths: [addedPath, deletedPath] });
  });

  it('refuses each unresolved or unexplained rotation condition with its failing path', () => {
    const path = '.docs/plans/changed.md';
    const sealedBytes = Buffer.from('sealed\n');
    const workspaceBytes = Buffer.from('workspace\n');
    const headBytes = Buffer.from('head\n');
    const baseBytes = Buffer.from('base\n');
    const seal = {
      version: 2 as const,
      baselineCommit: 'sealed-head',
      protectedArtifacts: [{
        path,
        fingerprint: `sha256:${createHash('sha256').update(sealedBytes).digest('hex')}`,
      }],
      rebaselines: [],
    };
    const input = {
      seal,
      baselineAncestry: 'non-ancestor' as const,
      workspaceArtifacts: new Map([[path, workspaceBytes]]),
      headArtifacts: new Map([[path, workspaceBytes]]),
      baseTipArtifacts: new Map([[path, workspaceBytes]]),
    };

    expect([
      evaluateProtectedArtifactSealRotation({ ...input, baselineAncestry: 'unresolvable' }),
      evaluateProtectedArtifactSealRotation({ ...input, baselineAncestry: 'ancestor' }),
      evaluateProtectedArtifactSealRotation({ ...input, baseTipArtifacts: undefined }),
      evaluateProtectedArtifactSealRotation({ ...input, headArtifacts: new Map([[path, headBytes]]) }),
      evaluateProtectedArtifactSealRotation({ ...input, baseTipArtifacts: new Map([[path, baseBytes]]) }),
      evaluateProtectedArtifactSealRotation({
        ...input,
        workspaceArtifacts: new Map(),
        headArtifacts: new Map([[path, headBytes]]),
        baseTipArtifacts: new Map([[path, headBytes]]),
      }),
    ]).toEqual([
      { permitted: false, condition: 'baseline-unresolvable' },
      { permitted: false, condition: 'same-history-ancestor' },
      { permitted: false, condition: 'base-tip-unresolved' },
      { permitted: false, condition: 'workspace-differs-from-head', path },
      { permitted: false, condition: 'head-differs-from-base', path },
      { permitted: false, condition: 'workspace-differs-from-head', path },
    ]);
  });

  it('fails closed distinctly when the sealed baseline object cannot resolve', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    const seal = {
      version: 2 as const,
      baselineCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      protectedArtifacts: [{
        path: '.docs/plans/feature.md',
        fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
      }],
      rebaselines: [],
    };

    await expect(evaluateProtectedArtifactSealRotationInRepository({
      projectRoot: repo,
      seal,
      headCommit: await git(repo, ['rev-parse', 'HEAD']),
      baseTipRef: 'main',
    })).resolves.toEqual({ permitted: false, condition: 'baseline-unresolvable' });
  });
});

describe('rotateProtectedArtifactSeal', () => {
  it('pins the persisted snapshot and notification produced by a permitted rotation', async () => {
    const repo = await makeRepo({
      '.docs/plans/feature.md': 'approved plan\n',
      '.docs/specs/feature.md': 'approved prd\n',
    });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    const seal = {
      version: 2 as const,
      baselineCommit,
      protectedArtifacts: [{
        path: '.docs/plans/feature.md',
        fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
      }],
      rebaselines: [],
    };
    const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
    await mkdir(dirname(sealPath), { recursive: true });
    await writeFile(sealPath, `${JSON.stringify(seal, null, 2)}\n`);
    await writeProjectFile(repo, '.docs/plans/feature.md', 'rebased plan\n');
    await writeProjectFile(repo, '.docs/specs/feature.md', 'rebased prd\n');
    await git(repo, ['add', '.docs']);
    await git(repo, ['commit', '-q', '-m', 'rebase inherited decide artifacts']);
    const toCommit = await git(repo, ['rev-parse', 'HEAD']);
    const notifications: unknown[] = [];

    const rotated = await rotateProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit,
      trigger: 'history-rewrite',
      paths: ['.docs/plans/feature.md'],
      onRebaseline: async (event) => { notifications.push(event); },
    });

    expect({
      rotated,
      persisted: JSON.parse(await readFile(sealPath, 'utf8')),
      sealDirectoryEntries: await readdir(dirname(sealPath)),
      notifications,
    }).toEqual({
      rotated: {
        version: 2,
        baselineCommit: toCommit,
        protectedArtifacts: [
          {
            path: '.docs/plans/feature.md',
            fingerprint: `sha256:${createHash('sha256').update('rebased plan\n').digest('hex')}`,
          },
          {
            path: '.docs/specs/feature.md',
            fingerprint: `sha256:${createHash('sha256').update('rebased prd\n').digest('hex')}`,
          },
        ],
        rebaselines: [{
          fromCommit: baselineCommit,
          toCommit,
          trigger: 'history-rewrite',
          paths: ['.docs/plans/feature.md'],
        }],
      },
      persisted: rotated,
      sealDirectoryEntries: ['protected-artifact-seal.json'],
      notifications: [{
        type: 'protected_artifact_rebaseline',
        fromCommit: baselineCommit,
        toCommit,
        trigger: 'history-rewrite',
        paths: ['.docs/plans/feature.md'],
      }],
    });
  });

  it('atomically persists the toCommit snapshot while preserving and appending rebaseline lineage', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    const seal = {
      version: 2 as const,
      baselineCommit,
      protectedArtifacts: [{
        path: '.docs/plans/feature.md',
        fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
      }],
      rebaselines: [{
        fromCommit: 'earlier-baseline',
        toCommit: baselineCommit,
        trigger: 'earlier-history-rewrite',
        paths: ['.docs/plans/earlier.md'],
      }],
    };
    const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
    await mkdir(dirname(sealPath), { recursive: true });
    await writeFile(sealPath, `${JSON.stringify(seal, null, 2)}\n`);
    await writeProjectFile(repo, '.docs/plans/feature.md', 'rebased plan\n');
    await git(repo, ['add', '.docs/plans/feature.md']);
    await git(repo, ['commit', '-q', '-m', 'rebase inherited plan']);
    const toCommit = await git(repo, ['rev-parse', 'HEAD']);

    const rotated = await rotateProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit,
      trigger: 'history-rewrite',
      paths: ['.docs/plans/feature.md'],
    });
    const persisted = JSON.parse(
      await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8'),
    );

    expect({
      rotated,
      persisted,
      sealDirectoryEntries: await readdir(join(repo, '.pipeline')),
    }).toEqual({
      rotated: {
        version: 2,
        baselineCommit: toCommit,
        protectedArtifacts: [{
          path: '.docs/plans/feature.md',
          fingerprint: `sha256:${createHash('sha256').update('rebased plan\n').digest('hex')}`,
        }],
        rebaselines: [
          seal.rebaselines[0],
          {
            fromCommit: baselineCommit,
            toCommit,
            trigger: 'history-rewrite',
            paths: ['.docs/plans/feature.md'],
          },
        ],
      },
      persisted: rotated,
      sealDirectoryEntries: ['protected-artifact-seal.json'],
    });
  });

  it('removes the temporary seal and preserves the destination when atomic rename fails', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    const seal = {
      version: 2 as const,
      baselineCommit,
      protectedArtifacts: [{
        path: '.docs/plans/feature.md',
        fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
      }],
      rebaselines: [],
    };
    const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
    const originalBytes = `${JSON.stringify(seal, null, 2)}\n`;
    await mkdir(dirname(sealPath), { recursive: true });
    await writeFile(sealPath, originalBytes);
    const protocol: string[] = [];

    const rejection = await rotateProtectedArtifactSeal({
      projectRoot: repo,
      seal,
      toCommit: baselineCommit,
      trigger: 'history-rewrite',
      paths: ['.docs/plans/feature.md'],
      fileOperations: {
        writeFile: async (...args: Parameters<typeof writeFile>) => {
          protocol.push(args[0] === sealPath ? 'write-destination' : 'write-temp');
          await writeFile(...args);
        },
        rename: async (...args: Parameters<typeof rename>) => {
          await readFile(args[0]);
          protocol.push('rename');
          throw new Error('injected rename failure');
        },
        rm: async (...args: Parameters<typeof rm>) => {
          protocol.push(args[0] === sealPath ? 'rm-destination' : 'rm-temp');
          await rm(...args);
        },
      },
    }).then(() => 'resolved', (error: Error) => error.message);

    expect({
      protocol,
      rejection,
      persistedBytes: await readFile(sealPath, 'utf8'),
      sealDirectoryEntries: await readdir(join(repo, '.pipeline')),
    }).toEqual({
      protocol: ['write-temp', 'rename', 'rm-temp'],
      rejection: 'injected rename failure',
      persistedBytes: originalBytes,
      sealDirectoryEntries: ['protected-artifact-seal.json'],
    });
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

  it('does not invoke git for a clean workspace before base inheritance needs resolving', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    gitInvocations.length = 0;

    // No mismatch reaches inheritedFromBase, so inspectSeal must leave its
    // baseRef thunk untouched. Supplying baseBranch would also invoke the
    // separate stale-seal rotation flow, which this laziness guard excludes.
    await expect(
      verifyProtectedArtifactSeal({ projectRoot: repo }),
    ).resolves.toMatchObject({ ok: true });

    expect(gitInvocations).toEqual([]);
  });

  it('rejects a changed protected artifact against the durable original seal', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await writeProjectFile(repo, '.docs/plans/feature.md', 'dirty replacement\n');

    await expect(verifyProtectedArtifactSeal({ projectRoot: repo, baseBranch: 'main' })).resolves.toEqual({
      ok: false,
      reason: 'Protected artifact changed: .docs/plans/feature.md',
    });
  });

  it('keeps the BUILD halt backstop for a task that edits a sealed artifact', async () => {
    const repo = await makeRepo({ '.docs/plans/another-feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await writeProjectFile(repo, '.docs/plans/another-feature.md', 'edited during BUILD\n');

    await expect(verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature', baseBranch: 'main' })).resolves.toEqual({
      ok: false,
      reason: 'Protected artifact changed: .docs/plans/another-feature.md',
    });
  });

  it('fails closed and names git diff when the inheritance probe exits non-zero', async () => {
    const repo = await makeRepo({ '.docs/plans/another-feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await writeProjectFile(repo, '.docs/plans/another-feature.md', 'edited during BUILD\n');
    failGitDiff.value = true;

    await expect(
      verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature', baseBranch: 'main' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'Protected artifact provenance undeterminable: .docs/plans/another-feature.md\nInheritance probe failed: git diff.\nVerify Git access and retry.',
    });
  });

  it('uses the normal changed-artifact halt, not undeterminable provenance, for a resolved-base modification', async () => {
    const repo = await makeRepo({ '.docs/plans/another-feature.md': 'approved plan\n' });
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await writeProjectFile(repo, '.docs/plans/another-feature.md', 'edited during BUILD\n');

    const verdict = await verifyProtectedArtifactSeal({
      projectRoot: repo,
      featureDesc: 'feature',
      baseBranch: 'main',
    });

    expect(verdict).toEqual({
      ok: false,
      reason: 'Protected artifact changed: .docs/plans/another-feature.md',
    });
    expect((verdict as { reason: string }).reason).not.toMatch(/undeterminable/i);
  });

  it('accepts base-tip content when the workspace differs from this branch HEAD', async () => {
    const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
    await git(repo, ['checkout', '-q', '-b', 'feat']);
    await createProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
    });
    await git(repo, ['checkout', '-q', 'main']);
    await writeProjectFile(repo, '.docs/plans/other-feature.md', 'base-tip plan\n');
    await git(repo, ['add', '.docs/plans/other-feature.md']);
    await git(repo, ['commit', '-q', '-m', 'base updates plan']);
    await git(repo, ['checkout', '-q', 'feat']);
    await writeProjectFile(repo, '.docs/plans/other-feature.md', 'base-tip plan\n');

    await expect(
      verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
    ).resolves.toMatchObject({ ok: true });
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

    await expect(verifyProtectedArtifactSeal({ projectRoot: repo, baseBranch: 'main' })).resolves.toEqual({ ok: false, reason });
  });

  it('refuses a deleted expected artifact before attempting base-inheritance', async () => {
    const repo = await makeRepo({ '.docs/plans/feature.md': 'approved plan\n' });
    const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
    await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });
    await rm(join(repo, '.pipeline/protected-artifact-seal.json'));
    await rm(join(repo, '.docs/plans/feature.md'));
    gitInvocations.length = 0;

    const verdict = await verifyProtectedArtifactSeal({
      projectRoot: repo,
      baselineCommit,
      featureDesc: 'mine',
      baseBranch: 'main',
    });

    expect({ verdict, gitInvocations }).toEqual({
      verdict: { ok: false, reason: 'Protected artifact deleted: .docs/plans/feature.md' },
      gitInvocations: [
        ['ls-tree', '-r', '-z', '--name-only', baselineCommit, '--', ...PROTECTED_ARTIFACT_DIRECTORIES],
        ['show', `${baselineCommit}:.docs/plans/feature.md`],
      ],
    });
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
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'unrelated-other-feature', baseBranch: 'main' }),
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
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'feature', baseBranch: 'main' }),
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
    async function advanceBaseWithoutMovingFeatureHead(
      repo: string,
      files: Record<string, string>,
    ): Promise<void> {
      const baseWorktree = await mkdtemp(join(tmpdir(), 'protected-artifact-seal-base-'));
      try {
        await git(repo, ['worktree', 'add', '--detach', '-q', baseWorktree, 'main']);
        for (const [path, content] of Object.entries(files)) {
          await writeProjectFile(baseWorktree, path, content);
        }
        await git(baseWorktree, ['add', '.']);
        await git(baseWorktree, ['commit', '-q', '-m', "another feature's merged PR"]);
        await git(repo, ['branch', '-f', 'main', await git(baseWorktree, ['rev-parse', 'HEAD'])]);
      } finally {
        await git(repo, ['worktree', 'remove', '--force', baseWorktree]).catch(() => undefined);
        await rm(baseWorktree, { recursive: true, force: true });
      }
    }

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

    it('advances main without moving the feature branch HEAD', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      await git(repo, ['checkout', '-q', '-b', 'feature']);
      const featureHead = await git(repo, ['rev-parse', 'HEAD']);

      await advanceBaseWithoutMovingFeatureHead(repo, {
        '.docs/plans/other-feature.md': 'amended by its owner\n',
      });

      const [head, mergeBase, baseTip] = await Promise.all([
        git(repo, ['rev-parse', 'HEAD']),
        git(repo, ['merge-base', 'HEAD', 'main']),
        git(repo, ['rev-parse', 'main']),
      ]);

      expect([head, mergeBase, baseTip]).toEqual([
        featureHead,
        featureHead,
        expect.not.stringMatching(new RegExp(`^${featureHead}$`)),
      ]);
    });

    it("tolerates another feature's inherited artifact when the feature HEAD remains behind main", async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['checkout', '-q', '-b', 'setup']);
      await advanceBaseWithoutMovingFeatureHead(repo, {
        '.docs/plans/other-feature.md': 'amended by its owner v1\n',
      });
      await git(repo, ['checkout', '-q', '-b', 'feature', 'main']);
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit,
      });
      await advanceBaseWithoutMovingFeatureHead(repo, {
        '.docs/plans/other-feature.md': 'amended by its owner v2\n',
      });

      const verdict = await verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' });

      expect(verdict, verdict.ok ? undefined : verdict.reason).toMatchObject({ ok: true });
    });

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

    it('tolerates a newly inherited artifact when the feature HEAD remains behind main', async () => {
      const repo = await makeRepo({ '.docs/plans/mine.md': 'approved plan\n' });
      const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['checkout', '-q', '-b', 'setup']);
      await advanceBaseWithoutMovingFeatureHead(repo, {
        '.docs/plans/other-feature.md': 'another feature plan v1\n',
      });
      await git(repo, ['checkout', '-q', '-b', 'feature', 'main']);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });
      await advanceBaseWithoutMovingFeatureHead(repo, {
        '.docs/plans/other-feature.md': 'another feature plan v2\n',
      });

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("refuses a feature's committed edit to another artifact while its HEAD remains behind main", async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['checkout', '-q', '-b', 'feature']);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });
      await advanceBaseWithoutMovingFeatureHead(repo, {
        '.docs/plans/other-feature.md': 'amended by its owner\n',
      });
      await writeProjectFile(repo, '.docs/plans/other-feature.md', 'changed by this feature\n');
      await git(repo, ['add', '.docs/plans/other-feature.md']);
      await git(repo, ['commit', '-q', '-m', 'build: edit another feature plan']);

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: false });
    });

    it("refuses an uncommitted edit when the feature's commits never changed the inherited artifact", async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['checkout', '-q', '-b', 'feature']);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });
      await advanceBaseWithoutMovingFeatureHead(repo, {
        '.docs/plans/other-feature.md': 'amended by its owner\n',
      });
      await writeProjectFile(repo, '.docs/plans/other-feature.md', 'uncommitted build edit\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: false });
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

    it('reports undeterminable provenance when no baseBranch is supplied', async () => {
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
        reason: 'Protected artifact provenance undeterminable: .docs/plans/other-feature.md\nMissing base ref: no base branch was supplied.\nProvide the base ref, then rebase onto it.',
      });
    });

    it('reports undeterminable provenance for an added artifact when no baseBranch is supplied', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      await createProtectedArtifactSeal({
        projectRoot: repo,
        baselineCommit: await git(repo, ['rev-parse', 'HEAD']),
      });
      await writeProjectFile(repo, '.docs/plans/invented.md', 'new plan\n');

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact provenance undeterminable: .docs/plans/invented.md\nMissing base ref: no base branch was supplied.\nProvide the base ref, then rebase onto it.',
      });
    });

    it('reports undeterminable provenance when the base branch ref does not exist', async () => {
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
        reason: 'Protected artifact provenance undeterminable: .docs/plans/other-feature.md\nMissing base ref: neither origin/no-such-branch nor no-such-branch resolves.\nProvide the base ref, then rebase onto it.',
      });
    });

    it('names the absent merge-base and rebase recovery for unrelated branch histories', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      const baselineCommit = await git(repo, ['rev-parse', 'HEAD']);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit });
      await rm(join(repo, '.pipeline/protected-artifact-seal.json'));

      await git(repo, ['checkout', '-q', '--orphan', 'unrelated-feature']);
      await git(repo, ['rm', '-q', '-rf', '.']);
      await writeProjectFile(repo, '.docs/plans/other-feature.md', 'unrelated plan\n');
      await git(repo, ['add', '.docs/plans/other-feature.md']);
      await git(repo, ['commit', '-q', '-m', 'unrelated feature history']);

      await expect(
        verifyProtectedArtifactSeal({
          projectRoot: repo,
          baselineCommit,
          featureDesc: 'mine',
          baseBranch: 'main',
        }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact provenance undeterminable: .docs/plans/other-feature.md\nNo merge-base exists between HEAD and main.\nRebase onto main to establish shared history.',
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

  // ── #976: rebaselining a seal stranded by a history rewrite ────────────────
  //
  // These cases sit BELOW the acceptance specs in
  // `test/acceptance/protected-artifact-seal-rebaseline-976.acceptance.test.ts`,
  // which drive the same behavior through the real `Conductor` dispatch guard.
  // Here we pin the predicate itself: the ancestry TRIGGER, the two-clause
  // inheritance PERMISSION, and every fail-closed branch.
  //
  // Every case above keeps a baseline that IS an ancestor of HEAD (single
  // branch, commits appended), so none of them trigger rotation — that is the
  // point of ADR "Non-ancestry is kept only as the trigger".
  describe('stale-seal rebaselining on a rewritten history (#976)', () => {
    /**
     * A repo whose history has genuinely been REWRITTEN: `feat` is sealed at its
     * pre-rebase HEAD, `main` then advances, and `feat` is rebased onto it. The
     * returned `strandedBaseline` is no longer an ancestor of HEAD — the exact
     * shape of the #254 canary worktree.
     */
    async function makeRewrittenRepo(options: {
      initial: Record<string, string>;
      /** Applied on `main` after the seal is taken. `null` deletes the path. */
      baseAdvance: Record<string, string | null>;
      /**
       * Committed on `feat` AFTER the seal is taken — a BUILD agent editing an
       * approved DECIDE artifact, which is what the rotation must refuse to
       * launder.
       */
      featureCommit?: Record<string, string>;
    }): Promise<{ repo: string; strandedBaseline: string; rewrittenHead: string }> {
      // Generated pipeline state is ignored in a real worktree; without this the
      // fixture's own `git add -A` would track the seal and a checkout would
      // move it around — a fixture artifact, not the behavior under test.
      const repo = await makeRepo({ '.gitignore': '.pipeline/\n', ...options.initial });
      await git(repo, ['checkout', '-q', '-b', 'feat']);
      await writeProjectFile(repo, 'src/feature.ts', 'feature work\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-q', '-m', 'feat: work']);

      const strandedBaseline = await git(repo, ['rev-parse', 'HEAD']);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: strandedBaseline });

      if (options.featureCommit) {
        for (const [path, content] of Object.entries(options.featureCommit)) {
          await writeProjectFile(repo, path, content);
        }
        await git(repo, ['add', '-A']);
        await git(repo, ['commit', '-q', '-m', 'build: feature-authored artifact edit']);
      }

      await git(repo, ['checkout', '-q', 'main']);
      for (const [path, content] of Object.entries(options.baseAdvance)) {
        if (content === null) await rm(join(repo, path));
        else await writeProjectFile(repo, path, content);
      }
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-q', '-m', "another feature's merged PR"]);
      await git(repo, ['checkout', '-q', 'feat']);
      await git(repo, ['rebase', '-q', 'main']);

      const rewrittenHead = await git(repo, ['rev-parse', 'HEAD']);
      return { repo, strandedBaseline, rewrittenHead };
    }

    async function readSeal(repo: string): Promise<{
      version: number;
      baselineCommit: string;
      protectedArtifacts: { path: string; fingerprint: string }[];
      rebaselines?: { fromCommit: string; toCommit: string; trigger: string; paths: string[] }[];
    }> {
      return JSON.parse(
        await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8'),
      );
    }

    it('rotates to HEAD and returns ok when every differing path is provably inherited from the base tip', async () => {
      const { repo, strandedBaseline, rewrittenHead } = await makeRewrittenRepo({
        initial: { '.docs/plans/other-feature.md': 'approved plan\n' },
        baseAdvance: { '.docs/plans/other-feature.md': 'amended by its owner\n' },
      });

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: true });

      const seal = await readSeal(repo);
      expect(seal.baselineCommit).toBe(rewrittenHead);
      expect(seal.protectedArtifacts).toContainEqual({
        path: '.docs/plans/other-feature.md',
        fingerprint: `sha256:${createHash('sha256').update('amended by its owner\n').digest('hex')}`,
      });
      expect(seal.rebaselines?.at(-1)).toEqual({
        fromCommit: strandedBaseline,
        toCommit: rewrittenHead,
        trigger: expect.stringMatching(/\S/),
        paths: ['.docs/plans/other-feature.md'],
      });
    });

    it('rotates a stranded baseline when rewritten history leaves protected artifact bytes unchanged', async () => {
      const { repo, strandedBaseline, rewrittenHead } = await makeRewrittenRepo({
        initial: { '.docs/plans/mine.md': 'approved plan\n' },
        baseAdvance: { 'src/base.ts': 'base work\n' },
      });
      const rebaselineEvents: unknown[] = [];

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
        onRebaseline: (event) => {
          rebaselineEvents.push(event);
        },
      });
      const seal = await readSeal(repo);

      expect({
        verdictOk: verdict.ok,
        baselineCommit: seal.baselineCommit,
        rebaselines: seal.rebaselines,
        rebaselineEvents,
      }).toEqual({
        verdictOk: true,
        baselineCommit: rewrittenHead,
        rebaselines: [{
          fromCommit: strandedBaseline,
          toCommit: rewrittenHead,
          trigger: 'defensive-history-rewrite',
          paths: [],
        }],
        rebaselineEvents: [{
          type: 'protected_artifact_rebaseline',
          fromCommit: strandedBaseline,
          toCommit: rewrittenHead,
          trigger: 'defensive-history-rewrite',
          paths: [],
        }],
      });
    });

    it('upgrades a v1 seal to the versioned shape in place when it rotates', async () => {
      const { repo } = await makeRewrittenRepo({
        initial: { '.docs/plans/other-feature.md': 'approved plan\n' },
        baseAdvance: { '.docs/plans/other-feature.md': 'amended by its owner\n' },
      });
      const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
      const current = await readSeal(repo);
      await writeFile(
        sealPath,
        `${JSON.stringify({
          version: 1,
          baselineCommit: current.baselineCommit,
          protectedArtifacts: current.protectedArtifacts,
        }, null, 2)}\n`,
      );
      expect((await readSeal(repo)).version).toBe(1);

      await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
      });

      expect((await readSeal(repo)).version).toBe(2);
    });

    it('re-anchors across a base-branch DELETE and ADD instead of firing the deleted/added refusals', async () => {
      const { repo, rewrittenHead } = await makeRewrittenRepo({
        initial: {
          '.docs/plans/other-feature.md': 'approved plan\n',
          '.docs/plans/mine.md': 'my plan\n',
        },
        baseAdvance: {
          '.docs/plans/other-feature.md': null,
          '.docs/plans/newly-merged.md': 'a newly merged plan\n',
        },
      });

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toMatchObject({ ok: true });

      const seal = await readSeal(repo);
      expect(seal.baselineCommit).toBe(rewrittenHead);
      expect(seal.protectedArtifacts.map((a) => a.path).sort()).toEqual([
        '.docs/plans/mine.md',
        '.docs/plans/newly-merged.md',
      ]);
      expect(seal.rebaselines?.at(-1)?.paths.sort()).toEqual([
        '.docs/plans/newly-merged.md',
        '.docs/plans/other-feature.md',
      ]);
    });

    it('REFUSES rotation when a differing path is feature-authored, naming the path and the condition', async () => {
      const { repo } = await makeRewrittenRepo({
        initial: { '.docs/plans/other-feature.md': 'approved plan\n' },
        baseAdvance: { 'unrelated.ts': 'main advance\n' },
        featureCommit: { '.docs/plans/other-feature.md': 'feature-authored edit\n' },
      });
      const before = await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8');

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
      });

      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain('.docs/plans/other-feature.md');
      expect((verdict as { reason: string }).reason).toMatch(/feature-authored/i);
      expect(
        await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8'),
      ).toBe(before);
    });

    it('REFUSES rotation when the feature reverts another artifact to a historical base revision', async () => {
      const path = '.docs/plans/other-feature.md';
      const historicalRevision = 'approved plan\n';
      const { repo, strandedBaseline } = await makeRewrittenRepo({
        initial: { [path]: historicalRevision },
        baseAdvance: { [path]: 'amended by its owner\n' },
      });
      await writeProjectFile(repo, path, historicalRevision);
      await git(repo, ['add', path]);
      await git(repo, ['commit', '-q', '-m', 'build: revert another feature plan to its historical revision']);
      const sealBefore = await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8');

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
      });

      expect({
        verdict,
        sealUnchanged: await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8') === sealBefore,
        baselineCommit: (await readSeal(repo)).baselineCommit,
      }).toEqual({
        verdict: {
          ok: false,
          reason: `Protected artifact changed: ${path}\nFeature-authored committed change: revert to the committed DECIDE content and route any actual amendment to DECIDE.`,
        },
        sealUnchanged: true,
        baselineCommit: strandedBaseline,
      });
    });

    it('REFUSES rotation when dirty sealed bytes conceal a feature-authored protected change at HEAD', async () => {
      const path = '.docs/plans/other-feature.md';
      const { repo, strandedBaseline } = await makeRewrittenRepo({
        initial: { [path]: 'approved plan\n' },
        baseAdvance: { 'unrelated.ts': 'main advance\n' },
        featureCommit: { [path]: 'feature-authored edit\n' },
      });
      await writeProjectFile(repo, path, 'approved plan\n');
      const sealBefore = await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8');
      const events: unknown[] = [];

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
        onRebaseline: (event) => {
          events.push(event);
        },
      });
      const sealAfter = await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8');

      expect({
        verdict,
        sealBytesUnchanged: sealAfter === sealBefore,
        baselineCommit: JSON.parse(sealAfter).baselineCommit,
        lineage: JSON.parse(sealAfter).rebaselines,
        workspaceBytes: await readFile(join(repo, path), 'utf8'),
        headBytes: await git(repo, ['show', `HEAD:${path}`]),
        events,
      }).toEqual({
        verdict: {
          ok: false,
          reason: `Uncommitted protected artifact changed: ${path}\nRestore from HEAD.`,
        },
        sealBytesUnchanged: true,
        baselineCommit: strandedBaseline,
        lineage: [],
        workspaceBytes: 'approved plan\n',
        headBytes: 'feature-authored edit',
        events: [{
          type: 'protected_artifact_rebaseline_refused',
          condition: 'feature-authored:workspace-differs-from-head',
          verdictCondition: 'workspace-differs-from-head',
          path,
        }],
      });
    });

    it('REFUSES the whole rotation when ONE path is feature-authored and another is inherited', async () => {
      const { repo } = await makeRewrittenRepo({
        initial: {
          '.docs/plans/other-feature.md': 'approved plan\n',
          '.docs/architecture/inherited.md': 'architecture v1\n',
        },
        baseAdvance: { '.docs/architecture/inherited.md': 'architecture v2\n' },
        featureCommit: { '.docs/plans/other-feature.md': 'feature-authored edit\n' },
      });

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
      });

      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain('.docs/plans/other-feature.md');
    });

    it('REFUSES rotation for a working-tree-only edit (workspace bytes ≠ the blob at HEAD)', async () => {
      const { repo } = await makeRewrittenRepo({
        initial: {
          '.docs/plans/other-feature.md': 'approved plan\n',
          '.docs/architecture/inherited.md': 'architecture v1\n',
        },
        baseAdvance: { '.docs/architecture/inherited.md': 'architecture v2\n' },
      });
      await writeProjectFile(repo, '.docs/plans/other-feature.md', 'uncommitted edit\n');
      const before = await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8');

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
      });

      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toContain('.docs/plans/other-feature.md');
      expect(
        await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8'),
      ).toBe(before);
    });

    it('is an INDETERMINATE fail-closed refusal, with its own reason, when the baseline object cannot be resolved', async () => {
      const { repo } = await makeRewrittenRepo({
        initial: { '.docs/plans/other-feature.md': 'approved plan\n' },
        baseAdvance: { '.docs/plans/other-feature.md': 'amended by its owner\n' },
      });
      const sealPath = join(repo, '.pipeline/protected-artifact-seal.json');
      const seal = await readSeal(repo);
      const missingBaseline = 'd'.repeat(40);
      await writeFile(
        sealPath,
        `${JSON.stringify({ ...seal, baselineCommit: missingBaseline }, null, 2)}\n`,
      );

      const verdict = await verifyProtectedArtifactSeal({
        projectRoot: repo,
        featureDesc: 'mine',
        baseBranch: 'main',
      });

      expect(verdict.ok).toBe(false);
      // Never "rewritten, therefore rotatable" — a distinct, baseline-specific reason.
      expect((verdict as { reason: string }).reason).toMatch(/baseline/i);
      expect((await readSeal(repo)).baselineCommit).toBe(missingBaseline);
    });

    it('REFUSES rotation and preserves the pre-existing failure when the base tip cannot be resolved', async () => {
      const { repo } = await makeRewrittenRepo({
        initial: { '.docs/plans/other-feature.md': 'approved plan\n' },
        baseAdvance: { '.docs/plans/other-feature.md': 'amended by its owner\n' },
      });
      const before = await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8');
      await git(repo, ['branch', '-q', '-D', 'main']);

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'main' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact provenance undeterminable: .docs/plans/other-feature.md\nMissing base ref: neither origin/main nor main resolves.\nProvide the base ref, then rebase onto it.',
      });
      expect(
        await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8'),
      ).toBe(before);
    });

    it('never rotates when the baseline IS an ancestor of HEAD, even though HEAD advanced past it', async () => {
      const repo = await makeRepo({ '.docs/plans/other-feature.md': 'approved plan\n' });
      const baseline = await git(repo, ['rev-parse', 'HEAD']);
      await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: baseline });
      const before = await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8');

      // Ordinary appended commits: HEAD moves, the baseline stays an ancestor,
      // and a protected artifact is mutated to something the base does not vouch for.
      await writeProjectFile(repo, '.docs/plans/other-feature.md', 'mutated on the same history\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-q', '-m', 'build: mutate an approved plan']);

      await expect(
        verifyProtectedArtifactSeal({ projectRoot: repo, featureDesc: 'mine', baseBranch: 'no-such-base' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Protected artifact provenance undeterminable: .docs/plans/other-feature.md\nMissing base ref: neither origin/no-such-base nor no-such-base resolves.\nProvide the base ref, then rebase onto it.',
      });
      expect(
        await readFile(join(repo, '.pipeline/protected-artifact-seal.json'), 'utf8'),
      ).toBe(before);
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

  it('fails closed for a glob over a protected directory', () => {
    expect(classifyMutationTarget({
      projectRoot,
      target: '.docs/plans/*.md',
      phase: 'BUILD',
      step: 'build',
    })).toEqual({ kind: 'indeterminate', reason: 'protected-glob-target' });
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

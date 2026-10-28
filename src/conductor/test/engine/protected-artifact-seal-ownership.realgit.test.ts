// Covers: task:4
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  computeFeatureOwnership,
  worktreeFeatureOwnershipSource,
} from '../../src/engine/feature-ownership.js';
import {
  PROTECTED_ARTIFACT_DIRECTORIES,
  createProtectedArtifactSeal,
  verifyProtectedArtifactSeal,
} from '../../src/engine/protected-artifact-seal.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout.trim();
}

async function write(root: string, path: string, contents = `${path}\n`): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents, 'utf8');
}

async function commit(root: string, message: string): Promise<void> {
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', message]);
}

function manifest(artifacts: readonly { kind: string; path: string }[]): string {
  return `${JSON.stringify({ schemaVersion: 1, slug: 'f', artifacts }, null, 2)}\n`;
}

async function fixture(files: Record<string, string>, baseFiles: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'protected-artifact-seal-ownership-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'protected-artifact-seal-ownership@example.test']);
  await git(root, ['config', 'user.name', 'Protected artifact seal ownership']);
  await write(root, 'README.md', 'base\n');
  for (const [path, contents] of Object.entries(baseFiles)) await write(root, path, contents);
  await commit(root, 'base');
  await git(root, ['checkout', '-qb', 'feature']);
  for (const [path, contents] of Object.entries(files)) await write(root, path, contents);
  await commit(root, 'manifest-backed feature');
  return root;
}

async function ownership(root: string) {
  const result = await computeFeatureOwnership(worktreeFeatureOwnershipSource(root), 'f', 'main');
  if (result.kind !== 'manifest') throw new Error(`expected manifest ownership, received ${result.kind}`);
  return result;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('manifest-backed protected artifact seals (real local Git)', () => {
  it('seals listed protected-kind paths outside the legacy folders and omits listed unprotected kinds', async () => {
    const root = await fixture({
      '.docs/f/manifest.json': manifest([
        { kind: 'plan', path: '.docs/plans/f.md' },
        { kind: 'stories', path: '.docs/f/review/stories.md' },
        { kind: 'coherence', path: '.docs/f/review/coherence.md' },
      ]),
      '.docs/plans/f.md': 'plan\n',
      '.docs/f/review/stories.md': 'stories\n',
      '.docs/f/review/coherence.md': 'coherence\n',
    });

    const seal = await createProtectedArtifactSeal({
      projectRoot: root,
      baselineCommit: await git(root, ['rev-parse', 'HEAD']),
      ownership: await ownership(root),
    });

    expect(seal.protectedArtifacts).toContainEqual(expect.objectContaining({
      path: '.docs/f/review/stories.md',
      fingerprint: expect.stringMatching(/^sha256:/),
    }));
    expect(seal.protectedArtifacts.map(({ path }) => path)).not.toContain('.docs/f/review/coherence.md');
  });

  it('reports a changed listed plan as a self-amendment', async () => {
    const root = await fixture({
      '.docs/f/manifest.json': manifest([{ kind: 'plan', path: '.docs/plans/f.md' }]),
      '.docs/plans/f.md': 'plan\n',
    });
    const manifestOwnership = await ownership(root);
    await createProtectedArtifactSeal({
      projectRoot: root,
      baselineCommit: await git(root, ['rev-parse', 'HEAD']),
      ownership: manifestOwnership,
    });
    await write(root, '.docs/plans/f.md', 'amended plan\n');

    await expect(verifyProtectedArtifactSeal({
      projectRoot: root,
      featureDesc: 'f',
      baseBranch: 'main',
      ownership: manifestOwnership,
    })).resolves.toMatchObject({
      ok: true,
      selfAmendments: [expect.objectContaining({ path: '.docs/plans/f.md' })],
    });
  });

  it('rejects an unlisted same-stem protected artifact instead of reporting it as a self-amendment', async () => {
    const root = await fixture({
      '.docs/f/manifest.json': manifest([{ kind: 'plan', path: '.docs/plans/f.md' }]),
      '.docs/plans/f.md': 'plan\n',
    }, {
      '.docs/stories/f-old.md': 'old story\n',
    });
    const manifestOwnership = await ownership(root);
    await createProtectedArtifactSeal({
      projectRoot: root,
      baselineCommit: await git(root, ['rev-parse', 'HEAD']),
      ownership: manifestOwnership,
    });
    await write(root, '.docs/stories/f-old.md', 'changed old story\n');

    const verdict = await verifyProtectedArtifactSeal({
      projectRoot: root,
      featureDesc: 'f',
      baseBranch: 'main',
      ownership: manifestOwnership,
    });
    expect(verdict).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Protected artifact changed: .docs/stories/f-old.md'),
    });
    expect(verdict.ok && verdict.selfAmendments).not.toContainEqual(expect.objectContaining({ path: '.docs/stories/f-old.md' }));
  });

  it('keeps the legacy folder seal and stem-based self-amendment behavior', async () => {
    const root = await mkdtemp(join(tmpdir(), 'protected-artifact-seal-ownership-legacy-'));
    roots.push(root);
    await git(root, ['init', '-q', '-b', 'main']);
    await git(root, ['config', 'user.email', 'protected-artifact-seal-ownership@example.test']);
    await git(root, ['config', 'user.name', 'Protected artifact seal ownership']);
    for (const directory of PROTECTED_ARTIFACT_DIRECTORIES) await write(root, `${directory}/f.md`, `${directory}\n`);
    await commit(root, 'legacy decide artifacts');
    await git(root, ['checkout', '-qb', 'feature']);
    const baselineCommit = await git(root, ['rev-parse', 'HEAD']);
    const seal = await createProtectedArtifactSeal({ projectRoot: root, baselineCommit });
    await write(root, '.docs/plans/f.md', 'self amended plan\n');

    expect(seal.protectedArtifacts.map(({ path }) => path).sort()).toEqual(
      PROTECTED_ARTIFACT_DIRECTORIES.map((directory) => `${directory}/f.md`).sort(),
    );
    await expect(verifyProtectedArtifactSeal({ projectRoot: root, featureDesc: 'f' })).resolves.toMatchObject({
      ok: true,
      selfAmendments: [expect.objectContaining({ path: '.docs/plans/f.md' })],
    });
  });
});

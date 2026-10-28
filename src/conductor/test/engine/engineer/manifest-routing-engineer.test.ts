// Covers: task:rem-prd-audit-14
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { initialSpecPublication } from '../../../src/engine/engineer-cli.js';
import { traceBranchIssue } from '../../../src/engine/engineer/intake/overlap-sources.js';
import { MalformedFeatureManifestError } from '../../../src/engine/feature-manifest-source.js';
import { readMutationProvenance } from '../../../src/engine/owner-gate/mutation-provenance.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);
const cleanupRoots: string[] = [];
const SLUG = 'manifest-routing';
const BRANCH = `spec/${SLUG}`;
const LEGACY_INTAKE = `.docs/intake/${SLUG}.md`;
const RELOCATED_INTAKE = `.docs/${SLUG}/intake.md`;

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

function manifest(artifacts: readonly { kind: string; path: string }[]): string {
  return JSON.stringify({ schemaVersion: 1, slug: SLUG, artifacts }, null, 2);
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'manifest-routing-engineer-'));
  cleanupRoots.push(root);
  await git(root, ['init', '--initial-branch=main', '--quiet']);
  await git(root, ['config', 'user.email', 'fixture@example.test']);
  await git(root, ['config', 'user.name', 'Manifest routing fixture']);
  await writeFile(join(root, 'README.md'), '# fixture\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '--quiet', '-m', 'base']);
  await git(root, ['switch', '--quiet', '-c', BRANCH]);
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }));
  await git(root, ['add', '.']);
  await git(root, ['commit', '--quiet', '-m', 'spec artifacts']);
  return root;
}

function publicationProvenance(root: string) {
  const gitRunner = async (args: string[], opts?: { cwd?: string }) => {
    const result = await execFile('git', args, { cwd: opts?.cwd ?? root });
    return { stdout: result.stdout, stderr: result.stderr };
  };
  const publication = initialSpecPublication(
    { remote: 'https://github.com/owner/repo.git' },
    BRANCH,
    root,
    async () => ({ stdout: '' }),
    gitRunner,
  );
  if (publication.remote.mutation === undefined) {
    throw new Error('expected initial spec publication to provide an ownership mutation');
  }
  return publication.remote.mutation;
}

describe('engineer spec-branch manifest routing (Task 14)', () => {
  it.each([
    ['no manifest', {
      [LEGACY_INTAKE]: 'Owner: legacy-owner\nSource-Ref: owner/repo#101\n',
    }],
    ['legacy-shaped manifest', {
      [LEGACY_INTAKE]: 'Owner: legacy-owner\nSource-Ref: owner/repo#101\n',
      [`.docs/${SLUG}/manifest.json`]: manifest([
        { kind: 'plan', path: `.docs/plans/${SLUG}.md` },
        { kind: 'intake', path: LEGACY_INTAKE },
      ]),
      [`.docs/plans/${SLUG}.md`]: '# Plan\n',
    }],
  ])('keeps spec-branch intake provenance on %s', async (_name, files) => {
    const root = await fixture(files);
    const mutation = publicationProvenance(root);

    await expect(readMutationProvenance(mutation.provenance, mutation.dependencies.provenanceDiscovery)).resolves.toMatchObject({
      kind: 'owned',
      owner: 'legacy-owner',
      ref: BRANCH,
    });
    await expect(traceBranchIssue({
      git: makeGitRunner(root),
      branch: BRANCH,
      repository: 'owner/repo',
      readIssueState: async () => 'OPEN',
      cwd: root,
    })).resolves.toBe('owner/repo#101');
  });

  it('reads relocated intake evidence from the spec branch manifest', async () => {
    const root = await fixture({
      [LEGACY_INTAKE]: 'Owner: legacy-owner\nSource-Ref: owner/repo#101\n',
      [RELOCATED_INTAKE]: 'Owner: relocated-owner\nSource-Ref: owner/repo#202\n',
      [`.docs/${SLUG}/manifest.json`]: manifest([
        { kind: 'plan', path: `.docs/plans/${SLUG}.md` },
        { kind: 'intake', path: RELOCATED_INTAKE },
      ]),
      [`.docs/plans/${SLUG}.md`]: '# Plan\n',
    });
    const mutation = publicationProvenance(root);

    await expect(readMutationProvenance(mutation.provenance, mutation.dependencies.provenanceDiscovery)).resolves.toMatchObject({
      kind: 'owned',
      owner: 'relocated-owner',
      ref: BRANCH,
    });
    await expect(traceBranchIssue({
      git: makeGitRunner(root),
      branch: BRANCH,
      repository: 'owner/repo',
      readIssueState: async () => 'OPEN',
      cwd: root,
    })).resolves.toBe('owner/repo#202');
  });

  it('does not fall back to a legacy intake marker when the manifest omits intake', async () => {
    const root = await fixture({
      [LEGACY_INTAKE]: 'Owner: legacy-owner\nSource-Ref: owner/repo#101\n',
      [`.docs/${SLUG}/manifest.json`]: manifest([{ kind: 'plan', path: `.docs/plans/${SLUG}.md` }]),
      [`.docs/plans/${SLUG}.md`]: '# Plan\n',
    });
    const mutation = publicationProvenance(root);

    await expect(readMutationProvenance(mutation.provenance, mutation.dependencies.provenanceDiscovery)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'missing-provenance',
    });
    await expect(traceBranchIssue({
      git: makeGitRunner(root),
      branch: BRANCH,
      repository: 'owner/repo',
      readIssueState: async () => 'OPEN',
      cwd: root,
    })).resolves.toBeNull();
  });

  it('fails closed on a malformed spec-branch manifest when tracing intake provenance', async () => {
    const root = await fixture({
      [LEGACY_INTAKE]: 'Owner: legacy-owner\nSource-Ref: owner/repo#101\n',
      [`.docs/${SLUG}/manifest.json`]: '{ malformed JSON',
    });

    await expect(traceBranchIssue({
      git: makeGitRunner(root),
      branch: BRANCH,
      repository: 'owner/repo',
      readIssueState: async () => 'OPEN',
      cwd: root,
    })).rejects.toSatisfy((error: unknown) => error instanceof MalformedFeatureManifestError
      && error.message.includes(`.docs/${SLUG}/manifest.json`));
  });
});

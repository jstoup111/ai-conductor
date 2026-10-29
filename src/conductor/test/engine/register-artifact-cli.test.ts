// Covers: task:18
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  dispatchRegisterArtifactCommand,
  validateRegistration,
  type RegisterArtifactDispatch,
} from '../../src/engine/register-artifact-cli.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const manifest = (artifacts: readonly { kind: string; path: string }[]) => JSON.stringify({
  schemaVersion: 1,
  slug: 'f',
  artifacts,
}, null, 2);

const DEFAULT_MANIFEST = manifest([
  { kind: 'plan', path: '.docs/plans/f.md' },
  { kind: 'stories', path: '.docs/stories/f.md' },
]);

async function fixture(options: {
  manifestText?: string;
  files?: Record<string, string>;
} = {}): Promise<{ root: string; worktree: string; manifestPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'register-artifact-cli-'));
  cleanupRoots.push(root);
  const worktree = join(root, '.worktrees', 'f');
  const manifestPath = join(worktree, '.docs/f/manifest.json');
  const files = {
    '.docs/f/manifest.json': options.manifestText ?? DEFAULT_MANIFEST,
    '.docs/plans/f.md': '# Plan\n',
    '.docs/stories/f.md': '# Stories\n',
    '.docs/stories/extra.md': '# Extra stories\n',
    ...options.files,
  };

  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const target = join(worktree, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }));

  return { root, worktree, manifestPath };
}

function request(overrides: Partial<RegisterArtifactDispatch> = {}): RegisterArtifactDispatch {
  return {
    slug: 'f',
    artifactKind: 'stories',
    path: '.docs/stories/extra.md',
    reason: 'Split the stories document.',
    clearHalt: false,
    ...overrides,
  };
}

async function dispatch(
  root: string,
  command: RegisterArtifactDispatch,
): Promise<{ code: number; errors: string[] }> {
  const errors: string[] = [];
  const code = await dispatchRegisterArtifactCommand(command, {
    cwd: root,
    err: (line) => errors.push(line),
  });
  return { code, errors };
}

describe('register-artifact validation', () => {
  it('renders a validated manifest through the canonical renderer', async () => {
    const { worktree } = await fixture();

    await expect(validateRegistration(request(), { worktree })).resolves.toMatchObject({
      kind: 'rendered',
      manifest: expect.stringContaining('".docs/stories/extra.md"'),
    });
  });

  it.each([
    ['a blank rationale', request({ reason: '   ' }), 'missing rationale'],
    ['an unknown worktree', request({ slug: 'g' }), "unknown feature worktree 'g'"],
    ['a path absent from the worktree', request({ path: '.docs/stories/missing.md' }), "artifact path '.docs/stories/missing.md' does not exist"],
  ])('refuses %s without writing the manifest', async (_name, command, condition) => {
    const { root, manifestPath } = await fixture();
    const before = await readFile(manifestPath, 'utf8');

    await expect(dispatch(root, command)).resolves.toEqual({
      code: 1,
      errors: [`register-artifact: ${condition}.`],
    });
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(before);
  });

  it.each([
    ['a duplicate entry', request({ path: '.docs/stories/f.md' }), 'duplicate artifact entry stories .docs/stories/f.md'],
    ['a mismatched legacy kind', request({ artifactKind: 'coherence' }), 'kind mismatch: .docs/stories/extra.md is stories, not coherence'],
    ['a second plan', request({ artifactKind: 'plan', path: '.docs/plans/extra.md' }), 'second plan entry'],
  ])('refuses %s without writing the manifest', async (_name, command, condition) => {
    const { root, manifestPath } = await fixture({
      files: { '.docs/plans/extra.md': '# Extra plan\n' },
    });
    const before = await readFile(manifestPath, 'utf8');

    await expect(dispatch(root, command)).resolves.toEqual({
      code: 1,
      errors: [`register-artifact: ${condition}.`],
    });
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(before);
  });

  it.each([
    '.docs/shipped/f.md',
    '.docs/halted/f.md',
    '.docs/plan-review/f.md',
    '.docs/release-waivers/f.md',
    'src/not-a-doc.md',
  ])('refuses the nonregistrable path %s', async (path) => {
    const { root, worktree, manifestPath } = await fixture({
      files: { [path]: '# Not registrable\n' },
    });
    const before = await readFile(manifestPath, 'utf8');

    await expect(dispatch(root, request({ path }))).resolves.toEqual({
      code: 1,
      errors: [`register-artifact: artifact path '${path}' is not registrable.`],
    });
    await expect(readFile(join(worktree, '.docs/f/manifest.json'), 'utf8')).resolves.toBe(before);
  });

  it('refuses a malformed manifest without changing its bytes', async () => {
    const malformed = '{"schemaVersion": 1, "slug": "other", "artifacts": []}';
    const { root, manifestPath } = await fixture({ manifestText: malformed });

    await expect(dispatch(root, request())).resolves.toEqual({
      code: 1,
      errors: ['register-artifact: .docs/f/manifest.json slug "other" does not match folder slug "f".'],
    });
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(malformed);
  });
});

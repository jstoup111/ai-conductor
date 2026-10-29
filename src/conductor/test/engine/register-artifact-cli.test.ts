// Covers: task:18, task:21
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  detectRegisterArtifactCommand,
  dispatchRegisterArtifactCommand,
  validateRegistration,
  type RegisterArtifactDispatch,
} from '../../src/engine/register-artifact-cli.js';
import { createProgram } from '../../src/cli.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { detectResealCommand, dispatchResealCommand } from '../../src/engine/reseal-cli.js';
import { prepareProtectedArtifactReseal } from '../../src/engine/protected-artifact-seal.js';
import type { DocsPath } from '../../src/engine/feature-manifest.js';

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
    isInteractive: true,
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
    const eventRoot = command.slug === 'f' ? join(root, '.worktrees', command.slug) : root;
    await expect(readFile(join(eventRoot, '.pipeline', 'events.jsonl'), 'utf8')).resolves.toContain(
      `"condition":"${condition}"`,
    );
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

  it('refuses non-interactive registration without changing the manifest and records one spine event', async () => {
    const { root, manifestPath, worktree } = await fixture();
    const before = await readFile(manifestPath, 'utf8');
    const errors: string[] = [];

    await expect(dispatchRegisterArtifactCommand(request(), {
      cwd: root,
      isInteractive: false,
      err: (line) => errors.push(line),
    })).resolves.toBe(1);

    expect(errors).toEqual(['register-artifact: requires an interactive terminal.']);
    await expect(readFile(manifestPath, 'utf8')).resolves.toBe(before);
    await expect(readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8')).resolves.toMatch(
      /"type":"feature_artifact_registration_refused","slug":"f","condition":"requires an interactive terminal"/,
    );
  });

  it('keeps reseal refusal unchanged for an unlisted, unsealed artifact', async () => {
    const { root, worktree, manifestPath } = await fixture({
      files: {
        '.pipeline/protected-artifact-seal.json': JSON.stringify({
          version: 2,
          baselineCommit: 'base',
          protectedArtifacts: [{ path: '.docs/stories/f.md', fingerprint: 'sha256:before' }],
          rebaselines: [],
        }),
      },
    });
    const command = detectResealCommand([
      'node', 'conduct', 'reseal', '--slug', 'f', '--path', '.docs/stories/extra.md', '--reason', 'Operator review.',
    ]);
    if (!command) throw new Error('expected reseal command');
    const before = await readFile(manifestPath, 'utf8');
    const errors: string[] = [];

    await expect(dispatchResealCommand(command, {
      cwd: root,
      isInteractive: true,
      resolveHead: async () => 'target',
      resolveBaseBranch: async () => 'main',
      reseal: async (options) => {
        await prepareProtectedArtifactReseal({
          ...options,
          ownership: {
            kind: 'manifest',
            manifestPath: '.docs/f/manifest.json' as DocsPath,
            ownedPaths: ['.docs/plans/f.md' as DocsPath, '.docs/stories/f.md' as DocsPath],
            protectedPaths: [
              '.docs/plans/f.md' as DocsPath,
              '.docs/stories/f.md' as DocsPath,
              '.docs/f/manifest.json' as DocsPath,
            ],
          },
        });
        return options.seal;
      },
      events: new ConductorEventEmitter(),
      err: (line) => errors.push(line),
    })).resolves.toBe(1);

    expect(errors).toEqual([
      'reseal: Protected artifact reseal target is not sealed: .docs/stories/extra.md.',
    ]);
    await expect(readFile(join(worktree, '.docs/f/manifest.json'), 'utf8')).resolves.toBe(before);
  });
});

describe('register-artifact operator command wiring', () => {
  it('recognizes only the fully bound registration grammar', () => {
    expect(detectRegisterArtifactCommand([
      'node',
      'conduct',
      'register-artifact',
      '--slug', 'f',
      '--kind', 'stories',
      '--path', '.docs/stories/extra.md',
      '--reason', 'Split the stories document.',
      '--clear-halt',
    ])).toEqual({
      slug: 'f',
      artifactKind: 'stories',
      path: '.docs/stories/extra.md',
      reason: 'Split the stories document.',
      clearHalt: true,
    });
    expect(detectRegisterArtifactCommand([
      'node', 'conduct', 'register-artifact', '--slug', 'f', '--path', '.docs/stories/extra.md', '--reason', 'why',
    ])).toBeNull();
  });

  it('declares a pre-pipeline operator command without adding a pipeline step', async () => {
    const indexSource = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
    const dispatchAt = indexSource.indexOf('const registerArtifactCmd = detectRegisterArtifactCommand(process.argv);');
    const pipelineAt = indexSource.indexOf('const conductor = new Conductor({');

    expect(createProgram().commands.find((command) => command.name() === 'register-artifact')?.options.map((option) => option.long))
      .toEqual(['--slug', '--kind', '--path', '--reason', '--clear-halt']);
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeLessThan(pipelineAt);
    expect(ALL_STEPS.map((step) => step.name)).not.toContain('register-artifact');
    expect(ALL_STEPS.map((step) => step.name)).not.toContain('register_artifact');
  });
});

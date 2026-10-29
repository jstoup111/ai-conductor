// Covers: task:2, task:7
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/engine/protected-artifact-seal.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/protected-artifact-seal.js')>(),
  createProtectedArtifactSeal: vi.fn(async () => ({
    version: 2,
    baselineCommit: 'test',
    protectedArtifacts: [],
    rebaselines: [],
  })),
  verifyProtectedArtifactSeal: vi.fn(async () => ({
    ok: true,
    seal: undefined,
    selfAmendments: [],
    inheritedDeletions: [],
  })),
}));

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import * as protectedArtifactSeal from '../../src/engine/protected-artifact-seal.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout.trim();
}

async function write(root: string, path: string, content = `${path}\n`): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), content, 'utf8');
}

async function commit(root: string, message: string): Promise<void> {
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', message]);
}

function manifest(artifacts: readonly { kind: string; path: string }[], slug = 'f'): string {
  return `${JSON.stringify({ schemaVersion: 1, slug, artifacts }, null, 2)}\n`;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'conductor-ownership-refusal-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'conductor-ownership@example.test']);
  await git(root, ['config', 'user.name', 'Conductor ownership']);
  await write(root, 'README.md', 'base\n');
  await commit(root, 'base');
  return root;
}

async function addManifestFeature(
  root: string,
  artifacts: readonly { kind: string; path: string }[] = [{ kind: 'plan', path: '.docs/plans/f.md' }],
): Promise<void> {
  await write(root, '.docs/f/manifest.json', manifest(artifacts));
  for (const artifact of artifacts) await write(root, artifact.path);
  await commit(root, 'manifest-backed feature');
}

async function seedState(root: string, target: 'build' | 'manual_test'): Promise<void> {
  await writeFile(join(root, 'conduct-state.json'), JSON.stringify({
    ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, step.name === target ? 'pending' : 'done'])),
    complexity_tier: 'M',
    feature_desc: 'f',
    track: 'technical',
  }), 'utf8');
}

async function runStep(
  root: string,
  target: 'build' | 'manual_test',
  options: {
    baseBranch?: string;
    maxRetries?: number;
    runnerResult?: { success: boolean; output?: string };
    onMarker?: (content: string) => void;
  } = {},
) {
  await seedState(root, target);
  const run = vi.fn(async () => {
    options.onMarker?.(await readFile(join(root, '.pipeline', 'phase-active'), 'utf8'));
    return options.runnerResult ?? { success: false, output: 'unexpected provider dispatch' };
  });
  const runner: StepRunner = { run };
  const conductor = new Conductor({
    stateFilePath: join(root, 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    fromStep: target,
    mode: 'default',
    verifyArtifacts: false,
    baseBranch: options.baseBranch ?? 'main',
    maxRetries: options.maxRetries ?? 2,
    childRegionLifecycle: { resolveActiveChild: async () => ({ kind: 'no-child' }) },
  });
  await conductor.run();
  return run;
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('conductor manifest ownership refusal at BUILD and SHIP entry', () => {
  it('writes manifest ownership lines into the BUILD phase marker', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root, [
      { kind: 'plan', path: '.docs/f/plan.md' },
      { kind: 'stories', path: '.docs/f/review/stories.md' },
      { kind: 'coherence', path: '.docs/coherence/f.md' },
    ]);
    let marker = '';

    const run = await runStep(root, 'build', {
      maxRetries: 1,
      runnerResult: { success: true },
      onMarker: (content) => { marker = content; },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(marker).toContain('own: .docs/f/plan.md');
    expect(marker).toContain('own: .docs/f/review/stories.md');
    expect(marker).not.toContain('own: .docs/f/manifest.json');
    expect(marker).toContain('protect: .docs/f/plan.md');
    expect(marker).toContain('protect: .docs/f/review/stories.md');
    expect(marker).toContain('protect: .docs/f/manifest.json');
    expect(marker).not.toContain('protect: .docs/coherence/f.md');
  });

  it('keeps legacy marker ownership lines absent', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await write(root, '.docs/plans/f.md');
    await commit(root, 'legacy plan');
    let marker = '';

    const run = await runStep(root, 'build', {
      maxRetries: 1,
      runnerResult: { success: true },
      onMarker: (content) => { marker = content; },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(marker).not.toContain('own: ');
    expect(marker).not.toContain('protect: ');
    expect(marker.match(/^allow: .+$/gm)).toEqual(['allow: .docs/release-waivers/']);
  });

  it('narrows a manifest-backed remediate marker allowlist to its listed plan path', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root, [
      { kind: 'plan', path: '.docs/f/plan.md' },
      { kind: 'stories', path: '.docs/f/review/stories.md' },
    ]);
    let marker = '';
    const runner: StepRunner = {
      run: async (step) => {
        expect(step).toBe('remediate');
        marker = await readFile(join(root, '.pipeline', 'phase-active'), 'utf8');
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, 'conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      baseBranch: 'main',
      childRegionLifecycle: { resolveActiveChild: async () => ({ kind: 'no-child' }) },
    });

    await (conductor as unknown as {
      runRemediateWithPhaseMarker(
        state: { feature_desc: string },
        options: Record<string, never>,
      ): Promise<unknown>;
    }).runRemediateWithPhaseMarker({ feature_desc: 'f' }, {});

    expect(marker.match(/^allow: .+$/gm)).toEqual([
      'allow: .docs/release-waivers/',
      'allow: .docs/f/plan.md',
    ]);
    expect(marker).not.toContain('allow: .docs/plans/');
  });

  it('restores an enclosing step marker byte-for-byte after nested remediate returns', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root, [
      { kind: 'plan', path: '.docs/f/plan.md' },
      { kind: 'stories', path: '.docs/f/review/stories.md' },
    ]);
    const enclosingMarker = [
      'step: build',
      'phase: BUILD',
      'written: 2026-10-29T00:00:00.000Z',
      'allow: .docs/release-waivers/',
      'own: .docs/f/plan.md',
      'own: .docs/f/review/stories.md',
      'protect: .docs/f/plan.md',
      'protect: .docs/f/review/stories.md',
      'protect: .docs/f/manifest.json',
      '',
    ].join('\n');
    await write(root, '.pipeline/phase-active', enclosingMarker);
    const conductor = new Conductor({
      stateFilePath: join(root, 'conduct-state.json'),
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
      projectRoot: root,
      baseBranch: 'main',
      childRegionLifecycle: { resolveActiveChild: async () => ({ kind: 'no-child' }) },
    });

    await (conductor as unknown as {
      runRemediateWithPhaseMarker(
        state: { feature_desc: string },
        options: Record<string, never>,
      ): Promise<unknown>;
    }).runRemediateWithPhaseMarker({ feature_desc: 'f' }, {});

    await expect(readFile(join(root, '.pipeline', 'phase-active'), 'utf8')).resolves.toBe(enclosingMarker);
  });

  it('refuses remediate drift before writing a marker or dispatching the provider', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root);
    await write(root, '.docs/stories/unlisted.md');
    await commit(root, 'unlisted story');
    const run = vi.fn();
    const conductor = new Conductor({
      stateFilePath: join(root, 'conduct-state.json'),
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      projectRoot: root,
      baseBranch: 'main',
      childRegionLifecycle: { resolveActiveChild: async () => ({ kind: 'no-child' }) },
    });

    const result = await (conductor as unknown as {
      runRemediateWithPhaseMarker(
        state: { feature_desc: string },
        options: Record<string, never>,
      ): Promise<{ success: boolean; output?: string }>;
    }).runRemediateWithPhaseMarker({ feature_desc: 'f' }, {});

    expect(result).toMatchObject({ success: false, output: expect.stringContaining('.docs/stories/unlisted.md: unlisted') });
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'phase-active'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a malformed manifest before writing a remediate marker or dispatching the provider', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await write(root, '.docs/f/manifest.json', manifest([{ kind: 'plan', path: '.docs/plans/f.md' }], 'other'));
    await commit(root, 'malformed manifest');
    const run = vi.fn();
    const conductor = new Conductor({
      stateFilePath: join(root, 'conduct-state.json'),
      stepRunner: { run },
      events: new ConductorEventEmitter(),
      projectRoot: root,
      baseBranch: 'main',
      childRegionLifecycle: { resolveActiveChild: async () => ({ kind: 'no-child' }) },
    });

    const result = await (conductor as unknown as {
      runRemediateWithPhaseMarker(
        state: { feature_desc: string },
        options: Record<string, never>,
      ): Promise<{ success: boolean; output?: string }>;
    }).runRemediateWithPhaseMarker({ feature_desc: 'f' }, {});

    expect(result).toMatchObject({ success: false, output: expect.stringContaining('Feature artifact manifest is malformed:') });
    expect(run).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'phase-active'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses BUILD before provider dispatch when an artifact is missing and another is committed but unlisted', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root, [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'coherence', path: '.docs/coherence/f.md' },
    ]);
    await rm(join(root, '.docs/coherence/f.md'));
    await write(root, '.docs/stories/extra.md');
    await commit(root, 'unlisted story');

    const run = await runStep(root, 'build');
    const halt = await readFile(join(root, '.pipeline/HALT'), 'utf8');

    expect(run).not.toHaveBeenCalled();
    expect(halt).toContain('.docs/coherence/f.md: missing — restore the file.');
    expect(halt).toContain('.docs/stories/extra.md: unlisted — register it with ai-conductor register-artifact.');
    await expect(readFile(join(root, '.pipeline/HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
  });

  it('refuses SHIP once with every missing and unlisted path, including an untracked manifest-folder file', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await addManifestFeature(root, [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'coherence', path: '.docs/coherence/f.md' },
    ]);
    await rm(join(root, '.docs/coherence/f.md'));
    await write(root, '.docs/stories/extra.md');
    await commit(root, 'unlisted story');
    await write(root, '.docs/f/notes.md');

    const run = await runStep(root, 'manual_test');
    const halt = await readFile(join(root, '.pipeline/HALT'), 'utf8');

    expect(run).not.toHaveBeenCalled();
    expect(halt).toContain('.docs/coherence/f.md: missing — restore the file.');
    expect(halt).toContain('.docs/stories/extra.md: unlisted — register it with ai-conductor register-artifact.');
    expect(halt).toContain('.docs/f/notes.md: unlisted — register it with ai-conductor register-artifact.');
  });

  it('refuses a malformed manifest before the seal can apply folder or stem ownership', async () => {
    const root = await fixture();
    await git(root, ['checkout', '-qb', 'feature']);
    await write(root, '.docs/f/manifest.json', manifest([{ kind: 'plan', path: '.docs/plans/f.md' }], 'g'));
    await commit(root, 'malformed manifest');

    const run = await runStep(root, 'manual_test');
    const halt = await readFile(join(root, '.pipeline/HALT'), 'utf8');

    expect(run).not.toHaveBeenCalled();
    expect(halt).toContain('Feature artifact manifest is malformed:');
    expect(halt).toContain('f');
    expect(halt).toContain('g');
    expect(protectedArtifactSeal.verifyProtectedArtifactSeal).not.toHaveBeenCalled();
  });

  it.each([
    ['a clean manifest-backed feature', async (root: string) => {
      await git(root, ['checkout', '-qb', 'feature']);
      await addManifestFeature(root);
      return 'main';
    }],
    ['a feature that added only implementation and a release waiver', async (root: string) => {
      await git(root, ['checkout', '-qb', 'feature']);
      await addManifestFeature(root);
      await write(root, 'src/x.ts');
      await write(root, '.docs/release-waivers/f.md');
      await commit(root, 'implementation and waiver');
      return 'main';
    }],
    ['a stacked child whose parent added a story', async (root: string) => {
      await git(root, ['checkout', '-qb', 'parent']);
      await write(root, '.docs/stories/p.md');
      await commit(root, 'parent story');
      await git(root, ['checkout', '-qb', 'child']);
      await addManifestFeature(root);
      return 'parent';
    }],
    ['a legacy feature that added a story', async (root: string) => {
      await git(root, ['checkout', '-qb', 'feature']);
      await write(root, '.docs/stories/extra.md');
      await commit(root, 'legacy story');
      return 'main';
    }],
  ])('dispatches BUILD without an ownership refusal for %s', async (_caseName, prepare) => {
    const root = await fixture();
    const baseBranch = await prepare(root);

    const run = await runStep(root, 'build', {
      baseBranch,
      maxRetries: 1,
      runnerResult: { success: true },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('build', expect.any(Object), expect.any(Object));
    await expect(readFile(join(root, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

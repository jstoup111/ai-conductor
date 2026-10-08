// Covers: task:10, task:11
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import { createProtectedArtifactSeal, PROTECTED_ARTIFACT_SEAL_PATH } from '../../src/engine/protected-artifact-seal.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCallback);
const FEATURE = 'inherited-deletion-guard';
const RETIRED = '.docs/plans/retired.md';
const OWN = `.docs/plans/${FEATURE}.md`;
const scratchRoots: string[] = [];

afterEach(async () => {
  while (scratchRoots.length > 0) await rm(scratchRoots.pop()!, { recursive: true, force: true });
});

async function write(repo: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), content, 'utf8');
}

async function fixture(): Promise<{ repo: string; git: (args: string[]) => Promise<{ stdout: string }>; deleteOnBase: () => Promise<string> }> {
  const origin = await mkdtemp(join(tmpdir(), 'inherited-deletion-origin-'));
  const repo = await mkdtemp(join(tmpdir(), 'inherited-deletion-'));
  scratchRoots.push(origin, repo);
  await execFile('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await initTestRepo(repo);
  await git(['remote', 'add', 'origin', origin]);
  await write(repo, '.gitignore', '.pipeline/\nconduct-state.json\n');
  await write(repo, RETIRED, 'retired\n');
  await write(repo, OWN, 'own plan\n');
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'approved artifacts']);
  await git(['push', '-q', 'origin', 'main']);
  await git(['checkout', '-q', '-b', 'feature']);
  await write(repo, 'src/feature.ts', 'work\n');
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'feature work']);
  const baseline = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: baseline });
  return {
    repo,
    git,
    deleteOnBase: async () => {
      await git(['checkout', '-q', 'main']);
      await unlink(join(repo, RETIRED));
      await git(['add', '-A']);
      await git(['commit', '-q', '-m', 'retire plan']);
      const deletedBy = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await git(['push', '-q', 'origin', 'main']);
      await git(['fetch', '-q', 'origin']);
      await git(['checkout', '-q', 'feature']);
      return deletedBy;
    },
  };
}

async function runBuild(repo: string, baseBranch = 'main'): Promise<{ dispatched: string[]; events: unknown[] }> {
  await writeState(join(repo, 'conduct-state.json'), { plan: 'done', feature_desc: FEATURE } as ConductState);
  const events = new ConductorEventEmitter();
  const seen: unknown[] = [];
  vi.spyOn(events, 'emit').mockImplementation(async (event) => {
    seen.push(event);
  });
  const dispatched: string[] = [];
  const runner: StepRunner = { run: async (step) => {
    dispatched.push(step);
    return { success: false, output: 'stop after guard observation' } satisfies StepRunResult;
  } };
  await new Conductor({
    stateFilePath: join(repo, 'conduct-state.json'), stepRunner: runner, events, projectRoot: repo,
    config: {} as never, fromStep: 'build', mode: 'default', maxRetries: 1, baseBranch,
  } as never).run();
  return { dispatched, events: seen };
}

describe('BUILD dispatch guard inherited deletions', () => {
  it('dispatches through rebase and merge shapes, pruning once with the base deleting commit', async () => {
    for (const shape of ['rebase', 'merge'] as const) {
      const { repo, git, deleteOnBase } = await fixture();
      const deletedBy = await deleteOnBase();
      if (shape === 'rebase') await git(['rebase', '-q', 'origin/main']);
      else await git(['merge', '--no-ff', '-q', 'origin/main', '-m', 'merge base deletion']);
      const result = await runBuild(repo);
      expect(result.dispatched).toContain('build');
      await expect(readFile(join(repo, HALT_MARKER), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(result.events.filter((event) => {
        const rebaseline = event as { type?: string; trigger?: string };
        return rebaseline.type === 'protected_artifact_rebaseline' && rebaseline.trigger === 'inherited-base-deletion';
      }))
        .toEqual([expect.objectContaining({ trigger: 'inherited-base-deletion', paths: [RETIRED], deletedBy: { [RETIRED]: deletedBy } })]);
    }
  }, 30000);

  it('halts undeterminable missing paths without an authorship attribution or seal rewrite', async () => {
    const { repo, git, deleteOnBase } = await fixture();
    await deleteOnBase();
    await git(['rebase', '-q', 'origin/main']);
    const sealPath = join(repo, PROTECTED_ARTIFACT_SEAL_PATH);
    const before = await readFile(sealPath, 'utf8');
    await git(['remote', 'remove', 'origin']);
    await git(['branch', '-q', '-D', 'main']);
    const { dispatched } = await runBuild(repo, 'main');
    expect(dispatched).toEqual([]);
    const halt = await readFile(join(repo, HALT_MARKER), 'utf8');
    expect(halt).toContain(`Protected artifact provenance undeterminable: ${RETIRED}`);
    expect(halt).toContain('Attribution: provenance undeterminable');
    expect(halt).not.toMatch(/feature-authored|base-inherited/);
    await expect(readFile(sealPath, 'utf8')).resolves.toBe(before);
  }, 30000);
});

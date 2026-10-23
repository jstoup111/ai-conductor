// Covers: task:4
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import * as protectedArtifactSeal from '../../src/engine/protected-artifact-seal.js';
import { readLastResolvedCount } from '../../src/engine/task-evidence.js';
import { countResolvedTasks } from '../../src/engine/task-progress.js';
import { createProtectedArtifactSeal, PROTECTED_ARTIFACT_SEAL_PATH } from '../../src/engine/protected-artifact-seal.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCallback);

describe('conductor protected-artifact self-amendment advisory', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function runSealedHalt(paths: Record<string, string>): Promise<{ root: string; worktree: string; halt: string; haltClass: string; dispatched: unknown[][]; seal: string; sealBefore: string; events: boolean }> {
    const root = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-halt-'));
    temporaryDirectories.push(root);
    const worktree = join(root, '.worktrees', 'feat-x');
    const git = (args: string[]) => execFile('git', args, { cwd: worktree });
    await mkdir(worktree, { recursive: true });
    await initTestRepo(worktree);
    for (const path of Object.keys(paths)) { await mkdir(join(worktree, path, '..'), { recursive: true }); await writeFile(join(worktree, path), 'approved\n'); }
    await git(['add', '.']); await git(['commit', '-q', '-m', 'approved']);
    await createProtectedArtifactSeal({ projectRoot: worktree, baselineCommit: (await git(['rev-parse', 'HEAD'])).stdout.trim() });
    const sealPath = join(worktree, PROTECTED_ARTIFACT_SEAL_PATH); const seal = await readFile(sealPath, 'utf8');
    await git(['checkout', '-q', '-b', 'feat-x']);
    for (const [path, content] of Object.entries(paths)) await writeFile(join(worktree, path), content);
    await git(['add', '.docs']); await git(['commit', '-q', '-m', 'amend']);
    await writeFile(join(worktree, 'conduct-state.json'), JSON.stringify({ plan: 'done' }));
    const run = vi.fn(async () => { throw new Error('unexpected dispatch'); });
    await new Conductor({ stateFilePath: join(worktree, 'conduct-state.json'), stepRunner: { run }, events: new ConductorEventEmitter(), projectRoot: worktree, config: {} as never, fromStep: 'build', mode: 'default', maxRetries: 2, baseBranch: 'main' }).run();
    return { root, worktree, halt: await readFile(join(worktree, '.pipeline/HALT'), 'utf8'), haltClass: await readFile(join(worktree, '.pipeline/HALT.class'), 'utf8'), dispatched: run.mock.calls, seal: await readFile(sealPath, 'utf8'), sealBefore: seal, events: await readFile(join(worktree, '.pipeline/events.jsonl'), 'utf8').then(() => true, () => false) };
  }

  it('writes the exact reseal hint for one committed sealed ADR without approval side effects', async () => {
    const path = '.docs/decisions/adr-2026-10-17-example.md';
    const result = await runSealedHalt({ [path]: 'corrected\n' });
    expect({ halt: result.halt, haltClass: result.haltClass, dispatched: result.dispatched, sealUnchanged: result.seal === result.sealBefore, events: result.events }).toEqual({
      halt: expect.stringContaining(`Protected artifact changed: ${path}\nAttribution: feature-authored`), haltClass: 'protected-artifact', dispatched: [], sealUnchanged: true, events: false,
    });
    expect(result.halt).toContain(`  ai-conductor reseal --slug feat-x --path ${path} --reason "«why»" --clear-halt`);
  }, 30000);

  it('names every changed sealed ADR in the recovery command', async () => {
    const a = '.docs/decisions/adr-2026-10-17-a.md'; const b = '.docs/decisions/adr-2026-10-17-b.md';
    const result = await runSealedHalt({ [a]: 'corrected a\n', [b]: 'corrected b\n' });
    expect(result.halt).toContain(`  ai-conductor reseal --slug feat-x --path ${a} --path ${b} --reason "«why»" --clear-halt`);
  }, 30000);

  it('warns once about every tolerated self-amendment and continues the BUILD dispatch', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: true,
      seal: { version: 2, baselineCommit: 'approved-commit', protectedArtifacts: [], rebaselines: [] },
      selfAmendments: [
        {
          path: '.docs/architecture/feature.md',
          sealedFingerprint: 'sha256:sealed-architecture',
          currentFingerprint: 'sha256:current-architecture',
        },
        {
          path: '.docs/plans/feature.md',
          sealedFingerprint: 'sha256:sealed-plan',
          currentFingerprint: 'sha256:current-plan',
        },
      ],
      inheritedDeletions: [],
    });
    const createSeal = vi.spyOn(protectedArtifactSeal, 'createProtectedArtifactSeal').mockResolvedValue({
      version: 2,
      baselineCommit: 'approved-commit',
      protectedArtifacts: [],
      rebaselines: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatchedSteps: string[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        dispatchedSteps.push(step);
        return step === 'build'
          ? { success: false, output: 'expected stop after BUILD dispatch' }
          : { success: true };
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 1,
    });

    await conductor.run();

    expect({
      warnings: warn.mock.calls.map(([message]) => message),
      firstDispatchedStep: dispatchedSteps[0],
      firstBuildSealCreation: createSeal.mock.calls[0],
    }).toEqual({
      warnings: [expect.stringMatching(
        /\.docs\/architecture\/feature\.md.*\.docs\/plans\/feature\.md.*approved plan.*build_review/s,
      )],
      firstDispatchedStep: 'build',
      firstBuildSealCreation: [{ projectRoot, baselineCommit: 'approved-commit' }],
    });
  });

  it('keeps the clean successful BUILD path quiet', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: true,
      seal: { version: 2, baselineCommit: 'approved-commit', protectedArtifacts: [], rebaselines: [] },
      selfAmendments: [],
      inheritedDeletions: [],
    });
    vi.spyOn(protectedArtifactSeal, 'createProtectedArtifactSeal').mockResolvedValue({
      version: 2,
      baselineCommit: 'approved-commit',
      protectedArtifacts: [],
      rebaselines: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatchedSteps: string[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        dispatchedSteps.push(step);
        return { success: false, output: 'expected stop after BUILD dispatch' };
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 1,
    });

    await conductor.run();

    expect({ warnings: warn.mock.calls, dispatchedSteps }).toEqual({
      warnings: [],
      dispatchedSteps: ['build'],
    });
  });

  it('keeps a failed seal on the protected-artifact halt path without an advisory', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: false,
      reason: 'Protected artifact changed: .docs/plans/feature.md',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn(async () => {
      throw new Error('unexpected dispatch after protected-artifact seal failure');
    });
    const runner: StepRunner = { run };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 2,
    });

    await conductor.run();

    expect({
      warnings: warn.mock.calls,
      dispatches: run.mock.calls,
      halt: await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'),
      haltClass: await readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8'),
    }).toEqual({
      warnings: [],
      dispatches: [],
      halt: expect.stringMatching(/^Protected artifact changed: .docs\/plans\/feature\.md(?:\n|$)/),
      haltClass: 'protected-artifact',
    });
  });

  it('stamps lastResolvedCount on the protected-artifact halt so the halted build earns no progress re-kick', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-protected-artifact-advisory-'));
    temporaryDirectories.push(projectRoot);
    const statePath = join(projectRoot, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    // Two of three plan tasks already resolved — the live resolved count the
    // daemon's `isProgressReKickEligible` compares the sidecar stamp against.
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({
        plan_ref: '.docs/plans/feature.md',
        tasks: [
          { id: '1', name: 'one', status: 'completed' },
          { id: '2', name: 'two', status: 'completed' },
          { id: '3', name: 'three', status: 'pending' },
        ],
      }),
      'utf8',
    );

    vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
    vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
      ok: false,
      reason: 'Protected artifact changed: .docs/stories/other-feature.md',
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runner: StepRunner = {
      run: vi.fn(async () => {
        throw new Error('unexpected dispatch after protected-artifact seal failure');
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      config: {} as never,
      fromStep: 'build',
      mode: 'default',
      maxRetries: 2,
    });

    await conductor.run();

    expect({
      lastResolvedCount: await readLastResolvedCount(projectRoot),
      liveResolvedCount: await countResolvedTasks(projectRoot),
    }).toEqual({ lastResolvedCount: 2, liveResolvedCount: 2 });
  });
});

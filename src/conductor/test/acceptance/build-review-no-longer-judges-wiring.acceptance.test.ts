/**
 * Acceptance coverage for ST-1496-1 and ST-1496-3 in
 * `.docs/stories/per-task-wired-into-contracts-cost-build-cycles-th.md`.
 *
 * These specs drive the real production boundaries. The first crosses config
 * resolution, build-review input assembly, prompt construction, a faithful
 * fake at the LLM adapter, verdict persistence, and the completion predicate.
 * The second crosses artifact selection, the DECIDE land gates, and the local
 * Git commit made by `landSpec`. Lower-level tests own individual schema,
 * parser, event, residue, and documentation assertions from ST-1496-2/4/5/6/7.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';

const execFile = promisify(execFileCallback);
const dirs: string[] = [];

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
}

async function initRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'acceptance@example.com');
  await git(dir, 'config', 'user.name', 'Acceptance Test');
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: build_review routes a rubric finding to build', () => {
  it('runs the named build_review-to-build kickback for a scope-only grader FAIL', async () => {
    const mainRoot = await initRepo('build-review-wiring-');
    await writeFile(join(mainRoot, 'README.md'), '# fixture\n');
    await git(mainRoot, 'add', 'README.md');
    await git(mainRoot, 'commit', '-qm', 'base');
    const dir = join(mainRoot, '.worktrees', 'wiring-review');
    await git(mainRoot, 'worktree', 'add', '-qb', 'feature/wiring-review', dir);
    const planPath = join(dir, '.docs', 'plans', 'fixture.md');
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      planPath,
      [
        '# Implementation Plan: fixture',
        '',
        '### Task 1: add production behavior',
        '**Files:** `src/orphan.ts`',
        '',
      ].join('\n'),
    );
    await writeFile(join(dir, 'src', 'entry.ts'), 'export function main(): void {}\n');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-qm', 'add wiring-review fixture');
    await writeFile(
      join(dir, 'src', 'orphan.ts'),
      'export function orphanedProductionSurface(): string { return "unreached"; }\n',
    );
    await git(dir, 'add', 'src/orphan.ts');
    await git(dir, 'commit', '-qm', 'add unwired production surface');

    const prompts: string[] = [];
    const invoke = vi.fn<LLMProvider['invoke']>().mockImplementation(async (options) => {
      prompts.push(options.prompt);
      const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!) as {
        rubric: string; lapId: string; snapshotDigest: string;
      };
      return {
        success: true,
        output: JSON.stringify({
          kind: 'judged', rubric: projection.rubric, lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest, contractVersion: 'v1',
        findings: projection.rubric === 'scope'
          ? [{
                concernKind: 'orphanedProductionSurface is outside the approved plan',
                anchor: {
                  rubric: 'scope', path: 'src/orphan.ts', relation: 'outside-plan',
                },
              }]
            : [],
        }),
        exitCode: 0,
      };
    });
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const config: HarnessConfig = {
      build_review: { enabled: true, perTaskFloor: false },
    };
    const buildReviewRunner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config,
      planPath,
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' },
        } as never),
      },
    });

    const state: Record<string, unknown> = {};
    for (const step of ALL_STEPS) {
      if (step.name === 'build_review') break;
      state[step.name] = 'done';
    }
    state.build_review = 'pending';
    state.complexity_tier = 'S';
    state.feature_desc = 'wiring-review-fixture';
    state.track = 'technical';
    const stateFilePath = join(dir, 'conduct-state.json');
    await writeState(stateFilePath, state as ConductState);

    const calls: StepName[] = [];
    let buildStateAtDispatch: ConductState['build'];
    const runner: StepRunner = {
      run: async (step) => {
        calls.push(step);
        if (step === 'build_review') {
          return buildReviewRunner.run(step, { complexity_tier: 'S' });
        }
        // The assertion target is the named-route transition. A bounded
        // unsuccessful build dispatch stops subsequent retries after the
        // conductor has returned the failed review to BUILD.
        if (step === 'build') {
          const persisted = await readState(stateFilePath);
          if (!persisted.ok) throw new Error(persisted.error.message);
          buildStateAtDispatch = persisted.value.build;
          return { success: false, output: 'stop after named-route observation' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      config,
      maxRetries: 1,
    } as never);

    await conductor.run();

    expect(invoke).toHaveBeenCalledTimes(4);
    expect(prompts).toHaveLength(4);
    expect(prompts.filter((prompt) => prompt.includes('Build Review Scope rubric'))).toHaveLength(1);
    expect(prompts.find((prompt) => prompt.includes('Build Review Scope rubric'))).toContain('src/orphan.ts');
    expect(calls).toContain('build_review');
    expect(calls).toContain('build');
    expect(buildStateAtDispatch).toBe('in_progress');
    const completion = await checkStepCompletion(dir, 'build_review', { config });
    expect(completion.done).toBe(false);
    expect(completion.routeClass).toBe('named-route');
    expect(completion.reason).toContain('unresolved findings');
    await expect(readFile(join(dir, '.pipeline', 'build-review.json'), 'utf8'))
      .resolves.toContain('orphanedProductionSurface');
  });
});

describe('acceptance: legacy wiring notation no longer blocks plan land (ST-1496-3)', () => {
  it('lands a technical plan containing unresolved and malformed legacy Wired-into prose', async () => {
    const dir = await initRepo('land-legacy-wiring-');
    await writeFile(join(dir, 'README.md'), '# fixture\n');
    await git(dir, 'add', 'README.md');
    await git(dir, 'commit', '-qm', 'base');
    await git(dir, 'checkout', '-qb', 'spec/legacy-wiring-plan');

    await mkdir(join(dir, '.docs', 'track'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs', 'track', 'legacy-wiring-plan.md'),
      '# Track\n\nTrack: technical\n',
    );
    await writeFile(
      join(dir, '.docs', 'stories', 'legacy-wiring-plan.md'),
      [
        '**Status:** Accepted',
        '',
        '# Stories: legacy wiring plan',
        '',
        '## Story 1',
        '',
        '- Given legacy prose, when the plan lands, then it is ignored.',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(dir, '.docs', 'plans', 'legacy-wiring-plan.md'),
      [
        '# Implementation Plan: legacy wiring plan',
        '',
        '**Stories:** .docs/stories/legacy-wiring-plan.md',
        '',
        '### Task 1: preserve old prose',
        '**Files:** `src/example.ts`',
        '**Wired-into:** `src/missing.ts#missingCaller`',
        '**Wired-into:** this is malformed legacy prose',
        '',
      ].join('\n'),
    );

    const result = await landSpec(
      { name: 'fixture', canonicalPath: dir },
      'legacy wiring plan',
      dir,
      undefined,
      { ownerConfig: { spec_owner: 'operator' } },
    );

    expect(result.branch).toBe('spec/legacy-wiring-plan');
    expect(await git(dir, 'log', '-1', '--pretty=%s')).toContain('spec: land authored artifacts');
    expect(await readFile(join(dir, '.docs', 'plans', 'legacy-wiring-plan.md'), 'utf-8'))
      .toContain('this is malformed legacy prose');
  });
});

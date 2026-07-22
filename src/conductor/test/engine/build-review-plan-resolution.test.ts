import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';

// ── build_review plan resolution (#407 regression) ───────────────────────────
//
// With several features in flight the worktree's `.docs/plans/` holds many
// plans. build_review must grade the diff against THIS feature's plan (resolved
// by slug, the same way the build step resolves it) — never the unscoped
// `.docs/plans/*.md` sort()[last] guess, which grabbed an alphabetically-later
// unrelated plan and FAILed the build on a spurious scope/completeness mismatch
// while the build step had built the correct feature.

const execFileAsync = promisify(execFile);

const PLAN_FEATURE_SENTINEL = 'PLAN_BODY_FOR_BUILD_PROGRESS_DISPLAY';
const PLAN_DECOY_SENTINEL = 'PLAN_BODY_FOR_WRITING_SYSTEM_TESTS';

/** Provider that records the prompt of every invoke() and returns a canned success. */
function capturingProvider() {
  const invokeCalls: InvokeOptions[] = [];
  const provider: LLMProvider = {
    invoke: vi.fn(async (opts: InvokeOptions): Promise<InvokeResult> => {
      invokeCalls.push(opts);
      return { success: true, output: 'PASS', exitCode: 0 };
    }),
    invokeInteractive: vi.fn(async (): Promise<void> => {}),
  };
  return { provider, invokeCalls };
}

describe('build_review resolves the feature-scoped plan, not the alphabetically-last one', () => {
  let dir: string;

  function realGit(): GitRunner {
    return async (args: string[]) => {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
        return { exitCode: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
      }
    };
  }

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', ['-C', dir, ...args]);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-plan-resolution-'));

    // Two plans in the shared directory. The decoy sorts AFTER the feature's
    // plan ("writing-…" > "build-…"), so the old sort()[last] logic would have
    // picked it. resolveFeaturePlanPath must slug-match the feature instead.
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs', 'plans', 'build-progress-1-based-display.md'),
      `# Implementation Plan: Build progress display should be 1-based\n\n${PLAN_FEATURE_SENTINEL}\n`,
      'utf-8',
    );
    await writeFile(
      join(dir, '.docs', 'plans', 'writing-system-tests-red-exit-gate.md'),
      `# Implementation Plan: writing-system-tests RED exit gate\n\n${PLAN_DECOY_SENTINEL}\n`,
      'utf-8',
    );

    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'base.txt'), 'base\n');
    await git('add', '.');
    await git('commit', '-m', 'base');
    await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

    await git('checkout', '-b', 'feature/build-progress');
    await writeFile(join(dir, 'feature.txt'), 'the build-progress change\n');
    await git('add', 'feature.txt');
    await git('commit', '-m', 'build-progress change');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('feeds the grader the feature slug plan, not the alphabetically-last decoy', async () => {
    const { provider, invokeCalls } = capturingProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', dir, {
      featureDesc: 'build-progress-1-based-display',
      gitRunner: realGit(),
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable'] } as HarnessConfig,
    });

    await runner.run('build_review', { feature_desc: 'build-progress-1-based-display' } as ConductState);

    expect(invokeCalls.length).toBeGreaterThan(0);
    const graderPrompt = invokeCalls[0].prompt ?? '';
    expect(graderPrompt).toContain(PLAN_FEATURE_SENTINEL);
    expect(graderPrompt).not.toContain(PLAN_DECOY_SENTINEL);
  });

  it('fails closed (no grader dispatch) when the feature plan cannot be scoped among many', async () => {
    const { provider, invokeCalls } = capturingProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', dir, {
      // A feature_desc that matches NO plan stem: must not grade a random plan.
      featureDesc: 'some-unrelated-feature-with-no-plan',
      gitRunner: realGit(),
      modelOverride: 'fable',
      config: { model_fallback_ladder: ['fable'] } as HarnessConfig,
    });

    const result = await runner.run('build_review', {
      feature_desc: 'some-unrelated-feature-with-no-plan',
    } as ConductState);

    expect(result.success).toBe(false);
    expect(invokeCalls.length).toBe(0);
    expect(result.output ?? '').toMatch(/could not scope this feature's plan/);
  });
});

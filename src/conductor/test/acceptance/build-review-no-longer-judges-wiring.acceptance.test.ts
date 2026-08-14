/**
 * Acceptance coverage for build_review's retired wiring rubric and for
 * ST-1496-3 in
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

describe('acceptance: build_review no longer judges wiring', () => {
  it('passes a production surface that no configured entry point reaches', async () => {
    const dir = await initRepo('build-review-no-wiring-');
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
    await git(dir, 'commit', '-qm', 'base');
    await git(dir, 'checkout', '-qb', 'feature/no-wiring-review');
    await writeFile(
      join(dir, 'src', 'orphan.ts'),
      'export function orphanedProductionSurface(): string { return "unreached"; }\n',
    );
    await git(dir, 'add', 'src/orphan.ts');
    await git(dir, 'commit', '-qm', 'add unwired production surface');

    let capturedPrompt = '';
    const invoke = vi.fn<LLMProvider['invoke']>().mockImplementation(async (options) => {
      capturedPrompt = options.prompt;
      await writeFile(
        join(dir, '.pipeline', 'build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          reasons: [],
          rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
        }),
      );
      return { success: true, output: 'graded', exitCode: 0 };
    });
    const provider: LLMProvider = {
      invoke,
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    // A stale consumer config still carrying the retired key must neither fail
    // validation nor reach the grader.
    const config = { wiring: { entry_points: ['src/entry.ts'] } } as unknown as HarnessConfig;
    const buildReviewRunner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config,
      planPath,
    });

    const result = await buildReviewRunner.run('build_review', { complexity_tier: 'S' });

    expect(result.success).toBe(true);
    expect(capturedPrompt.toLowerCase()).not.toContain('wiring');
    expect(capturedPrompt).not.toContain('src/entry.ts');
    expect(capturedPrompt).toMatch(/exactly these four rubric items/i);

    const completion = await checkStepCompletion(dir, 'build_review', { config });
    expect(completion.done).toBe(true);
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

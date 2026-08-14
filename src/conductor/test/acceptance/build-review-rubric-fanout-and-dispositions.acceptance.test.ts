/**
 * Acceptance RED for #1542.
 *
 * Covers: FR-1, FR-2, FR-5, FR-6, FR-10, FR-11, FR-22, FR-24, FR-25
 *
 * These scenarios stop at existing public production boundaries. The first
 * drives the real build_review entry point through source-input assembly and
 * provider dispatch. The second checks the pre-boot operator command surface.
 * Typed result validation, disposition transactions, event reduction,
 * reporting, and publication stay at their narrower plan-owned seams until
 * those contracts exist; this file deliberately does not guess their JSON.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderFullHelp } from '../../src/cli.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

const execFile = promisify(execFileCallback);
const dirs: string[] = [];

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
}

async function fixtureRepo(): Promise<{ dir: string; planPath: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'build-review-rubric-acceptance-'));
  dirs.push(dir);
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'acceptance@example.com');
  await git(dir, 'config', 'user.name', 'Acceptance Test');
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  const planPath = join(dir, '.docs', 'plans', 'fixture.md');
  await writeFile(planPath, '# Plan\n\n### Task 1: add reviewed behavior\n');
  await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
  await writeFile(join(dir, 'src', 'feature.ts'), 'export const reviewed = false;\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-qm', 'base');
  await git(dir, 'checkout', '-qb', 'feature/rubric-fanout');
  await writeFile(join(dir, 'src', 'feature.ts'), 'export const reviewed = true;\n');
  await git(dir, 'add', 'src/feature.ts');
  await git(dir, 'commit', '-qm', 'implement reviewed behavior');
  return { dir, planPath, head: await git(dir, 'rev-parse', 'HEAD') };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: independent build_review rubric execution', () => {
  it('dispatches five isolated rubric sessions from one immutable review lap by default', async () => {
    const { dir, planPath } = await fixtureRepo();
    const prompts: string[] = [];
    let active = 0;
    let peak = 0;
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        prompts.push(options.prompt);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return { success: false, output: 'fixture branch stops after dispatch observation', exitCode: 1 };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const config = {
      build_review: { enabled: true, perTaskFloor: false },
      wiring: { entry_points: ['src/feature.ts'] },
    } as HarnessConfig;
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config,
      planPath,
      pipelineDir: join(dir, '.pipeline'),
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' },
        } as never),
      },
    });

    await runner.run('build_review', {
      complexity_tier: 'L',
      feature_desc: 'rubric-fanout',
      track: 'product',
    });

    expect(provider.invoke).toHaveBeenCalledTimes(5);
    expect(peak).toBe(5);
    expect(prompts).toHaveLength(5);
    for (const rubric of ['Tautology', 'Scope', 'Root Cause', 'Completeness', 'Wiring']) {
      expect(prompts.filter((prompt) => prompt.includes(rubric))).toHaveLength(1);
    }
  });

  it('advertises read-only finding inspection and exact-finding acceptance as local commands', () => {
    const help = renderFullHelp();

    expect(help).toContain('build-review findings');
    expect(help).toContain('build-review accept');
    expect(help).toMatch(/lap/i);
    expect(help).toMatch(/finding/i);
    expect(help).toMatch(/rationale/i);
  });

  it('rematerializes a current lap from cached clean rubric judgements without redispatching providers', async () => {
    const { dir, planPath } = await fixtureRepo();
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        return {
          success: true,
          output: JSON.stringify({
            kind: 'judged',
            rubric: projection.rubric,
            lapId: projection.lapId,
            snapshotDigest: projection.snapshotDigest,
            contractVersion: 'v1',
            findings: [],
            verdict: 'PASS',
          }),
          exitCode: 0,
        };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config: {
        build_review: { enabled: true, perTaskFloor: false },
        wiring: { entry_points: ['src/feature.ts'] },
      } as HarnessConfig,
      planPath,
      pipelineDir: join(dir, '.pipeline'),
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' },
        } as never),
      },
    });

    const state = { complexity_tier: 'L', feature_desc: 'cache-rematerialization', track: 'product' } as const;
    await runner.run('build_review', state);
    await runner.run('build_review', state);

    expect(provider.invoke).toHaveBeenCalledTimes(5);
  });

  it('fans operator reseal evidence into Scope alone while retaining the legacy scalar prompt contract', async () => {
    const { dir, planPath, head } = await fixtureRepo();
    const rationale = 'Operator approved the protected story amendment after review.';
    await writeFile(join(dir, '.pipeline', 'protected-artifact-seal.json'), `${JSON.stringify({
      version: 2,
      baselineCommit: head,
      protectedArtifacts: [],
      rebaselines: [{
        trigger: 'operator-reseal',
        paths: ['.docs/stories/resealed-story.md'],
        reason: rationale,
        fromCommit: 'reseal-base',
        toCommit: head,
      }],
    })}\n`);
    const prompts: string[] = [];
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        prompts.push(options.prompt);
        return { success: false, output: 'stop after fan-out observation', exitCode: 1 };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config: { build_review: { enabled: true, perTaskFloor: false } } as HarnessConfig,
      planPath,
      pipelineDir: join(dir, '.pipeline'),
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' },
        } as never),
      },
    });

    await runner.run('build_review', { complexity_tier: 'L', feature_desc: 'reseal-fanout', track: 'product' });

    const scopePrompt = prompts.find((prompt) => prompt.includes('Scope'))!;
    expect(scopePrompt).toContain(rationale);
    expect(scopePrompt).toContain('.docs/stories/resealed-story.md');
    expect(prompts.filter((prompt) => prompt.includes(rationale))).toEqual([scopePrompt]);
  });
});

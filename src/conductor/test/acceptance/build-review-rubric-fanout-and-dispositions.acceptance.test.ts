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
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderFullHelp } from '../../src/cli.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { computeBuildReviewMetrics } from '../../src/engine/build-tail-rollup.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

const execFile = promisify(execFileCallback);
const dirs: string[] = [];

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
}

async function fixtureRepo(): Promise<{ dir: string; planPath: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-rubric-acceptance-'));
  dirs.push(root);
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'acceptance@example.com');
  await git(root, 'config', 'user.name', 'Acceptance Test');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  const rootPlanPath = join(root, '.docs', 'plans', 'fixture.md');
  await writeFile(rootPlanPath, '# Plan\n\n### Task 1: add reviewed behavior\n');
  await writeFile(join(root, '.gitignore'), '.pipeline/\n.worktrees/\n');
  await writeFile(join(root, 'src', 'feature.ts'), 'export const reviewed = false;\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'base');
  const dir = join(root, '.worktrees', 'rubric-fanout');
  await git(root, 'worktree', 'add', '-qb', 'feature/rubric-fanout', dir, 'main');
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  const planPath = join(dir, '.docs', 'plans', 'fixture.md');
  await writeFile(join(dir, 'src', 'feature.ts'), 'export const reviewed = true;\n');
  await git(dir, 'add', 'src/feature.ts');
  await git(dir, 'commit', '-qm', 'implement reviewed behavior');
  return { dir, planPath, head: await git(dir, 'rev-parse', 'HEAD') };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: independent build_review rubric execution', () => {
  it('dispatches four isolated rubric sessions from one immutable review lap by default', async () => {
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

    expect(provider.invoke).toHaveBeenCalledTimes(4);
    expect(peak).toBe(4);
    expect(prompts).toHaveLength(4);
    for (const rubric of ['Tautology', 'Scope', 'Root Cause', 'Completeness']) {
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

    expect(provider.invoke).toHaveBeenCalledTimes(4);
  });

  it('uses each rubric\'s registered skill and resolved mixed model policy through the real runner', async () => {
    const { dir, planPath } = await fixtureRepo();
    const calls: Array<{ prompt: string; model: string | undefined }> = [];
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        calls.push({ prompt: options.prompt, model: options.model });
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        return { success: true, output: JSON.stringify({ kind: 'judged', rubric: projection.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: 'v1', findings: [], verdict: 'PASS' }), exitCode: 0 };
      }), invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      providerKey: 'codex', planPath, pipelineDir: join(dir, '.pipeline'),
      config: { build_review: { enabled: true, perTaskFloor: false, rubrics: { scope: { model: 'gpt-5.6-sol', model_fallback_ladder: ['gpt-5.6-terra'] }, rootCause: { model: 'gpt-5.6-terra' } } }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' } } as never) },
    });
    await expect(runner.run('build_review', { complexity_tier: 'L', feature_desc: 'mixed-policy', track: 'product' })).resolves.toMatchObject({ success: true });
    expect(calls.map(({ prompt, model }) => ({ skill: prompt.match(/^\$(build-review-[\w-]+)/m)?.[1], model }))).toEqual(expect.arrayContaining([
      { skill: 'build-review-scope', model: 'gpt-5.6-sol' },
      { skill: 'build-review-root-cause', model: 'gpt-5.6-terra' },
    ]));
  });

  it.each([
    ['an unresolved finding', true],
    ['an infrastructure failure', false],
  ])('fails closed in both runner and completion predicate for %s', async (_name, returnFinding) => {
    const { dir, planPath } = await fixtureRepo();
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        if (projection.rubric === 'scope' && !returnFinding) return { success: false, output: 'fake provider outage', exitCode: 1 };
        const findings = projection.rubric === 'scope' && returnFinding ? [{ concernKind: 'unresolved surface', anchor: { rubric: 'scope', path: 'src/feature.ts', relation: 'outside-plan' } }] : [];
        return { success: true, output: JSON.stringify({ kind: 'judged', rubric: projection.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: 'v1', findings, verdict: findings.length ? 'FAIL' : 'PASS' }), exitCode: 0 };
      }), invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, { planPath, pipelineDir: join(dir, '.pipeline'), config: { build_review: { enabled: true, perTaskFloor: false }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig, buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' } } as never) } });
    const result = await runner.run('build_review', { complexity_tier: 'L', feature_desc: 'blocking-branch', track: 'product' });
    const completion = await checkStepCompletion(dir, 'build_review', { sessionStartedAt: Date.now() - 1_000 });
    expect({ result: result.success, done: completion.done, route: completion.routeClass }).toEqual({ result: false, done: false, route: 'named-route' });
  });

  it('converges a current Scope finding to completion after the operator accepts its exact recomputed identity', async () => {
    const { dir, planPath } = await fixtureRepo();
    let providerCalls = 0;
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        providerCalls += 1;
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        const findings = projection.rubric === 'scope'
          ? [{ concernKind: 'outside approved plan', anchor: { rubric: 'scope', path: 'src/feature.ts', relation: 'outside-plan' } }]
          : [];
        return {
          success: true,
          output: JSON.stringify({
            kind: 'judged', rubric: projection.rubric, lapId: projection.lapId,
            snapshotDigest: projection.snapshotDigest, contractVersion: 'v1', findings,
            verdict: findings.length === 0 ? 'PASS' : 'FAIL',
          }),
          exitCode: 0,
        };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config: { build_review: { enabled: true, perTaskFloor: false }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig,
      planPath,
      pipelineDir: join(dir, '.pipeline'),
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' },
        } as never),
      },
    });
    const state = { complexity_tier: 'L', feature_desc: 'accepted-finding-recomputation', track: 'product' } as const;

    const first = await runner.run('build_review', state);
    const aggregate = JSON.parse(await readFile(join(dir, '.pipeline', 'build-review.json'), 'utf8'));
    const scope = aggregate.results.scope;
    const finding = scope.kind === 'judged' ? scope.findings[0] : undefined;
    const identity = finding && canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: scope.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
    });
    const accepted = identity && await new BuildReviewDispositionStore(dir).append({
      feature: { version: 'v1', repository: await realpath(join(dir, '..', '..')), feature: 'rubric-fanout' },
      finding: identity,
      sourceLapId: aggregate.lapId,
      summary: finding.concernKind,
      rationale: 'The operator accepts this explicitly bounded finding.',
      operator: 'acceptance-operator',
    });
    const second = await runner.run('build_review', state);
    const completion = await checkStepCompletion(dir, 'build_review', { sessionStartedAt: Date.now() - 1_000 });

    expect({ first: first.success, accepted, second: second.success, completion: completion.done, calls: providerCalls }).toMatchObject({
      first: false,
      accepted: { ok: true },
      second: true,
      completion: true,
      calls: 4,
    });
  });

  it('records neutral skips and current rubric metrics without spending providers on skipped branches', async () => {
    const { dir, planPath } = await fixtureRepo();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(dir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    let providerCalls = 0;
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        providerCalls += 1;
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        return { success: true, output: JSON.stringify({ kind: 'judged', rubric: projection.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: 'v1', findings: [], verdict: 'PASS' }), exitCode: 0 };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config: { build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: false } } } } as HarnessConfig,
      planPath, pipelineDir: join(dir, '.pipeline'), events,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' } } as never) },
    });
    const result = await runner.run('build_review', { complexity_tier: 'L', feature_desc: 'neutral-skips', track: 'product' });
    persister.stop();
    const ledger = (await readFile(join(dir, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const aggregate = JSON.parse(await readFile(join(dir, '.pipeline', 'build-review.json'), 'utf8'));

    expect({ success: result.success, calls: providerCalls, coverage: aggregate.coverage, metrics: computeBuildReviewMetrics(ledger) }).toMatchObject({
      success: true, calls: 3, coverage: { tautology: 'skipped' }, metrics: { skipped: 1, cacheHits: 0 },
    });
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

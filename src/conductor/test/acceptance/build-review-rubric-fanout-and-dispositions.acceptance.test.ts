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
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderFullHelp } from '../../src/cli.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { dispatchBuildReviewAccept } from '../../src/engine/build-review-cli.js';
import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { deriveBuildReviewRubricProjections } from '../../src/engine/build-review-projections.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { computeBuildReviewMetrics } from '../../src/engine/build-tail-rollup.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
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

/** The closed projection is the final paragraph after the rubric's JSON shape example. */
function projectionFromPrompt(prompt: string): { rubric: string; lapId: string; snapshotDigest: string; digest: string } {
  return JSON.parse(prompt.split('\n\n').at(-1)!) as { rubric: string; lapId: string; snapshotDigest: string; digest: string };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: independent build_review rubric execution', () => {
  it('wires the daemon feature event persister into its lifecycle runner', () => {
    // Daemon mode owns the feature worktree EventPersister. The runner must
    // receive that exact feature-scoped emitter, otherwise build_review's
    // optional event callback silently drops the rubric and outer-verdict
    // records before they reach .pipeline/events.jsonl.
    const daemonSource = readFileSync(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8');
    const runnerConstruction = daemonSource.match(
      /const stepRunner = new DefaultStepRunner\([\s\S]*?\n    \);/,
    )?.[0];

    expect(runnerConstruction).toContain('events: featureEvents,');
  });

  it('persists an early disposition refusal through the same-schema external event ledger', async () => {
    const { dir } = await fixtureRepo();
    await expect(dispatchBuildReviewAccept({
      kind: 'accept', feature: 'rubric-fanout', lapId: 'lap-current', findingId: 'sha256:missing', rationale: 'risk',
    }, {
      cwd: dir, isInteractive: false, resolveOperator: () => 'operator', print: () => {},
    })).resolves.toBe(1);

    const ledger = await readFile(join(dir, '.pipeline', 'pipeline-events.jsonl'), 'utf8');
    expect(JSON.parse(ledger.trim())).toMatchObject({
      type: 'build_review_disposition_refused', feature: 'rubric-fanout',
      reason: 'non-interactive-or-unidentified-operator',
    });
  });

  it('dispatches four isolated rubric sessions from one immutable review lap when tautology is opted in', async () => {
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
      build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: true }, rootCause: { enabled: true } } },
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
        const projection = projectionFromPrompt(options.prompt);
        return {
          success: true,
          output: JSON.stringify({
            kind: 'judged',
            rubric: projection.rubric,
            lapId: projection.lapId,
            snapshotDigest: projection.snapshotDigest,
            contractVersion: 'v3',
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
        build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: true }, rootCause: { enabled: true } } },
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

  it('misses Scope alone after production assembly observes a new operator reseal', async () => {
    const { dir, planPath, head } = await fixtureRepo();
    const projections: Array<{ rubric: string; digest: string; snapshotDigest: string }> = [];
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        const projection = projectionFromPrompt(options.prompt);
        projections.push({ rubric: projection.rubric, digest: projection.digest, snapshotDigest: projection.snapshotDigest });
        return { success: true, output: JSON.stringify({ kind: 'judged', rubric: projection.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' }), exitCode: 0 };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(dir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config: { build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: true }, rootCause: { enabled: true } } }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig,
      events, planPath, pipelineDir: join(dir, '.pipeline'),
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' } } as never) },
    });
    const state = { complexity_tier: 'L', feature_desc: 'reseal-cache-isolation', track: 'product' } as const;
    const projectionSource = (inputs: Awaited<ReturnType<typeof assembleBuildReviewInputs>>) =>
      deriveBuildReviewRubricProjections({
        lapId: 'cache-isolation-projection', inputs,
        tautology: { changedTestSelectors: [], revertedProductionManifest: [], preflight: { classification: 'approved-exception' } },
      } as never);
    const beforeReseal = projectionSource(await assembleBuildReviewInputs(
      makeGitRunner(dir), planPath,
      { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' } } as never) },
    ));

    await runner.run('build_review', state);
    await writeFile(join(dir, '.pipeline', 'protected-artifact-seal.json'), `${JSON.stringify({
      version: 2, baselineCommit: head, protectedArtifacts: [], rebaselines: [{
        trigger: 'operator-reseal', paths: ['.docs/stories/resealed-story.md'],
        reason: 'Operator approved the protected story amendment.', fromCommit: 'reseal-base', toCommit: head,
      }],
    })}\n`);
    const afterReseal = projectionSource(await assembleBuildReviewInputs(
      makeGitRunner(dir), planPath,
      { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' } } as never) },
    ));
    await runner.run('build_review', state);
    persister.stop();

    expect(projections).toHaveLength(5);
    const initial = new Map(projections.slice(0, 4).map((projection) => [projection.rubric, projection]));
    const resealedScope = projections[4]!;
    expect(resealedScope.rubric).toBe('scope');
    expect(resealedScope.digest).not.toBe(initial.get('scope')!.digest);
    for (const rubric of ['tautology', 'rootCause', 'completeness']) {
      expect(projections.filter((projection) => projection.rubric === rubric)).toHaveLength(1);
      expect(beforeReseal[rubric as 'tautology' | 'rootCause' | 'completeness'].digest).toBe(
        afterReseal[rubric as 'tautology' | 'rootCause' | 'completeness'].digest,
      );
    }
    expect(beforeReseal.scope.digest).not.toBe(afterReseal.scope.digest);
    const ledger = await readFile(join(dir, '.pipeline', 'events.jsonl'), 'utf8');
    expect(ledger.match(/build_review_cache_hit/g)).toHaveLength(3);
  });

  it('uses each mixed-provider rubric\'s native default model, effort, and fallback ladder through the real runner', async () => {
    const { dir, planPath } = await fixtureRepo();
    const calls: Array<{ provider: string; prompt: string; model: string | undefined; effort: string | undefined; sessionId: string | undefined }> = [];
    const fake = (provider: string): LLMProvider => ({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async (options) => {
        calls.push({ provider, prompt: options.prompt, model: options.model, effort: options.effort, sessionId: options.sessionId });
        const projection = projectionFromPrompt(options.prompt);
        // Make the real provider executor walk the resolved provider-native
        // ladder. The model it retries is the observable policy boundary.
        if (options.model === (provider === 'claude' ? 'opus' : 'gpt-5.6-sol')) {
          return { success: false, output: 'fixture model unavailable', exitCode: 1, modelUnavailable: true };
        }
        return { success: true, output: JSON.stringify({ kind: 'judged', rubric: projection.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' }), exitCode: 0 };
      }), invokeInteractive: vi.fn().mockResolvedValue(undefined),
    });
    const claude = fake('claude');
    const codex = fake('codex');
    const runtimes = new ProviderRuntimeSet([
      { key: 'claude', provider: claude, lifecycleCapability: claude.lifecycleCapability, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
      { key: 'codex', provider: codex, lifecycleCapability: codex.lifecycleCapability, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) },
    ]);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(dir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const runner = new DefaultStepRunner(codex, 'maker-session', dir, {
      providerKey: 'codex', providerRuntimes: runtimes, sessionStore: new ProviderSessionStore({ createSessionId: (() => { let id = 0; return () => `review-session-${++id}`; })() }), events, planPath, pipelineDir: join(dir, '.pipeline'),
      config: { llm_provider: ['codex', 'claude'], build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: true, llm_provider: 'claude' }, scope: { llm_provider: 'codex' }, rootCause: { enabled: true, llm_provider: 'claude', effort: 'medium' }, completeness: {} } }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: 'fixture-head', outcome: 'PASS' } } as never) },
    });
    const result = await runner.run('build_review', { complexity_tier: 'L', feature_desc: 'mixed-policy', track: 'product' });
    expect(result.success, result.output).toBe(true);
    const observed = calls.map(({ provider, prompt, model, effort }) => ({
      provider, skill: prompt.match(/^[/$](build-review-[\w-]+)/m)?.[1], model, effort,
    }));
    expect(observed).toEqual(expect.arrayContaining([
      { provider: 'claude', skill: 'build-review-tautology', model: 'opus', effort: 'high' },
      { provider: 'claude', skill: 'build-review-tautology', model: 'sonnet', effort: 'high' },
      { provider: 'codex', skill: 'build-review-scope', model: 'gpt-5.6-sol', effort: 'medium' },
      { provider: 'codex', skill: 'build-review-scope', model: 'gpt-5.6-terra', effort: 'medium' },
      { provider: 'claude', skill: 'build-review-root-cause', model: 'opus', effort: 'medium' },
      { provider: 'claude', skill: 'build-review-root-cause', model: 'sonnet', effort: 'medium' },
      { provider: 'codex', skill: 'build-review-completeness', model: 'gpt-5.6-sol', effort: 'high' },
      { provider: 'codex', skill: 'build-review-completeness', model: 'gpt-5.6-terra', effort: 'high' },
    ]));
    expect(JSON.parse(await readFile(join(dir, '.pipeline', 'build-review.json'), 'utf8')).coverage).toEqual({
      tautology: 'judged', scope: 'judged', rootCause: 'judged', completeness: 'judged',
    });
    expect((await readFile(join(dir, '.pipeline', 'events.jsonl'), 'utf8')).match(/build_review_rubric_result/g)).toHaveLength(4);
    persister.stop();
  });

  it.each([
    ['an unresolved finding', true],
    ['an infrastructure failure', false],
  ])('fails closed in both runner and completion predicate for %s', async (_name, returnFinding) => {
    const { dir, planPath, head } = await fixtureRepo();
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        if (projection.rubric === 'scope' && !returnFinding) return { success: false, output: 'fake provider outage', exitCode: 1 };
        const findings = projection.rubric === 'scope' && returnFinding ? [{
          concernKind: 'out-of-plan-change',
          summary: 'src/feature.ts changes an unresolved surface.',
          evidenceLocations: ['src/feature.ts:1'],
          anchor: { rubric: 'scope', path: 'src/feature.ts', relation: 'not-authorized-by-plan' },
        }] : [];
        return { success: true, output: JSON.stringify({ findings }), exitCode: 0 };
      }), invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, { planPath, pipelineDir: join(dir, '.pipeline'), config: { build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: true }, rootCause: { enabled: true } } }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig, buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' } } as never) } });
    const result = await runner.run('build_review', { complexity_tier: 'L', feature_desc: 'blocking-branch', track: 'product' });
    const completion = await checkStepCompletion(dir, 'build_review', { sessionStartedAt: Date.now() - 1_000 });
    expect({ result: result.success, done: completion.done, route: completion.routeClass }).toEqual({
      result: returnFinding,
      done: false,
      route: returnFinding ? 'named-route' : 'absent',
    });
  });

  it('converges a current Scope finding to completion after the operator accepts its exact recomputed identity', async () => {
    const { dir, planPath, head } = await fixtureRepo();
    let providerCalls = 0;
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        providerCalls += 1;
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!);
        const findings = projection.rubric === 'scope'
          ? [{
            concernKind: 'out-of-plan-change',
            summary: 'src/feature.ts changes behavior outside the approved plan.',
            evidenceLocations: ['src/feature.ts:1', '.docs/plans/fixture.md:3'],
            anchor: { rubric: 'scope', path: 'src/feature.ts', relation: 'not-authorized-by-plan' },
          }]
          : [];
        return {
          success: true,
          output: JSON.stringify({ findings }),
          exitCode: 0,
        };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config: { build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: true }, rootCause: { enabled: true } } }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig,
      planPath,
      pipelineDir: join(dir, '.pipeline'),
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' },
        } as never),
      },
    });
    const state = { complexity_tier: 'L', feature_desc: 'accepted-finding-recomputation', track: 'product' } as const;

    const first = await runner.run('build_review', state);
    const aggregate = JSON.parse(await readFile(join(dir, '.pipeline', 'build-review.json'), 'utf8'));
    const scope = aggregate.results.scope;
    const finding = scope.kind === 'judged' ? scope.findings[0] : undefined;
    const retainedFinding = finding as (typeof finding & {
      readonly summary: string;
      readonly evidenceLocations: readonly string[];
    });
    const identity = finding && canonicalizeBuildReviewFindingIdentity({
      rubric: 'scope', contractVersion: scope.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
    });
    const accepted = identity && await new BuildReviewDispositionStore(dir).append({
      feature: { version: 'v1', repository: await realpath(join(dir, '..', '..')), feature: 'rubric-fanout' },
      finding: identity,
      sourceLapId: aggregate.lapId,
      summary: retainedFinding.summary,
      rationale: 'The operator accepts this explicitly bounded finding.',
      operator: 'acceptance-operator',
    });
    const second = await runner.run('build_review', state);
    const completion = await checkStepCompletion(dir, 'build_review', { sessionStartedAt: Date.now() - 1_000 });

    expect(retainedFinding).toMatchObject({
      summary: 'src/feature.ts changes behavior outside the approved plan.',
      evidenceLocations: ['src/feature.ts:1', '.docs/plans/fixture.md:3'],
    });
    expect({ first: first.success, accepted, second: second.success, completion: completion.done, calls: providerCalls }).toMatchObject({
      first: true,
      accepted: { ok: true, record: { summary: 'src/feature.ts changes behavior outside the approved plan.' } },
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
        return { success: true, output: JSON.stringify({ kind: 'judged', rubric: projection.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' }), exitCode: 0 };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'maker-session', dir, {
      config: { build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: false }, rootCause: { enabled: true } } } } as HarnessConfig,
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

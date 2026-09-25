// Covers: task:33, task:4
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { Conductor } from '../test-conductor.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function runCompatibilityLap(custom: boolean, verdictShape: 'aggregate' | 'scalar' = 'aggregate') {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-routing-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, step.name === 'build_review' ? 'pending' : 'done'])) as ConductState;
  state.complexity_tier = 'M';
  await writeState(join(root, '.pipeline', 'state.json'), state);
  const aggregate = joinBuildReviewRubricOutcomes({
    lapId: parseBuildReviewLapId('lap-compatibility')!, snapshotDigest: 'sha256:snapshot',
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: parseBuildReviewLapId('lap-compatibility')!,
        snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', verdict: 'FAIL',
        findings: [{
          concernKind: 'test-insensitive', summary: 'The changed test does not observe the behavior.',
          evidenceLocations: ['test/example.test.ts:8'],
          anchor: {
            rubric: 'testQuality',
            locus: {
              path: 'test/example.test.ts', contentHash: `sha256:${'a'.repeat(64)}`,
              display: 'example behavior',
            },
          },
        }],
      },
    },
  });
  const dispatched: StepName[] = [];
  const runner: StepRunner = { run: async (step) => {
    dispatched.push(step);
    if (step === 'build_review') {
      await writeFile(join(root, '.pipeline', 'build-review.json'), JSON.stringify(verdictShape === 'aggregate' ? aggregate : {
        verdict: 'FAIL', rubric: { testQuality: true }, reasons: ['legacy scalar failure'],
      }));
      return { success: false, output: 'build review found a failure' };
    }
    return { success: true };
  } };
  const conductor = new Conductor({
    projectRoot: root, stateFilePath: join(root, '.pipeline', 'state.json'), stepRunner: runner,
    events: new ConductorEventEmitter(), fromStep: 'build_review', mode: 'auto', daemon: true,
    config: { build_review: {
      rubrics: { testQuality: { enabled: true } },
      ...(custom ? { custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project' } } } : {}),
    } },
    buildReviewEffectiveResolver: async () => ({ ok: false, reason: 'build-review feature identity is unavailable' }) as never,
  } as never);
  await conductor.run();
  return { dispatched, halt: await (async () => {
    try { return await (await import('node:fs/promises')).readFile(join(root, '.pipeline', 'HALT'), 'utf8'); } catch { return ''; }
  })() };
}

describe('custom build-review compatibility routing', () => {
  it('launches a built-in peer of a custom lap in Claude read-only mode over the frozen input', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-routing-launch-'));
    roots.push(root);
    const config = {
      llm_provider: 'claude', build_review: {
        enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: true } },
        custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review the frozen candidate.', source: 'project', llm_provider: 'claude' } },
      },
    } as HarnessConfig;
    const launches: Array<{ executable: string; args: string[]; cwd: string | undefined; prompt: string }> = [];
    const provider = new ClaudeProvider(undefined, ((executable, args, options) => {
      const prompt = typeof options.input === 'string' ? options.input : '';
      launches.push({ executable, args: [...args], cwd: options.cwd, prompt });
      const result = prompt.includes('portable-policy')
        ? { kind: 'custom-findings', version: 'v1', findings: [] }
        : { findings: [] };
      return Promise.resolve({
        stdout: JSON.stringify({ type: 'result', result: JSON.stringify(result), structured_output: result }), stderr: '', exitCode: 0, failed: false,
      }) as never;
    }) as never);
    const frozenHead = join(root, '.pipeline', 'frozen', 'head');
    const frozenBaseline = join(root, '.pipeline', 'frozen', 'baseline');
    await Promise.all([mkdir(frozenHead, { recursive: true }), mkdir(frozenBaseline, { recursive: true })]);
    const source = {
      identity: { snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' },
      baselinePath: frozenBaseline, headPath: frozenHead,
    };
    const runner = new DefaultStepRunner(provider, 'mixed-routing', root, {
      featureDesc: 'feature',
      config,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: root, feature: 'feature' }, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }) as never,
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });
    const inputs = {
      diff: 'diff --git a/src/a.ts b/src/a.ts', planBody: '# Plan', mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
      testSuiteProof: {}, sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', diff: 'diff --git a/src/a.ts b/src/a.ts', planBody: '# Plan', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [] },
      sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} },
    } as never;
    await (runner as unknown as { runRubricBuildReview: (value: unknown, config: unknown, tier: 'M') => Promise<{ success: boolean; output: string }> }).runRubricBuildReview(inputs, resolveBuildReviewConfig(config), 'M');
    const builtin = launches.find(({ prompt }) => prompt.includes('Build Review Security rubric.'));
    const custom = launches[0];
    expect(builtin).toBeDefined();
    expect(custom).toBeDefined();
    expect(builtin).toMatchObject({ executable: 'claude', cwd: frozenHead });
    expect(builtin!.args).toContain('--restricted');
    expect(builtin!.args).not.toContain('--dangerously-skip-permissions');
    for (const flag of ['--restricted', '--tools', '--allowedTools', '--strict-mcp-config']) expect(builtin!.args).toContain(flag);
    expect(builtin!.args).toEqual(expect.arrayContaining(custom!.args.filter((value) => ['--restricted', '--tools', '--allowedTools', '--strict-mcp-config'].includes(value))));
    for (const flag of ['--tools', '--allowedTools']) {
      expect(builtin!.args[builtin!.args.indexOf(flag) + 1]).toBe(custom!.args[custom!.args.indexOf(flag) + 1]);
    }
    expect(builtin!.prompt).toContain('Frozen build-review input sha256:content');
    expect(builtin!.prompt).toContain(frozenHead);
    expect(builtin!.args[builtin!.args.indexOf('--allowedTools') + 1]).toContain('Bash(git show:*)');
  });
  it('refuses a custom-enabled compatibility lap before raw finding routing', async () => {
    const result = await runCompatibilityLap(true);
    expect(result.halt).toContain('custom-capability error');
    expect(result.dispatched).not.toContain('remediate');
  });

  it('preserves the legacy no-custom compatibility route', async () => {
    const result = await runCompatibilityLap(false);
    expect(result.halt).not.toContain('custom-capability error');
  });

  it('refuses a custom-enabled lap whose verdict has no settled aggregate instead of raw-FAIL routing', async () => {
    const result = await runCompatibilityLap(true, 'scalar');
    expect(result.halt).toContain('custom-capability error');
    expect(result.dispatched).not.toContain('remediate');
    expect(result.dispatched).not.toContain('build');
  });

  it('keeps the historical raw route for a scalar verdict without custom policies', async () => {
    const result = await runCompatibilityLap(false, 'scalar');
    expect(result.halt).not.toContain('custom-capability error');
  });
});

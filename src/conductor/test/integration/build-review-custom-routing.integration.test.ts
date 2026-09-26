// Covers: task:4, task:13, task:33
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { Conductor } from '../test-conductor.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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
  it('probes an unthreaded built-in peer provider once and dispatches it in read-only mode', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-routing-unthreaded-peer-'));
    roots.push(root);
    const fixtureDir = join(root, 'bin');
    const probeLog = join(root, 'claude-probe.log');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(join(fixtureDir, 'claude'), `#!/bin/sh\nprintf '%s\\n' \"$*\" >> '${probeLog}'\nprintf '%s\\n' --restricted --tools --allowedTools --strict-mcp-config\n`);
    await chmod(join(fixtureDir, 'claude'), 0o755);
    vi.stubEnv('PATH', `${fixtureDir}:${process.env.PATH}`);

    const config = {
      llm_provider: 'codex', build_review: {
        enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: true, llm_provider: 'claude' } },
        custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project', llm_provider: 'codex' } },
      },
    } as HarnessConfig;
    const invocations: Array<{ prompt: string; readOnlyReview?: boolean }> = [];
    const provider: LLMProvider = {
      invoke: vi.fn(async (options: { prompt: string; readOnlyReview?: boolean }) => {
        invocations.push(options);
        const payload = options.prompt.includes('Build Review Security rubric.') ? { findings: [] } : { kind: 'custom-findings', version: 'v1', findings: [] };
        return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
      }),
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const source = {
      identity: { snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' },
      baselinePath: join(root, '.pipeline', 'frozen', 'baseline'), headPath: join(root, '.pipeline', 'frozen', 'head'),
    };
    await Promise.all([mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    const runner = new DefaultStepRunner(provider, 'unthreaded-peer-routing', root, {
      featureDesc: 'feature', config,
      providerRuntimes: new ProviderRuntimeSet([
        { key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) },
        { key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
      ]),
      sessionStore: new ProviderSessionStore(),
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: root, feature: 'feature' }, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }) as never,
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });
    const inputs = {
      diff: 'diff', planBody: '# Plan', mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
      testSuiteProof: {}, sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', diff: 'diff', planBody: '# Plan', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [] },
      sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} },
    } as never;
    const result = await (runner as unknown as { runRubricBuildReview: (value: unknown, resolved: unknown, tier: 'M', executionContext: unknown, capabilities: unknown) => Promise<{ success: boolean; output: string }> }).runRubricBuildReview(
      inputs, resolveBuildReviewConfig(config), 'M', undefined, { codex: { provider: 'codex', platform: 'linux', status: 'available' } },
    );

    await expect((await import('node:fs/promises')).readFile(probeLog, 'utf8')).resolves.toBe('--help\n');
    expect(invocations).toEqual(expect.arrayContaining([expect.objectContaining({ prompt: expect.stringContaining('Build Review Security rubric.'), readOnlyReview: true })]));
    expect(result.output).not.toContain('read-only-review-unavailable');
  });

  it('settles an unthreaded built-in peer as unavailable when its default probe rejects restricted mode', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-routing-unthreaded-peer-unavailable-'));
    roots.push(root);
    const fixtureDir = join(root, 'bin');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(join(fixtureDir, 'claude'), "#!/bin/sh\nprintf '%s\\n' '--tools' '--allowedTools' '--strict-mcp-config'\n");
    await chmod(join(fixtureDir, 'claude'), 0o755);
    vi.stubEnv('PATH', `${fixtureDir}:${process.env.PATH}`);

    const config = { llm_provider: 'codex', build_review: { enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: true, llm_provider: 'claude' } }, custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project', llm_provider: 'codex' } } } } as HarnessConfig;
    const events = new ConductorEventEmitter();
    const failures: unknown[] = [];
    events.on('build_review_rubric_infrastructure_failure', (event) => { failures.push(event); });
    const provider: LLMProvider = {
      invoke: vi.fn(async () => {
        const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
        return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
      }),
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const source = { identity: { snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' }, baselinePath: join(root, '.pipeline', 'frozen', 'baseline'), headPath: join(root, '.pipeline', 'frozen', 'head') };
    await Promise.all([mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    const runner = new DefaultStepRunner(provider, 'unthreaded-peer-unavailable', root, {
      featureDesc: 'feature', config,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }, { key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(), events,
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: root, feature: 'feature' }, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }) as never,
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });
    const inputs = { diff: 'diff', planBody: '# Plan', mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true, testSuiteProof: {}, sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', diff: 'diff', planBody: '# Plan', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [] }, sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} } } as never;
    await expect((runner as unknown as { runRubricBuildReview: (value: unknown, resolved: unknown, tier: 'M', executionContext: unknown, capabilities: unknown) => Promise<{ success: boolean; output: string }> }).runRubricBuildReview(inputs, resolveBuildReviewConfig(config), 'M', undefined, { codex: { provider: 'codex', platform: 'linux', status: 'available' } })).rejects.toThrow('build-review aggregate');

    expect(provider.invoke).not.toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('Build Review Security rubric.') }));
    expect(failures).toEqual(expect.arrayContaining([expect.objectContaining({
      rubric: 'security', cause: 'read-only-review-unavailable', excerpt: expect.stringContaining('Claude help does not list --restricted'),
    })]));
  });

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
    const provider = new ClaudeProvider(undefined, ((executable: string, args: readonly string[], options: { readonly input?: string | Uint8Array; readonly cwd?: string }) => {
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
      probeReadOnlyReviewCapability: async ({ provider: providerKey, platform }) => ({ provider: providerKey, platform, status: 'available' as const }),
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

  it('skips a custom-review candidate without an available read-only mode and falls back to Claude', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-routing-read-only-'));
    roots.push(root);
    const config = {
      llm_provider: 'claude', build_review: {
        enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: false } },
        custom_rubrics: {
          portable: {
            enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project',
            llm_provider: ['codex', 'claude'],
          },
        },
      },
    } as HarnessConfig;
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const attempts: unknown[] = [];
    const source = {
      identity: { snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' },
      baselinePath: join(root, '.pipeline', 'frozen', 'baseline'), headPath: join(root, '.pipeline', 'frozen', 'head'),
    };
    await Promise.all([mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    const runner = new DefaultStepRunner(provider, 'read-only-routing', root, {
      featureDesc: 'feature', config,
      providerRuntimes: new ProviderRuntimeSet([
        { key: 'codex', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
        { key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
      ]),
      sessionStore: new ProviderSessionStore(),
      providerAttempt: async (_step, attempt) => { attempts.push(attempt); },
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: root, feature: 'feature' }, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }) as never,
      buildReviewPolicyCatalog: async ({ skill }) => [{ semanticName: skill, source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: `/fixture/project/${skill}/SKILL.md`, packageRoot: `/fixture/project/${skill}`, declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({ policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md', manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` }),
    });
    const inputs = {
      diff: 'diff', planBody: '# Plan', mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
      testSuiteProof: {}, sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', diff: 'diff', planBody: '# Plan', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [] },
      sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} },
    } as never;
    await (runner as unknown as { runRubricBuildReview: (value: unknown, resolved: unknown, tier: 'M', executionContext: unknown, capabilities: unknown) => Promise<{ success: boolean }> }).runRubricBuildReview(
      inputs, resolveBuildReviewConfig(config), 'M', undefined, {
        codex: { provider: 'codex', platform: 'linux', status: 'unavailable', reason: 'sandbox helper is unavailable' },
        claude: { provider: 'claude', platform: 'linux', status: 'available' },
      },
    );

    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'codex', invoked: false, skipReason: 'setup-unavailable', setupCapability: 'read-only-review-mode' }),
      expect.objectContaining({ provider: 'claude', invoked: true }),
    ]));
    expect(invoke).toHaveBeenCalled();
  });
  it('resolves a falling-back built-in peer policy in its actual prepared candidate', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-routing-builtin-fallback-'));
    roots.push(root);
    const config = {
      llm_provider: 'claude', build_review: {
        enabled: true, rubrics: { testQuality: { enabled: false }, security: { enabled: true, llm_provider: ['codex', 'claude'] } },
        custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project', llm_provider: 'claude' } },
      },
    } as HarnessConfig;
    const invoke = vi.fn(async (options: { prompt: string }) => {
      const payload = options.prompt.includes('Build Review Security rubric.') ? { findings: [] } : { kind: 'custom-findings', version: 'v1', findings: [] };
      return { success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload };
    });
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const catalogCalls: Array<{ provider: string; skill: string; preparedEnv?: NodeJS.ProcessEnv }> = [];
    const captured: Array<{ skill: string; candidateHome: string | undefined }> = [];
    const source = {
      identity: { snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' },
      baselinePath: join(root, '.pipeline', 'frozen', 'baseline'), headPath: join(root, '.pipeline', 'frozen', 'head'),
    };
    await Promise.all([mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    const runner = new DefaultStepRunner(provider, 'builtin-fallback-routing', root, {
      featureDesc: 'feature', config,
      providerRuntimes: new ProviderRuntimeSet([
        { key: 'codex', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
        { key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) },
      ]),
      sessionStore: new ProviderSessionStore(),
      providerExecution: {
        prepareCandidateSelfHost: async (candidate: { providerKey: string }) => ({
          executable: candidate.providerKey, args: [], env: { CANDIDATE_HOME: `/prepared/${candidate.providerKey}` }, teardown: async () => {},
        }),
      } as never,
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: root, feature: 'feature' }, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }) as never,
      buildReviewPolicyCatalog: async (request) => {
        catalogCalls.push({ provider: request.provider, skill: request.skill, ...(request.preparedEnv === undefined ? {} : { preparedEnv: request.preparedEnv }) });
        return [{ semanticName: request.skill, source: 'project', installationOrigin: `/installed/${request.preparedEnv?.CANDIDATE_HOME ?? 'ambient'}`, canonicalSkillPath: `/installed/${request.skill}/SKILL.md`, packageRoot: `/installed/${request.preparedEnv?.CANDIDATE_HOME ?? 'ambient'}/${request.skill}`, declaredDependencies: [], availability: 'available' as const }];
      },
      buildReviewPolicyCapture: async (policy) => {
        captured.push({ skill: policy.semanticName, candidateHome: policy.packageRoot });
        return { policy, materialPath: join(root, 'material', policy.semanticName), definitionPath: join(root, 'material', policy.semanticName, 'SKILL.md'), manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Policy\n') }], metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256-v1:${'a'.repeat(64)}` };
      },
    });
    const inputs = {
      diff: 'diff', planBody: '# Plan', mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
      testSuiteProof: {}, sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', diff: 'diff', planBody: '# Plan', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [] },
      sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} },
    } as never;
    await (runner as unknown as { runRubricBuildReview: (value: unknown, resolved: unknown, tier: 'M', executionContext: unknown, capabilities: unknown) => Promise<{ success: boolean }> }).runRubricBuildReview(
      inputs, resolveBuildReviewConfig(config), 'M', undefined, {
        codex: { provider: 'codex', platform: 'linux', status: 'unavailable', reason: 'sandbox helper is unavailable' },
        claude: { provider: 'claude', platform: 'linux', status: 'available' },
      },
    );

    const securityCatalogs = catalogCalls.filter(({ skill }) => skill.includes('security'));
    expect(securityCatalogs).toEqual(expect.arrayContaining([{ provider: 'claude', skill: expect.stringContaining('security'), preparedEnv: { CANDIDATE_HOME: '/prepared/claude' } }]));
    expect(captured.filter(({ skill }) => skill.includes('security'))).toEqual(expect.arrayContaining([
      { skill: expect.stringContaining('security'), candidateHome: expect.stringContaining('/prepared/claude/') },
    ]));
    expect(invoke.mock.calls.some(([options]) => options.prompt.includes('Build Review Security rubric.'))).toBe(true);
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

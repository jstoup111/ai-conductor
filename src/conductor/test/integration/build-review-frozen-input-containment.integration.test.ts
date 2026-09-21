// Covers: task:13
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const execaMock = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: execaMock }));

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const HEAD = 'b'.repeat(40);
const BASE = 'a'.repeat(40);
const PROVED = [
  'source-write-refused', 'baseline-write-refused', 'installation-write-refused', 'engine-state-write-refused',
  'scratch-write-succeeded', 'sibling-evidence-withheld', 'nested-sandbox-available', 'host-state-withheld', 'checkout-state-withheld',
].join('\n');

function git() {
  return async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${BASE}\n`, stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000src/a.ts\u0000D\u0000src/gone.ts\u0000', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n', stderr: '' };
    if (args[0] === 'show') return { exitCode: 0, stdout: '# Plan\n', stderr: '' };
    if (args[0] === 'cat-file' || args[0] === 'worktree') return { exitCode: 0, stdout: '', stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  };
}

describe('custom review containment exposes the complete frozen baseline/head input', () => {
  it('binds the baseline view read-only, proves it, and names both views and the change inventory to the reviewer', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'frozen-input-containment-'));
    roots.push(root);
    const project = join(root, 'project');
    await mkdir(join(project, '.pipeline'), { recursive: true });
    await mkdir(join(project, '.docs', 'plans'), { recursive: true });
    await writeFile(join(project, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 1: review\n**Files:** src/a.ts\n');
    execaMock.mockReset();
    execaMock.mockImplementation(async (executable: string) => {
      if (executable !== 'bwrap') throw new Error(`unexpected process ${executable}`);
      return { exitCode: 0, stdout: PROVED, stderr: '' };
    });
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify({ kind: 'custom-findings', version: 'v1', findings: [] }) }));
    const provider: LLMProvider = { invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true } };
    const runner = new DefaultStepRunner(provider, 'frozen-input', project, {
      featureDesc: 'feature', planPath: join(project, '.docs', 'plans', 'feature.md'), gitRunner: git(),
      config: { llm_provider: 'codex', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', source: 'project', llm_provider: 'codex' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      providerExecution: {
        prepareCandidateSelfHost: async () => ({ executable: '/prepared/codex', env: { CODEX_HOME: '/prepared/candidate-home', CODEX_API_KEY: 'k' }, args: [], teardown: async () => {} }),
      } as never,
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never),
        materialization: { projectRoot: project, runtimeRoot: join(root, 'runtime') },
      },
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: '/repo', feature: 'feature' }, effective: {
        rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
        skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
      } }) as never,
      buildReviewPolicyCatalog: async () => [{
        semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available',
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: `sha256-v1:${'a'.repeat(64)}`,
      }),
    });

    const run = await runner.run('build_review', { complexity_tier: 'M' } as never);
    expect(run.success, run.output).toBe(true);

    // The mocked process boundary is what production reached, and only bwrap.
    expect(execaMock).toHaveBeenCalledTimes(1);
    const probeArgs = execaMock.mock.calls[0]![1] as string[];
    const bound = (flag: string) => probeArgs.flatMap((arg, index) => arg === flag ? [probeArgs[index + 1]!] : []);
    const baseline = bound('--ro-bind').find((path) => /lap-[^/]+\/baseline$/.test(path));
    const head = bound('--ro-bind').find((path) => /lap-[^/]+\/head$/.test(path));
    expect({ baseline, head }).toEqual({ baseline: expect.any(String), head: expect.any(String) });
    expect(bound('--bind')).not.toContain(baseline);
    expect(probeArgs).toContain(join(baseline!, '.build-review-write-probe'));

    // Sibling lap artifacts and the cache live under the evidence root of the
    // ro-bound checkout; production masks that root and probes a real file in it.
    const evidenceRoot = join(project, '.pipeline', 'build-review');
    expect(bound('--tmpfs')).toContain(evidenceRoot);
    expect(probeArgs).toContain(join(evidenceRoot, '.sibling-evidence-probe'));
    // Non-input checkout state is masked and handed to the probe.
    expect(bound('--tmpfs')).toContain(join(project, '.pipeline'));
    expect(probeArgs.at(-1)).toBe(join(project, '.pipeline'));

    const invocation = (invoke.mock.calls as unknown as Array<[{ prompt: string; cwd: string; reviewAccess?: { profile: { mountArgs: string[] } } }]>)[0]![0];
    expect(invocation.cwd).toBe(head);
    expect(invocation.reviewAccess?.profile.mountArgs).toEqual(expect.arrayContaining(['--ro-bind', baseline!, baseline!]));
    expect(invocation.prompt).toContain(`Reviewed baseline ${BASE} (read-only): ${baseline}`);
    expect(invocation.prompt).toContain(`Reviewed head ${HEAD} (read-only): ${head}`);
    expect(invocation.prompt).toContain('M src/a.ts');
    expect(invocation.prompt).toContain('D src/gone.ts');
  });
});

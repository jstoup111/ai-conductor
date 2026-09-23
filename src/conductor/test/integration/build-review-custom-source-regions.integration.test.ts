// Covers: task:16
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const HEAD_TEXT = 'export const value = 1;\nexport const other = 2;\n';
const BASE_TEXT = 'export const removed = 0;\n';
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'custom-source-regions-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 1: review\n**Files:** src/a.ts\n');
  return root;
}

/** Frozen commits: `head` has src/a.ts, `base` has src/a.ts and the deleted src/gone.ts. */
function git() {
  return async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'head\n', stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
    if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000src/a.ts\u0000D\u0000src/gone.ts\u0000', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n', stderr: '' };
    if (args[0] === 'show' && args[1] === 'head:src/a.ts') return { exitCode: 0, stdout: HEAD_TEXT, stderr: '' };
    if (args[0] === 'show' && args[1] === 'base:src/gone.ts') return { exitCode: 0, stdout: BASE_TEXT, stderr: '' };
    if (args[0] === 'show' && args[1] === 'base:src/a.ts') return { exitCode: 0, stdout: 'export const value = 0;\n', stderr: '' };
    if (args[0] === 'show' && args[1] === 'head:src/gone.ts') return { exitCode: 128, stdout: '', stderr: 'absent' };
    if (args[0] === 'show') return { exitCode: 0, stdout: '# Plan\n', stderr: '' };
    if (args[0] === 'ls-tree') return { exitCode: 0, stdout: '', stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  };
}

async function review(region: { path: string; startLine: number; endLine: number; contentHash: string }, declaredDependencies: string[] = []) {
  const root = await fixture();
  const payload = { kind: 'custom-findings', version: 'v1', findings: [{
    concernId: 'concern.one', summary: 'A concern.', evidenceLocations: [`${region.path}:${region.startLine}`],
    sourceRegions: [{ ...region, display: 'cited region' }],
  }] };
  const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload }));
  const provider: LLMProvider = {
    invoke, supportsSessionResume: false, lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true },
  };
  const runner = new DefaultStepRunner(provider, 'custom-source-regions', root, {
    featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'), gitRunner: git(),
    config: { llm_provider: 'codex', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
      portable: { enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', source: 'project', llm_provider: 'codex' },
    } } } as HarnessConfig,
    providerRuntimes: new ProviderRuntimeSet([{ key: 'codex', provider, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder) }]),
    sessionStore: new ProviderSessionStore(),
    providerExecution: {
      prepareCandidateSelfHost: async () => ({ executable: '/prepared/codex', env: { CODEX_HOME: '/prepared/candidate-home' }, args: [], teardown: async () => {} }),
    } as never,
    buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
    buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: '/repo', feature: 'feature' }, effective: {
      rawVerdict: 'FAIL', verdict: 'FAIL', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
      skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
    } }) as never,
    buildReviewPolicyCatalog: async () => [{
      semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies, availability: 'available',
    }],
    buildReviewPolicyCapture: async (policy) => ({
      policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
      manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# Portable policy\n') }, { relativePath: 'refs/criteria.md', bytes: Buffer.from('criteria\n') }],
      metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
      digest: `sha256-v1:${'a'.repeat(64)}`,
    }),
  });
  const run = await runner.run('build_review', { complexity_tier: 'M' } as never);
  expect(invoke, run.output).toHaveBeenCalled();
  const artifact = JSON.parse(await readFile(join(root, '.pipeline', 'build-review', 'lap-head', 'portable.json'), 'utf8'));
  return { artifact, prompt: (invoke.mock.calls as unknown as Array<[{ prompt: string }]>)[0]![0].prompt };
}

describe('custom source regions are validated against frozen source bytes', () => {
  it('admits a region whose line range and hash match the frozen head blob', async () => {
    const { artifact, prompt } = await review({ path: 'src/a.ts', startLine: 2, endLine: 2, contentHash: sha('export const other = 2;\n') });
    expect(artifact.result).toMatchObject({ kind: 'judged', verdict: 'FAIL', findings: [{ concernId: 'concern.one' }] });
    expect(prompt).toContain('sha256sum');
  });

  it('admits a deleted-file region against the frozen baseline blob', async () => {
    const { artifact } = await review({ path: 'src/gone.ts', startLine: 1, endLine: 1, contentHash: sha(BASE_TEXT) });
    expect(artifact.result).toMatchObject({ kind: 'judged', verdict: 'FAIL' });
  });

  it('refuses a forged content hash on a changed path', async () => {
    const { artifact } = await review({ path: 'src/a.ts', startLine: 1, endLine: 1, contentHash: `sha256:${'f'.repeat(64)}` });
    expect(artifact.result).toMatchObject({ kind: 'infrastructure-failure', reason: 'malformed-artifact' });
    expect(artifact.result.detail).toContain('src/a.ts:1-1');
  });

  it('refuses a line range beyond the frozen blob', async () => {
    const { artifact } = await review({ path: 'src/a.ts', startLine: 2, endLine: 9, contentHash: sha('export const other = 2;\n') });
    expect(artifact.result).toMatchObject({ kind: 'infrastructure-failure', reason: 'malformed-artifact' });
  });

  it('admits a declared dependency written in a non-normalized form that capture already resolved', async () => {
    const { artifact } = await review({ path: 'src/a.ts', startLine: 1, endLine: 1, contentHash: sha('export const value = 1;\n') }, ['./refs/criteria.md']);
    expect(artifact.result).toMatchObject({ kind: 'judged' });
  });
});

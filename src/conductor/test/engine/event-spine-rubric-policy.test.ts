// Covers: task:2
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  discoverClaudeReviewPolicies,
} from '../../src/engine/build-review-policy-claude.js';
import { resolveInstalledReviewPolicy } from '../../src/engine/build-review-policy-resolver.js';
import { loadConfig } from '../../src/engine/config.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function eventSpineDeclaration() {
  const loaded = await loadConfig(repoRoot);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw new Error('repository config must load');
  const entry = resolveBuildReviewConfig(loaded.config).catalog.find((item) => item.id === 'eventSpine');
  if (!entry || entry.kind !== 'custom') throw new Error('eventSpine custom rubric must resolve');
  return { loaded, entry };
}

describe('repository-local event-spine policy settlement', () => {
  it('discovers and resolves the one project event-spine policy from the repository rubric declaration', async () => {
    const { entry } = await eventSpineDeclaration();
    const command = vi.fn(async () => ({ stdout: '[]' }));
    const policies = await discoverClaudeReviewPolicies({
      candidate: {
        cwd: repoRoot, env: {}, skill: entry.skill,
        projectSkillRoots: [join(repoRoot, '.claude', 'skills'), join(repoRoot, '.agents', 'skills')],
        userSkillRoots: [],
      },
      command,
    });
    const resolved = resolveInstalledReviewPolicy({ skill: entry.skill, source: 'project' }, policies);

    expect(command).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'], { cwd: repoRoot, env: {} });
    expect(policies).toHaveLength(2);
    expect(new Set(policies.map((policy) => policy.installationOrigin))).toEqual(new Set([join(repoRoot, '.agents', 'skills', 'event-spine')]));
    expect(resolved).toMatchObject({
      kind: 'resolved',
      policy: { semanticName: 'event-spine', source: 'project', canonicalSkillPath: expect.stringMatching(/\.agents\/skills\/event-spine\/SKILL\.md$/) },
    });
  });

  it('settles empty project roots as an absent event-spine policy', async () => {
    const { entry } = await eventSpineDeclaration();
    const root = await mkdtemp(join(process.env.TMPDIR!, 'event-spine-policy-absent-'));
    roots.push(root);
    const projectSkillRoots = [join(root, '.claude', 'skills'), join(root, '.agents', 'skills')];
    await Promise.all(projectSkillRoots.map((path) => mkdir(path, { recursive: true })));
    const policies = await discoverClaudeReviewPolicies({
      candidate: {
        cwd: root, env: {}, skill: entry.skill, projectSkillRoots,
        userSkillRoots: [],
      },
      command: async () => ({ stdout: '[]' }),
    });

    expect(resolveInstalledReviewPolicy({ skill: entry.skill, source: 'project' }, policies)).toEqual({
      kind: 'failure', failure: { code: 'absent', skill: 'event-spine', source: 'project' },
    });
  });

  it('emits an event-spine catalog policy failure without invoking a provider when the policy is absent', async () => {
    const { loaded } = await eventSpineDeclaration();
    const root = await mkdtemp(join(process.env.TMPDIR!, 'event-spine-policy-'));
    roots.push(root);
    const config: HarnessConfig = {
      ...loaded.config,
      build_review: {
        ...loaded.config.build_review,
        rubrics: { ...loaded.config.build_review?.rubrics, testQuality: { enabled: false }, security: { enabled: false } },
      },
    };
    const invoke = vi.fn(async () => ({ success: true, exitCode: 0, output: '{}' }));
    const provider: LLMProvider = {
      invoke, supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true }, nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const events = new ConductorEventEmitter();
    const failures: unknown[] = [];
    events.on('build_review_policy_failed', (event) => { failures.push(event); });
    const source = {
      identity: { snapshotDigest: 'sha256:snapshot', contentDigest: 'sha256:content', mergeBase: 'base', headSha: 'head' },
      baselinePath: join(root, '.pipeline', 'frozen', 'baseline'), headPath: join(root, '.pipeline', 'frozen', 'head'),
    };
    await Promise.all([mkdir(source.baselinePath, { recursive: true }), mkdir(source.headPath, { recursive: true })]);
    const runner = new DefaultStepRunner(provider, 'event-spine-policy', root, {
      featureDesc: 'feature', config, events,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: root, feature: 'feature' }, effective: { rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }) as never,
      buildReviewPolicyCatalog: async () => [],
    });
    const inputs = {
      diff: 'diff', planBody: '# Plan', mergeBase: 'base', baseRef: 'origin/main', baseKind: 'remote', trackingRefSha: 'base', remoteHeadSha: 'base', fresh: true,
      testSuiteProof: {},
      sourceSnapshot: { digest: 'sha256:snapshot', contentDigest: 'sha256:content', baseRef: 'origin/main', mergeBase: 'base', headSha: 'head', diff: 'diff', planBody: '# Plan', repairContext: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, sourceChanges: [] },
      sourceMaterialization: { source, contextFor: (memberId: string) => ({ memberId, source }), settle: async () => {} },
    } as never;
    const runRubricBuildReview = (runner as unknown as { runRubricBuildReview: (value: unknown, resolved: unknown, tier: 'M', executionContext: unknown, capabilities: unknown) => Promise<{ success: boolean }> }).runRubricBuildReview.bind(runner);
    const result = await runRubricBuildReview(
      inputs, resolveBuildReviewConfig(config), 'M', undefined, { claude: { provider: 'claude', platform: 'linux', status: 'available' } },
    );

    const detail = 'Installed build-review policy event-spine is unavailable: absent; requested source: project';
    expect(result).toEqual(expect.objectContaining({
      success: false,
      output: `build_review mechanical fault in eventSpine (policy-load-failed): ${detail}`,
    }));
    expect(invoke).not.toHaveBeenCalled();
    expect(failures).toHaveLength(3);
    expect(failures).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({
      type: 'build_review_policy_failed', rubric: 'eventSpine', stage: 'catalog', reason: detail,
    })));

    await runRubricBuildReview(inputs, resolveBuildReviewConfig(config), 'M', undefined, { claude: { provider: 'claude', platform: 'linux', status: 'available' } });
    await runRubricBuildReview(inputs, resolveBuildReviewConfig(config), 'M', undefined, { claude: { provider: 'claude', platform: 'linux', status: 'available' } });
    const aggregate = JSON.parse(await readFile(join(root, '.pipeline', 'build-review.json'), 'utf8'));
    expect(aggregate.customResults.eventSpine.result).toEqual({
      kind: 'infrastructure-failure', rubric: 'eventSpine', reason: 'policy-load-failed', detail,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

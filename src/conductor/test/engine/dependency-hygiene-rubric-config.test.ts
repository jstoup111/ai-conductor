import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { buildReviewSeverityThresholds, deriveComposedBuildReviewEffectiveVerdict } from '../../src/engine/build-review-effective.js';
import { loadConfig } from '../../src/engine/config.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/events.js';

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const roots: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await execFileAsync('git', args, { cwd });
  return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
}

async function createProject(change: { path: string; content: string } = {
  path: 'src/conductor/package.json', content: '{"name":"changed"}\n',
}): Promise<{ root: string; planPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dependency-hygiene-config-'));
  roots.push(root);
  const planPath = join(root, '.docs/plans/plan.md');
  await mkdir(join(root, 'src/conductor'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await mkdir(dirname(planPath), { recursive: true });
  await mkdir(join(root, '.docs/stories'), { recursive: true });
  await writeFile(planPath, '# Plan\n\n### Task 10: Review dependency changes\n**Files:** src/conductor/package.json\n', 'utf8');
  await writeFile(join(root, '.docs/stories/plan.md'), '# Stories\n', 'utf8');
  await writeFile(join(root, 'src/conductor/package.json'), '{"name":"base"}\n', 'utf8');
  await writeFile(join(root, 'test/covered.test.ts'), "// Covers: task:10\nit('covered', () => {});\n", 'utf8');
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'Test');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'base');
  await git(root, 'remote', 'add', 'origin', root);
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
  await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  await git(root, 'checkout', '-b', 'feature/dependency-hygiene');
  await mkdir(dirname(join(root, change.path)), { recursive: true });
  await writeFile(join(root, change.path), change.content, 'utf8');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'dependency change');
  return { root, planPath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('repository dependency-hygiene build-review rubric', () => {
  // Covers: S5.1
  it('resolves the global dependency-hygiene declaration while preserving eventSpine', async () => {
    const repository = await loadConfig(repoRoot);

    expect(repository.ok).toBe(true);
    if (!repository.ok) return;
    const resolved = resolveBuildReviewConfig(repository.config);
    const dependencyHygiene = resolved.catalog.find((entry) => entry.id === 'dependencyHygiene');
    const eventSpine = resolved.catalog.find((entry) => entry.id === 'eventSpine');

    expect(dependencyHygiene).toMatchObject({
      id: 'dependencyHygiene', kind: 'custom', skill: 'build-review-dependency-hygiene', source: 'global',
      policy: { enabled: true, min_severity: 'minor' }, paths: ['**/package.json', '**/package-lock.json'],
    });
    expect(eventSpine).toMatchObject({
      id: 'eventSpine', kind: 'custom', skill: 'event-spine', source: 'project', policy: { enabled: true },
    });
  });

  // Covers: S5.2
  it('dispatches the repository-resolved dependency policy for a package manifest diff', async () => {
    const repository = await loadConfig(repoRoot);
    expect(repository.ok).toBe(true);
    if (!repository.ok) return;
    const { root, planPath } = await createProject();
    const manifest = '{"name":"changed"}\n';
    const invoke = vi.fn(async (options) => ({
      success: true, exitCode: 0, output: 'reviewed',
      finalStructuredResult: options.prompt.includes('$build-review-dependency-hygiene') ? {
        kind: 'custom-findings', version: 'v2', findings: [{
          concernId: 'necessity', summary: 'The fixture dependency lacks necessity evidence.', severity: 'major',
          evidenceLocations: ['src/conductor/package.json:1'],
          sourceRegions: [{
            path: 'src/conductor/package.json', startLine: 1, endLine: 1,
            contentHash: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
          }],
        }],
      } : { findings: [] },
    }));
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true }, nativeSchemaCapability: { nativeOutputSchema: true }, invoke,
    };
    const runner = new DefaultStepRunner(provider, 'dependency-hygiene-config', root, {
      planPath,
      gitRunner: async (args: string[]) => git(root, ...args),
      config: {
        ...repository.config,
        build_review: {
          ...repository.config.build_review,
          custom_rubrics: {
            ...repository.config.build_review?.custom_rubrics,
            eventSpine: { ...repository.config.build_review?.custom_rubrics?.eventSpine!, enabled: false },
          },
        },
      },
      buildReviewInputOptions: {
        materialization: { projectRoot: root },
        inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: (await git(root, 'rev-parse', 'HEAD')).stdout.trim(), outcome: 'PASS' } } as never),
      },
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider, lifecycleCapability: provider.lifecycleCapability, nativeSchemaCapability: provider.nativeSchemaCapability,
        policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      }, {
        key: 'codex', provider, lifecycleCapability: provider.lifecycleCapability, nativeSchemaCapability: provider.nativeSchemaCapability,
        policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      }, {
        key: 'pi', provider, lifecycleCapability: provider.lifecycleCapability, nativeSchemaCapability: provider.nativeSchemaCapability,
        policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(), configuredProviders: ['codex', 'claude', 'pi'],
      probeReadOnlyReviewCapability: async ({ provider: key, platform }) => ({ provider: key, platform, status: 'available' as const }),
      buildReviewPolicyCatalog: async ({ skill }) => [{
        semanticName: skill, source: 'global' as const, installationOrigin: join(repoRoot, 'skills', skill),
        canonicalSkillPath: join(repoRoot, 'skills', skill, 'SKILL.md'), packageRoot: join(repoRoot, 'skills', skill), declaredDependencies: [], availability: 'available' as const,
      }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: join(repoRoot, 'skills', policy.semanticName), definitionPath: join(repoRoot, 'skills', policy.semanticName, 'SKILL.md'),
        manifest: [{ relativePath: 'SKILL.md', bytes: Buffer.from('# fixture policy\n') }],
        metadata: { version: 1 as const, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] }, digest: `sha256:${'a'.repeat(64)}`,
      }),
      buildReviewArtifactReader: async (_root, rubric, lapId, snapshotDigest) => ({
        version: 1, rubric, lapId, snapshotDigest,
        result: rubric === 'security'
          ? {
              kind: 'judged', rubric, lapId, snapshotDigest, contractVersion: 'v3', verdict: 'FAIL', findings: [{
                concernKind: 'committed-secret', summary: 'Fixture source reaches a secret.', evidenceLocations: ['src/conductor/package.json:1'],
                anchor: { rubric: 'security', locus: { path: 'src/conductor/package.json', contentHash: `sha256:${'b'.repeat(64)}`, display: 'fixture manifest' } },
              }],
            }
          : { kind: 'judged', rubric, lapId, snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' },
      } as never),
      buildReviewEffectiveResolver: async () => ({ ok: true as const, feature: { version: 'v1' as const, repository: root, feature: 'dependency-hygiene-config' }, effective: { rawVerdict: 'PASS' as const, verdict: 'PASS' as const, acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }),
    });
    vi.spyOn(runner as any, 'resolveBuildReviewEngineIdentity').mockResolvedValue({ engineStamp: 'fixture', skillDigests: {} });

    const result = await runner.run('build_review', {});
    expect(result.success, result.output).toBe(true);
    expect(invoke).toHaveBeenCalled();
    expect(invoke.mock.calls.some(([options]) => options.prompt.includes('$build-review-dependency-hygiene'))).toBe(true);
    const aggregate = JSON.parse(await readFile(join(root, '.pipeline', 'build-review.json'), 'utf8'));
    expect(projectBuildReviewAggregateSources(aggregate)?.map((source) => source.rubric)).toContain('security');
  });

  // Covers: S5.3
  it('withholds the repository dependency policy on a dependency-free diff without invoking a provider', async () => {
    const repository = await loadConfig(repoRoot);
    expect(repository.ok).toBe(true);
    if (!repository.ok) return;
    const { root, planPath } = await createProject({
      path: 'src/conductor/src/engine/config.ts', content: 'export const fixture = true;\n',
    });
    const invoke = vi.fn();
    const provider: LLMProvider = {
      lifecycleCapability: { synchronousSpawnPermit: true }, nativeSchemaCapability: { nativeOutputSchema: true }, invoke,
    };
    const events = new ConductorEventEmitter();
    const skips: ConductorEvent[] = [];
    events.on('build_review_rubric_skipped', (event) => { skips.push(event); });
    const runner = new DefaultStepRunner({ invoke: vi.fn() }, 'dependency-hygiene-config', root, {
      planPath,
      gitRunner: async (args: string[]) => git(root, ...args),
      events,
      config: {
        ...repository.config,
        build_review: {
          ...repository.config.build_review,
          custom_rubrics: {
            ...repository.config.build_review?.custom_rubrics,
            eventSpine: { ...repository.config.build_review?.custom_rubrics?.eventSpine!, enabled: false },
          },
        },
      },
      buildReviewInputOptions: {
        materialization: { projectRoot: root },
        inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: (await git(root, 'rev-parse', 'HEAD')).stdout.trim(), outcome: 'PASS' } } as never),
      },
      providerRuntimes: new ProviderRuntimeSet([{
        key: 'claude', provider, lifecycleCapability: provider.lifecycleCapability, nativeSchemaCapability: provider.nativeSchemaCapability,
        policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      }]),
      sessionStore: new ProviderSessionStore(), configuredProviders: ['claude'],
      buildReviewCoordinator: async () => ({ success: true, output: 'fixture built-in result' }),
      buildReviewArtifactReader: async (_root, rubric, lapId, snapshotDigest) => ({
        version: 1, rubric, lapId, snapshotDigest,
        result: { kind: 'judged', rubric, lapId, snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' },
      } as never),
      buildReviewEffectiveResolver: async () => ({ ok: true as const, feature: { version: 'v1' as const, repository: root, feature: 'dependency-hygiene-config' }, effective: { rawVerdict: 'PASS' as const, verdict: 'PASS' as const, acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [] } }),
    });

    const result = await runner.run('build_review', {});
    expect(result.success, result.output).toBe(true);

    expect(skips).toEqual([expect.objectContaining({
      type: 'build_review_rubric_skipped', rubric: 'dependencyHygiene', reason: 'paths-unmatched',
    })]);
    expect(invoke).not.toHaveBeenCalled();
  });

  // Covers: S5.4
  it('keeps a nit dependency license finding advisory under the repository threshold', async () => {
    const repository = await loadConfig(repoRoot);
    expect(repository.ok).toBe(true);
    if (!repository.ok) return;
    const config = resolveBuildReviewConfig(repository.config);
    const declaration = {
      version: 'v1' as const, rubricId: 'dependencyHygiene', semanticSkill: 'build-review-dependency-hygiene',
      question: config.catalog.find((entry) => entry.id === 'dependencyHygiene')!.question, source: 'global' as const, resources: [],
    };
    const sourceRegion = {
      path: 'src/conductor/package.json', startLine: 1, endLine: 1,
      contentHash: `sha256:${'a'.repeat(64)}`, display: 'dependency manifest',
    };
    const custom = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v2', findings: [{
        concernId: 'license-unverifiable', summary: 'The dependency license cannot be verified.', severity: 'nit',
        evidenceLocations: ['src/conductor/package.json:1'], sourceRegions: [sourceRegion],
      }],
    }, {
      rubric: 'dependencyHygiene', lapId: 'lap-dependency-hygiene', declaration,
      policy: { version: 'v1', bundleDigest: `sha256:${'b'.repeat(64)}` },
      candidate: { provider: 'claude', model: 'fixture', effort: 'medium' },
      reviewedInput: { version: 'v1', contentDigest: `sha256:${'c'.repeat(64)}` },
    }, { sourceRegions: [sourceRegion] });
    if (!custom) throw new Error('fixture custom finding must stamp');
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: 'lap-dependency-hygiene' as never, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' } },
      customResults: {
        dependencyHygiene: {
          descriptor: {
            version: 'v1', semanticSkill: declaration.semanticSkill, declaration, installation: { source: 'global' },
            effectivePolicy: { version: 'v1', bundleDigest: `sha256:${'b'.repeat(64)}` },
            reviewedInput: { version: 'v1', contentDigest: `sha256:${'c'.repeat(64)}` },
            producer: { provider: 'claude', model: 'fixture', effort: 'medium' },
          }, result: custom,
        },
      }, currentCustomRubrics: ['dependencyHygiene'],
    } as never);

    const effective = deriveComposedBuildReviewEffectiveVerdict(
      aggregate, { version: 'v1', repository: repoRoot, feature: 'dependency-hygiene-config' }, [], [], {}, new Set(),
      buildReviewSeverityThresholds(config),
    );

    expect(effective).toMatchObject({ verdict: 'PASS', unresolvedFindingIds: [] });
    expect(effective?.advisoryFindingIds).toHaveLength(1);
  });
});

// Covers: task:40
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { AuditTrailWriter } from '../../src/engine/audit-trail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function withoutTimestamp(record: Record<string, unknown>): Record<string, unknown> {
  const { ts: _ts, ...event } = record;
  return event;
}

describe('custom build-review policy event spine', () => {
  it('persists, renders, and audits bounded current and reused policy provenance without policy bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-policy-events-'));
    roots.push(root);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    new AuditTrailWriter(root).subscribe(events);
    const lines: string[] = [];
    for (const type of ['build_review_policy_resolved', 'build_review_policy_failed', 'build_review_cache_hit', 'build_review_rubric_result', 'build_review_outer_verdict'] as const) {
      events.on(type, (event) => renderDaemonEvent(event, (line) => lines.push(line)));
    }
    const candidate = { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' } as const;
    const resolved = {
      type: 'build_review_policy_resolved', rubric: 'portablePolicy', lapId: 'lap-current',
      provider: 'codex', source: 'plugin', pluginId: 'acme:portable', bundleDigest: 'sha256:bundle',
      provenance: { inputDigest: 'sha256:input', candidate, plugin: { id: 'acme:portable', version: '2.4.0' } },
    } satisfies ConductorEvent;
    const failed = {
      type: 'build_review_policy_failed', rubric: 'portablePolicy', lapId: 'lap-current',
      provider: 'codex', stage: 'capture', reason: 'selected resource is unreadable',
      provenance: { inputDigest: 'sha256:input', candidate },
    } satisfies ConductorEvent;
    const reused = {
      type: 'build_review_cache_hit', rubric: 'portablePolicy', lapId: 'lap-current',
      customReuse: {
        source: 'plugin', plugin: { id: 'acme:portable', version: '2.4.0' },
        bundleDigest: 'sha256:bundle', inputDigest: 'sha256:input', candidate,
        originalLapId: 'lap-original', originalSnapshotDigest: 'sha256:original-input',
      },
    } satisfies ConductorEvent;
    const customResult = {
      type: 'build_review_rubric_result', rubric: 'portablePolicy', lapId: 'lap-current', verdict: 'PASS',
    } satisfies ConductorEvent;
    const outerVerdict = {
      type: 'build_review_outer_verdict', lapId: 'lap-current', rawVerdict: 'PASS', effectiveVerdict: 'PASS',
    } satisfies ConductorEvent;

    persister.start();
    await events.emit(resolved);
    await events.emit(failed);
    await events.emit(reused);
    await events.emit(customResult);
    await events.emit(outerVerdict);
    persister.stop();

    const ledger = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => withoutTimestamp(JSON.parse(line)));
    const audit = (await readFile(join(root, '.pipeline', 'audit-trail', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));

    expect(ledger).toEqual([resolved, failed, reused, customResult, outerVerdict]);
    expect(lines.join('\n')).toContain('codex/gpt-5.6-sol/medium plugin/acme:portable');
    expect(lines.join('\n')).toContain('custom reuse from lap-original');
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'build_review_policy_resolved', cause: 'sha256:bundle; input sha256:input; candidate codex/gpt-5.6-sol/medium' }),
      expect.objectContaining({ event: 'build_review_policy_failed', cause: 'sha256:input; candidate codex/gpt-5.6-sol/medium' }),
      expect.objectContaining({ event: 'build_review_cache_hit', cause: 'sha256:bundle; input sha256:input; candidate codex/gpt-5.6-sol/medium' }),
    ]));
  });

  it('keeps captured policy bytes and prepared environment credentials out of every event-spine sink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-policy-event-runner-'));
    roots.push(root);
    await Promise.all([
      mkdir(join(root, '.pipeline'), { recursive: true }),
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, 'src'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, '.docs', 'plans', 'feature.md'), '# Plan\n\n### Task 1: review\n**Files:** src/a.ts\n'),
      writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n'),
    ]);
    const policyByteSentinel = 'POLICY-BYTES-SENTINEL-7ef49b';
    const environmentCredentialSentinel = 'ENV-CREDENTIAL-SENTINEL-31d992';
    const bundleDigest = `sha256-v1:${'a'.repeat(64)}`;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    new AuditTrailWriter(root).subscribe(events);
    const lines: string[] = [];
    for (const type of ['build_review_policy_resolved', 'build_review_policy_failed', 'build_review_cache_hit', 'build_review_rubric_result', 'build_review_outer_verdict'] as const) {
      events.on(type, (event) => renderDaemonEvent(event, (line) => lines.push(line)));
    }
    const payload = { kind: 'custom-findings', version: 'v1', findings: [] };
    const provider: LLMProvider = {
      invoke: async () => ({ success: true, exitCode: 0, output: JSON.stringify(payload), finalStructuredResult: payload }),
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      nativeSchemaCapability: { nativeOutputSchema: true },
    };
    const runner = new DefaultStepRunner(provider, 'policy-event-sentinels', root, {
      featureDesc: 'feature', planPath: join(root, '.docs', 'plans', 'feature.md'),
      gitRunner: async (args: string[]) => {
        if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
        if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'head\n', stderr: '' };
        if (args[0] === 'merge-base') return { exitCode: 0, stdout: 'base\n', stderr: '' };
        if (args[0] === 'diff' && args.includes('--name-status')) return { exitCode: 0, stdout: 'M\u0000src/a.ts\u0000', stderr: '' };
        if (args[0] === 'diff') return { exitCode: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n', stderr: '' };
        if (args[0] === 'show') return { exitCode: 0, stdout: 'export const value = 0;\n', stderr: '' };
        return { exitCode: 1, stdout: '', stderr: '' };
      },
      config: { llm_provider: 'claude', build_review: { enabled: true, rubrics: { testQuality: { enabled: false } }, custom_rubrics: {
        portable: { enabled: true, skill: 'portable-policy', question: 'Check the selected policy.', source: 'project', llm_provider: 'claude' },
      } } } as HarnessConfig,
      providerRuntimes: new ProviderRuntimeSet([{ key: 'claude', provider, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }]),
      sessionStore: new ProviderSessionStore(),
      providerExecution: { prepareCandidateSelfHost: async () => ({ executable: '/prepared/claude', env: { BUILD_REVIEW_CREDENTIAL: environmentCredentialSentinel }, args: [], teardown: async () => {} }) } as never,
      buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: {} } as never) },
      buildReviewEffectiveResolver: async () => ({ ok: true, feature: { version: 'v1', repository: '/repo', feature: 'feature' }, effective: {
        rawVerdict: 'PASS', verdict: 'PASS', acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: ['testQuality'], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [], uncoveredScopeIncompleteRubrics: [],
      } }) as never,
      buildReviewPolicyCatalog: async () => [{ semanticName: 'portable-policy', source: 'project', installationOrigin: '/fixture/project', canonicalSkillPath: '/fixture/project/SKILL.md', packageRoot: '/fixture/project', declaredDependencies: [], availability: 'available' as const }],
      buildReviewPolicyCapture: async (policy) => ({
        policy, materialPath: '/runtime/policy', definitionPath: '/runtime/policy/SKILL.md',
        manifest: [
          { relativePath: 'SKILL.md', bytes: Buffer.from(`# ${policyByteSentinel}\n`) },
          { relativePath: 'credential.env', bytes: Buffer.from(environmentCredentialSentinel) },
        ],
        metadata: { version: 1, semanticName: policy.semanticName, source: policy.source, declaredDependencies: [] },
        digest: bundleDigest,
      }),
      events,
    });

    persister.start();
    const result = await runner.run('build_review', { complexity_tier: 'M' } as never, {
      readOnlyReviewCapabilities: {
        claude: { provider: 'claude', platform: process.platform, status: 'available' },
      },
    });
    persister.stop();
    expect(result.success, result.output).toBe(true);

    const ledger = await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8');
    const audit = await readFile(join(root, '.pipeline', 'audit-trail', 'events.jsonl'), 'utf8');
    const rendered = lines.join('\n');
    for (const sink of [ledger, audit, rendered]) {
      expect(sink).not.toContain(policyByteSentinel);
      expect(sink).not.toContain(environmentCredentialSentinel);
    }
    expect(ledger).toContain(bundleDigest);
    expect(audit).toContain(bundleDigest);
    expect(rendered).toContain('claude/opus/high project');
  });
});

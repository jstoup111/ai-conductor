import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { load as loadYaml } from 'js-yaml';

import {
  assembleBuildReviewAdjudicationContext,
  buildReviewAdjudicationSourceId,
} from '../../src/engine/build-review-adjudication-context.js';
import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { validateConfig } from '../../src/engine/config.js';
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { chargeBuildReviewEffectInLedger } from '../../src/engine/kickback-ledger.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { markBuildReviewWorkOrderAttempted, publishBuildReviewWorkOrder } from '../../src/engine/build-review-work-order.js';
import type { EffectMarkerTrackerClient } from '../../src/engine/tracker-client.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const directories: string[] = [];
const feature = { version: 'v1' as const, repository: '/repo', feature: 'event-spine' };
const lapId = 'lap-event-spine-adjudication' as never;
const snapshotDigest = 'sha256:event-spine-adjudication';
const HASH = `sha256:${'a'.repeat(64)}`;

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'event-spine-adjudication-'));
  directories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function aggregate() {
  const declaration = {
    version: 'v1' as const,
    rubricId: 'eventSpine',
    semanticSkill: 'event-spine',
    question: 'Does this change extend the existing event spine?',
    source: 'project' as const,
    resources: ['AGENT_INSTRUCTIONS.md'],
  };
  const sourceRegion = {
    path: 'src/conductor/src/engine/reviewer.ts', startLine: 12, endLine: 18,
    contentHash: HASH, display: 'parallel reviewer ledger',
  };
  const policy = { version: 'v1' as const, bundleDigest: `sha256:${'b'.repeat(64)}` };
  const producer = { provider: 'claude', model: 'opus', effort: 'low' } as const;
  const reviewedInput = { version: 'v1' as const, contentDigest: HASH };
  const result = stampBuildReviewCustomJudgedResult({
    kind: 'custom-findings', version: 'v1', findings: [{
      concernId: 'parallel-event-channel', summary: 'The diff adds a separate reviewer ledger.',
      evidenceLocations: ['src/conductor/src/engine/reviewer.ts:12'], confidence: 92, sourceRegions: [sourceRegion],
    }],
  }, { rubric: 'eventSpine', lapId, declaration, policy, candidate: producer, reviewedInput }, { sourceRegions: [sourceRegion] });
  if (!result) throw new Error('expected stamped event-spine finding');
  return joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest,
    results: {
      testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' },
      security: { kind: 'judged', rubric: 'security', lapId, snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS' },
    },
    customResults: {
      eventSpine: {
        descriptor: {
          version: 'v1', semanticSkill: 'event-spine', declaration, installation: { source: 'project' },
          effectivePolicy: policy, reviewedInput, producer,
        },
        result,
      },
    },
    currentCustomRubrics: ['eventSpine'],
  } as never);
}

function eventSource() {
  const source = projectBuildReviewAggregateSources(aggregate())?.[0];
  if (!source) throw new Error('expected event-spine source');
  return source;
}

function coordinatorInput(root: string, judge: (context: unknown) => Promise<RemediationCaseJudgement>) {
  return {
    projectRoot: root, feature, aggregate: aggregate(), operatorResolvedFindingIds: new Set<string>(), mechanical: 'healthy' as const,
    judge, chargeInput: { treeHash: 'tree-event-spine', resolvedCount: 1, reason: 'fixture' },
    generateId: (() => { const ids = ['case-event-spine', 'effect-event-spine']; return () => ids.shift()!; })(),
    readPlanContract: async () => ({
      path: '.docs/plans/event-spine.md', pointers: [],
      admittedTaskContracts: [{ id: '5', contract: 'Route event-spine findings through adjudication.' }],
    }),
    readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '5', status: 'in_progress' }] }),
  };
}

describe('event-spine rubric adjudication', () => {
  it('attributes its sole unresolved custom finding to eventSpine in adjudication context', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(), priorCases: [],
      planContract: { path: '.docs/plans/event-spine.md', pointers: [], admittedTaskContracts: [{ id: '5', contract: 'Route event-spine findings through adjudication.' }] },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '5', status: 'in_progress' }] },
    });

    expect(result).toMatchObject({ ok: true, context: {
      currentFindings: [expect.objectContaining({ rubric: 'eventSpine', concernKind: 'parallel-event-channel' })],
    } });
  });

  it('routes act to BUILD, files defer without passing the source, and settles refute without a charge', async () => {
    const source = eventSource();
    const sourceId = buildReviewAdjudicationSourceId(source);
    const action: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'event-spine-case' }],
      cases: [{
        caseRef: 'event-spine-case', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The event must use the shared spine.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Use ConductorEventEmitter.', admittedTaskIds: ['5'], admissionRationale: 'Task 5 owns event-spine adjudication.' }] },
      }],
      consistency: { verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['event-spine-case'], rationale: 'The repair is admitted.' },
    };
    const actionRoot = await projectRoot();
    await expect(coordinateBuildReviewAdjudication({ ...coordinatorInput(actionRoot, async () => action) })).resolves.toMatchObject({ ok: true, route: 'build' });

    const deferred: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'deferred', caseRef: 'event-spine-defer' }],
      cases: [{
        caseRef: 'event-spine-defer', disposition: 'defer', priority: 'low', confidence: 'high', rationale: 'Track separately.',
        effect: { kind: 'deferral', title: 'Remove parallel event channel', body: 'Use the existing event spine.', exclusionRationale: 'Outside this feature.' },
      }],
      consistency: { verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['event-spine-defer'], rationale: 'The deferral is explicit.' },
    };
    const deferredRoot = await projectRoot();
    const fileIssue = vi.fn(async () => ({ issueUrl: 'https://example.test/issues/event-spine' }));
    await expect(coordinateBuildReviewAdjudication({
      ...coordinatorInput(deferredRoot, async () => deferred), repo: 'acme/conductor', fileIssue,
      tracker: { findIssueByEffectMarker: async () => undefined } as unknown as EffectMarkerTrackerClient,
    })).resolves.toMatchObject({ ok: true, route: 'pass' });
    expect(fileIssue).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove parallel event channel' }));
    await expect(new RemediationCaseStore(deferredRoot, feature).read()).resolves.toMatchObject({
      ok: true, state: { cases: [expect.objectContaining({ disposition: 'defer', resolution: 'open' })] },
    });

    const refuteRoot = await projectRoot();
    const store = new RemediationCaseStore(refuteRoot, feature);
    await store.mutate(async () => ({ value: null, nextState: { version: 'v1', feature, cases: [{
      id: 'case-event-spine', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'Repair the event channel.', resolution: 'open',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-09-28T00:00:00.000Z' }], effect: { id: 'effect-event-spine', kind: 'action', status: 'applied', workOrderId: 'order-event-spine' },
    }] } }));
    await publishBuildReviewWorkOrder(refuteRoot, { version: 'v1', domain: 'build_review', feature, effectId: 'effect-event-spine', cases: [{ caseId: 'case-event-spine', priority: 'high', tasks: [{ title: 'Use ConductorEventEmitter.' }] }] });
    await markBuildReviewWorkOrderAttempted(refuteRoot, feature);
    await mkdir(join(refuteRoot, 'test'), { recursive: true });
    await writeFile(join(refuteRoot, 'test', 'event-spine-refutation.test.ts'), 'uses ConductorEventEmitter\n');
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    const refuted: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review', sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'event-spine-refutation' }],
      cases: [{
        caseRef: 'event-spine-refutation', existingCaseId: 'case-event-spine', disposition: 'refute', priority: 'high', confidence: 'high', rationale: 'The shared emitter is already used.', effect: { kind: 'none' },
        refutation: { claim: 'A parallel event channel exists.', assertions: [{ assertion: 'The event uses ConductorEventEmitter.', verdict: 'refuted', evidence: [{ path: 'test/event-spine-refutation.test.ts', excerpt: 'ConductorEventEmitter' }] }] },
      }],
      consistency: { verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['event-spine-refutation'], rationale: 'The evidence refutes the source.' },
    };
    await expect(coordinateBuildReviewAdjudication({ ...coordinatorInput(refuteRoot, async () => refuted), chargeEffect: charge })).resolves.toMatchObject({ ok: true, route: 'pass' });
    expect(charge).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toMatchObject({
      ok: true, state: { cases: [expect.objectContaining({ disposition: 'refute', resolution: 'resolved', effect: { kind: 'none' } })] },
    });
  });

  it('refuses the repository eventSpine rubric when adjudication is disabled', async () => {
    const config = loadYaml(await readFile(join(repoRoot, '.ai-conductor', 'config.yml'), 'utf8'));
    expect(config).toBeTypeOf('object');
    if (!config || typeof config !== 'object') return;
    const repositoryConfig = config as { build_review?: Record<string, unknown> };

    const result = validateConfig({
      ...repositoryConfig,
      build_review: { ...repositoryConfig.build_review, adjudication: { enabled: false } },
    });

    expect(result).toEqual({
      ok: false,
      error: { type: 'validation_error', message: 'build_review.custom_rubrics.eventSpine cannot be enabled while build_review.adjudication.enabled is false' },
    });
  });
});

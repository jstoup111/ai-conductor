/**
 * Covers: S4.1, S5.1
 *
 * Drives the no-owner finding through typed evidence, the scope router,
 * durable decision store, and next-lap router. The temporary
 * filesystem is the persistence boundary; no third-party service is used.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'prd-audit-no-owner-over-scope',
  })),
}));

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import {
  AcceptedWideningDecisionStore,
} from '../../src/engine/accepted-widenings.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { persistFixtureProjectedRemediationPlan } from '../engine/remediation-plan-fixtures.js';

const SUMMARY = 'unplanned npm test change';
const ACTIVE_PLAN = '### Task 1: Planned behavior\n\n**Files:** src/example.ts\n';

describe('an accepted scope decision closes only its own blocker (S5.3)', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  function mixedReport(withFixable: boolean): string {
    return [
      '**PRD:** none',
      '',
      '## Verdict Table',
      '| Criterion | Grade | Plan task | Evidence | Intent relation |',
      '| --- | --- | --- | --- | --- |',
      withFixable
        ? '| S1.1 | FIXABLE | 1 | Planned behavior is missing. | within |'
        : '| S1.1 | PASS | 1 | Planned behavior is present. | within |',
      '',
      '## Findings without an owning criterion',
      '| Finding | Grade | Plan task | Evidence | Intent relation |',
      '| --- | --- | --- | --- | --- |',
      `| NC.1 | OVER_SCOPE | | ${SUMMARY} | outside-visible |`,
    ].join('\n');
  }

  async function remediateWithAcceptedScope(withFixable: boolean): Promise<{ kind: string; remediateRuns: number; detail?: string }> {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-mixed-scope-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), '# Plan\n\n' + ACTIVE_PLAN);
    await writeFile(
      join(root, '.docs', 'stories', 'feature.md'),
      '## Story 1: Planned behavior\n\n### Happy Path\n- Given the plan, when built, then the behavior is present.\n',
    );
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: '.docs/plans/feature.md' }),
    );
    await writeFile(join(root, '.pipeline', 'prd-audit.md'), mixedReport(withFixable));
    await persistPrdAuditVerdict(root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 },
          criterionId: 'S1.1',
          grade: withFixable ? 'FIXABLE' : 'PASS',
          evidence: withFixable ? 'Planned behavior is missing.' : 'Planned behavior is present.',
          rationale: 'Fixture judgment.',
          requirementAssociations: [],
          evidenceTaskIds: ['1'],
          ...(withFixable ? { ownerTaskId: '1' } : {}),
        }],
        noOwnerObservations: [{
          presentationOrdinal: 'NC.1', grade: 'OVER_SCOPE', evidence: SUMMARY,
          rationale: 'Fixture scope observation.', intentRelation: 'outside-visible',
        }],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'fixture-run', codeStamp: null });
    const caseFeature = { version: 'v1' as const, repository: '/fixture/repository', feature: 'prd-audit-no-owner-over-scope' };
    const decisionFeature = { version: 1 as const, repository: '/fixture/repository', feature: 'prd-audit-no-owner-over-scope' };
    const currentSourceId = prdWideningSourceId({
      criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: SUMMARY, prdIds: [],
    });
    const offers = await persistPrdWideningOffers(root, caseFeature, [{
      criterion: 'NC.1', sourceId: currentSourceId, evidence: SUMMARY,
      reportSnapshot: mixedReport(withFixable), relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error(`fixture offer failed: ${offers.reason}`);
    const offer = offers.offers[0]!;
    const accepted = await new AcceptedWideningDecisionStore(root, decisionFeature).append({
      criterion: 'NC.1', authority: 'accept', rationale: 'Approved.', operator: 'acceptance-test',
      originalSource: offer.originalSource, originalCaseId: offer.originalCaseId, offerEntryId: offer.offerEntryId,
    });
    if (!accepted.ok) throw new Error(`fixture acceptance failed: ${accepted.reason}`);

    let remediateRuns = 0;
    const runner: StepRunner = {
      run: async (step: StepName, _state, options) => {
        if (step === 'remediate' && options?.remediationRequest?.mode === 'prd-widening-reconciliation') {
          return {
            success: true,
            finalStructuredResult: {
              version: 'v1',
              results: [{
                sourceId: currentSourceId,
                kind: 'same-case', caseId: offer.originalCaseId,
                reason: 'Fixture relation confirms the current accepted behavior.',
              }],
            },
          };
        }
        if (step === 'remediate') {
          remediateRuns++;
          await persistFixtureProjectedRemediationPlan(root!, options, [{
            id: 'S1.1',
            disposition: 'build',
            category: null,
            rationale: 'Planned behavior is missing.',
            tasks: [{ id: 'rem-s1-1', title: 'Implement the planned behavior' }],
          }]);
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      // One authored task: a 0.25 ratio would leave the FIXABLE append no room.
      config: { prd_audit: { max_appended_ratio: 1 } } as never,
    });
    const remediationState = { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState;
    (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...remediationState };
    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState, steps: typeof ALL_STEPS, context: string,
        source: { source: string; evidence: ReadonlyArray<{ gate: string; evidenceFile: string }> },
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      remediationState,
      ALL_STEPS, 'test remediation',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );
    return { kind: outcome.kind, remediateRuns, detail: outcome.detail };
  }

  it('advances without remediation when the accepted scope finding is the only blocker', async () => {
    await expect(remediateWithAcceptedScope(false)).resolves.toMatchObject({ kind: 'none', remediateRuns: 0 });
  });

  it('still remediates a coexisting FIXABLE finding after the scope acceptance', async () => {
    const outcome = await remediateWithAcceptedScope(true);
    expect(outcome.remediateRuns).toBe(1);
    expect(outcome.kind, outcome.detail).toBe('route');
  });
});

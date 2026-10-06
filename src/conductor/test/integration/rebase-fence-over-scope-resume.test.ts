// Covers: task:3

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'rebase-fence-over-scope-resume',
  })),
}));

vi.mock('../../src/engine/owner-gate/machine-identity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/owner-gate/machine-identity.js')>(),
  readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: 'fixture-operator' })),
}));

vi.mock('../../src/engine/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/steps.js')>();
  return { ...actual, buildStepRegistry: vi.fn() };
});

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict, readVerdict } from '../../src/engine/gate-verdicts.js';
import { writeState } from '../../src/engine/state.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { persistPrdWideningOffers } from '../../src/engine/prd-widening-offers.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';
import type { ConductState, StepDefinition, StepName } from '../../src/types/index.js';
import type { RebasePreservedCandidate } from '../../src/engine/gate-verdicts.js';

const report = [
  '**PRD:** none',
  '',
  '## Verdict Table',
  '| Criterion | Grade | Plan task | PRD: | Intent relation | Evidence |',
  '| --- | --- | --- | --- | --- | --- |',
  '| S1.1 | PASS | — | none | within | Planned behavior is present. |',
  '',
  '## Findings without an owning criterion',
  '| Finding | Grade | Intent relation | Evidence |',
  '| --- | --- | --- | --- |',
  '| NC.1 | OVER_SCOPE | outside-visible | The original user-visible widening. |',
].join('\n');

/** The typed judgment the managed prd_audit dispatch persists for {@link report}. */
const judgment = {
  version: 'v1' as const,
  criterionJudgments: [{
    criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS' as const,
    evidence: 'Planned behavior is present.', rationale: 'Fixture pass.',
    requirementAssociations: [], evidenceTaskIds: [],
  }],
  noOwnerObservations: [{
    presentationOrdinal: 'NC.1', grade: 'OVER_SCOPE' as const,
    evidence: 'The original user-visible widening.', rationale: 'Fixture widening.',
    intentRelation: 'outside-visible' as const,
  }],
};

const sourceId = prdWideningSourceId({
  criterion: 'NC.1', grade: 'OVER_SCOPE',
  evidence: 'The original user-visible widening.', prdIds: [],
});

const resumedSteps: StepDefinition[] = [
  {
    name: 'prd_audit', label: 'PRD Audit', phase: 'SHIP', enforcement: 'gating',
    prerequisites: [], skippableForTiers: [], isCheckpoint: false, loopGate: true,
  },
  {
    name: 'explore', label: 'Later observation', phase: 'SHIP', enforcement: 'advisory',
    prerequisites: ['prd_audit'], skippableForTiers: [], isCheckpoint: false,
  },
];

const buildReviewVerdict = { satisfied: true, checkedAt: 100 };
const replay = { preRebaseHead: 'pre', mergeBase: 'base', target: 'main', completedHead: 'head', expectedTree: 'tree' };

function fixtureCandidate(gate: 'build_review' | 'prd_audit'): RebasePreservedCandidate {
  const originalVerdict = gate === 'build_review'
    ? buildReviewVerdict
    : { satisfied: true, checkedAt: 99 };
  const originalVerdictDigest = `sha256:${createHash('sha256').update(JSON.stringify(originalVerdict)).digest('hex')}`;
  return {
    gate,
    original: {
      artifactDigest: `sha256:${createHash('sha256').update(`${gate}-artifact`).digest('hex')}`,
      attemptId: `${gate}-attempt`,
      runId: `${gate}-run`,
      codeStamp: 'head',
    },
    originalVerdictDigest,
    relevantInputIdentities: [`.docs/specs/${gate}.md@sha256:${gate}-input`],
  };
}

const preservationEvidence = [fixtureCandidate('build_review'), fixtureCandidate('prd_audit')];
const buildReviewCandidate = preservationEvidence[0]!;

const rebaseOperation = {
  id: 'rebase-operation-2983',
  status: 'applied' as const,
  appliedAt: 100,
  transition: { preserved: ['build_review', 'prd_audit'] as StepName[], invalidated: [], reverified: [] },
  replay,
  preservationEvidence,
};

describe('integration/rebase-fence-over-scope-resume (#2983)', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'rebase-fence-over-scope-resume-'));
    stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    vi.mocked(buildStepRegistry).mockReturnValue(resumedSteps);
    await writeState(stateFilePath, { prd_audit: 'pending' } as ConductState);
    await writeVerdict(projectRoot, 'rebase', { satisfied: true, checkedAt: 150, rebaseOperation });
    await writeVerdict(projectRoot, 'build_review', {
      ...buildReviewVerdict,
      preservation: {
        gate: 'build_review',
        original: buildReviewCandidate.original,
        replay: rebaseOperation.replay,
        relevantInputIdentities: buildReviewCandidate.relevantInputIdentities,
        operationId: rebaseOperation.id,
      },
    });
    await writeVerdict(projectRoot, 'prd_audit', { satisfied: false, checkedAt: 200 });

    const offers = await persistPrdWideningOffers(projectRoot, {
      version: 'v1', repository: '/fixture/repository', feature: 'rebase-fence-over-scope-resume',
    }, [{
      criterion: 'NC.1', sourceId, evidence: 'The original user-visible widening.',
      reportSnapshot: report, relation: 'outside-visible',
    }]);
    if (!offers.ok) throw new Error(`fixture offer failed: ${offers.reason}`);
  });

  afterEach(async () => {
    vi.mocked(buildStepRegistry).mockReset();
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeClearedDecision(decision: 'accept' | 'refuse'): Promise<void> {
    const stored = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'remediation-cases.json'), 'utf8')) as {
      prdWideningCases: Array<{ id: string; originalSources: Array<{ sourceId: string; snapshot: string }> }>;
    };
    const offer = stored.prdWideningCases[0]!;
    await writeFile(join(projectRoot, '.pipeline', 'HALT.cleared'), [
      '```json over-scope-decisions',
      JSON.stringify([{
        criterion: 'NC.1', summary: 'The original user-visible widening.', relation: 'outside-visible',
        offerEntryId: offer.id, originalCaseId: offer.id,
        originalSource: { id: offer.originalSources[0]!.sourceId, snapshot: offer.originalSources[0]!.snapshot },
        decision, rationale: decision === 'accept' ? 'The operator accepts this widening.' : 'The operator refuses this widening.',
      }]),
      '```',
    ].join('\n'));
  }

  async function resume(expectDecision: boolean): Promise<{ started: StepName[]; loopHalts: string[] }> {
    const events = new ConductorEventEmitter();
    const started: StepName[] = [];
    const loopHalts: string[] = [];
    events.on('step_started', (event) => { if (event.type === 'step_started') started.push(event.step); });
    events.on('loop_halt', (event) => { if (event.type === 'loop_halt') loopHalts.push(event.reason); });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        if (step === 'prd_audit') {
          if (expectDecision) {
            expect(options?.prdWideningReviewContext?.decisions).toEqual(expect.arrayContaining([
              expect.objectContaining({ criterion: 'NC.1' }),
            ]));
          }
          await persistPrdAuditVerdict(projectRoot, {
            complete: true, judgment, diagnostics: [], recordedDispositions: [],
          } as never, { attemptId: options?.runId ?? 'fixture-run', codeStamp: 'head' });
          return { success: true };
        }
        if (step === 'remediate') {
          const cases = JSON.parse(await readFile(join(projectRoot, '.pipeline', 'remediation-cases.json'), 'utf8')) as {
            prdWideningCases: Array<{ id: string }>;
          };
          return {
            success: true,
            finalStructuredResult: {
              version: 'v1',
              results: [{
                sourceId, kind: 'same-case', caseId: cases.prdWideningCases[0]!.id,
                reason: 'The current report re-grades the same original source.',
              }],
            },
          };
        }
        return { success: true };
      }),
    };
    await new Conductor({
      projectRoot, stateFilePath, stepRunner: runner, events, resume: true,
      verifyArtifacts: true, config: { gate_code_validity: { enabled: false } },
      maxRetries: 1,
    } as never).run();
    return { started, loopHalts };
  }

  it('delivers an accepted cleared decision to the resumed prd_audit lap', async () => {
    await writeClearedDecision('accept');

    const result = await resume(true);

    expect(result.started).toEqual(expect.arrayContaining(['prd_audit', 'explore']));
    expect(result.loopHalts).toEqual([]);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(projectRoot, '.pipeline', 'accepted-widenings.json'), 'utf8')).resolves.toMatch(/"authority":"accept"/);
    await expect(readVerdict(projectRoot, 'prd_audit')).resolves.toMatchObject({ satisfied: true });
  });

  it('keeps a refused cleared decision on the existing prd_audit over-scope halt', async () => {
    await writeClearedDecision('refuse');

    const result = await resume(true);

    expect(result.started).toEqual(['prd_audit']);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/refus|NC\.1/i);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain('rebase transition');
  });

  it('keeps an unrecorded decision blocked on NC.1', async () => {
    const result = await resume(false);

    expect(result.started).toEqual(['prd_audit']);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/NC\.1.*awaiting|awaiting.*NC\.1/i);
  });
});

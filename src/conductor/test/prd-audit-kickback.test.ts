// Covers: task:1, task:3, task:5, task:6, task:7, task:9, S5.1, S5.2, S5.3, S5.4

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

vi.mock('../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'prd-audit-kickback',
  })),
}));

// Pre-audit reconciliation needs a machine-scoped operator whenever a fixture
// contains a cleared decision. Individual no-owner cases override this seam.
vi.mock('../src/engine/owner-gate/machine-identity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/engine/owner-gate/machine-identity.js')>(),
  readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: 'fixture-operator' })),
}));

import {
  Conductor,
  readRemediationGateAppendBudget,
  remediationLapCapForGate,
  validationJoinRemediationRoundCap,
  type StepRunner,
} from '../src/engine/conductor.js';
import {
  AcceptedWideningDecisionStore,
  renderOverScopeDecisionBlock,
} from '../src/engine/accepted-widenings.js';
import { renderPrdAuditScopeHalt } from '../src/engine/prd-widening-recovery.js';
import type { PrdAuditFinding, PrdAuditGrade } from '../src/engine/artifacts.js';
import { prdWideningSourceId } from '../src/engine/prd-widening-context.js';
import { readGrowth, readKickbackLedger } from '../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import { readState, writeState } from '../src/engine/state.js';
import type { ConductState, StepName } from '../src/types/index.js';
import type { ConductorEvent } from '../src/types/events.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { DefaultStepRunner } from '../src/engine/step-runners.js';
import { PROTECTED_ARTIFACT_SEAL_PATH } from '../src/engine/protected-artifact-seal.js';
import {
  appendRecordedShipmentFindings,
  recordedShipmentFindings,
} from '../src/engine/shipment-association.js';
import * as machineIdentity from '../src/engine/owner-gate/machine-identity.js';
import { persistAsBuiltVerdict, readAsBuiltVerdict } from '../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../src/engine/as-built-policy.js';
import { persistPrdAuditVerdict, readPrdAuditVerdict } from '../src/engine/prd-audit-verdict-store.js';
import type { PrdAuditJudgment } from '../src/engine/prd-audit-contract.js';

const dirs: string[] = [];

const AS_BUILT_FIXTURE_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'test fixture' },
  planGap: { enabled: true, reason: 'test fixture' },
  adrCompliance: { enabled: false, reason: 'test fixture' },
  diagramDrift: { enabled: false, reason: 'test fixture' },
};

// The Markdown governing-clause parser was retired in favour of typed verdict
// references. These historical parser cases remain skipped until their direct
// test block is removed with the legacy fixture consolidation.
const resolveAsBuiltGoverningClause = async (..._args: unknown[]): Promise<null> => null;

function planGapReport(criterion: string, summary = 'The approved plan has no task for this behavior.') {
  return [
    '**PRD:** present',
    '',
    '## Verdict Table',
    '| Criterion | Grade | Plan task | Evidence |',
    '| --- | --- | --- | --- |',
    `| ${criterion} | PLAN_GAP | | ${summary} |`,
  ].join('\n');
}

function storiesWithCriterion(section: 'Happy Path' | 'Negative Paths') {
  return [
    '# Stories',
    '',
    '## Story 2: behavior',
    '',
    `#### ${section}`,
    '- Given input, when exercised, then the expected behavior occurs.',
  ].join('\n');
}

function overScopeReport(
  criterion: string,
  relation: 'within' | 'outside-harmless' | 'outside-visible',
  summary = 'The change adds behavior beyond the approved plan.',
  includeIntentRelation = true,
) {
  const header = includeIntentRelation
    ? '| Criterion | Grade | Plan task | Evidence | Intent relation |'
    : '| Criterion | Grade | Plan task | Evidence |';
  const separator = includeIntentRelation
    ? '| --- | --- | --- | --- | --- |'
    : '| --- | --- | --- | --- |';
  const row = includeIntentRelation
    ? `| ${criterion} | OVER_SCOPE | | ${summary} | ${relation} |`
    : `| ${criterion} | OVER_SCOPE | | ${summary} |`;
  return [
    '**PRD:** present',
    '',
    '## Verdict Table',
    header,
    separator,
    row,
  ].join('\n');
}

function refusedFixableReport() {
  return [
    '**PRD:** present',
    '',
    '## Verdict Table',
    '| Criterion | Grade | Plan task | Evidence | Intent relation |',
    '| --- | --- | --- | --- | --- |',
    '| S2.1 | OVER_SCOPE | | The change adds behavior beyond the approved plan. | outside-visible |',
    '| S2.2 | FIXABLE | 2 | Missing S2.2 behavior | within |',
  ].join('\n');
}

function noOwnerOverScopeReport(
  criterion: string,
  summary: string,
  relation: 'within' | 'outside-harmless' | 'outside-visible' = 'outside-visible',
) {
  return [
    '**PRD:** none',
    '',
    '## Verdict Table',
    '| Criterion | Grade | Plan task | Evidence | Intent relation |',
    '| --- | --- | --- | --- | --- |',
    '| S3.1 | PASS | | Covered behavior | within |',
    '',
    '## Findings without an owning criterion',
    '| Finding | Grade | Intent relation | Evidence |',
    '| --- | --- | --- | --- |',
    `| ${criterion} | OVER_SCOPE | ${relation} | ${summary} |`,
  ].join('\n');
}

/**
 * A report whose rows are mixed: one PASS, one negative-path PLAN_GAP that a
 * clean report would record, and one no-owner row keyed `OS.1` — an invalid
 * key, so the parser rejects that row instead of parsing a finding from it.
 * Every rejected row must block by name, whichever route reads the report.
 */
function rejectedRowWithNegativePathPlanGapReport() {
  return [
    '**PRD:** none',
    '',
    '## Verdict Table',
    '| Criterion | Grade | Plan task | Evidence |',
    '| --- | --- | --- | --- |',
    '| S11.1 | PASS | 1 | Covered behavior |',
    '| S11.2 | PLAN_GAP | | An edge case is not in the approved plan. |',
    '',
    '## Findings without an owning criterion',
    '| Finding | Grade | Intent relation | Evidence |',
    '| --- | --- | --- | --- |',
    '| OS.1 | OVER_SCOPE | outside-visible | A visible behavior exists outside the approved plan. |',
  ].join('\n');
}

/**
 * This legacy report matrix still names its fixtures as Markdown, but managed
 * dispatches must now settle the engine-owned typed verdict. Keep the fixture
 * data as-is while translating it at the mocked provider boundary.
 */
async function persistGroupedPrdAuditVerdict(
  root: string,
  report: string,
  attemptId: string | undefined,
): Promise<void> {
  const findings: PrdAuditFinding[] = [...report.matchAll(/^\|\s*(S[A-Za-z0-9.-]+\.\d+|NC[.-]\d+)\s*\|\s*(PASS|FIXABLE|PLAN_GAP|OVER_SCOPE)\s*\|\s*([^|]*)\|\s*([^|]*)(?:\|\s*([^|]*))?(?:\|\s*([^|]*))?\|?\s*$/gmi)]
    .map((match) => ({
      criterion: match[1]!.toUpperCase(),
      grade: match[2]!.toUpperCase() as PrdAuditGrade,
      ...(match[3]!.trim() && match[3]!.trim() !== '—' ? { planTask: match[3]!.trim() } : {}),
      prdIds: [...report.matchAll(/\bFR-\d+[A-Za-z]?\b/gi)].map((id) => id[0]!.toUpperCase()),
      evidence: [match[4], match[5], match[6]].find((cell) => cell && !/^(within|outside-harmless|outside-visible)$/i.test(cell.trim()))?.trim() ?? '',
    }));
  const relations = new Map(findings
    .map((finding) => [finding.criterion, report.match(new RegExp(`\\|\\s*${finding.criterion.replace('.', '\\.') }\\s*\\|[^\\n]*(within|outside-harmless|outside-visible)`, 'i'))?.[1]?.toLowerCase()] as const)
    .filter((entry): entry is readonly [string, 'within' | 'outside-harmless' | 'outside-visible'] => entry[1] === 'within' || entry[1] === 'outside-harmless' || entry[1] === 'outside-visible'));
  // This fixture emulates the provider→validator boundary. A malformed carrier
  // is surfaced as typed incompleteness before any conductor route reads it;
  // the Markdown fixture remains presentation-only after that boundary.
  const diagnostics: string[] = /\|\s*OS\.1\s*\|/i.test(report)
    ? ['OS.1: fixture invalid typed evidence']
    : [];
  const criterionJudgments: Array<PrdAuditJudgment['criterionJudgments'][number]> = [];
  const noOwnerObservations: Array<PrdAuditJudgment['noOwnerObservations'][number]> = [];

  for (const finding of findings) {
      if (/^NC\.\d+$/i.test(finding.criterion)) {
        noOwnerObservations.push({
          presentationOrdinal: finding.criterion,
          grade: 'OVER_SCOPE',
          evidence: finding.evidence || 'Fixture supplies typed audit evidence.',
          rationale: 'Fixture supplies typed audit evidence.',
          intentRelation: relations.get(finding.criterion) ?? 'outside-visible',
        });
        continue;
      }
      const match = /^S(.+)\.(\d+)$/i.exec(finding.criterion);
      if (!match) {
        diagnostics.push(`${finding.criterion}: fixture could not derive a criterion reference`);
        continue;
      }
      const criterion = { storyId: match[1]!, ordinal: Number(match[2]) };
      const base = {
        criterion,
        criterionId: finding.criterion,
        evidence: finding.evidence || 'Fixture supplies typed audit evidence.',
        rationale: 'Fixture supplies typed audit evidence.',
        requirementAssociations: finding.prdIds.map((requirementId) => ({
          path: '.docs/specs/feature.md', requirementId,
        })),
        evidenceTaskIds: finding.planTask ? [finding.planTask] : [],
      };
      if (finding.grade === 'FIXABLE') {
        criterionJudgments.push({ ...base, grade: 'FIXABLE', ownerTaskId: finding.planTask ?? '1' });
      } else if (finding.grade === 'OVER_SCOPE') {
        criterionJudgments.push({
          ...base,
          grade: 'OVER_SCOPE',
          intentRelation: relations.get(finding.criterion) ?? 'outside-visible',
        });
      } else {
        criterionJudgments.push({ ...base, grade: finding.grade });
      }
  }

  await persistPrdAuditVerdict(root, {
    complete: diagnostics.length === 0,
    judgment: { version: 'v1', criterionJudgments, noOwnerObservations },
    diagnostics,
    recordedDispositions: [],
  }, { attemptId: attemptId ?? 'fixture-run', codeStamp: null });
}

function storiesForRejectedRowReport() {
  return [
    '# Stories',
    '',
    '## Story 11: negative boundary',
    '',
    '#### Happy Path',
    '- Given a valid request, when it is served, then the behavior holds.',
    '',
    '#### Negative Paths',
    '- Given an unsupported condition, when it occurs, then it is recorded.',
  ].join('\n');
}

async function createPrdAuditRemediationFixture(input: {
  taskCount: number;
  criteria: string[];
  config?: Record<string, unknown>;
  priorLaps?: number;
  priorGrowthAdded?: number;
  existingTask?: boolean;
  repairTaskId?: string;
  report?: string;
  beforePlanRemediation?: (root: string) => Promise<void>;
}) {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-'));
  dirs.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  const plan = Array.from(
    { length: input.taskCount },
    (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
  ).join('\n');
  await writeFile(planPath, plan);
  const maxOrdinal = Math.max(0, ...input.criteria.map((criterion) => Number(criterion.match(/^S2\.(\d+)$/)?.[1] ?? 0)));
  await writeFile(
    join(root, '.docs', 'stories', 'feature.md'),
    ['# Stories', '', '## Story 2: remediation', '', '#### Happy Path',
      ...Array.from({ length: maxOrdinal }, (_, index) => `- Given S2.${index + 1}, when repaired, then it holds.`),
    ].join('\n'),
  );
  await writeFile(
    join(root, '.pipeline', 'engine-state.json'),
    JSON.stringify({ activePlanPath: planPath }),
  );
  const malformed = input.report?.includes('| S2.1 | MAYBE |') ?? false;
  await persistPrdAuditVerdict(root, {
    complete: !malformed,
    judgment: {
      version: 'v1',
      criterionJudgments: malformed
        ? []
        : input.criteria.map((criterion, index) => ({
          criterion: { storyId: '2', ordinal: Number(criterion.slice('S2.'.length)) },
          criterionId: criterion,
          grade: 'FIXABLE' as const,
          evidence: `Missing ${criterion} behavior`,
          rationale: `Fixture repair for ${criterion}.`,
          requirementAssociations: [],
          evidenceTaskIds: [String(index + 1)],
          ownerTaskId: String(index + 1),
        })),
      noOwnerObservations: [],
    },
    diagnostics: malformed ? ['S2.1: fixture invalid grade'] : [],
    recordedDispositions: [],
  }, { attemptId: 'fixture-remediation', codeStamp: null });
  if (input.priorLaps !== undefined || input.priorGrowthAdded !== undefined) {
    await writeKickbackLedger(root, {
      version: 1,
      gates: {
        ...(input.priorLaps === undefined ? {} : {
          prd_audit: {
            count: 0,
            cumulative: 0,
            treeHash: null,
            lastReason: '',
            priorVerdict: true,
            resolvedBefore: 0,
            laps: input.priorLaps,
          },
        }),
      },
      ...(input.priorGrowthAdded === undefined ? {} : {
        growth: { authored: input.taskCount, added: input.priorGrowthAdded, byGate: { prd_audit: input.priorGrowthAdded } },
      }),
    } as never);
  }

    await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await execa('git', ['add', '.docs'], { cwd: root });
  await execa('git', ['commit', '-qm', 'fixture plan'], { cwd: root });

  const remediateDispatches: string[] = [];
  const runner: StepRunner = {
    run: async (step: StepName) => {
      remediateDispatches.push(step);
      await writeFile(
        join(root, '.pipeline', 'remediation.json'),
        JSON.stringify({
          dispositions: input.criteria.map((criterion) => ({
            id: criterion,
            disposition: input.existingTask ? 'existing-task' : 'build',
            category: null,
            rationale: `Repair ${criterion}.`,
            tasks: [{ id: input.existingTask ? '1' : (input.repairTaskId ?? `rem-${criterion.toLowerCase()}`), title: `Repair ${criterion}` }],
          })),
        }),
      );
      return { success: true };
    },
  };
  const events = new ConductorEventEmitter();
  const gateBlocks: Array<{ step: string; reason: string }> = [];
  events.on('gate_blocked', (event) => {
    if (event.type === 'gate_blocked') {
      gateBlocks.push({ step: event.step, reason: event.reason });
    }
  });
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    events,
    projectRoot: root,
    featureSlug: 'prd-audit-kickback',
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    config: { prd_audit: { max_remediation_laps: 1, ...input.config } } as never,
  });

  await input.beforePlanRemediation?.(root);
  const outcome = await (conductor as unknown as {
    planRemediation: (
      state: ConductState,
      steps: typeof ALL_STEPS,
      dispatchContext: string,
      hintSource: {
        source: string;
        evidence: Array<{ gate: StepName; evidenceFile: string }>;
      },
    ) => Promise<{ kind: string; target?: string; detail?: string; haltClass?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS,
    'prd audit blocked',
    {
      source: 'prd-audit',
      evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }],
    },
  );

  return { outcome, plan, planPath, root, gateBlocks, remediateDispatches };
}

async function createAsBuiltRemediationCapFixture(input: {
  priorLaps?: number;
  priorGrowthAdded?: number;
  appendCap?: number;
  plannerFindingIds?: string[];
  /** Findings the planner dispositions `halt` (needs a human, no plan growth). */
  plannerHaltFindingIds?: string[];
  /** Decision 6 kill switch. Default true, matching production. */
  remediationEnabled?: boolean;
  /** Add a validated prd_audit FIXABLE finding + its evidence, for mixed rounds. */
  withPrdEvidence?: boolean;
  /** Seed prd_audit's own lap counter, to exhaust THAT gate in a mixed round. */
  prdAuditPriorLaps?: number;
}) {
  const root = await mkdtemp(join(tmpdir(), 'as-built-remediation-cap-'));
  dirs.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  const plan = [1, 2, 3, 4].map((id) => `### Task ${id}: Authored work`).join('\n');
  const findings = [
    { id: 'AB-1', clause: 'Task 1', summary: 'Add the approved guard' },
    { id: 'AB-2', clause: 'Task 2', summary: 'Restore the approved boundary' },
  ];
  await Promise.all([
    mkdir(join(root, '.docs', 'plans'), { recursive: true }),
    mkdir(join(root, '.pipeline'), { recursive: true }),
  ]);
  await writeFile(planPath, plan);
  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
  await persistAsBuiltVerdict(root, {
    version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [],
    findings: findings.map((finding) => ({
      id: finding.id,
      class: 'REMEDIABLE' as const,
      reference: { kind: 'plan-task' as const, taskId: finding.clause.replace('Task ', '') },
      summary: finding.summary,
    })),
    violations: 'fixture violations', resolution: 'fixture resolution',
  }, { attemptId: 'fixture-run', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });
  if (input.withPrdEvidence) {
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await writeFile(join(root, '.docs', 'stories', 'feature.md'), [
      '# Stories', '', '## Story 1: the criterion', '', '### Acceptance Criteria', '',
      '#### Happy Path',
      '- Given a request, when handled, then the criterion holds.',
    ].join('\n'));
    await persistPrdAuditVerdict(root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'FIXABLE',
          evidence: 'not implemented', rationale: 'Fixture repair.',
          requirementAssociations: [{ path: '.docs/specs/feature.md', requirementId: 'FR-1' }],
          evidenceTaskIds: ['1'], ownerTaskId: '1',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'fixture-prd', codeStamp: null });
  }
  if (
    input.priorLaps !== undefined
    || input.priorGrowthAdded !== undefined
    || input.prdAuditPriorLaps !== undefined
  ) {
    await writeKickbackLedger(root, {
      version: 1,
      gates: {
        ...(input.priorLaps === undefined
          ? {}
          : {
              architecture_review_as_built: {
                count: 0,
                cumulative: 0,
                treeHash: null,
                lastReason: '',
                priorVerdict: true,
                resolvedBefore: 0,
                laps: input.priorLaps,
              },
            }),
        ...(input.prdAuditPriorLaps === undefined
          ? {}
          : {
              prd_audit: {
                count: 0,
                cumulative: 0,
                treeHash: null,
                lastReason: '',
                priorVerdict: true,
                resolvedBefore: 0,
                laps: input.prdAuditPriorLaps,
              },
            }),
      },
      ...(input.priorGrowthAdded === undefined
        ? {}
        : {
            growth: {
              authored: 4,
              added: input.priorGrowthAdded,
              byGate: { prd_audit: input.priorGrowthAdded },
            },
          }),
    } as never);
  }
  const runner: StepRunner = {
    run: async () => {
      await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
        dispositions: [
          ...(input.withPrdEvidence
            ? [{
                id: 'S1.1',
                disposition: 'build',
                category: null,
                rationale: 'Satisfy the criterion.',
                tasks: [{ id: 'prd-fix', title: 'Satisfy S1.1' }],
              }]
            : []),
          ...(input.plannerHaltFindingIds ?? []).map((id) => ({
          id,
          disposition: 'halt',
          category: 'architectural-clarity',
          rationale: `${id} needs a human decision.`,
          tasks: [],
          })),
          ...(input.plannerFindingIds ?? findings.map((finding) => finding.id))
            .filter((id) => !(input.plannerHaltFindingIds ?? []).includes(id))
            .map((id) => ({
          id,
          disposition: 'build',
          category: null,
          rationale: `Repair ${id}.`,
          tasks: [{ id: `fix-${id.toLowerCase()}`, title: `Repair ${id}.` }],
          })),
        ],
      }));
      return { success: true };
    },
  };
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    featureSlug: 'as-built-remediation-cap',
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    config: {
      ...(input.appendCap === undefined
        ? {}
        : { prd_audit: { max_appended_tasks: input.appendCap, max_appended_ratio: 1 } }),
      architecture_review_as_built: {
        remediation: { enabled: input.remediationEnabled ?? true },
      },
    } as never,
  });
  const outcome = await (conductor as unknown as {
    planRemediation: (
      state: ConductState,
      steps: typeof ALL_STEPS,
      dispatchContext: string,
      hintSource: unknown,
    ) => Promise<{ kind: string; target?: string; detail?: string; haltClass?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS,
    'as-built blocked',
    {
      source: input.withPrdEvidence ? 'validation-group' : 'architecture-review-as-built',
      evidence: [
        ...(input.withPrdEvidence
          ? [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }]
          : []),
        { gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' },
      ],
    },
  );

  return { outcome, plan, planPath, findings, root };
}

/**
 * Drive `planRemediation` directly against an all-refused S2.1 report whose
 * durable decision binds the planner's rework gap. The serial SHIP tail is
 * exercised separately; this isolates the planRemediation admission/append
 * seam the refusal route shares with FIXABLE rounds.
 */
async function createRefusalReworkRemediationFixture(input?: {
  decisionId?: string;
  plannerGaps?: Array<{
    id: string;
    disposition: string;
    category?: string | null;
    rationale?: string;
    tasks?: Array<{ id: string; title: string }>;
  }>;
}) {
  const root = await mkdtemp(join(tmpdir(), 'refusal-rework-remediation-'));
  dirs.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await writeFile(planPath, '### Task 1: authored plan work\n');
  await writeFile(join(root, '.docs', 'stories', 'feature.md'), [
    '# Stories', '', '## Story 2: the criterion', '', '#### Happy Path',
    '- Given input, when exercised, then the criterion behavior holds.',
  ].join('\n'));
  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
  const decisionId = input?.decisionId ?? 'dec-refuse-s21';
  await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
    version: 2,
    feature: { version: 1, repository: '/fixture/repository', feature: 'prd-audit-kickback' },
    decisions: [{
      id: decisionId,
      criterion: 'S2.1',
      authority: 'refuse',
      rationale: 'Rethink the refused behavior.',
      operator: 'operator@example.test',
      revision: 1,
    }],
  }));
  await persistGroupedPrdAuditVerdict(
    root,
    overScopeReport('S2.1', 'outside-visible'),
    'fixture-refusal-rework',
  );

  const runner: StepRunner = {
    run: async () => {
      await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
        dispositions: input?.plannerGaps ?? [{
          id: `refusal-${decisionId}`,
          disposition: 'build',
          category: null,
          rationale: 'Remove the refused behavior.',
          tasks: [{ id: 'remove-refused-s21', title: 'Remove the refused S2.1 behavior' }],
        }],
      }));
      return { success: true };
    },
  };
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    featureSlug: 'prd-audit-kickback',
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    config: { prd_audit: { max_remediation_laps: 1 } } as never,
  });

  const outcome = await (conductor as unknown as {
    planRemediation: (
      state: ConductState,
      steps: typeof ALL_STEPS,
      dispatchContext: string,
      hintSource: { source: string; evidence: Array<{ gate: StepName; evidenceFile: string }> },
    ) => Promise<{ kind: string; target?: string; detail?: string; haltClass?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS,
    'prd audit refused block',
    { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
  );

  return { outcome, planPath, root, decisionId };
}

function passReport(criterion: string) {
  return [
    '**PRD:** present',
    '',
    '## Verdict Table',
    '| Criterion | Grade | Plan task | Evidence |',
    '| --- | --- | --- | --- |',
    `| ${criterion} | PASS | | Covered behavior |`,
  ].join('\n');
}

const OVER_SCOPE_SUMMARY = 'The change adds behavior beyond the approved plan.';

/**
 * The refused-over-scope fallback body the serial tail writes when a refusal-
 * rework round falls back to the operator block instead of dispatching
 * remediation. Built from the same renderers the production route uses, so a
 * fixture can assert byte-identity rather than substring drift.
 */
function refusedReworkFallbackBody(criterion: string, summary = OVER_SCOPE_SUMMARY): string {
  const refused = { criterion, summary, relation: 'outside-visible' as const };
  return renderPrdAuditScopeHalt(
    `OVER_SCOPE visible behavior on ${criterion}.`,
    renderOverScopeDecisionBlock([refused], [refused], []),
  );
}

/**
 * Shared assertions for every refusal-rework fallback: the run writes the
 * operator refused-over-scope block under the `over-scope` class, appends no
 * `rem-prd-audit-refusal-*` task, and never re-dispatches BUILD.
 */
async function expectRefusedReworkFallback(
  fixture: { root: string; calls: StepName[]; planPath: string },
  criterion = 'S2.1',
): Promise<void> {
  await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('over-scope');
  await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
    `${refusedReworkFallbackBody(criterion)}\n`,
  );
  await expect(readFile(fixture.planPath, 'utf8')).resolves.not.toContain('rem-prd-audit-refusal-');
  expect(fixture.calls).not.toContain('build');
}

/**
 * Drive the daemon serial SHIP tail for a refusal-rework round. `reports` is
 * the ordered sequence of typed PRD-audit verdicts the step runner publishes
 * on successive `prd_audit` dispatches. The BUILD rewind is the observation
 * boundary: the step runner terminates it with an injected sentinel failure,
 * so the fixture never drags the whole BUILD→finish happy path into the
 * assertion (write-tests §3).
 */
async function runRefusalReworkRun(input: {
  reports: string[];
  decisionId?: string;
  lapCap?: number;
  mode?: 'auto' | 'default';
  asBuilt?: 'approved' | 'blocked-remediable';
  /** Model the planner's `.pipeline/remediation.json` output for its one call. */
  remediationMode?: 'default' | 'absent' | 'stale' | 'unparseable';
  /** Last-chance fixture mutation before `conductor.run()`. */
  beforeRun?: (root: string) => Promise<void>;
  plannerGaps?: (retryReason: string) => Array<{
    id: string;
    disposition: string;
    category?: string | null;
    rationale?: string;
    tasks?: Array<{ id: string; title: string }>;
  }>;
}) {
  const root = await mkdtemp(join(tmpdir(), 'refusal-rework-run-'));
  dirs.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  const statePath = join(root, '.pipeline', 'conduct-state.json');
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  // Growth allowance is config-derived (min(5, 25% of authored tasks)); a
  // 1-task plan floors that to zero and falsely exhausts the allowance at the
  // BUILD dispatch boundary. Author enough tasks for the single appended
  // refusal task to fit under the default cap.
  const authoredTasks = Array.from(
    { length: 8 },
    (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
  ).join('');
  await writeFile(planPath, authoredTasks);
  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
  await writeFile(join(root, '.docs', 'stories', 'feature.md'), storiesWithCriterion('Happy Path'));
  await writeFile(
    join(root, '.pipeline', 'task-status.json'),
    JSON.stringify({
      tasks: Array.from({ length: 8 }, (_, index) => ({
        id: `task-${index + 1}`, status: 'completed',
      })),
    }),
  );
  const decisionId = input.decisionId ?? 'dec-refuse-s21';
  const acceptedWidenings = JSON.stringify({
    version: 2,
    feature: { version: 1, repository: '/fixture/repository', feature: 'prd-audit-kickback' },
    decisions: [{
      id: decisionId,
      criterion: 'S2.1',
      authority: 'refuse',
      rationale: 'Rethink the refused behavior.',
      operator: 'operator@example.test',
      revision: 1,
    }],
  });
  await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), acceptedWidenings);

  const state: Record<string, unknown> = {
    feature_desc: 'feature',
    complexity_tier: 'M',
    track: 'product',
    run_started_at: Date.now() - 1_000,
    rebase: 'done',
    finish: 'done',
  };
  for (const step of ALL_STEPS) {
    if (step.name === 'manual_test') break;
    state[step.name] = 'done';
  }
  await writeState(statePath, state as ConductState);

  const calls: StepName[] = [];
  const retryReasons: string[] = [];
  const kickbacks: Array<{ from: string; to: string; count: number; evidence?: string }> = [];
  let prdAuditDispatches = 0;
  const runner: StepRunner = {
    run: async (step, _state, options) => {
      calls.push(step);
      if (step === 'manual_test') {
        await writeFile(
          join(root, '.pipeline', 'manual-test-results.md'),
          '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
        );
      } else if (step === 'prd_audit') {
        const report = input.reports[Math.min(prdAuditDispatches++, input.reports.length - 1)]
          ?? input.reports[input.reports.length - 1];
        await persistGroupedPrdAuditVerdict(root, report, options?.runId);
      } else if (step === 'remediate') {
        retryReasons.push(options?.retryReason ?? '');
        if (input.remediationMode === 'absent') {
          return { success: true };
        }
        if (input.remediationMode === 'stale') {
          // Leave the pre-written stale remediation.json untouched.
          return { success: true };
        }
        if (input.remediationMode === 'unparseable') {
          await writeFile(join(root, '.pipeline', 'remediation.json'), '{ not valid json');
          return { success: true };
        }
        const gaps = input.plannerGaps?.(options?.retryReason ?? '') ?? [{
          id: `refusal-${decisionId}`,
          disposition: 'build',
          category: null,
          rationale: 'Remove the refused behavior.',
          tasks: [{ id: 'remove-refused-s21', title: 'Remove the refused S2.1 behavior' }],
        }];
        await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({ dispositions: gaps }));
      } else if (step === 'architecture_review_as_built') {
        await persistAsBuiltVerdict(root, input.asBuilt === 'blocked-remediable' ? {
          version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [],
          findings: [{
            id: 'AB-1', class: 'REMEDIABLE',
            reference: { kind: 'plan-task', taskId: '1' },
            summary: 'Restore the approved architecture boundary.',
          }],
          violations: 'fixture violations', resolution: 'fixture resolution',
        } : {
          version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [],
        }, {
          attemptId: options?.runId ?? 'test-run',
          codeStamp: null,
          policy: AS_BUILT_FIXTURE_POLICY,
        });
      } else if (step === 'build') {
        // The serial-tail observation ends at the BUILD rewind: routing the
        // refusal already proved its kickback target. Terminating with an
        // injected sentinel keeps the fixture from dragging the whole
        // BUILD→finish happy path into the assertion (write-tests §3).
        return { success: false, error: 'sentinel: refusal rework reached BUILD dispatch' };
      }
      return { success: true };
    },
  };
  const events = new ConductorEventEmitter();
  events.on('kickback', (event) => {
    if (event.type === 'kickback') {
      kickbacks.push({ from: event.from, to: event.to, count: event.count, evidence: event.evidence });
    }
  });
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    projectRoot: root,
    mode: input.mode ?? 'default',
    daemon: true,
    verifyArtifacts: true,
    maxRetries: 1,
    fromStep: 'manual_test',
    config: { prd_audit: { max_remediation_laps: input.lapCap ?? 1 } } as never,
    gh: async () => ({ stdout: 'operator@example.test\n' }),
  });
  if (input.remediationMode === 'stale') {
    const path = join(root, '.pipeline', 'remediation.json');
    await writeFile(path, JSON.stringify({ dispositions: [] }));
    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
  }
  await input.beforeRun?.(root);
  await conductor.run();
  return { root, planPath, calls, retryReasons, kickbacks, state: await readState(statePath), acceptedWidenings, decisionId };
}

describe('prd_audit kickback', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('preserves migrated sibling decisions while routing a current refusal', async () => {
    // Legacy decisions are migrated at the pre-audit entry boundary. A clear
    // that names a different historical finding remains durable but inert;
    // routing only projects the current refusal into the verdict artifact.
    const root = await mkdtemp(join(tmpdir(), 'over-scope-halt-route-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const report = [
      '# PRD Audit',
      '',
      '**PRD:** none',
      '',
      '| Criterion | Grade | Plan task | PRD: | Intent relation | Evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| S3.1 | OVER_SCOPE | — | none | outside-visible | conductor.ts:1 |',
      '',
    ].join('\n');
    await persistGroupedPrdAuditVerdict(root, report, 'fixture-refusal');
    await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
      version: 1,
      decisions: [{
        criterion: 'S3.1',
        summary: 'Visible behavior outside the approved intent.',
        decision: 'refuse',
        rationale: 'Rework it inside scope.',
        operator: 'operator@example.test',
        decidedAt: '2026-08-24T00:00:00.000Z',
      }],
    }));
    // This is a valid pre-offer legacy clear, not a v2 offer reference.
    await writeFile(join(root, '.pipeline', 'HALT.cleared'), [
      '```json over-scope-decisions',
      '[{"criterion":"S9.9","summary":"x","decision":"accept","rationale":"x"}]',
      '```',
    ].join('\n'));

    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline/conduct-state.json'),
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
    });

    const recovery = await (conductor as unknown as {
      preparePrdWideningBeforeAudit: () => Promise<string | undefined>;
    }).preparePrdWideningBeforeAudit();
    expect(recovery).toBeUndefined();

    const route = await (conductor as unknown as {
      routeCurrentPrdAuditOverScope: () => Promise<{
        kind: string;
        refusals?: Array<{ key: string; decisionId: string; revision: number; rationale: string }>;
        refused?: Array<{ criterion: string }>;
        defects?: Array<{ kind: string; criterion?: string }>;
      }>;
    }).routeCurrentPrdAuditOverScope();

    expect(route.kind).toBe('refusal-rework');
    expect(route.refusals).toEqual([expect.objectContaining({
      key: 'S3.1',
      rationale: 'Rework it inside scope.',
    })]);
    expect(route.refused).toEqual([expect.objectContaining({ criterion: 'S3.1' })]);
    expect(route.defects).toBeUndefined();

    await expect(readPrdAuditVerdict(root)).resolves.toMatchObject({
      kind: 'present',
      value: {
        recordedDispositions: [expect.objectContaining({
          criterionId: 'S3.1', decision: 'refuse', rationale: 'Rework it inside scope.', authority: 'operator@example.test',
        })],
      },
    });
  });

  it('admits an all-refused report as a decision-bound prd_audit rework task', async () => {
    const { outcome, planPath, decisionId } = await createRefusalReworkRemediationFixture();

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    const plan = await readFile(planPath, 'utf8');
    expect(plan).toContain(`### Task rem-prd-audit-refusal-${decisionId}: Remove the refused S2.1 behavior`);
    expect(plan).toContain(`**Governing clause:** Refused S2.1 (decision ${decisionId} r1)`);
    expect(plan).toContain('**Criterion:** S2.1');
  });

  it('halts with the refused over-scope block when the planner leaves a refusal unbound', async () => {
    const { outcome, planPath } = await createRefusalReworkRemediationFixture({
      plannerGaps: [{
        id: 'refusal-other-decision',
        disposition: 'build',
        category: null,
        rationale: 'Binds a different decision.',
        tasks: [{ id: 'wrong-bind', title: 'Unrelated work' }],
      }],
    });

    expect(outcome).toMatchObject({ kind: 'halt' });
    expect((outcome as { detail?: string }).detail).toContain('user-visible scope requires operator acceptance');
    expect((outcome as { detail?: string }).detail).toContain('Refused — rework required: S2.1.');
    const plan = await readFile(planPath, 'utf8');
    expect(plan).not.toContain('rem-prd-audit-refusal-');
  });

  it('writes the refused over-scope block instead of dispatching rework for a non-daemon run', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport('S2.1', 'outside-visible'),
      storiesWithCriterion('Happy Path'),
      async (root) => {
        await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
          version: 2,
          feature: { version: 1, repository: '/fixture/repository', feature: 'prd-audit-kickback' },
          decisions: [{
            id: 'dec-s21',
            criterion: 'S2.1',
            authority: 'refuse',
            rationale: 'Rethink the refused behavior.',
            operator: 'operator@example.test',
            revision: 1,
          }],
        }));
      },
      { mode: 'default', daemon: false },
    );

    expect(fixture.calls).not.toContain('remediate');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('over-scope');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('Refused — rework required: S2.1.');
  });

  it('dispatches refusal rework through the serial SHIP tail to BUILD', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible'), passReport('S2.1')],
    });

    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    expect(fixture.retryReasons).toHaveLength(1);
    expect(fixture.retryReasons[0]).toContain(`refusal-${fixture.decisionId}`);
    expect(fixture.retryReasons[0]).toContain(fixture.decisionId);
    expect(fixture.retryReasons[0]).toContain('.pipeline/prd-audit.md');
    const plan = await readFile(fixture.planPath, 'utf8');
    expect(plan).toContain(`### Task rem-prd-audit-refusal-${fixture.decisionId}: Remove the refused S2.1 behavior`);
    expect(fixture.kickbacks).toContainEqual(expect.objectContaining({
      from: 'prd_audit', to: 'build', count: 1,
    }));
    const remediateIndex = fixture.calls.indexOf('remediate');
    expect(remediateIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.calls[remediateIndex + 1]).toBe('build');
    // The refusal route routed to remediation instead of writing the refused
    // operator block. The sentinel that stops the fixture at BUILD dispatch
    // leaves a needs-human marker, but never the over-scope fallback.
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.not.toBe('over-scope');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain('Refused — rework required');
    // Routing reads the durable refusal but never mutates it: the store is
    // byte-identical after the round and still returns the same decision.
    expect(await readFile(join(fixture.root, '.pipeline', 'accepted-widenings.json'), 'utf8'))
      .toBe(fixture.acceptedWidenings);
    const store = new AcceptedWideningDecisionStore(fixture.root, {
      version: 1,
      repository: '/fixture/repository',
      feature: 'prd-audit-kickback',
    });
    await expect(store.read()).resolves.toMatchObject({
      kind: 'valid',
      state: {
        decisions: [expect.objectContaining({
          id: fixture.decisionId,
          authority: 'refuse',
          revision: 1,
        })],
      },
    });
  });

  it('charges admitted refusal rework to the existing prd_audit lap and growth ledger', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
    });

    const ledger = await readKickbackLedger(fixture.root);
    expect(ledger.gates.prd_audit).toMatchObject({ laps: 1 });
    expect(ledger.growth).toMatchObject({ added: 1, byGate: { prd_audit: 1 } });
  });

  it('re-admits refusal work when a raised prd_audit lap cap has capacity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raised-refusal-rework-budget-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeKickbackLedger(root, {
      version: 1,
      gates: {
        prd_audit: {
          count: 0, cumulative: 0, treeHash: null, lastReason: '', priorVerdict: true,
          resolvedBefore: 0, laps: 1, effectiveLapCap: 2,
        },
      },
    });

    await expect(readRemediationGateAppendBudget(
      root, { prd_audit: { max_remediation_laps: 1 } } as never,
      'prd_audit', 1, 1, 1, 8,
    )).resolves.toMatchObject({ priorLaps: 1, lapCap: 2, taskCount: 1, growthTaskCount: 1 });
  });

  it('routes an all-refused validation group through one refusal-context remediation dispatch', async () => {
    const serial = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
    });
    const grouped = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      mode: 'auto',
    });

    expect(grouped.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    expect(grouped.retryReasons).toEqual([expect.stringContaining(serial.retryReasons[0]!)]);
    await expect(readFile(join(grouped.root, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain(
      'Refused — rework required',
    );
  });

  it('preserves the serial refused-plus-pending halt body in the validation join', async () => {
    const report = [
      '**PRD:** present', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | Evidence | Intent relation |',
      '| --- | --- | --- | --- | --- |',
      '| S2.1 | OVER_SCOPE | | Refused behavior. | outside-visible |',
      '| S2.2 | OVER_SCOPE | | Pending behavior. | outside-visible |',
    ].join('\n');
    const serial = await runRefusalReworkRun({ reports: [report] });
    const grouped = await runRefusalReworkRun({ reports: [report], mode: 'auto' });

    expect(serial.calls).not.toContain('remediate');
    expect(grouped.calls).not.toContain('remediate');
    await expect(readFile(join(grouped.root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      await readFile(join(serial.root, '.pipeline', 'HALT'), 'utf8'),
    );
  });

  it('merges refused prd_audit and remediable as-built evidence into one remediation dispatch', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      mode: 'auto',
      asBuilt: 'blocked-remediable',
      plannerGaps: () => [{
        id: 'refusal-dec-refuse-s21', disposition: 'build', category: null,
        rationale: 'Remove the refused behavior.',
        tasks: [{ id: 'remove-refused-s21', title: 'Remove the refused S2.1 behavior' }],
      }, {
        id: 'AB-1', disposition: 'build', category: null,
        rationale: 'Restore the approved architecture boundary.',
        tasks: [{ id: 'restore-boundary', title: 'Restore the approved architecture boundary' }],
      }],
    });

    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    expect(fixture.retryReasons).toHaveLength(1);
    expect(fixture.retryReasons[0]).toContain(fixture.decisionId);
    expect(fixture.retryReasons[0]).toContain('.pipeline/prd-audit.md');
    expect(fixture.retryReasons[0]).toContain('.pipeline/architecture-review-as-built.json');
  });

  it.each([
    ['an empty-rationale refusal', 'refuse', ''],
    ['an acceptance revising a prior refusal', 'accept', 'Keep this behavior in scope.'],
  ])('does not dispatch grouped remediation for %s', async (_caseName, authority, rationale) => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport('S2.1', 'outside-visible'),
      storiesWithCriterion('Happy Path'),
      async (root) => {
        await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
          version: 2,
          feature: { version: 1, repository: '/fixture/repository', feature: 'prd-audit-kickback' },
          decisions: [{
            id: 'dec-s21', criterion: 'S2.1', authority, rationale,
            operator: 'operator@example.test', revision: 2,
          }],
        }));
      },
    );

    expect(fixture.calls).not.toContain('remediate');
  });

  it('records one remediation dispatch for a refusal riding with a FIXABLE row', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [refusedFixableReport()],
      plannerGaps: () => [
        {
          id: 'refusal-dec-refuse-s21',
          disposition: 'build',
          category: null,
          rationale: 'Remove the refused behavior.',
          tasks: [{ id: 'remove-refused-s21', title: 'Remove the refused S2.1 behavior' }],
        },
        {
          id: 'S2.2',
          disposition: 'build',
          category: null,
          rationale: 'Repair the FIXABLE row.',
          tasks: [{ id: 'rem-s2.2', title: 'Repair S2.2' }],
        },
      ],
    });

    // Both the refusal and the FIXABLE finding ride the same single
    // remediation dispatch, charged as one prd_audit lap (kickback count 1).
    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    expect(fixture.retryReasons).toHaveLength(1);
    expect(fixture.retryReasons[0]).toContain(`refusal-${fixture.decisionId}`);
    expect(fixture.retryReasons[0]).toContain(fixture.decisionId);
    expect(fixture.retryReasons[0]).toContain('.pipeline/prd-audit.md');
    expect(fixture.retryReasons[0]).toContain('S2.2');
    expect(fixture.kickbacks).toContainEqual(expect.objectContaining({
      from: 'prd_audit', to: 'build', count: 1,
    }));
    // The provenance still points at the rendered prd-audit verdict carrying
    // the FIXABLE row, alongside the refused block.
    await expect(readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).resolves.toContain('FIXABLE');
    const plan = await readFile(fixture.planPath, 'utf8');
    expect(plan).toContain(`### Task rem-prd-audit-refusal-${fixture.decisionId}: Remove the refused S2.1 behavior`);
    expect(plan).toContain('**Criterion:** S2.2');
  });

  it('writes the refused over-scope block when the prd_audit lap is already spent', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      lapCap: 0,
    });

    expect(fixture.calls).not.toContain('remediate');
    await expectRefusedReworkFallback(fixture);
  });

  it('writes the refused over-scope block when admission rejects the planner output', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      plannerGaps: () => [{
        id: 'refusal-other-decision',
        disposition: 'build',
        category: null,
        rationale: 'Binds a different decision.',
        tasks: [{ id: 'wrong-bind', title: 'Unrelated work' }],
      }],
    });

    // The planner ran once, bound nothing, and the tail fell back to the
    // refused block instead of re-dispatching remediation.
    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    await expectRefusedReworkFallback(fixture);
  });

  it('writes the refused over-scope block when the planner wrote no remediation plan', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      remediationMode: 'absent',
    });

    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    await expectRefusedReworkFallback(fixture);
  });

  it('writes the refused over-scope block when the planner plan is stale', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      remediationMode: 'stale',
    });

    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    await expectRefusedReworkFallback(fixture);
  });

  it('writes the refused over-scope block when the planner plan is unparseable', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      remediationMode: 'unparseable',
    });

    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    await expectRefusedReworkFallback(fixture);
  });

  it('writes the refused over-scope block when the refusal task id cannot be addressed', async () => {
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      decisionId: '!!!',
    });

    expect(fixture.calls.filter((call) => call === 'remediate')).toHaveLength(1);
    await expectRefusedReworkFallback(fixture);
  });

  it('escalates a no-op BUILD lap to the kickback-to-build no-op halt on an unchanged verdict', async () => {
    // Seed the single-use baseline a prior kickback would have captured: same
    // tree and resolved count, `priorVerdict: false`. The refusal route's
    // escalation check then sees no progress on the unchanged verdict.
    const fixture = await runRefusalReworkRun({
      reports: [overScopeReport('S2.1', 'outside-visible')],
      beforeRun: async (root) => {
        await writeKickbackLedger(root, {
          version: 1,
          gates: {
            prd_audit: {
              count: 0,
              cumulative: 0,
              treeHash: null,
              lastReason: '',
              priorVerdict: false,
              resolvedBefore: 8,
            },
          },
        });
      },
    });

    // The escalation fires before any remediation dispatch.
    expect(fixture.calls).not.toContain('remediate');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'prd_audit kickback-to-build no-op',
    );
    await expect(readFile(fixture.planPath, 'utf8')).resolves.not.toContain('rem-prd-audit-refusal-');
  });

  it('halts with the named serialization refusal and leaves the verdict unwritten', async () => {
    // D8 fail-closed: exercise the renderer's own unrenderable-decision path,
    // not filesystem permissions (which a privileged test process can bypass).
    const report = overScopeReport('S9.7', 'outside-visible');
    const originalStringify = JSON.stringify;
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(
      ((value: unknown, replacer?: Parameters<typeof JSON.stringify>[1], space?: Parameters<typeof JSON.stringify>[2]) => {
        if (
          typeof value === 'object' && value !== null &&
          'recordedDispositions' in value &&
          Array.isArray((value as { recordedDispositions?: unknown }).recordedDispositions) &&
          (value as { recordedDispositions: unknown[] }).recordedDispositions.length > 0
        ) {
          throw new Error('recorded decision is unrenderable');
        }
        return originalStringify(value, replacer, space);
      }) as typeof JSON.stringify,
    );
    try {
      const fixture = await runGroupedPrdAudit(
        report,
        storiesWithCriterion('Happy Path'),
        async (root) => {
          await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
            version: 1,
            decisions: [{
              criterion: 'S9.7',
              summary: 'A recorded visible widening.',
              decision: 'accept',
              rationale: 'The operator explicitly accepted it.',
              operator: 'operator@example.test',
              decidedAt: '2026-08-25T00:00:00.000Z',
            }],
          }), 'utf8');
        },
      );

      await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
        'recorded findings could not be persisted to .pipeline/prd-audit.json',
      );
      // Fail closed: the artifact is exactly the judge's original verdict;
      // it never settles without the recorded operator decision.
      await expect(readPrdAuditVerdict(fixture.root)).resolves.toMatchObject({
        kind: 'present',
        value: { recordedDispositions: [] },
      });
    } finally {
      stringify.mockRestore();
    }
  });

  it('renders all undecided criteria as editable decision offers', () => {
    const rendered = renderOverScopeDecisionBlock([
      { criterion: 'S3.1', summary: 'First.', relation: 'outside-visible' },
      { criterion: 'S3.2', summary: 'Second.', relation: 'outside-visible' },
      { criterion: 'S3.3', summary: 'Third.', relation: 'outside-visible' },
    ]);
    expect(rendered).toContain('```json over-scope-decisions');
    expect(rendered.match(/"decision": "pending"/g)).toHaveLength(3);
  });

  it('tells an operator that pending leaves a prior decision unchanged only for revise-decision offers', () => {
    const reviseDecision = renderOverScopeDecisionBlock([{
      kind: 'revise-decision',
      criterion: 'NC-8',
      summary: 'A previously refused scope expansion.',
      relation: 'outside-visible',
      offerEntryId: 'prd-case-8',
      originalSource: { id: 'prd-audit:NC-8', snapshot: 'Original refusal evidence.' },
      originalCaseId: 'prd-case-8',
      priorDecision: { id: 'decision-8', revision: 1 },
    }]);
    const pendingOnly = renderOverScopeDecisionBlock([{
      criterion: 'NC-9',
      summary: 'A newly reported scope expansion.',
      relation: 'outside-visible',
    }]);

    expect(reviseDecision).toContain('leaving `decision` as `pending` keeps the prior decision unchanged');
    expect(pendingOnly).not.toContain('keeps the prior decision unchanged');
  });

  it('names the payload-preserving halt clear command instead of an unspecified clear (#2576)', () => {
    const pendingOnly = renderOverScopeDecisionBlock([{ criterion: 'S5.6', summary: 'Widened.', relation: 'outside-visible' }]);
    const reviseDecision = renderOverScopeDecisionBlock([{
      kind: 'revise-decision',
      criterion: 'NC.8',
      summary: 'A previously refused scope expansion.',
      relation: 'outside-visible',
      offerEntryId: 'prd-case-8',
      originalSource: { id: 'prd-audit:NC.8', snapshot: 'Original refusal evidence.' },
      originalCaseId: 'prd-case-8',
      priorDecision: { id: 'decision-8', revision: 1 },
    }]);

    for (const rendered of [pendingOnly, reviseDecision]) {
      expect(rendered).toContain('ai-conductor halt clear --feature <slug>');
      expect(rendered).toContain('Do not delete this file');
      expect(rendered).not.toMatch(/clear this halt/i);
    }
  });

  async function runGroupedPrdAudit(
    report: string,
    stories: string,
    setup?: (root: string) => Promise<void>,
    options?: { root?: string; mode?: 'auto' | 'default'; daemon?: boolean },
  ) {
    const root = options?.root ?? await mkdtemp(join(tmpdir(), 'prd-audit-group-route-'));
    if (!options?.root) dirs.push(root);
    const statePath = join(root, '.pipeline', 'conduct-state.json');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await writeFile(join(root, '.docs', 'stories', 'feature.md'), stories);
    await writeFile(
      join(root, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );

    const state: Record<string, unknown> = {
      feature_desc: 'feature',
      complexity_tier: 'M',
      track: 'product',
      run_started_at: Date.now() - 1_000,
      rebase: 'done',
      finish: 'done',
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'manual_test') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    await setup?.(root);

    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step, _state, options) => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(
            join(root, '.pipeline', 'manual-test-results.md'),
            '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
          );
        } else if (step === 'prd_audit') {
          await persistGroupedPrdAuditVerdict(root, report, options?.runId);
          if (report.includes('S13.4')) {
            await writeFile(join(root, '.pipeline', 's13.4-probe-file'), 'keep this review finding\n');
          }
        } else if (step === 'remediate') {
          const cases = await readFile(join(root, '.pipeline', 'remediation-cases.json'), 'utf8')
            .then((raw) => JSON.parse(raw) as { prdWideningCases?: Array<{ id: string }> })
            .catch(() => undefined);
          const caseId = cases?.prdWideningCases?.[0]?.id;
          if (caseId) {
            return {
              success: true,
              finalStructuredResult: {
                version: 'v1',
                results: [{
                  sourceId: prdWideningSourceId({
                    criterion: 'NC.1', grade: 'OVER_SCOPE',
                    evidence: 'A visible behavior exists outside the approved plan.', prdIds: [],
                  }),
                  kind: 'same-case', caseId,
                  reason: 'The current report names the original accepted behavior.',
                }],
              },
            };
          }
        } else if (step === 'architecture_review_as_built') {
          await persistAsBuiltVerdict(root, {
            version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [],
          }, {
            attemptId: options?.runId ?? 'test-run',
            codeStamp: null,
            policy: AS_BUILT_FIXTURE_POLICY,
          });
        }
        return { success: true };
      },
    };
    const events = new ConductorEventEmitter();
    const gateBlocks: Array<{ step: StepName; reason: string }> = [];
    events.on('gate_blocked', (event) => {
      if (event.type === 'gate_blocked') gateBlocks.push({ step: event.step, reason: event.reason });
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: root,
      mode: options?.mode ?? 'auto',
      daemon: options?.daemon ?? true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'manual_test',
      gh: async () => ({ stdout: 'operator@example.test\n' }),
    });
    await conductor.run();
    return { root, calls, gateBlocks, state: await readState(statePath) };
  }

  it('appends the first capped lap of FIXABLE work with criterion-bound completion checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    const plan = Array.from(
      { length: 20 },
      (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
    ).join('\n');
    await writeFile(planPath, plan);
    await writeFile(join(root, '.docs', 'stories', 'feature.md'), [
      '# Stories', '', '## Story 2: remediation', '', '#### Happy Path',
      '- Given S2.1, when repaired, then it holds.',
      '- Given S2.2, when repaired, then it holds.',
      '- Given S2.3, when repaired, then it holds.',
    ].join('\n'));
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
    );
    await persistPrdAuditVerdict(root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [
          ['S2.1', 4, 'Missing first behavior'],
          ['S2.2', 5, 'Missing second behavior'],
          ['S2.3', 6, 'Missing third behavior'],
        ].map(([criterionId, ownerTaskId, evidence]) => ({
          criterion: { storyId: '2', ordinal: Number(String(criterionId).slice('S2.'.length)) },
          criterionId: String(criterionId), grade: 'FIXABLE' as const, evidence: String(evidence),
          rationale: 'Fixture repair.', requirementAssociations: [], evidenceTaskIds: [String(ownerTaskId)], ownerTaskId: String(ownerTaskId),
        })),
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'fixture-capped-lap', codeStamp: null });

    const runner: StepRunner = {
      run: async () => {
        await writeFile(
          join(root, '.pipeline', 'remediation.json'),
          JSON.stringify({
            dispositions: ['S2.1', 'S2.2', 'S2.3'].map((criterion) => ({
              id: criterion,
              disposition: 'build',
              category: null,
              rationale: `Repair ${criterion}.`,
              tasks: [{ id: `rem-${criterion.toLowerCase()}`, title: `Repair ${criterion}` }],
            })),
          }),
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
      config: { prd_audit: { max_remediation_laps: 1 } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: {
          source: string;
          evidence: Array<{ gate: StepName; evidenceFile: string }>;
        },
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      {
        source: 'prd-audit',
        evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }],
      },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    const appendedPlan = await readFile(planPath, 'utf8');
    for (const [criterion, parentTask] of [['S2.1', 4], ['S2.2', 5], ['S2.3', 6]] as const) {
      expect(appendedPlan).toContain(`**Criterion:** ${criterion}`);
      expect(appendedPlan).toContain(`**Parent task:** ${parentTask}`);
      expect(appendedPlan).toContain(`**Done when:**\n- [test] ${criterion} is satisfied by this task.`);
    }
    const ledger = await readKickbackLedger(root);
    expect((ledger.gates.prd_audit as { laps?: number } | undefined)?.laps ?? 0).toBe(0);
    expect(ledger.growth?.added ?? 0).toBe(0);
    expect(ledger.pendingRepair).toMatchObject({
      charges: { prd_audit: { laps: 1, growth: 3 } },
    });
  });

  it('keeps as-built task append rejection unchanged when remediation is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-cross-gate-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(planPath, [
      '### Task 1: authored', '### Task 2: authored', '### Task rem-prd: recorded prd addition',
    ].join('\n'));
    await writeFile(join(root, '.pipeline/engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeKickbackLedger(root, {
      version: 1,
      gates: {},
      growth: { authored: 2, added: 1, byGate: { prd_audit: 1 } },
    });
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(root, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'arch-gap', disposition: 'build', category: null, rationale: 'Foreign append.',
            tasks: [{ id: 'rem-arch', title: 'Unbounded architecture task' }],
          }],
        }));
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: {
        architecture_review_as_built: { remediation: { enabled: false } },
      } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      { source: 'as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }] },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('no plan-growth allowance'),
    });
    expect(await readFile(planPath, 'utf8')).not.toContain('rem-arch');
    await expect(readGrowth(root, 4)).resolves.toEqual({
      authored: 2, added: 1, byGate: { prd_audit: 1 }, remaining: 3,
    });
  });

  it.skip('admits validated as-built REMEDIABLE evidence when remediation is enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-remediation-enabled-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(planPath, [
      '### Task 1: authored',
      '### Task 2: authored',
      '### Task 3: authored',
      '### Task 4: authored',
    ].join('\n'));
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| arch-gap | REMEDIABLE | Task 1 | Repair approved architecture drift. |',
    ].join('\n'));
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'arch-gap', disposition: 'build', category: null, rationale: 'Repair approved architecture drift.',
            tasks: [{ id: 'rem-arch', title: 'Repair approved architecture drift' }],
          }],
        }));
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: {
        architecture_review_as_built: { remediation: { enabled: true } },
      } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; target?: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      { source: 'as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    const appendedPlan = await readFile(planPath, 'utf8');
    expect(appendedPlan).toContain('### Task rem-as-built-rem-arch: Repair approved architecture drift');
    expect(appendedPlan).toContain('**Governing clause:** Task 1');
  });

  it.skip('constructs clause-bound as-built gaps and projects every remediated lap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-bound-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const adrStem = 'adr-2026-08-25-example-architecture';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
      mkdir(join(root, '.pipeline'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 7: Existing approved work\n');
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: Example architecture',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '1. **Guard the architecture boundary.**',
    ].join('\n'));
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      `| AB-ADR | REMEDIABLE | ${adrStem} decision 1 | Add the approved architecture guard |`,
      '| AB-TASK | REMEDIABLE | Task 7 | Complete the existing approved work |',
    ].join('\n'));


    let remediationRound = 0;
    const runner: StepRunner = {
      run: async () => {
        remediationRound++;
        await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
          dispositions: remediationRound === 1
            ? [
                {
                  id: 'AB-ADR', disposition: 'build', category: null,
                  rationale: 'Conform to the approved ADR.',
                  tasks: [{ id: 'adr-guard', title: 'Add the approved architecture guard' }],
                },
                {
                  id: 'AB-TASK', disposition: 'build', category: null,
                  rationale: 'Conform to the active plan task.',
                  tasks: [{ id: 'task-guard', title: 'Complete the existing approved work' }],
                },
              ]
            : [{
                id: 'AB-LATER', disposition: 'build', category: null,
                rationale: 'Complete the later as-built finding.',
                tasks: [{ id: 'later-guard', title: 'Complete the later approved work' }],
              }],
        }));
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: {
        prd_audit: { max_appended_tasks: 3, max_appended_ratio: 3 },
        architecture_review_as_built: {
          remediation: { enabled: true },
          max_remediation_laps: 2,
        },
      } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      { source: 'as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    const appended = await readFile(planPath, 'utf8');
    expect(appended.match(/^### Task rem-as-built-/gm)).toHaveLength(2);

    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| AB-LATER | REMEDIABLE | Task 7 | Complete the later approved work |',
    ].join('\n'));
    await expect((conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked again',
      { source: 'as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }] },
    )).resolves.toMatchObject({ kind: 'route', target: 'build' });

    // A rebuilt gate replaces its BLOCKED report with its converged verdict.
    // The conductor carries the authorized rows through that replacement and
    // projects every lap only once the re-evaluation is green.
    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), 'Verdict: APPROVED\n');
    await expect((conductor as unknown as {
      projectPendingAsBuiltRemediationFindings: () => Promise<string | undefined>;
    }).projectPendingAsBuiltRemediationFindings()).resolves.toBeUndefined();
    const projected = await readFile(join(root, '.pipeline', 'architecture-review-as-built.md'), 'utf8');
    expect(projected).toContain('## Recorded Findings');
    expect(projected).toContain('"finding": "AB-ADR"');
    expect(projected).toContain(`"governingClause": "${adrStem} decision 1"`);
    expect(projected).toContain('"finding": "AB-TASK"');
    expect(projected).toContain('"governingClause": "Task 7"');
    expect(projected).toContain('"finding": "AB-LATER"');
  });

  it.skip('reloads appended as-built findings into the successful verdict and shipment handoff after restart', async () => {
    const fixture = await createAsBuiltRemediationCapFixture({ appendCap: 3 });
    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    const pendingAfterFirstLap = (await readKickbackLedger(fixture.root) as {
      pendingAsBuiltRemediationFindings?: unknown;
    }).pendingAsBuiltRemediationFindings;
    await writeFile(join(fixture.root, '.pipeline', 'architecture-review-as-built.md'), [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| AB-3 | REMEDIABLE | Task 3 | Complete the next approved task |',
    ].join('\n'));
    const secondLap = new Conductor({
      stateFilePath: join(fixture.root, '.pipeline', 'conduct-state.json'),
      stepRunner: {
        run: async () => {
          await writeFile(join(fixture.root, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'AB-3', disposition: 'build', category: null,
              rationale: 'Complete the next approved task.',
              tasks: [{ id: 'fix-ab-3', title: 'Complete the next approved task' }],
            }],
          }));
          return { success: true };
        },
      },
      events: new ConductorEventEmitter(),
      projectRoot: fixture.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
      config: {
        prd_audit: { max_appended_tasks: 3, max_appended_ratio: 1 },
        architecture_review_as_built: {
          remediation: { enabled: true },
          max_remediation_laps: 2,
        },
      } as never,
    });
    await expect((secondLap as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: unknown,
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked after restart',
      {
        source: 'architecture-review-as-built',
        evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }],
      },
    )).resolves.toMatchObject({ kind: 'route', target: 'build' });
    const pendingBeforeSuccess = (await readKickbackLedger(fixture.root) as {
      pendingAsBuiltRemediationFindings?: unknown;
    }).pendingAsBuiltRemediationFindings;
    const restartState: Record<string, unknown> = {
      feature_desc: 'as-built-restart',
      complexity_tier: 'L',
      track: 'technical',
      run_started_at: Date.now() - 1_000,
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'architecture_review_as_built') break;
      restartState[step.name] = 'done';
    }
    Object.assign(restartState, {
      manual_test: 'skipped',
      prd_audit: 'skipped',
      architecture_review_as_built: 'pending',
      rebase: 'skipped',
      finish: 'done',
    });
    await writeState(join(fixture.root, '.pipeline', 'conduct-state.json'), restartState as ConductState);
    const restarted = new Conductor({
      stateFilePath: join(fixture.root, '.pipeline', 'conduct-state.json'),
      stepRunner: {
        run: async (step, _state, options) => {
          if (step === 'architecture_review_as_built') {
            await persistAsBuiltVerdict(fixture.root, {
              version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [],
            }, {
              attemptId: options?.runId ?? 'test-run',
              codeStamp: null,
              policy: AS_BUILT_FIXTURE_POLICY,
            });
          }
          return { success: true };
        },
      },
      events: new ConductorEventEmitter(),
      projectRoot: fixture.root,
      mode: 'auto',
      daemon: true,
      fromStep: 'architecture_review_as_built',
      verifyArtifacts: true,
      maxRetries: 1,
      config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
    });
    await restarted.run();
    const finalVerdict = await readAsBuiltVerdict(fixture.root);
    const shipmentFindings = recordedShipmentFindings({
      asBuilt: finalVerdict.kind === 'present' ? finalVerdict.value : undefined,
    });
    const pendingAfterSuccess = (await readKickbackLedger(fixture.root) as {
      pendingAsBuiltRemediationFindings?: unknown;
    }).pendingAsBuiltRemediationFindings;

    expect({
      pendingAfterFirstLap,
      pendingBeforeSuccess,
      shipmentFindings,
      pendingAfterSuccess,
    }).toEqual({
      pendingAfterFirstLap: [
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-1',
          class: 'REMEDIABLE',
          governingClause: 'Task 1',
          summary: 'Add the approved guard',
          outcome: 'remediated',
        },
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-2',
          class: 'REMEDIABLE',
          governingClause: 'Task 2',
          summary: 'Restore the approved boundary',
          outcome: 'remediated',
        },
      ],
      pendingBeforeSuccess: [
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-1',
          class: 'REMEDIABLE',
          governingClause: 'Task 1',
          summary: 'Add the approved guard',
          outcome: 'remediated',
        },
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-2',
          class: 'REMEDIABLE',
          governingClause: 'Task 2',
          summary: 'Restore the approved boundary',
          outcome: 'remediated',
        },
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-3',
          class: 'REMEDIABLE',
          governingClause: 'Task 3',
          summary: 'Complete the next approved task',
          outcome: 'remediated',
        },
      ],
      shipmentFindings: [
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-1',
          class: 'REMEDIABLE',
          governingClause: 'Task 1',
          summary: 'Add the approved guard',
          outcome: 'remediated',
        },
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-2',
          class: 'REMEDIABLE',
          governingClause: 'Task 2',
          summary: 'Restore the approved boundary',
          outcome: 'remediated',
        },
        {
          gate: 'architecture_review_as_built',
          finding: 'AB-3',
          class: 'REMEDIABLE',
          governingClause: 'Task 3',
          summary: 'Complete the next approved task',
          outcome: 'remediated',
        },
      ],
      pendingAfterSuccess: undefined,
    });
    const shippedRecord = appendRecordedShipmentFindings([
      '---',
      'slug: as-built-restart',
      'spec_hash: digest',
      '---',
      '',
      '## Cost',
    ].join('\n'), shipmentFindings);
    expect(shippedRecord).toContain('findings:');
    expect(shippedRecord).toContain('    finding: AB-1');
    expect(shippedRecord).toContain('    finding: AB-2');
    expect(shippedRecord).toContain('    finding: AB-3');
  });

  it.skip('records as-built plan growth and an isolated remediation lap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-remediation-ledger-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.pipeline'), { recursive: true }),
    ]);
    await writeFile(planPath, [1, 2, 3, 4].map((id) => `### Task ${id}: Authored work`).join('\n'));
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| AB-1 | REMEDIABLE | Task 1 | Add the approved guard |',
    ].join('\n'));
    const buildReview = {
      count: 2, cumulative: 4, treeHash: 'build-tree', lastReason: 'prior build review',
      priorVerdict: true, resolvedBefore: 3,
    };
    const prdAudit = {
      count: 1, cumulative: 1, treeHash: 'prd-tree', lastReason: 'prior prd audit',
      priorVerdict: true, resolvedBefore: 1, laps: 1,
    };
    await writeKickbackLedger(root, {
      version: 1,
      gates: { build_review: buildReview, prd_audit: prdAudit },
      growth: { authored: 4, added: 0, byGate: {} },
    });
    const initialLedger = await readKickbackLedger(root);
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'AB-1', disposition: 'build', category: null, rationale: 'Add the approved guard.',
            tasks: [{ id: 'approved-guard', title: 'Add the approved guard' }],
          }],
        }));
        return { success: true };
      },
    };
    const events = new ConductorEventEmitter();
    const growthEvents: Array<Extract<ConductorEvent, { type: 'plan_growth' }>> = [];
    events.on('plan_growth', (event) => {
      if (event.type === 'plan_growth') growthEvents.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events, projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      { source: 'as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    const ledger = await readKickbackLedger(root);
    expect((ledger.gates.architecture_review_as_built as { laps?: number } | undefined)?.laps).toBe(1);
    expect(ledger.growth).toMatchObject({
      authored: 4,
      added: 1,
      byGate: { architecture_review_as_built: 1 },
    });
    expect(ledger.gates.build_review).toEqual(initialLedger.gates.build_review);
    expect(ledger.gates.prd_audit).toEqual(initialLedger.gates.prd_audit);
    expect(growthEvents).toEqual([expect.objectContaining({
      type: 'plan_growth', added: 1, byGate: { architecture_review_as_built: 1 },
    })]);
  });

  /**
   * adr-2026-08-25 decision 4: a `kickback-cap` terminal lists EVERY finding.
   * The prd_audit exit rendered only its own criteria, so in a mixed
   * validation-group round the participating as-built findings — already
   * dispositioned by remediate — vanished from the halt body and the operator
   * saw no sign they had been routed and discarded. Its sibling exits (the
   * as-built cap and the shared-growth cap) both render them.
   */
  it.skip('lists as-built findings too when the prd_audit lap cap halts a mixed round', async () => {
    const fixture = await createAsBuiltRemediationCapFixture({
      withPrdEvidence: true,
      prdAuditPriorLaps: 1,
    });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
    expect(fixture.outcome.detail).toContain('prd_audit remediation lap cap reached (1/1)');
    // Its own finding is still named.
    expect(fixture.outcome.detail).toContain('S1.1');
    // And so is every as-built finding that participated in the same round.
    for (const finding of fixture.findings) {
      expect(fixture.outcome.detail).toContain(
        `${finding.id} (REMEDIABLE; ${finding.clause}): ${finding.summary}`,
      );
    }
    await expect(readFile(fixture.planPath, 'utf8')).resolves.toBe(fixture.plan);
  });

  it.skip('halts a second as-built remediation lap before appending and lists every finding', async () => {
    const fixture = await createAsBuiltRemediationCapFixture({ priorLaps: 1 });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
    expect(fixture.outcome.detail).toContain('lap cap reached (1/1)');
    for (const finding of fixture.findings) {
      expect(fixture.outcome.detail).toContain(
        `${finding.id} (REMEDIABLE; ${finding.clause}): ${finding.summary}`,
      );
    }
    await expect(readFile(fixture.planPath, 'utf8')).resolves.toBe(fixture.plan);
  });

  it.skip('halts an as-built request beyond the remaining shared growth allowance before appending', async () => {
    const fixture = await createAsBuiltRemediationCapFixture({ priorGrowthAdded: 1 });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
    expect(fixture.outcome.detail).toContain('shared plan-growth allowance');
    expect(fixture.outcome.detail).toContain('0 remaining');
    for (const finding of fixture.findings) {
      expect(fixture.outcome.detail).toContain(
        `${finding.id} (REMEDIABLE; ${finding.clause}): ${finding.summary}`,
      );
    }
    await expect(readFile(fixture.planPath, 'utf8')).resolves.toBe(fixture.plan);
  });

  it('surfaces a halt-dispositioned finding by its own rationale, not as a missing finding', async () => {
    // A `halt` disposition means the planner addressed the finding and judged it
    // a human decision rather than plan growth. It is admitted at
    // conductor.ts:3988 but `continue`s before the counter the exact-match check
    // reads, so the check reported it `Missing` — punishing the planner for the
    // correct answer and hiding the finding's real rationale behind set
    // arithmetic.
    const fixture = await createAsBuiltRemediationCapFixture({ plannerHaltFindingIds: ['AB-1'] });

    expect(fixture.outcome).toMatchObject({ kind: 'halt' });
    expect(fixture.outcome.detail).not.toContain('Missing: AB-1');
    expect(fixture.outcome.detail).toContain('AB-1');
    expect(fixture.outcome.detail).toContain('needs a human decision');
  });

  it('carries planner halt rationales through the exact-match mismatch halt', async () => {
    // The credit above is keyed by finding id, so a planner that keys its halt
    // by anything else — its governing clause is the observed case — misses it
    // and lands on the mismatch halt instead. That halt reported only set
    // arithmetic, so the decision the planner actually escalated never reached
    // the operator, and `.pipeline/remediation.json` holding the only copy is
    // swept on re-dispatch. Report the mismatch AND the rationale.
    const fixture = await createAsBuiltRemediationCapFixture({
      plannerFindingIds: ['AB-2'],
      plannerHaltFindingIds: ['Task 1'],
    });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
    // Fail-closed is unchanged: an unmatched finding is still reported missing.
    expect(fixture.outcome.detail).toContain('Missing: AB-1');
    // ...and the escalated decision now travels with it.
    expect(fixture.outcome.detail).toContain('Task 1');
    expect(fixture.outcome.detail).toContain('needs a human decision');
    expect(fixture.outcome.detail).toContain('architectural-clarity');
    await expect(readFile(fixture.planPath, 'utf8')).resolves.toBe(fixture.plan);
  });

  it('halts before appending when planner gaps omit or add parsed as-built findings', async () => {
    const fixture = await createAsBuiltRemediationCapFixture({
      plannerFindingIds: ['AB-1', 'AB-EXTRA'],
    });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
    expect(fixture.outcome.detail).toContain('Missing: AB-2');
    expect(fixture.outcome.detail).toContain('Unexpected: AB-EXTRA');
    await expect(readFile(fixture.planPath, 'utf8')).resolves.toBe(fixture.plan);
    await expect(readKickbackLedger(fixture.root)).resolves.toMatchObject({ gates: {} });
  });

  it.skip.each([
    { id: 'AB-MISSING-ADR', clause: 'adr-2099-01-01-missing decision 1' },
    { id: 'AB-MISSING-TASK', clause: 'Task 404' },
  ])('halts without appending when $id has an unresolvable governing clause', async ({ id, clause }) => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-unresolvable-clause-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.pipeline'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 1: Existing approved work\n');
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| AB-RESOLVED | REMEDIABLE | Task 1 | Complete the existing approved work |',
      `| ${id} | REMEDIABLE | ${clause} | Resolve the missing authority |`,
    ].join('\n'));
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
          dispositions: [
            {
              id: 'AB-RESOLVED', disposition: 'build', category: null,
              rationale: 'Conform to the active plan task.',
              tasks: [{ id: 'resolved-task', title: 'Complete the existing approved work' }],
            },
            {
              id, disposition: 'build', category: null,
              rationale: 'Resolve the missing authority.',
              tasks: [{ id: 'unresolved-task', title: 'Do not append this task' }],
            },
          ],
        }));
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string; haltClass?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      {
        source: 'as-built',
        evidence: [{
          gate: 'architecture_review_as_built',
          evidenceFile: '.pipeline/architecture-review-as-built.md',
        }],
      },
    );

    expect({
      outcome,
      appended: (await readFile(planPath, 'utf8')).includes('### Task rem-as-built-'),
    }).toMatchObject({
      outcome: {
        kind: 'halt',
        haltClass: 'needs-human',
        detail: expect.stringContaining(`${id}: ${clause}`),
      },
      appended: false,
    });
  });

  it.skip('halts needs-human when an as-built finding cites an undeclared dotted ADR decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-unresolvable-dotted-clause-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const adrStem = 'adr-2026-09-18-declared-remediation-decisions';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
      mkdir(join(root, '.pipeline'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 1: Existing approved work\n');
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: Declared remediation decisions',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '**D1 — First.**',
      '**D2 — Second.**',
      '**D3 — Third.**',
      '**D4 — Fourth.**',
    ].join('\n'));
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      `| AB-1 | REMEDIABLE | ${adrStem} D9.1 | Resolve the missing authority |`,
    ].join('\n'));
    const run = vi.fn(async () => {
      await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
        dispositions: [{
          id: 'AB-1', disposition: 'build', category: null,
          rationale: 'Resolve the missing authority.',
          tasks: [{ id: 'unresolved-task', title: 'Do not append this task' }],
        }],
      }));
      return { success: true };
    });
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: { run }, events: new ConductorEventEmitter(), projectRoot: root,
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string; haltClass?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      {
        source: 'as-built',
        evidence: [{
          gate: 'architecture_review_as_built',
          evidenceFile: '.pipeline/architecture-review-as-built.md',
        }],
      },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      haltClass: 'needs-human',
      detail: expect.stringContaining(`AB-1: ${adrStem} D9.1`),
    });
    expect(run).toHaveBeenCalledOnce();
    await expect(readFile(planPath, 'utf8')).resolves.toBe('### Task 1: Existing approved work\n');
  });

  it('uses gate-specific configured lap caps without changing the generic cap', () => {
    expect(
      remediationLapCapForGate('prd_audit', { prd_audit: { max_remediation_laps: 1 } } as never, 0),
    ).toBe(1);
    expect(remediationLapCapForGate('architecture_review_as_built', {} as never, 0)).toBe(1);
    expect(
      remediationLapCapForGate(
        'architecture_review_as_built',
        { architecture_review_as_built: { max_remediation_laps: 2 } } as never,
        0,
      ),
    ).toBe(2);
    expect(remediationLapCapForGate('manual_test', {} as never, 0)).toBe(0);
  });

  it('bounds validation-join remediation rounds by the durable raised lap cap, never below the generic cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'join-round-cap-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    expect(await validationJoinRemediationRoundCap(root, {} as never)).toBe(2);
    await writeKickbackLedger(root, {
      version: 1,
      gates: {
        prd_audit: {
          count: 0, cumulative: 0, treeHash: null, lastReason: '', priorVerdict: false,
          resolvedBefore: 0, laps: 4, effectiveLapCap: 6,
        },
      },
    } as never);
    expect(await validationJoinRemediationRoundCap(root, {} as never)).toBe(6);
  });

  it('halts a malformed PRD-audit report before remediation can append its task', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 1,
      criteria: ['S2.1'],
      report: [
        '**PRD:** present',
        '',
        '## Verdict Table',
        '| Criterion | Grade | Plan task | Evidence |',
        '| --- | --- | --- | --- |',
        '| S2.1 | MAYBE | 1 | Missing behavior |',
      ].join('\n'),
    });

    expect(fixture.outcome).toMatchObject({
      kind: 'halt',
      haltClass: 'mechanical',
      detail: 'PRD audit verdict is incomplete: S2.1: fixture invalid grade',
    });
    expect(fixture.gateBlocks).toEqual([{
      step: 'prd_audit',
      reason: 'PRD audit verdict is incomplete: S2.1: fixture invalid grade',
    }]);
    expect(await readFile(fixture.planPath, 'utf8')).toBe(fixture.plan);
  });


  it('authorizes FIXABLE remediation alongside a within-intent NC finding without a mechanical unknown-criteria halt', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.1'],
      report: [
        '**PRD:** present',
        '',
        '## Verdict Table',
        '| Criterion | Grade | Plan task | Evidence |',
        '| --- | --- | --- | --- |',
        '| S2.1 | FIXABLE | 1 | Missing S2.1 behavior |',
        '',
        '## Findings without an owning criterion',
        '| Finding | Grade | Intent relation | Evidence |',
        '| --- | --- | --- | --- |',
        '| NC.1 | OVER_SCOPE | within | Internal implementation detail |',
      ].join('\n'),
    });

    await expect(readPrdAuditVerdict(fixture.root)).resolves.toMatchObject({
      kind: 'present',
      value: {
        complete: true,
        judgment: {
          criterionJudgments: [expect.objectContaining({ criterionId: 'S2.1', grade: 'FIXABLE' })],
        },
      },
    });
    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(fixture.gateBlocks).toEqual([]);
    expect(await readFile(fixture.planPath, 'utf8')).toContain('**Criterion:** S2.1');
  });

  it('does not record cap evidence or a budget-raise command when policy refuses plan growth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-no-growth-allowance-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(planPath, '### Task 1: authored\n### Task 2: authored\n');
    await writeFile(join(root, '.pipeline/engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(root, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'arch-gap', disposition: 'build', category: null, rationale: 'Foreign append.',
            tasks: [{ id: 'rem-arch', title: 'Unbounded architecture task' }],
          }],
        }));
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: { architecture_review_as_built: { remediation: { enabled: false } } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      { source: 'as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'halt', detail: expect.stringContaining('no plan-growth allowance') });
    expect(outcome.detail).not.toContain('kickback-budget raise');
    expect(Object.values((await readKickbackLedger(root)).gates)).not.toContainEqual(
      expect.objectContaining({ capEvidence: expect.anything() }),
    );
  });

  it('does not append or record cap evidence when the participating gate ledger entry is unreadable', async () => {
    let root = '';
    let planPath = '';
    let plan = '';
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.1'],
      beforePlanRemediation: async (fixtureRoot) => {
        root = fixtureRoot;
        planPath = join(root, '.docs', 'plans', 'feature.md');
        plan = await readFile(planPath, 'utf8');
        await writeFile(
          join(root, '.pipeline', 'kickback-ledger.json'),
          JSON.stringify({ version: 1, gates: { prd_audit: { laps: 'unreadable' } } }),
        );
      },
    });

    expect(fixture.outcome).toMatchObject({
      kind: 'halt',
      haltClass: 'needs-human',
      detail: "kickback ledger gate 'prd_audit' is unreadable",
    });
    await expect(readFile(planPath, 'utf8')).resolves.toBe(plan);
    const ledger = await readKickbackLedger(root);
    expect(ledger.gates.prd_audit?.capEvidence).toBeUndefined();
  });

  it('does not append when the entire kickback ledger is unreadable', async () => {
    let root = '';
    let planPath = '';
    let plan = '';
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.1'],
      beforePlanRemediation: async (fixtureRoot) => {
        root = fixtureRoot;
        planPath = join(root, '.docs', 'plans', 'feature.md');
        plan = await readFile(planPath, 'utf8');
        await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), '{not-json');
      },
    });

    expect(fixture.outcome).toMatchObject({
      kind: 'halt',
      haltClass: 'needs-human',
      detail: 'kickback ledger is unreadable',
    });
    await expect(readFile(planPath, 'utf8')).resolves.toBe(plan);
    await expect(readKickbackLedger(root)).resolves.not.toHaveProperty('pendingRepair');
  });

  it('dispatches, appends, seeds, and records an exhausted prd_audit repair pending build', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.5'],
      priorLaps: 1,
    });

    expect(fixture.remediateDispatches).toEqual(['remediate']);
    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    const ledger = await readKickbackLedger(fixture.root);
    expect(ledger.gates.prd_audit).toMatchObject({
      laps: 1,
    });
    expect(ledger.pendingRepair).toMatchObject({
      charges: { prd_audit: { laps: 1, growth: 1 } },
    });
    expect(ledger.pendingRepair?.taskIds).toHaveLength(1);
    expect(await readFile(fixture.planPath, 'utf8')).toContain('**Criterion:** S2.5');
    expect((await execa('git', ['log', '-1', '--format=%s'], { cwd: fixture.root })).stdout)
      .toBe('chore(plan): record appended remediation tasks');
    const taskStatus = JSON.parse(await readFile(join(fixture.root, '.pipeline', 'task-status.json'), 'utf8'));
    expect(taskStatus.tasks).toContainEqual(expect.objectContaining({
      id: ledger.pendingRepair!.taskIds[0], name: 'Repair S2.5', status: 'pending',
    }));
  });

  it('still dispatches remediate and appends when the prd_audit lap is under the cap', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.5'],
      priorLaps: 0,
    });

    expect(fixture.remediateDispatches).toEqual(['remediate']);
    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(await readFile(fixture.planPath, 'utf8')).toContain('**Criterion:** S2.5');
    const ledger = await readKickbackLedger(fixture.root);
    expect(ledger.gates.prd_audit?.laps ?? 0).toBe(0);
    expect(ledger.growth?.added ?? 0).toBe(0);
    expect(ledger.pendingRepair).toMatchObject({
      charges: { prd_audit: { laps: 1, growth: 1 } },
    });
  });

  it('records no pending charge when the admitted task cannot be appended', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.5'],
      repairTaskId: 'invalid task id',
    });

    expect(fixture.remediateDispatches).toEqual(['remediate']);
    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(await readFile(fixture.planPath, 'utf8')).not.toContain('**Criterion:** S2.5');
    const ledger = await readKickbackLedger(fixture.root);
    expect(ledger.pendingRepair).toBeUndefined();
    expect(ledger.gates.prd_audit?.laps ?? 0).toBe(0);
    expect(ledger.growth?.added ?? 0).toBe(0);
  });

  it('honors a raised configurable growth cap before appending every FIXABLE task', async () => {
    const criteria = ['S2.1', 'S2.2', 'S2.3', 'S2.4', 'S2.5', 'S2.6'];
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 20,
      criteria,
      config: { max_appended_tasks: 8, max_appended_ratio: 0.5 },
    });

    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    const appended = await readFile(fixture.planPath, 'utf8');
    for (const criterion of criteria) expect(appended).toContain(`**Criterion:** ${criterion}`);
    expect(appended.match(/^\*\*Criterion:\*\*/gm)).toHaveLength(6);
  });


  it('joins a negative-path PLAN_GAP as a recorded, satisfied prd_audit member', async () => {
    const stories = [
      '# Stories', '', '## Story 11: negative boundary', '', '#### Negative Paths',
      '- Given an unsupported condition, when it occurs, then it is recorded.',
    ].join('\n');
    const fixture = await runGroupedPrdAudit(planGapReport('S11.1'), stories);

    expect(fixture.calls).not.toContain('remediate');
    expect(fixture.state.ok && fixture.state.value.prd_audit).toBe('done');
    expect(await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).toContain(
      '- S11.1: PLAN_GAP',
    );
  });

  it('joins a within-intent OVER_SCOPE finding as a recorded, satisfied prd_audit member', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport('S9.1', 'within'),
      storiesWithCriterion('Happy Path'),
    );

    expect(fixture.calls).not.toContain('remediate');
    expect(fixture.state.ok && fixture.state.value.prd_audit).toBe('done');
    await expect(readPrdAuditVerdict(fixture.root)).resolves.toMatchObject({
      kind: 'present',
      value: {
        recordedDispositions: [expect.objectContaining({
          criterionId: 'S9.1', grade: 'OVER_SCOPE', decision: 'record', authority: 'engine',
        })],
      },
    });
  });

  it('records the S13.4 outside-harmless probe-file finding without deleting its evidence', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport(
        'S13.4',
        'outside-harmless',
        'Unadmitted .pipeline/s13.4-probe-file is outside intent but harmless.',
      ),
      storiesWithCriterion('Happy Path'),
    );

    expect(fixture.calls).not.toContain('remediate');
    expect(fixture.state.ok && fixture.state.value.prd_audit).toBe('done');
    await expect(readFile(join(fixture.root, '.pipeline', 's13.4-probe-file'), 'utf8')).resolves.toBe(
      'keep this review finding\n',
    );
    await expect(readPrdAuditVerdict(fixture.root)).resolves.toMatchObject({
      kind: 'present',
      value: {
        recordedDispositions: [expect.objectContaining({
          criterionId: 'S13.4', grade: 'OVER_SCOPE', decision: 'record', authority: 'engine',
        })],
      },
    });
  });

  it('halts a grouped outside-visible OVER_SCOPE finding with the serial over-scope class', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport('S9.6', 'outside-visible'),
      storiesWithCriterion('Happy Path'),
    );

    expect(fixture.calls).not.toContain('remediate');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('over-scope');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'user-visible scope requires operator acceptance',
    );
  });

  it('keeps the grouped prd_audit member unsatisfied when a rejected row rides with a recordable PLAN_GAP', async () => {
    const fixture = await runGroupedPrdAudit(
      rejectedRowWithNegativePathPlanGapReport(),
      storiesForRejectedRowReport(),
    );

    expect(fixture.state.ok && fixture.state.value.prd_audit).not.toBe('done');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('OS.1');
  });

  it('keeps the serial prd_audit tail unsatisfied when a rejected row rides with a recordable PLAN_GAP', async () => {
    const fixture = await runGroupedPrdAudit(
      rejectedRowWithNegativePathPlanGapReport(),
      storiesForRejectedRowReport(),
      undefined,
      { mode: 'default' },
    );

    expect(fixture.state.ok && fixture.state.value.prd_audit).not.toBe('done');
    // The serial tail never reaches its `record` promotion. The typed verdict
    // remains incomplete and has no recorded disposition, regardless of its
    // rendered Markdown view.
    await expect(readPrdAuditVerdict(fixture.root)).resolves.toMatchObject({
      kind: 'present',
      value: { complete: false, recordedDispositions: [] },
    });
  });

  it('completes an NC.1 operator-acceptance lap through the rendered cleared-halt handoff', async () => {
    const summary = 'A visible behavior exists outside the approved plan.';
    const report = noOwnerOverScopeReport('NC.1', summary, 'outside-visible');
    const stories = storiesWithCriterion('Happy Path');
    const ownerConfig = vi.spyOn(machineIdentity, 'readMachineOwnerConfig').mockResolvedValue({ spec_owner: null });
    try {
      const first = await runGroupedPrdAudit(report, stories);

      const halt = await readFile(join(first.root, '.pipeline', 'HALT'), 'utf8');
      expect(halt).toContain('user-visible scope requires operator acceptance');
      expect(halt).toContain('"criterion": "NC.1"');
      expect(halt).toContain(`"summary": "${summary}"`);

      const cleared = halt
        .replace('"decision": "pending"', '"decision": "accept", "rationale": "Approved for this feature."');

      const second = await runGroupedPrdAudit(report, stories, async (root) => {
        await writeFile(join(root, '.pipeline', 'HALT.cleared'), cleared);
        await rm(join(root, '.pipeline', 'HALT'));
        await rm(join(root, '.pipeline', 'HALT.class'));
      }, { root: first.root });
      const decisions = await new AcceptedWideningDecisionStore(second.root, {
        version: 1,
        repository: '/fixture/repository',
        feature: 'prd-audit-kickback',
      }).read();

      expect(decisions).toMatchObject({ kind: 'valid', state: { decisions: [expect.objectContaining({
        criterion: 'NC.1',
        authority: 'accept',
        rationale: 'Approved for this feature.',
        operator: 'operator@example.test',
        originalSource: {
          id: prdWideningSourceId({ criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: summary, prdIds: [] }),
          snapshot: summary,
        },
      })] } });
      expect(second.gateBlocks).not.toContainEqual(expect.objectContaining({ step: 'prd_audit' }));
      expect(second.state.ok && second.state.value.prd_audit).toBe('done');
    } finally {
      ownerConfig.mockRestore();
    }
  });


  it('passes reseal and feature-commit Scope rationale evidence into the prd_audit prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-scope-prompt-'));
    dirs.push(root);
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
    await writeFile(join(root, 'base.ts'), 'export const base = true;\n');
    await execa('git', ['add', 'base.ts'], { cwd: root });
    await execa('git', ['commit', '-q', '-m', 'base'], { cwd: root });
    await writeFile(join(root, 'optional.ts'), 'export const optional = true;\n');
    await execa('git', ['add', 'optional.ts'], { cwd: root });
    await execa('git', [
      'commit',
      '-q',
      '-m',
      'add optional behavior\n\nScope: optional.ts — supports the optional behavior',
    ], { cwd: root });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, PROTECTED_ARTIFACT_SEAL_PATH),
      JSON.stringify({
        version: 2,
        baselineCommit: 'baseline',
        protectedArtifacts: [],
        rebaselines: [{
          fromCommit: 'before',
          toCommit: 'after',
          trigger: 'operator-reseal',
          paths: ['.docs/plans/feature.md'],
          reason: 'corrected plan',
        }],
      }),
    );
    const invoke = vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 });
    const runner = new DefaultStepRunner({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke,
    }, 'session', root, { pipelineDir: join(root, '.pipeline') });

    await runner.run('prd_audit', {});

    const prompt = invoke.mock.calls[0][0].systemPrompt as string;
    expect(prompt).toContain('PRD-AUDIT SCOPE EVIDENCE');
    expect(prompt).toContain('.docs/plans/feature.md');
    expect(prompt).toContain('corrected plan');
    expect(prompt).toContain('optional.ts');
    expect(prompt).toContain('supports the optional behavior');
  });

  /**
   * AB-R12: 11 of this repo's APPROVED ADRs write their decisions as `**D<n>`
   * headings rather than a numbered list. Clause resolution only accepted the
   * numbered form, so a REMEDIABLE finding citing a D-heading decision could
   * never enter the bounded remediation path decision 1 promises.
   */
  it.skip('resolves a governing clause against a D-heading ADR decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-d-heading-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const adrStem = 'adr-2026-08-25-d-heading-architecture';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 1: Existing approved work\n');
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: D-heading architecture',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '**D1 — Engine-minted run identity.** The engine binds an identity per dispatch.',
      '',
      '**D2 — Engine-stamped, never provider-echoed.** Skills write only content.',
      '',
      '## Consequences',
      '',
      '- Something else entirely.',
    ].join('\n'));

    const plan = await readFile(planPath, 'utf8');
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 1`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 1` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 2`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 2` });
    // Fail closed on a decision the ADR does not carry, and never let D1 match D10.
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 3`))
      .resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 10`))
      .resolves.toBeNull();
  });

  it.skip('resolves fractional subclauses against a D-heading ADR decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-d-heading-fractional-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const adrStem = 'adr-2026-09-18-d-heading-fractional-architecture';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 1: Existing approved work\n');
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: Fractional D-heading architecture',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '**D5 — Engine-minted run identity.** The engine binds an identity per dispatch.',
      '',
      '## Consequences',
      '',
      '- Something else entirely.',
    ].join('\n'));

    const plan = await readFile(planPath, 'utf8');
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} D5`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} D5` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 5`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 5` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} D5.2`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} D5.2` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 5.2`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 5.2` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} + 5.2`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} + 5.2` });
  });

  it.skip('keeps undeclared, malformed, draft, and task-shaped dotted cites fail closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-dotted-negative-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const declaredStem = 'adr-2026-09-18-declared-decisions';
    const numericStem = 'adr-2026-09-18-numeric-decision';
    const draftStem = 'adr-2026-09-18-draft-decision';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 5.2: Existing approved work\n');
    await writeFile(join(root, '.docs', 'decisions', `${declaredStem}.md`), [
      '# ADR: Declared decisions',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '**D1 — First.**',
      '**D2 — Second.**',
      '**D3 — Third.**',
      '**D4 — Fourth.**',
    ].join('\n'));
    await writeFile(join(root, '.docs', 'decisions', `${numericStem}.md`), [
      '# ADR: Numeric decision',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '**D5 — Fifth.**',
    ].join('\n'));
    await writeFile(join(root, '.docs', 'decisions', `${draftStem}.md`), [
      '# ADR: Draft decision',
      '**Status:** DRAFT',
      '',
      '## Decision',
      '',
      '**D5 — Fifth.**',
    ].join('\n'));

    const plan = await readFile(planPath, 'utf8');
    await expect(resolveAsBuiltGoverningClause(root, plan, `${declaredStem} D9.1`)).resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, `${numericStem} D5.a`)).resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, `${numericStem} D5.`)).resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, `${draftStem} D5.2`)).resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, 'Task 5.2'))
      .resolves.toEqual({ kind: 'plan-task', clause: 'Task 5.2', parentTask: '5.2' });
  });

  it.skip('fails closed when an ADR omits the cited decision number', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-absent-decision-'));
    dirs.push(root);
    const adrStem = 'adr-2026-09-02-absent-decision';
    await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: Absent decision',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '4. **Only decision.**',
    ].join('\n'));

    await expect(resolveAsBuiltGoverningClause(root, '', `${adrStem} decision 5`))
      .resolves.toBeNull();
  });

  /**
   * AB-R12 widened clause resolution to the bolded `**D<n>` form, but 15 of
   * this repo's APPROVED ADRs — including
   * `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` and
   * `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` — write
   * their decisions as ATX headings (`### D4 — ...`). The `^\s*` anchor cannot
   * step over the leading `#`, so every heading-form decision stayed uncitable
   * and its REMEDIABLE finding halted needs-human. `templates/adr.md.template`
   * prescribes no decision shape, so the heading form is not a defect in the
   * ADR — the consumer must accept what the template permits.
   */
  it.skip('resolves a governing clause against an ATX-heading ADR decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-atx-heading-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const adrStem = 'adr-2026-08-29-atx-heading-architecture';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 1: Existing approved work\n');
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: ATX-heading architecture',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '### D1 — The eight categories become a closed vocabulary',
      '',
      'Prose for the first decision.',
      '',
      '#### D2 — A deeper heading level still cites',
      '',
      'Prose for the second decision.',
      '',
      '## Consequences',
      '',
      '- Something else entirely.',
    ].join('\n'));

    const plan = await readFile(planPath, 'utf8');
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 1`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 1` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 2`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 2` });
    // Still fails closed: absent decisions, and D1 never matches D10.
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 3`))
      .resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 10`))
      .resolves.toBeNull();
  });

  /**
   * The fourth shape in this family, and the one that halted
   * `build-review-rubrics-need-a-post-join-adjudicator-` on 2026-09-04:
   * `adr-2026-08-11-halt-events-ride-the-persisted-spine` numbers its decisions
   * with the bold wrapping the number (`**1. Halt-class events persist.**`)
   * rather than after it. `^\s*<n>\.` cannot step over the leading `**`, so a
   * REMEDIABLE finding citing a real, APPROVED, genuinely-violated decision was
   * uncitable and halted needs-human instead of routing to BUILD.
   */
  it.skip('resolves a governing clause against a bold-wrapped numbered ADR decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-bold-number-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const adrStem = 'adr-2026-08-11-bold-numbered-architecture';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 1: Existing approved work\n');
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: Bold-numbered architecture',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '**1. Halt-class events persist.** `loop_halt` becomes `persist: true`.',
      '',
      '**2. `loop_halt` gains an optional `step`, stamped centrally.** One owned emit path.',
      '',
      '## Consequences',
      '',
      '- Something else entirely.',
    ].join('\n'));

    const plan = await readFile(planPath, 'utf8');
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 1`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 1` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 2`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 2` });
    // Still fails closed: an absent decision, and `**1.` never matches `**12.`.
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 3`))
      .resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} decision 12`))
      .resolves.toBeNull();
  });

  /**
   * Every REMEDIABLE clause authored in the wild backticks its stem
   * (`` `adr-x` + Decision 4 ``). The grammar is anchored on a bare identifier,
   * so the leading backtick failed the match before any ADR lookup ran and the
   * finding became a needs-human HALT — on substance the bounded remediation
   * route could have closed. The skill's own template also renders as
   * `<stem> + <decision number>`, without the literal word `decision`.
   */
  it.skip('resolves a governing clause through authored markdown emphasis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'as-built-clause-emphasis-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const adrStem = 'adr-2026-08-26-authored-clause-emphasis';
    await Promise.all([
      mkdir(join(root, '.docs', 'plans'), { recursive: true }),
      mkdir(join(root, '.docs', 'decisions'), { recursive: true }),
    ]);
    await writeFile(planPath, '### Task 1: Existing approved work\n\n### Task 9: Second approved task\n');
    await writeFile(join(root, '.docs', 'decisions', `${adrStem}.md`), [
      '# ADR: Authored clause emphasis',
      '**Status:** APPROVED',
      '',
      '## Decision',
      '',
      '4. **A clause cell carries no markup.** Emphasis is presentation, not identity.',
      '',
      '## Consequences',
      '',
      '- Something else entirely.',
    ].join('\n'));

    const plan = await readFile(planPath, 'utf8');
    // The resolution reports the emphasis-stripped clause: it is rendered into
    // the appended plan task, where the markup was never meaningful.
    await expect(resolveAsBuiltGoverningClause(root, plan, `\`${adrStem}\` + Decision 4`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} + Decision 4` });
    await expect(resolveAsBuiltGoverningClause(root, plan, `**${adrStem}** + decision 4`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} + decision 4` });
    // The skill template's own form omits the literal word `decision`.
    await expect(resolveAsBuiltGoverningClause(root, plan, `${adrStem} + 4`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} + 4` });
    await expect(resolveAsBuiltGoverningClause(root, plan, '`Task 9`'))
      .resolves.toEqual({ kind: 'plan-task', clause: 'Task 9', parentTask: '9' });

    // Stripping emphasis must not widen the grammar: a clause naming two
    // references stays unresolvable, and a decision the ADR lacks fails closed.
    await expect(resolveAsBuiltGoverningClause(root, plan, 'Task 9 and Task 10'))
      .resolves.toBeNull();
    await expect(resolveAsBuiltGoverningClause(root, plan, `\`${adrStem}\` + Decision 5`))
      .resolves.toBeNull();
  });


  /**
   * AB-R15/AB-R16 matrix (issue #1912). APPROVED decision 6 requires
   * `architecture_review_as_built.remediation.enabled: false` to revert EXACTLY
   * to halt-always-on-BLOCKED. The kill switch had been enforced per call site,
   * so each new site reopened it. These cells pin the seam where as-built
   * evidence becomes authority, across the round shapes that reach it.
   *
   * The join-level dimension (a manual_test FAIL deferring to the consolidated
   * kickback) is covered by the parallel-validation acceptance suite; this
   * matrix owns the planRemediation-level inputs.
   */
  describe('as-built remediation kill switch (decision 6)', () => {
    for (const withPrdEvidence of [false, true]) {
      const round = withPrdEvidence ? 'mixed PRD/as-built' : 'as-built-only';

      it(`grants no as-built authority in a ${round} round when disabled`, async () => {
        const fixture = await createAsBuiltRemediationCapFixture({
          remediationEnabled: false,
          withPrdEvidence,
          appendCap: 4,
        });

        const ledger = await readKickbackLedger(fixture.root);
        const plan = await readFile(fixture.planPath, 'utf8');

        // No as-built lap, no as-built growth attribution, no appended
        // as-built task — the switch removes the authority, not just the route.
        expect(ledger.gates?.architecture_review_as_built).toBeUndefined();
        expect(ledger.growth?.byGate?.architecture_review_as_built).toBeUndefined();
        expect(plan).not.toContain('rem-as-built-');
        expect(
          (ledger as { pendingAsBuiltRemediationFindings?: unknown[] })
            .pendingAsBuiltRemediationFindings ?? [],
        ).toHaveLength(0);
      });

      it(`keeps as-built authority in a ${round} round when enabled`, async () => {
        const fixture = await createAsBuiltRemediationCapFixture({
          withPrdEvidence,
          appendCap: 4,
          ...(withPrdEvidence ? { plannerFindingIds: ['S1.1', 'AB-1', 'AB-2'] } : {}),
        });

        // The switch is the ONLY difference from the cell above: enabling it
        // admits the as-built findings through the appender and records their
        // gate-local charge for the build transition. These effects distinguish
        // as-built authority from the PRD-only route that still exists in a
        // mixed round.
        expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
        const ledger = await readKickbackLedger(fixture.root);
        const plan = await readFile(fixture.planPath, 'utf8');
        expect(plan).toContain('rem-as-built-');
        expect((ledger.gates?.architecture_review_as_built as { laps?: number } | undefined)?.laps ?? 0)
          .toBe(0);
        expect(ledger.growth?.byGate?.architecture_review_as_built ?? 0).toBe(0);
        expect(ledger.pendingRepair?.charges.architecture_review_as_built)
          .toEqual({ laps: 1, growth: 2 });
      });
    }
  });
});

import { writeKickbackLedger } from './kickback-ledger-test-support.js';

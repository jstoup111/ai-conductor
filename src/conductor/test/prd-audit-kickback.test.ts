// Covers: task:9, task:17
// Covers: S5.1, S5.2, S5.3, S5.4, task:10

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import {
  Conductor,
  remediationLapCapForGate,
  resolveAsBuiltGoverningClause,
  routePrdAuditPlanGaps,
  routePrdAuditOverScope,
  recordedFindingsBlock,
  recordedPrdAuditFindingsBlock,
  type StepRunner,
} from '../src/engine/conductor.js';
import {
  classifyOverScopeCriterion,
  overScopeRelations,
  parseClearedOverScopeDecisions,
  readOverScopeDecisions,
  recordOverScopeDecisions,
  renderOverScopeDecisionBlock,
} from '../src/engine/accepted-widenings.js';
import { parsePrdAuditReport } from '../src/engine/artifacts.js';
import { readGrowth, readKickbackLedger, writeKickbackLedger } from '../src/engine/kickback-ledger.js';
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

const dirs: string[] = [];

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
  report?: string;
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
  await writeFile(
    join(root, '.pipeline', 'prd-audit.md'),
    input.report ?? [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      ...input.criteria.map(
        (criterion, index) =>
          `| ${criterion} | FIXABLE | ${index + 1} | Missing ${criterion} behavior |`,
      ),
    ].join('\n'),
  );
  if (input.priorLaps !== undefined) {
    await writeKickbackLedger(root, {
      version: 1,
      gates: {
        prd_audit: {
          count: 0,
          cumulative: 0,
          treeHash: null,
          lastReason: '',
          priorVerdict: true,
          resolvedBefore: 0,
          laps: input.priorLaps,
        },
      },
    } as never);
  }

  const runner: StepRunner = {
    run: async () => {
      await writeFile(
        join(root, '.pipeline', 'remediation.json'),
        JSON.stringify({
          dispositions: input.criteria.map((criterion) => ({
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
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    config: { prd_audit: { max_remediation_laps: 1, ...input.config } } as never,
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

  return { outcome, plan, planPath, root, gateBlocks };
}

async function createAsBuiltRemediationCapFixture(input: {
  priorLaps?: number;
  priorGrowthAdded?: number;
  appendCap?: number;
  plannerFindingIds?: string[];
  /** Decision 6 kill switch. Default true, matching production. */
  remediationEnabled?: boolean;
  /** Add a validated prd_audit FIXABLE finding + its evidence, for mixed rounds. */
  withPrdEvidence?: boolean;
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
  await writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), [
    'Verdict: BLOCKED',
    '',
    '## Blocking Findings',
    '| Finding | Class | Governing clause | Summary |',
    '| --- | --- | --- | --- |',
    ...findings.map((finding) =>
      `| ${finding.id} | REMEDIABLE | ${finding.clause} | ${finding.summary} |`,
    ),
  ].join('\n'));
  if (input.withPrdEvidence) {
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await writeFile(join(root, '.docs', 'stories', 'feature.md'), [
      '# Stories', '', '## Story 1: the criterion', '', '### Acceptance Criteria', '',
      '#### Happy Path',
      '- Given a request, when handled, then the criterion holds.',
    ].join('\n'));
    await writeFile(join(root, '.pipeline', 'prd-audit.md'), [
      '# PRD Audit', '', '**PRD:** none', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S1.1 | FIXABLE | 1 | FR-1 | not implemented |',
    ].join('\n'));
  }
  if (input.priorLaps !== undefined || input.priorGrowthAdded !== undefined) {
    await writeKickbackLedger(root, {
      version: 1,
      gates: input.priorLaps === undefined
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
                id: 'FR-1',
                disposition: 'build',
                category: null,
                rationale: 'Satisfy the criterion.',
                tasks: [{ id: 'prd-fix', title: 'Satisfy S1.1' }],
              }]
            : []),
          ...(input.plannerFindingIds ?? findings.map((finding) => finding.id)).map((id) => ({
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

describe('prd_audit kickback', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reads only conforming version-one over-scope decision stores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'over-scope-decisions-reader-'));
    dirs.push(root);
    const path = join(root, '.pipeline', 'accepted-widenings.json');

    await expect(readOverScopeDecisions(root)).resolves.toEqual({ decisions: [] });

    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(path, '{ not json');
    await expect(readOverScopeDecisions(root)).resolves.toEqual({ decisions: [] });

    await writeFile(path, JSON.stringify({
      version: 1,
      entries: [{ criterion: 'S3.1', summary: 'Old store.', acceptedAt: '2026-08-24T00:00:00.000Z' }],
    }));
    await expect(readOverScopeDecisions(root)).resolves.toEqual({ decisions: [] });

    const decisions = [{
      criterion: 'S3.1',
      summary: 'Visible optional behavior.',
      decision: 'accept',
      rationale: 'The operator approved this visible widening.',
      operator: 'operator@example.test',
      decidedAt: '2026-08-24T00:00:00.000Z',
    }];
    await writeFile(path, JSON.stringify({ version: 1, decisions }));
    await expect(readOverScopeDecisions(root)).resolves.toEqual({ decisions });
  });

  it('records durable decisions idempotently and permits a later override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'over-scope-decisions-record-'));
    dirs.push(root);
    const refuse = { criterion: 'S3.1', summary: 'Visible behavior.', decision: 'refuse' as const, rationale: 'Needs rework.', operator: 'operator' };
    await expect(recordOverScopeDecisions(root, [refuse])).resolves.toMatchObject({ recorded: [expect.objectContaining(refuse)] });
    await expect(recordOverScopeDecisions(root, [refuse])).resolves.toEqual({ recorded: [] });
    await recordOverScopeDecisions(root, [{ ...refuse, decision: 'accept', rationale: 'Approved after review.' }]);
    const decisions = (await readOverScopeDecisions(root)).decisions;
    expect(classifyOverScopeCriterion('S3.1', 'Visible behavior.', new Map([['S3.1', 'outside-visible']]), decisions)).toBe('accepted');
  });

  it('extracts no-owner intent relations and classifies NC findings uniformly without decisions', () => {
    const relations = overScopeRelations([
      '**PRD:** present',
      '',
      '## Verdict Table',
      '| Criterion | Grade | Plan task | Evidence | Intent relation |',
      '| --- | --- | --- | --- | --- |',
      '| S3.1 | OVER_SCOPE | | Existing criterion behavior | within |',
      '',
      '## Findings without an owning criterion',
      '| Finding | Grade | Intent relation | Evidence |',
      '| --- | --- | --- | --- |',
      '| NC.1 | OVER_SCOPE | within | Unplanned internal detail |',
      '| NC.2 | OVER_SCOPE | outside-harmless | Harmless unplanned detail |',
      '| NC.3 | OVER_SCOPE | outside-visible | Visible unplanned behavior |',
    ].join('\n'));

    expect([...relations]).toEqual([
      ['S3.1', 'within'],
      ['NC.1', 'within'],
      ['NC.2', 'outside-harmless'],
      ['NC.3', 'outside-visible'],
    ]);
    expect(classifyOverScopeCriterion('NC.1', 'Unplanned internal detail', relations, [])).toBe('not-blocking');
    expect(classifyOverScopeCriterion('NC.2', 'Harmless unplanned detail', relations, [])).toBe('not-blocking');
    expect(classifyOverScopeCriterion('NC.3', 'Visible unplanned behavior', relations, [])).toBe('blocking-undecided');
  });

  it('binds NC decisions to their normalized finding summary while criterion decisions remain criterion-only', () => {
    const relations = new Map([
      ['NC.1', 'outside-visible' as const],
      ['NC.2', 'outside-visible' as const],
      ['S3.1', 'outside-visible' as const],
    ]);
    const decisions = [
      { criterion: 'NC.1', summary: '  Visible addition X.  ', decision: 'refuse' as const, rationale: 'First review.', operator: 'operator', decidedAt: '2026-08-26T00:00:00.000Z' },
      { criterion: 'NC.1', summary: 'Visible addition X.', decision: 'accept' as const, rationale: 'Second review.', operator: 'operator', decidedAt: '2026-08-26T00:01:00.000Z' },
      { criterion: 'S3.1', summary: 'Old evidence.', decision: 'accept' as const, rationale: 'Criterion decision.', operator: 'operator', decidedAt: '2026-08-26T00:00:00.000Z' },
    ];

    expect(classifyOverScopeCriterion('NC.1', 'Visible addition X.', relations, decisions)).toBe('accepted');
    expect(classifyOverScopeCriterion('NC.2', 'Visible addition X.', relations, decisions)).toBe('blocking-undecided');
    expect(classifyOverScopeCriterion('NC.1', 'Visible addition Y.', relations, decisions)).toBe('blocking-undecided');
    expect(classifyOverScopeCriterion('S3.1', 'Drifted evidence.', relations, decisions)).toBe('accepted');

    expect(routePrdAuditOverScope(noOwnerOverScopeReport('NC.1', 'Visible addition X.'), decisions)).toMatchObject({
      kind: 'record', findings: [{ criterion: 'NC.1', decision: 'accept', rationale: 'Second review.' }],
    });
    expect(routePrdAuditOverScope(noOwnerOverScopeReport('NC.1', 'Visible addition Y.'), decisions)).toMatchObject({
      kind: 'halt', undecided: [{ criterion: 'NC.1', summary: 'Visible addition Y.' }],
    });
  });

  it('routes NC findings only to the recorded-risk or operator-decision outcomes', () => {
    const summary = 'Visible behavior outside the approved intent.';
    const refused = {
      criterion: 'NC.1',
      summary,
      decision: 'refuse' as const,
      rationale: 'Rework it inside the approved scope.',
      operator: 'operator',
      decidedAt: '2026-08-26T00:00:00.000Z',
    };
    const undecided = routePrdAuditOverScope(
      noOwnerOverScopeReport('NC.1', summary, 'outside-visible'),
      [],
    );
    const within = routePrdAuditOverScope(noOwnerOverScopeReport('NC.1', summary, 'within'), []);
    const harmless = routePrdAuditOverScope(
      noOwnerOverScopeReport('NC.1', summary, 'outside-harmless'),
      [],
    );
    const refusedRoute = routePrdAuditOverScope(
      noOwnerOverScopeReport('NC.1', summary, 'outside-visible'),
      [refused],
    );
    if (undecided.kind !== 'halt' || refusedRoute.kind !== 'halt') {
      throw new Error('outside-visible NC findings must halt for an operator decision');
    }

    const undecidedBlock = renderOverScopeDecisionBlock(undecided.undecided, undecided.refused);
    const refusedBlock = renderOverScopeDecisionBlock(refusedRoute.undecided, refusedRoute.refused);
    const routeSource = routePrdAuditOverScope.toString();

    expect({
      // The route's discriminant is exhaustively limited to non-work outcomes.
      kinds: [undecided.kind, within.kind, harmless.kind, refusedRoute.kind],
      undecided: {
        undecided: undecided.undecided,
        refused: undecided.refused,
      },
      refused: {
        undecided: refusedRoute.undecided,
        refused: refusedRoute.refused,
      },
      pendingEntryRendered: undecidedBlock.includes(
        JSON.stringify([{
          criterion: 'NC.1',
          summary,
          relation: 'outside-visible',
          decision: 'pending',
        }], null, 2),
      ),
      refusedEntryReoffered: refusedBlock.includes('"decision": "pending"'),
      routeAppendsTasks: /append(?:Remediation)?Tasks|planRemediation/.test(routeSource),
      routeEmitsKickback: /emit(?:Tracked)?\([^)]*kickback|type:\s*'kickback'/.test(routeSource),
    }).toMatchObject({
      kinds: ['halt', 'record', 'record', 'halt'],
      undecided: {
        undecided: [{ criterion: 'NC.1', summary, relation: 'outside-visible' }],
        refused: [],
      },
      refused: {
        undecided: [],
        refused: [{ criterion: 'NC.1', summary, relation: 'outside-visible', decision: 'refuse' }],
      },
      pendingEntryRendered: true,
      refusedEntryReoffered: false,
      routeAppendsTasks: false,
      routeEmitsKickback: false,
    });
  });

  it('carries harvest defects and recorded decisions out of a halted over-scope route', async () => {
    // ADR D7: a defect the operator's edit produced must reach the next halt
    // body, not only the spine. ADR D8: recorded decisions project into the
    // verdict artifact even when the route halts on a refusal.
    const root = await mkdtemp(join(tmpdir(), 'over-scope-halt-route-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'prd-audit.md'), [
      '# PRD Audit',
      '',
      '**PRD:** none',
      '',
      '| Criterion | Grade | Plan task | PRD: | Intent relation | Evidence |',
      '| --- | --- | --- | --- | --- | --- |',
      '| S3.1 | OVER_SCOPE | — | none | outside-visible | conductor.ts:1 |',
      '',
    ].join('\n'));
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
    // An entry naming a criterion the halt never offered is a named defect.
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

    const route = await (conductor as unknown as {
      routeCurrentPrdAuditOverScope: () => Promise<{
        kind: string;
        refused?: Array<{ criterion: string }>;
        defects?: Array<{ kind: string; criterion?: string }>;
      }>;
    }).routeCurrentPrdAuditOverScope();

    expect(route.kind).toBe('halt');
    expect(route.refused).toEqual([expect.objectContaining({ criterion: 'S3.1' })]);
    expect(route.defects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'unknown-criterion', criterion: 'S9.9' })]),
    );

    const report = await readFile(join(root, '.pipeline', 'prd-audit.md'), 'utf8');
    expect(report).toContain('## Recorded Findings');
    expect(report).toContain('"decision": "refuse"');
    expect(report).toContain('"rationale": "Rework it inside scope."');
  });

  it('refuses to render a recorded decision that carries no rationale, naming the reason', () => {
    // ADR adr-2026-08-24 D8 / adr-2026-08-13 §6: a recorded decision that
    // cannot be rendered blocks with a named reason rather than silently
    // disappearing from the verdict artifact.
    const renderable = recordedPrdAuditFindingsBlock([
      { gate: 'prd_audit', grade: 'OVER_SCOPE', criterion: 'S3.1', summary: 'Visible.', decision: 'refuse', rationale: 'Rework.' },
    ]);
    expect(renderable.ok).toBe(true);
    expect(renderable.ok && renderable.block).toContain('"decision": "refuse"');

    const missingRationale = recordedPrdAuditFindingsBlock([
      { gate: 'prd_audit', grade: 'OVER_SCOPE', criterion: 'S3.1', summary: 'Visible.', decision: 'accept', rationale: '   ' },
    ]);
    expect(missingRationale).toEqual({
      ok: false,
      message: 'recorded decision accept on S3.1 carries no rationale',
    });

    const missingSummary = recordedPrdAuditFindingsBlock([
      { gate: 'prd_audit', grade: 'PLAN_GAP', criterion: 'S4.2', summary: '' },
    ]);
    expect(missingSummary).toEqual({ ok: false, message: 'recorded finding S4.2 carries no summary' });

    const unrenderableDecision = {
      gate: 'prd_audit', grade: 'OVER_SCOPE', criterion: 'S3.2', summary: 'Visible.',
      decision: 'accept', rationale: 'Accepted.', unrenderableDetail: 1n,
    };
    expect(recordedPrdAuditFindingsBlock([unrenderableDecision] as never)).toMatchObject({
      ok: false,
      message: expect.stringContaining('recorded findings are not serializable'),
    });
  });

  it('refuses a partial remediated as-built finding by naming its missing render field', () => {
    expect(recordedFindingsBlock([{
      gate: 'architecture_review_as_built',
      finding: 'AB-1',
      class: 'REMEDIABLE',
      governingClause: '   ',
      summary: 'Add the approved guard.',
      outcome: 'remediated',
    }] as never)).toEqual({
      ok: false,
      message: 'recorded as-built finding AB-1 carries no governingClause',
    });
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
          'findings' in value && Array.isArray((value as { findings?: unknown }).findings)
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
        'Unreadable scope decisions: unrenderable-decision (recorded findings are not serializable: recorded decision is unrenderable).',
      );
      // Fail closed: the artifact is exactly the judge's original verdict;
      // it never settles without the recorded operator decision.
      await expect(readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).resolves.toBe(report);
    } finally {
      stringify.mockRestore();
    }
  });

  it('renders all undecided criteria and parses valid decision siblings while naming defects', () => {
    const rendered = renderOverScopeDecisionBlock([
      { criterion: 'S3.1', summary: 'First.', relation: 'outside-visible' },
      { criterion: 'S3.2', summary: 'Second.', relation: 'outside-visible' },
      { criterion: 'S3.3', summary: 'Third.', relation: 'outside-visible' },
    ]);
    expect(rendered).toContain('```json over-scope-decisions');
    expect(rendered.match(/"decision": "pending"/g)).toHaveLength(3);
    const edited = rendered
      .replace('"criterion": "S3.1",\n    "summary": "First.",\n    "relation": "outside-visible",\n    "decision": "pending"', '"criterion": "S3.1", "summary": "First.", "decision": "accept", "rationale": "Approved."')
      .replace('"criterion": "S3.2",\n    "summary": "Second.",\n    "relation": "outside-visible",\n    "decision": "pending"', '"criterion": "S3.2", "summary": "Second.", "decision": "refuse", "rationale": "Rework."')
      .replace('"criterion": "S3.3",\n    "summary": "Third.",\n    "relation": "outside-visible",\n    "decision": "pending"', '"criterion": "S3.3", "summary": "Third.", "decision": "accept", "rationale": ""');
    const parsed = parseClearedOverScopeDecisions(edited, new Map([['S3.1', 'First.'], ['S3.2', 'Second.'], ['S3.3', 'Third.']]));
    expect(parsed).toMatchObject({ kind: 'parsed', decisions: [{ criterion: 'S3.1', decision: 'accept' }, { criterion: 'S3.2', decision: 'refuse' }], defects: [{ kind: 'missing-rationale', criterion: 'S3.3' }] });
  });

  it('treats pending, absent, malformed, unknown, and invalid decision entries safely', () => {
    expect(parseClearedOverScopeDecisions('ordinary halt', new Map([['S3.1', 'x']]))).toEqual({ kind: 'absent' });
    expect(parseClearedOverScopeDecisions('```json over-scope-decisions\n{ nope\n```', new Map([['S3.1', 'x']]))).toMatchObject({ defects: [{ kind: 'malformed-block' }] });
    const body = '```json over-scope-decisions\n[{"criterion":"S3.1","summary":"x","decision":"pending"},{"criterion":"S9.9","summary":"x","decision":"accept","rationale":"x"},{"criterion":"S3.1","summary":"x","decision":"wat","rationale":"x"}]\n```';
    expect(parseClearedOverScopeDecisions(body, new Map([['S3.1', 'x']]))).toMatchObject({ decisions: [], defects: [{ kind: 'unknown-criterion', criterion: 'S9.9' }, { kind: 'invalid-decision', criterion: 'S3.1' }] });
  });

  it('rejects a cleared NC decision whose summary differs from the current report without recording it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'over-scope-nc-cleared-'));
    dirs.push(root);
    const parsed = parseClearedOverScopeDecisions(
      '```json over-scope-decisions\n[{"criterion":"NC.1","summary":"Reworded visible addition.","decision":"accept","rationale":"Approved."}]\n```',
      new Map([['NC.1', 'Visible addition.']]),
    );

    expect(parsed).toMatchObject({
      kind: 'parsed',
      decisions: [],
      defects: [{ kind: 'invalid-decision', criterion: 'NC.1' }],
    });
    if (parsed.kind === 'parsed') {
      await expect(recordOverScopeDecisions(root, parsed.decisions.map((decision) => ({ ...decision, operator: 'operator' })))).resolves.toEqual({ recorded: [] });
    }
    await expect(readOverScopeDecisions(root)).resolves.toEqual({ decisions: [] });
  });

  async function runGroupedPrdAudit(
    report: string,
    stories: string,
    setup?: (root: string) => Promise<void>,
    options?: { root?: string; mode?: 'auto' | 'default' },
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
      run: async (step) => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(
            join(root, '.pipeline', 'manual-test-results.md'),
            '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
          );
        } else if (step === 'prd_audit') {
          await writeFile(join(root, '.pipeline', 'prd-audit.md'), report);
          if (report.includes('S13.4')) {
            await writeFile(join(root, '.pipeline', 's13.4-probe-file'), 'keep this review finding\n');
          }
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(root, '.pipeline', 'architecture-review-as-built.md'),
            '# As-Built Architecture Review\n\n**Verdict:** APPROVED\n',
          );
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
      daemon: true,
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
    await writeFile(
      join(root, '.pipeline', 'prd-audit.md'),
      [
        '**PRD:** present',
        '',
        '## Verdict Table',
        '| Criterion | Grade | Plan task | Evidence |',
        '| --- | --- | --- | --- |',
        '| S2.1 | FIXABLE | 4 | Missing first behavior |',
        '| S2.2 | FIXABLE | 5 | Missing second behavior |',
        '| S2.3 | FIXABLE | 6 | Missing third behavior |',
      ].join('\n'),
    );

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
      expect(appendedPlan).toContain(`**Done when:**\n- ${criterion} is satisfied by this task.`);
    }
    const ledger = await readKickbackLedger(root);
    expect((ledger.gates.prd_audit as { laps?: number } | undefined)?.laps).toBe(1);
    expect(ledger.growth).toMatchObject({ added: 3, byGate: { prd_audit: 3 } });
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

  it('admits validated as-built REMEDIABLE evidence when remediation is enabled', async () => {
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

  it('constructs clause-bound as-built gaps and projects every remediated lap', async () => {
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

    await expect(resolveAsBuiltGoverningClause(root, await readFile(planPath, 'utf8'), `${adrStem} decision 1`))
      .resolves.toEqual({ kind: 'adr', clause: `${adrStem} decision 1` });
    await expect(resolveAsBuiltGoverningClause(root, await readFile(planPath, 'utf8'), 'Task 7'))
      .resolves.toEqual({ kind: 'plan-task', clause: 'Task 7', parentTask: '7' });

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

  it('reloads appended as-built findings into the successful verdict and shipment handoff after restart', async () => {
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
        run: async (step) => {
          if (step === 'architecture_review_as_built') {
            await writeFile(
              join(fixture.root, '.pipeline', 'architecture-review-as-built.md'),
              'Verdict: APPROVED\n',
            );
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
    const finalVerdict = await readFile(join(fixture.root, '.pipeline', 'architecture-review-as-built.md'), 'utf8');
    const shipmentFindings = recordedShipmentFindings({ asBuilt: finalVerdict });
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

  it('records as-built plan growth and an isolated remediation lap', async () => {
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

  it('halts a second as-built remediation lap before appending and lists every finding', async () => {
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

  it('halts an as-built request beyond the remaining shared growth allowance before appending', async () => {
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

  it.each([
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
      detail: 'PRD audit report rejected rows: S2.1 (PRD audit finding S2.1 has an invalid Grade.)',
    });
    expect(fixture.gateBlocks).toEqual([{
      step: 'prd_audit',
      reason: 'PRD audit report rejected rows: S2.1 (PRD audit finding S2.1 has an invalid Grade.)',
    }]);
    expect(await readFile(fixture.planPath, 'utf8')).toBe(fixture.plan);
  });

  it('does not record a within-intent NC finding when the report also has a rejected row', () => {
    const report = [
      '**PRD:** none',
      '',
      '## Verdict Table',
      '| Criterion | Grade | Plan task | Evidence | Intent relation |',
      '| --- | --- | --- | --- | --- |',
      '| S3.1 | PASS | | Covered behavior | within |',
      '| S3.2 | MAYBE | | Invalid grade | within |',
      '',
      '## Findings without an owning criterion',
      '| Finding | Grade | Intent relation | Evidence |',
      '| --- | --- | --- | --- |',
      '| NC.1 | OVER_SCOPE | within | Internal implementation detail |',
    ].join('\n');

    const parsed = parsePrdAuditReport(report);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        findings: [
          { criterion: 'S3.1', grade: 'PASS' },
          { criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: 'Internal implementation detail' },
        ],
        rejectedRows: [{ key: 'S3.2', reason: expect.stringContaining('invalid Grade') }],
      },
    });
    expect(routePrdAuditOverScope(report, [])).toEqual({ kind: 'none' });
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

    const report = await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8');
    expect(parsePrdAuditReport(report)).toMatchObject({
      ok: true,
      value: {
        findings: [
          { criterion: 'S2.1', grade: 'FIXABLE' },
          { criterion: 'NC.1', grade: 'OVER_SCOPE', evidence: 'Internal implementation detail' },
        ],
        rejectedRows: [],
      },
    });
    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(fixture.gateBlocks).toEqual([]);
    expect(await readFile(fixture.planPath, 'utf8')).toContain('**Criterion:** S2.1');
  });

  it('halts without appending when FIXABLE work exceeds the growth cap, listing every finding', async () => {
    const criteria = ['S2.1', 'S2.2', 'S2.3', 'S2.4'];
    const fixture = await createPrdAuditRemediationFixture({ taskCount: 12, criteria });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
    expect(fixture.outcome.detail).toContain('growth cap');
    for (const criterion of criteria) expect(fixture.outcome.detail).toContain(criterion);
    expect(await readFile(fixture.planPath, 'utf8')).toBe(fixture.plan);
  });

  it('halts a second prd_audit lap without appending and lists the new finding', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.5'],
      priorLaps: 1,
    });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
    expect(fixture.outcome.detail).toContain('S2.5');
    expect(await readFile(fixture.planPath, 'utf8')).toBe(fixture.plan);
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

  it('halts a PLAN_GAP for a happy-path criterion with a plan-gap class', () => {
    const route = routePrdAuditPlanGaps(
      planGapReport('S2.1'),
      storiesWithCriterion('Happy Path'),
      {} as never,
    );

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'plan-gap' });
    if (route.kind !== 'halt') throw new Error('expected happy-path plan gap to halt');
    expect(route.detail).toContain('S2.1');
  });

  it('records a negative-path PLAN_GAP finding and lets the gate pass', () => {
    const route = routePrdAuditPlanGaps(
      planGapReport('S2.1', 'An edge case is not in the approved plan.'),
      storiesWithCriterion('Negative Paths'),
      {} as never,
    );

    expect(route).toMatchObject({
      kind: 'record',
      findings: [{
        grade: 'PLAN_GAP',
        criterion: 'S2.1',
        summary: 'An edge case is not in the approved plan.',
        gate: 'prd_audit',
      }],
    });
  });

  it('treats an unclassifiable PLAN_GAP criterion as happy-path and halts', () => {
    const route = routePrdAuditPlanGaps(planGapReport('S2.3'), '# Stories\n', {} as never);

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'plan-gap' });
  });

  it('uses the finding story and ordinal when another story has the same criterion prose', () => {
    const sharedCriterion = 'Given a request, when it is malformed, then the engine refuses it.';
    const stories = [
      '# Stories',
      '',
      '## Story 1: primary flow',
      '',
      '#### Happy Path',
      `- ${sharedCriterion}`,
      '',
      '## Story 2: edge flow',
      '',
      '#### Negative Paths',
      `- ${sharedCriterion}`,
    ].join('\n');

    const route = routePrdAuditPlanGaps(planGapReport('S2.1'), stories, {} as never);

    expect(route).toMatchObject({
      kind: 'record',
      findings: [expect.objectContaining({ criterion: 'S2.1', grade: 'PLAN_GAP' })],
    });
  });

  it('halts a negative-path PLAN_GAP when halt_on_any_plan_gap is enabled', () => {
    const route = routePrdAuditPlanGaps(
      planGapReport('S2.1'),
      storiesWithCriterion('Negative Paths'),
      { prd_audit: { halt_on_any_plan_gap: true } } as never,
    );

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'plan-gap' });
  });

  it('refuses to record a negative-path PLAN_GAP while the report carries a rejected row', () => {
    const route = routePrdAuditPlanGaps(
      rejectedRowWithNegativePathPlanGapReport(),
      storiesForRejectedRowReport(),
      {} as never,
    );

    expect(route).toEqual({ kind: 'none' });
  });

  it('records an in-intent OVER_SCOPE finding as an accepted widening and passes', () => {
    const route = routePrdAuditOverScope(overScopeReport('S3.1', 'within'), []);

    expect(route).toMatchObject({
      kind: 'record',
      findings: [{ grade: 'OVER_SCOPE', criterion: 'S3.1', accepted: true }],
    });
  });

  it('records a harmless out-of-intent OVER_SCOPE finding and passes', () => {
    const route = routePrdAuditOverScope(overScopeReport('S3.2', 'outside-harmless'), []);

    expect(route).toMatchObject({
      kind: 'record',
      findings: [{ grade: 'OVER_SCOPE', criterion: 'S3.2', accepted: false }],
    });
  });

  it('halts a visible out-of-intent OVER_SCOPE finding with its own class', () => {
    const route = routePrdAuditOverScope(overScopeReport('S3.3', 'outside-visible'), []);

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'over-scope' });
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
      '"grade": "PLAN_GAP"',
    );
  });

  it('joins a within-intent OVER_SCOPE finding as a recorded, satisfied prd_audit member', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport('S9.1', 'within'),
      storiesWithCriterion('Happy Path'),
    );

    expect(fixture.calls).not.toContain('remediate');
    expect(fixture.state.ok && fixture.state.value.prd_audit).toBe('done');
    expect(await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).toContain(
      '"accepted": true',
    );
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
    expect(await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).toContain(
      '"criterion": "S13.4"',
    );
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
    // The serial tail never reaches its `record` promotion, so the PLAN_GAP is
    // never projected back into the report as an accepted risk — the rejected
    // OS.1 row is still the last word on disk.
    const report = await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8');
    expect(report).toBe(rejectedRowWithNegativePathPlanGapReport());
    expect(report).not.toContain('"grade": "PLAN_GAP"');
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
      const decisions = await readOverScopeDecisions(second.root);

      expect(decisions.decisions).toEqual([expect.objectContaining({
        criterion: 'NC.1',
        summary,
        decision: 'accept',
        rationale: 'Approved for this feature.',
        operator: 'operator@example.test',
      })]);
      expect(second.gateBlocks).not.toContainEqual(expect.objectContaining({ step: 'prd_audit' }));
      expect(second.state.ok && second.state.value.prd_audit).toBe('done');
    } finally {
      ownerConfig.mockRestore();
    }
  });

  it('requires the explicit Intent relation field instead of inferring within intent from evidence', () => {
    const route = routePrdAuditOverScope(
      overScopeReport('S3.4', 'within', 'within', false),
      [],
    );

    expect(route).toEqual({ kind: 'none' });
  });

  it('parses a cleared decision block and regrades an accepted criterion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accepted-widenings-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const report = overScopeReport('S3.4', 'outside-visible', 'A visible optional feature.');
    const body = renderOverScopeDecisionBlock([{ criterion: 'S3.4', summary: 'A visible optional feature.', relation: 'outside-visible' }])
      .replace('"pending"', '"accept"')
      .replace('"decision": "accept"', '"decision": "accept", "rationale": "Approved."');
    const parsed = parseClearedOverScopeDecisions(body, new Set(['S3.4']));
    expect(parsed.kind).toBe('parsed');
    if (parsed.kind !== 'parsed') return;
    await recordOverScopeDecisions(root, parsed.decisions.map((decision) => ({ ...decision, operator: 'test' })));
    const decisions = await readOverScopeDecisions(root);
    expect(decisions.decisions).toHaveLength(1);
    expect(routePrdAuditOverScope(report, decisions.decisions)).toMatchObject({
      kind: 'record',
      findings: [{ criterion: 'S3.4', accepted: true }],
    });
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
  it('resolves a governing clause against a D-heading ADR decision', async () => {
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
  it('resolves a governing clause against an ATX-heading ADR decision', async () => {
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
   * Every REMEDIABLE clause authored in the wild backticks its stem
   * (`` `adr-x` + Decision 4 ``). The grammar is anchored on a bare identifier,
   * so the leading backtick failed the match before any ADR lookup ran and the
   * finding became a needs-human HALT — on substance the bounded remediation
   * route could have closed. The skill's own template also renders as
   * `<stem> + <decision number>`, without the literal word `decision`.
   */
  it('resolves a governing clause through authored markdown emphasis', async () => {
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
        });

        // The switch is the ONLY difference from the cell above: enabling it
        // admits the as-built findings through the appender and charges their
        // gate-local budget. These effects distinguish as-built authority
        // from the PRD-only route that still exists in a mixed round.
        expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
        const ledger = await readKickbackLedger(fixture.root);
        const plan = await readFile(fixture.planPath, 'utf8');
        expect(plan).toContain('rem-as-built-');
        expect((ledger.gates?.architecture_review_as_built as { laps?: number } | undefined)?.laps)
          .toBe(1);
        expect(ledger.growth?.byGate?.architecture_review_as_built).toBe(2);
      });
    }
  });
});

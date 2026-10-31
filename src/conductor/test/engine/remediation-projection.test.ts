import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildRemediationProjection,
  REMEDIATION_PROJECTION_LIMITS,
  REMEDIATION_PROJECTION_VERSION,
} from '../../src/engine/remediation-projection.js';
import { readPendingAsBuiltRemediationFindings } from '../../src/engine/kickback-ledger.js';
import {
  REMEDIATION_PLAN_CONTRACT_VERSION,
  validateRemediationPlan,
} from '../../src/engine/remediation-plan-contract.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { AS_BUILT_VERDICT_CONTRACT_VERSION, stampAsBuiltFindingIds } from '../../src/engine/as-built-contract.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: true, reason: 'fixture' },
  diagramDrift: { enabled: true, reason: 'fixture' },
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-projection-'));
  roots.push(root);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'active.md'), [
    '# Plan',
    '',
    '### Task 7: Repair the typed projection',
    '',
    '**Done when:**',
    '- [test] The projection receives the criterion.',
    '- The task title and completion checks are available.',
    '',
  ].join('\n'));
  return root;
}

async function writePrdVerdict(root: string): Promise<void> {
  await persistPrdAuditVerdict(root, {
    complete: true,
    diagnostics: [],
    recordedDispositions: [],
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 2 },
        criterionId: 'S1.2',
        grade: 'FIXABLE',
        evidence: 'The renderer ignores the durable disposition.',
        rationale: 'The active task can repair it.',
        requirementAssociations: [],
        evidenceTaskIds: ['7'],
        ownerTaskId: '7',
      }],
      noOwnerObservations: [],
    },
  }, { attemptId: 'prd-attempt', codeStamp: null });
}

async function writeAsBuiltVerdict(root: string): Promise<void> {
  await persistAsBuiltVerdict(root, stampAsBuiltFindingIds({
    version: AS_BUILT_VERDICT_CONTRACT_VERSION,
    verdict: 'BLOCKED',
    reachability: [],
    driftNotes: [],
    violations: 'A remediable boundary is missing.',
    resolution: 'Repair the boundary.',
    findings: [{
      class: 'REMEDIABLE',
      reference: { kind: 'plan-task', taskId: '7' },
      summary: 'The typed boundary is not reached.',
    }],
  }, 'as-built-attempt'), { attemptId: 'as-built-attempt', codeStamp: null, policy });
}

async function writeAsBuiltCases(root: string): Promise<void> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
    version: 'v4',
    feature: { version: 'v1', repository: 'acme/conductor', feature: 'remediation-projection' },
    cases: [],
    prdWideningCases: [{
      id: 'prd-case-1', domain: 'prd_widening',
      originalSources: [{ sourceId: 'S1.1', snapshot: 'An unrelated widening record.' }],
      currentSources: [], relationships: [],
    }],
    asBuiltCases: [{
      id: 'case-open', domain: 'as_built', status: 'open', repairTaskIds: ['rem-as-built-t1'], recurrenceCount: 1,
      sources: [{
        findingId: 'as-built:prior:1', attemptId: 'prior', class: 'REMEDIABLE',
        reference: { kind: 'plan-task', taskId: '7' }, summary: 'The old boundary remains absent.',
        relation: 'new', reason: 'First observed missing boundary.',
      }],
    }, {
      id: 'case-resolved', domain: 'as_built', status: 'resolved', repairTaskIds: ['rem-as-built-t2'], recurrenceCount: 2,
      sources: [{
        findingId: 'as-built:prior:2', attemptId: 'prior', class: 'REMEDIABLE',
        reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 2 }, summary: 'The old ADR boundary was incomplete.',
        relation: 'recurrence', reason: 'The repaired boundary recurred.', priorCaseId: 'case-original',
      }],
    }],
    suppressions: [], outbox: [],
  }), 'utf8');
  await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
    { id: 'rem-as-built-t1', status: 'pending' },
    { id: 'rem-as-built-t2', status: 'completed' },
  ] }), 'utf8');
}

const realisticTaskDoneWhen = [
  'A PRD-audit projection carries every FIXABLE criterion by its engine criterion id with its owning task and judgment summary, those tasks’ titles and Done-when blocks from the active plan, and the accepted dispositions and halt categories rendered from the code constants.',
  'An as-built projection names every REMEDIABLE finding by stamped id with governing reference and summary, plus pending as-built findings and prior remediation laps read from the kickback ledger.',
  'A validation-group projection carries the complete union of required reference sets, retaining its source gate label for each reference and preserving every independent remediation obligation.',
  'The projection remains bounded by named engine limits measured from repository corpus inputs, faults required structured overflow before provider dispatch, and never truncates any required reference or owning task.',
];

async function writeRealisticPlan(root: string): Promise<void> {
  const task = (id: string, title: string, doneWhen: readonly string[]) => [
    `### Task ${id}: ${title}`,
    '',
    '**Done when:**',
    ...doneWhen.map((line) => `- ${line}`),
    '',
  ];
  await writeFile(join(root, '.docs', 'plans', 'active.md'), [
    '# Plan', '',
    ...task('8', 'Project typed sources, refusals and explicit absence', realisticTaskDoneWhen),
    ...task('9', 'Project untyped sources with bounded evidence', realisticTaskDoneWhen.slice(0, 2)),
    ...task('10', 'Fault on missing, unreadable or over-limit required input', realisticTaskDoneWhen.slice(2)),
    ...task('11', 'Preserve typed planning admission at the routing boundary', realisticTaskDoneWhen),
  ].join('\n'));
}

async function writeCorpusScalePrdVerdict(root: string): Promise<readonly string[]> {
  const ids = ['S1.1', 'S1.2', 'S1.3', 'S7.1'];
  await persistPrdAuditVerdict(root, {
    complete: true,
    diagnostics: [],
    recordedDispositions: [],
    judgment: {
      version: 'v1',
      criterionJudgments: ids.map((criterionId, index) => ({
        criterion: { storyId: '1', ordinal: index + 1 },
        criterionId,
        grade: 'FIXABLE' as const,
        evidence: `${criterionId}: ${'verified remediation evidence '.repeat(28)}`,
        rationale: 'The owning task is the approved repair boundary.',
        requirementAssociations: [],
        evidenceTaskIds: [String(index + 8)],
        ownerTaskId: String(index + 8),
      })),
      noOwnerObservations: [],
    },
  }, { attemptId: 'prd-attempt', codeStamp: null });
  return ids;
}

async function writeCorpusScaleAsBuiltVerdict(root: string): Promise<void> {
  await persistAsBuiltVerdict(root, stampAsBuiltFindingIds({
    version: AS_BUILT_VERDICT_CONTRACT_VERSION,
    verdict: 'BLOCKED',
    reachability: [],
    driftNotes: [],
    violations: 'The as-built review found remediable implementation drift.',
    resolution: 'Repair the approved owning tasks.',
    findings: ['8', '9'].map((taskId, index) => ({
      class: 'REMEDIABLE' as const,
      reference: { kind: 'plan-task' as const, taskId },
      summary: `AB-${index + 1}: ${'stamped as-built remediation summary '.repeat(15)}`,
    })),
  }, 'as-built-attempt'), { attemptId: 'as-built-attempt', codeStamp: null, policy });
}

async function expectPreparationFault(
  result: Awaited<ReturnType<typeof buildRemediationProjection>>,
  expected: Record<string, unknown>,
): Promise<void> {
  expect(result).toMatchObject({ ok: false, kind: 'preparation-fault', fault: expected });
  expect(result).not.toHaveProperty('projection');
}

describe('remediation projection', () => {
  // Covers: task:3
  it('projects prior as-built cases and their repair tasks into an as-built gap plan', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'plans', 'active.md'), [
      '# Plan', '',
      '### Task 7: Repair the typed projection', '', '**Done when:**', '- owner repair', '',
      '### Task rem-as-built-t1: Repair the old boundary', '', '**Done when:**', '- repair the first case', '',
      '### Task rem-as-built-t2: Repair the old ADR boundary', '', '**Done when:**', '- repair the second case', '',
    ].join('\n'));
    await Promise.all([writeAsBuiltVerdict(root), writeAsBuiltCases(root)]);

    const result = await buildRemediationProjection(root, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        priorAsBuiltCases: [{
          id: 'case-open', status: 'open', recurrenceCount: 1,
          sources: [{ summary: 'The old boundary remains absent.', reference: { kind: 'plan-task', taskId: '7' }, relation: 'new', reason: 'First observed missing boundary.' }],
          repairTasks: [{ id: 'rem-as-built-t1', resolution: 'pending' }],
        }, {
          id: 'case-resolved', status: 'resolved', recurrenceCount: 2,
          sources: [{ summary: 'The old ADR boundary was incomplete.', reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 2 }, relation: 'recurrence', reason: 'The repaired boundary recurred.' }],
          repairTasks: [{ id: 'rem-as-built-t2', resolution: 'completed' }],
        }],
        tasks: expect.arrayContaining([
          expect.objectContaining({ id: '7' }),
          { id: 'rem-as-built-t1', title: 'Repair the old boundary', doneWhen: ['repair the first case'] },
          { id: 'rem-as-built-t2', title: 'Repair the old ADR boundary', doneWhen: ['repair the second case'] },
        ]),
      },
    });
  });

  // Covers: task:3
  it('keeps prior as-built context scoped to as-built requests and faults instead of truncating it', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'plans', 'active.md'), [
      '# Plan', '',
      '### Task 7: Repair the typed projection', '', '**Done when:**', '- owner repair', '',
      '### Task rem-as-built-t1: Repair the old boundary', '', '**Done when:**', '- repair the first case', '',
      '### Task rem-as-built-t2: Repair the old ADR boundary', '', '**Done when:**', '- repair the second case', '',
    ].join('\n'));
    await Promise.all([writeAsBuiltVerdict(root), writeAsBuiltCases(root)]);

    const asBuilt = await buildRemediationProjection(root, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    }, { priorAsBuiltCasesBytes: 1 });
    await expectPreparationFault(asBuilt, {
      source: 'as-built', dimension: 'prior-as-built-cases', actual: expect.any(Number), limit: 1,
    });
    expect(asBuilt).not.toHaveProperty('projection');

    const prdOnly = await buildRemediationProjection(root, {
      source: 'finish-verification', activePlanPath: '.docs/plans/active.md',
    });
    expect(prdOnly).toMatchObject({ ok: true });
    if (!prdOnly.ok) throw new Error(prdOnly.fault.detail);
    expect(prdOnly.projection).not.toHaveProperty('priorAsBuiltCases');
  });

  // Covers: task:3
  it('fails closed for an undeclared repair task or unreadable as-built case store', async () => {
    const undeclared = await fixture();
    await Promise.all([writeAsBuiltVerdict(undeclared), writeAsBuiltCases(undeclared)]);
    await expectPreparationFault(await buildRemediationProjection(undeclared, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    }), {
      source: 'active plan', dimension: 'prior-as-built-cases', detail: expect.stringContaining('rem-as-built-t1'),
    });

    const corrupt = await fixture();
    await writeAsBuiltVerdict(corrupt);
    await mkdir(join(corrupt, '.pipeline'), { recursive: true });
    await writeFile(join(corrupt, '.pipeline', 'remediation-cases.json'), '{', 'utf8');
    await expectPreparationFault(await buildRemediationProjection(corrupt, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    }), {
      source: 'remediation case store', detail: expect.stringContaining('unreadable'),
    });
  });

  // Covers: task:3
  // Covers: task:8
  it('projects FIXABLE PRD criteria without widening the v1 PRD-only envelope', async () => {
    const root = await fixture();
    await writePrdVerdict(root);

    const result = await buildRemediationProjection(root, {
      source: 'prd-audit',
      activePlanPath: '.docs/plans/active.md',
      attemptRunId: 'prd-attempt',
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        version: REMEDIATION_PROJECTION_VERSION,
        source: 'prd-audit',
        requiredReferences: [{
          kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit', ownerTaskId: '7',
          summary: 'The renderer ignores the durable disposition.',
        }],
        tasks: [{
          id: '7', title: 'Repair the typed projection',
          doneWhen: [
            '[test] The projection receives the criterion.',
            'The task title and completion checks are available.',
          ],
        }],
        vocabulary: {
          dispositions: expect.arrayContaining(['build', 'existing-task', 'halt']),
          haltCategories: expect.arrayContaining(['architectural-clarity', 'product-scope', 'unanswerable']),
        },
      },
    });
    if (!result.ok) throw new Error(result.fault.detail);
    expect(REMEDIATION_PROJECTION_VERSION).toBe(2);
    expect(result.projection).not.toHaveProperty('priorAsBuiltCases');
    expect(JSON.stringify({ ...result.projection, version: 1 })).toBe(
      '{"version":1,"source":"prd-audit","requiredReferences":[{"kind":"prd-criterion","id":"S1.2","sourceGate":"prd_audit","ownerTaskId":"7","summary":"The renderer ignores the durable disposition."}],"evidence":{"excerpts":[],"omittedFiles":[]},"tasks":[{"id":"7","title":"Repair the typed projection","doneWhen":["[test] The projection receives the criterion.","The task title and completion checks are available."]}],"pendingAsBuiltFindings":[],"priorLaps":[],"refusals":[],"vocabulary":{"dispositions":["build","acceptance_specs","architecture_review","plan","publication","existing-task","halt"],"haltCategories":["architectural-clarity","product-scope","unanswerable"]}}',
    );
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-s1-1-2
  it('admits a corpus-scale PRD-audit projection with every criterion and realistic owning task', async () => {
    const root = await fixture();
    await writeRealisticPlan(root);
    const ids = await writeCorpusScalePrdVerdict(root);

    const result = await buildRemediationProjection(root, {
      source: 'prd-audit', activePlanPath: '.docs/plans/active.md', attemptRunId: 'prd-attempt',
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.fault.detail);
    expect(result.projection.requiredReferences.map((reference) => reference.id)).toEqual(ids);
    expect(result.projection.tasks.map((task) => task.id)).toEqual(['10', '11', '8', '9']);
    expect(result.projection.tasks.find((task) => task.id === '8')).toMatchObject({
      title: 'Project typed sources, refusals and explicit absence',
      doneWhen: realisticTaskDoneWhen,
    });
  });

  // Covers: task:8
  it('projects REMEDIABLE as-built findings with pending findings and prior laps', async () => {
    const root = await fixture();
    await writeAsBuiltVerdict(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: { architecture_review_as_built: { count: 1, cumulative: 1, laps: 1, treeHash: null, lastReason: 'prior review', priorVerdict: true, resolvedBefore: 0 } },
      pendingAsBuiltRemediationFindings: [{
        gate: 'architecture_review_as_built', finding: 'as-built:prior:1', class: 'REMEDIABLE',
        governingClause: 'Task 7', reference: { kind: 'plan-task', taskId: '7' },
        summary: 'An earlier finding remains pending.', outcome: 'remediated',
      }],
    }), 'utf8');

    const result = await buildRemediationProjection(root, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        requiredReferences: [{
          kind: 'as-built-finding', id: 'as-built:as-built-attempt:1', sourceGate: 'architecture_review_as_built',
          reference: { kind: 'plan-task', taskId: '7' }, summary: 'The typed boundary is not reached.',
        }],
        pendingAsBuiltFindings: [{ finding: 'as-built:prior:1', summary: 'An earlier finding remains pending.' }],
        priorAsBuiltCases: [],
        priorLaps: [{ gate: 'architecture_review_as_built', laps: 1 }],
      },
    });
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-s1-2-1
  it('admits corpus-scale as-built findings, pending entries, and prior laps', async () => {
    const root = await fixture();
    await writeRealisticPlan(root);
    await writeCorpusScaleAsBuiltVerdict(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const pending = [1, 2, 3].map((index) => ({
      gate: 'architecture_review_as_built',
      finding: `as-built:prior-lap:${index}`,
      class: 'REMEDIABLE',
      governingClause: `Task ${index + 7}`,
      reference: { kind: 'plan-task', taskId: String(index + 7) },
      summary: `Pending AB-${index}: ${'durable stamped remediation history '.repeat(15)}`,
      outcome: 'remediated',
    }));
    await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: {
        architecture_review_as_built: { count: 2, cumulative: 2, laps: 2, treeHash: null, lastReason: 'first lap', priorVerdict: true, resolvedBefore: 0 },
        prd_audit: { count: 3, cumulative: 3, laps: 3, treeHash: null, lastReason: 'second lap', priorVerdict: true, resolvedBefore: 0 },
      },
      pendingAsBuiltRemediationFindings: pending,
    }));

    const result = await buildRemediationProjection(root, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.fault.detail);
    expect(result.projection.requiredReferences).toHaveLength(2);
    expect(result.projection.pendingAsBuiltFindings.map((finding) => finding.finding)).toEqual(
      pending.map((finding) => finding.finding),
    );
    expect(result.projection.priorLaps).toEqual([
      { gate: 'architecture_review_as_built', laps: 2 },
      { gate: 'prd_audit', laps: 3 },
    ]);
  });

  it('admits a fifteen-finding pending as-built set without truncation', async () => {
    const root = await fixture();
    await writeRealisticPlan(root);
    await writeCorpusScaleAsBuiltVerdict(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    // Distinct from the corpus-scale case above: mirrors a halted daemon ledger whose
    // 15 findings (~10 KB) exceeded the former 4 KiB optional-history limit.
    const pending = Array.from({ length: 15 }, (_, index) => ({
      gate: 'architecture_review_as_built',
      finding: `as-built:0ccf593e-94cc-4fc0-832b-4a32c22b0b91:${index + 1}`,
      class: 'REMEDIABLE',
      governingClause: `adr-014-otel-observability-exporter decision ${index + 20}`,
      reference: { kind: 'adr-decision', stem: 'adr-014-otel-observability-exporter', decision: index + 20 },
      summary: `Verified, 99% confidence: finding ${index + 1} ${'cites a source location and the required repair. '.repeat(9)}`,
      outcome: 'remediated',
    }));
    await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: {},
      pendingAsBuiltRemediationFindings: pending,
    }));

    const result = await buildRemediationProjection(root, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    });

    if (!result.ok) throw new Error(result.fault.detail);
    expect(result.projection.pendingAsBuiltFindings.map((finding) => finding.summary)).toEqual(
      pending.map((finding) => finding.summary),
    );
  });

  // Covers: task:15
  it('keeps provider-minted pending rows historical and refuses to account for them', async () => {
    const root = await fixture();
    await writeAsBuiltVerdict(root);
    const legacyFindings = [{
      gate: 'architecture_review_as_built',
      finding: 'ARCH-1',
      class: 'REMEDIABLE',
      governingClause: 'Task 7',
      reference: { kind: 'plan-task', taskId: '7' },
      summary: 'first pre-upgrade repair',
      outcome: 'remediated',
    }, {
      gate: 'architecture_review_as_built',
      finding: 'ARCH-1',
      class: 'REMEDIABLE',
      governingClause: 'Task 7',
      reference: { kind: 'plan-task', taskId: '7' },
      summary: 'second pre-upgrade repair sharing the provider id',
      outcome: 'remediated',
    }];
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: {},
      pendingAsBuiltRemediationFindings: legacyFindings,
    }), 'utf8');

    const result = await buildRemediationProjection(root, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    });
    if (!result.ok) throw new Error(`expected projection, received ${result.fault.detail}`);
    expect(result.projection.requiredReferences).toEqual([expect.objectContaining({
      kind: 'as-built-finding', id: 'as-built:as-built-attempt:1',
    })]);
    expect(result.projection.requiredReferences).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ARCH-1' }),
    ]));
    expect(result.projection.pendingAsBuiltFindings).toEqual([]);

    const currentDisposition = {
      reference: { kind: 'as-built-finding', id: 'as-built:as-built-attempt:1' },
      disposition: 'existing-task',
      category: null,
      rationale: 'The current stamped finding belongs to Task 7.',
      tasks: [],
      boundTaskIds: ['7'],
      reconciliation: { relation: 'new', reason: 'The current finding has no prior case.' },
    };
    expect(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [currentDisposition],
    }, result.projection)).toMatchObject({ kind: 'accepted' });

    expect(validateRemediationPlan({
      version: REMEDIATION_PLAN_CONTRACT_VERSION,
      dispositions: [{ ...currentDisposition, reference: { kind: 'as-built-finding', id: 'ARCH-1' } }],
    }, result.projection)).toMatchObject({
      kind: 'rejected',
      diagnostics: expect.arrayContaining([
        'dispositions[0].reference does not resolve required reference as-built-finding:ARCH-1',
      ]),
    });
    await expect(readPendingAsBuiltRemediationFindings(root)).resolves.toEqual({
      kind: 'ok',
      findings: legacyFindings,
    });
  });

  // Covers: task:8
  it('unions validation-group references and preserves each source label', async () => {
    const root = await fixture();
    await Promise.all([writePrdVerdict(root), writeAsBuiltVerdict(root)]);

    const result = await buildRemediationProjection(root, {
      source: 'validation-group', activePlanPath: '.docs/plans/active.md', attemptRunId: 'prd-attempt',
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        requiredReferences: expect.arrayContaining([
          expect.objectContaining({ kind: 'prd-criterion', id: 'S1.2', sourceGate: 'prd_audit' }),
          expect.objectContaining({ kind: 'as-built-finding', id: 'as-built:as-built-attempt:1', sourceGate: 'architecture_review_as_built' }),
        ]),
      },
    });
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-s1-3-1
  it('keeps the corpus-scale validation-group union under its required-reference bound', async () => {
    const root = await fixture();
    await writeRealisticPlan(root);
    const criterionIds = await writeCorpusScalePrdVerdict(root);
    await writeCorpusScaleAsBuiltVerdict(root);

    const result = await buildRemediationProjection(root, {
      source: 'validation-group', activePlanPath: '.docs/plans/active.md', attemptRunId: 'prd-attempt',
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.fault.detail);
    expect(result.projection.requiredReferences).toHaveLength(criterionIds.length + 2);
    expect(result.projection.requiredReferences).toEqual(expect.arrayContaining([
      ...criterionIds.map((id) => expect.objectContaining({ id, sourceGate: 'prd_audit' })),
      expect.objectContaining({ id: 'as-built:as-built-attempt:1', sourceGate: 'architecture_review_as_built' }),
      expect.objectContaining({ id: 'as-built:as-built-attempt:2', sourceGate: 'architecture_review_as_built' }),
    ]));
    expect(Buffer.byteLength(JSON.stringify(result.projection.requiredReferences), 'utf8'))
      .toBeLessThan(REMEDIATION_PROJECTION_LIMITS.requiredReferencesBytes);
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-s7-1-1
  it('honors a validation-group caller that includes only PRD-audit evidence', async () => {
    const root = await fixture();
    await writePrdVerdict(root);

    const result = await buildRemediationProjection(root, {
      source: 'validation-group',
      includedGates: ['prd_audit'],
      activePlanPath: '.docs/plans/active.md',
      attemptRunId: 'prd-attempt',
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.fault.detail);
    expect(result.projection.requiredReferences).toEqual([
      expect.objectContaining({ kind: 'prd-criterion', sourceGate: 'prd_audit' }),
    ]);
  });

  // Covers: task:8
  it('projects supplied refusal evidence as required refusal references', async () => {
    const root = await fixture();
    await writePrdVerdict(root);

    const result = await buildRemediationProjection(root, {
      source: 'prd-audit', activePlanPath: '.docs/plans/active.md',
      attemptRunId: 'prd-attempt',
      refusals: [{ key: 'S1.3', decisionId: 'decision-42', revision: 3, rationale: 'The change exceeds the approved scope.' }],
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        requiredReferences: expect.arrayContaining([
          { kind: 'refusal', id: 'decision-42', sourceGate: 'refusal-rework', revision: 3, rationale: 'The change exceeds the approved scope.' },
        ]),
        refusals: [{ key: 'S1.3', decisionId: 'decision-42', revision: 3, rationale: 'The change exceeds the approved scope.' }],
      },
    });
  });

  // Covers: task:8
  it('renders absent optional history as explicit empty fields', async () => {
    const root = await fixture();

    const result = await buildRemediationProjection(root, {
      source: 'finish-verification', activePlanPath: '.docs/plans/active.md',
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        requiredReferences: [], pendingAsBuiltFindings: [], priorLaps: [], refusals: [],
      },
    });
  });

  // Covers: task:9
  it('projects the build-stall question by its stall key without fabricating typed references', async () => {
    const root = await fixture();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'build-stall-question.md'), 'Which migration owns this boundary?');

    const result = await buildRemediationProjection(root, {
      source: 'build-stall', activePlanPath: '.docs/plans/active.md', featureDesc: 'Repair build stall evidence',
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        requiredReferences: [],
        evidence: {
          excerpts: [{
            key: 'stall:repair-build-stall-evidence',
            path: '.pipeline/build-stall-question.md',
            content: 'Which migration owns this boundary?',
          }],
          omittedFiles: [],
        },
      },
    });
  });

  // Covers: task:9
  it('projects finish test failures by their test-stem key without fabricating typed references', async () => {
    const root = await fixture();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'test-failures.md'), 'remediation-projection.test.ts failed');

    const result = await buildRemediationProjection(root, {
      source: 'finish-verification', activePlanPath: '.docs/plans/active.md',
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        requiredReferences: [],
        evidence: {
          excerpts: [{
            key: 'test:test-failures',
            path: '.pipeline/test-failures.md',
            content: 'remediation-projection.test.ts failed',
          }],
          omittedFiles: [],
        },
      },
    });
  });

  // Covers: task:rem-as-built-rem-as-built-ab1-1
  it.each([
    ['build-stall', '.pipeline/build-stall-question.md', 'stall:large-stall-evidence', 'large-stall-evidence'],
    ['finish-verification', '.pipeline/test-failures.md', 'test:test-failures', 'large-finish-verification-evidence'],
  ] as const)('keeps a 3 KiB %s evidence excerpt outside structured total accounting', async (
    source,
    path,
    key,
    featureDesc,
  ) => {
    const root = await fixture();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const content = 'e'.repeat(3 * 1024);
    await writeFile(join(root, path), content);

    const result = await buildRemediationProjection(root, {
      source,
      activePlanPath: '.docs/plans/active.md',
      featureDesc,
    });

    expect(result).toMatchObject({
      ok: true,
      projection: { evidence: { excerpts: [{ key, path, content }], omittedFiles: [] } },
    });
  });

  // Covers: task:9
  it('omits over-cap untyped evidence by path and digest while retaining its key', async () => {
    const root = await fixture();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const content = 'x'.repeat(80);
    await writeFile(join(root, '.pipeline', 'test-failures.md'), content);

    const perFileResult = await buildRemediationProjection(root, {
      source: 'finish-verification', activePlanPath: '.docs/plans/active.md',
    }, { perFileHunksBytes: 64, totalDiffBytes: 128 });
    const totalResult = await buildRemediationProjection(root, {
      source: 'finish-verification', activePlanPath: '.docs/plans/active.md',
    }, { perFileHunksBytes: 128, totalDiffBytes: 64 });

    const omitted = {
      key: 'test:test-failures',
      path: '.pipeline/test-failures.md',
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    };
    for (const result of [perFileResult, totalResult]) {
      expect(result).toMatchObject({
        ok: true,
        projection: {
          requiredReferences: [],
          evidence: { excerpts: [], omittedFiles: [omitted] },
        },
      });
    }
  });

  // Covers: task:10
  it('returns preparation faults for missing and unreadable required typed verdicts', async () => {
    const missingPrdRoot = await fixture();
    const unreadableAsBuiltRoot = await fixture();
    await mkdir(join(unreadableAsBuiltRoot, '.pipeline'), { recursive: true });
    await writeFile(join(unreadableAsBuiltRoot, '.pipeline', 'architecture-review-as-built.json'), '{', 'utf8');

    await expectPreparationFault(await buildRemediationProjection(missingPrdRoot, {
      source: 'prd-audit', activePlanPath: '.docs/plans/active.md', attemptRunId: 'prd-attempt',
    }), {
      source: 'prd-audit verdict', detail: expect.stringContaining('missing'),
    });
    await expectPreparationFault(await buildRemediationProjection(unreadableAsBuiltRoot, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    }), {
      source: 'as-built verdict', detail: expect.stringContaining('unreadable'),
    });
  });

  // Covers: task:10
  it('returns a preparation fault for an unsupported typed verdict version', async () => {
    const root = await fixture();
    await writeAsBuiltVerdict(root);
    const path = join(root, '.pipeline', 'architecture-review-as-built.json');
    const persisted = JSON.parse(await readFile(path, 'utf8')) as { verdict: { version: string } };
    persisted.verdict.version = 'unsupported-version';
    await writeFile(path, JSON.stringify(persisted), 'utf8');

    await expectPreparationFault(await buildRemediationProjection(root, {
      source: 'as-built', activePlanPath: '.docs/plans/active.md',
    }), {
      source: 'as-built verdict', detail: expect.stringContaining('unsupported'),
    });
  });

  // Covers: task:rem-as-built-rem-as-built-ab2-1
  it.each([
    ['build-stall', '.pipeline/build-stall-question.md', 'build-stall question'],
    ['finish-verification', '.pipeline/test-failures.md', 'finish test failures'],
  ] as const)('returns a named preparation fault when %s untyped evidence is unreadable', async (source, path, faultSource) => {
    const root = await fixture();
    await mkdir(join(root, path), { recursive: true });

    await expectPreparationFault(await buildRemediationProjection(root, {
      source,
      activePlanPath: '.docs/plans/active.md',
      featureDesc: 'unreadable evidence',
    }), {
      source: faultSource,
      detail: expect.stringContaining(`untyped evidence is unreadable: ${path}`),
    });
  });

  // Covers: task:10, task:rem-prd-audit-rem-prd-audit-s1-1-1
  it('refuses an over-limit required structured dimension without shortening it', async () => {
    const root = await fixture();
    await writePrdVerdict(root);

    const result = await buildRemediationProjection(root, {
      source: 'prd-audit', activePlanPath: '.docs/plans/active.md', attemptRunId: 'prd-attempt',
    }, { requiredReferencesBytes: 1 });
    await expectPreparationFault(result, {
      source: 'prd-audit', dimension: 'required-references', actual: expect.any(Number), limit: 1,
    });
    if (result.ok) throw new Error('expected an over-limit preparation fault');
    expect(result.fault.actual).toBeGreaterThan(result.fault.limit!);
  });

  // Covers: task:10
  it('faults for a corrupt or throwing kickback-ledger read instead of projecting empty history', async () => {
    const corruptRoot = await fixture();
    const throwingRoot = await fixture();
    await mkdir(join(corruptRoot, '.pipeline'), { recursive: true });
    await writeFile(join(corruptRoot, '.pipeline', 'kickback-ledger.json'), '{', 'utf8');

    await expectPreparationFault(await buildRemediationProjection(corruptRoot, {
      source: 'finish-verification', activePlanPath: '.docs/plans/active.md',
    }), {
      source: 'kickback ledger', detail: expect.stringContaining('kickback ledger'),
    });
    await expectPreparationFault(await buildRemediationProjection(throwingRoot, {
      source: 'finish-verification', activePlanPath: '.docs/plans/active.md',
    }, {}, {
      readKickbackLedgerResult: async () => { throw new Error('injected ledger read failure'); },
    }), {
      source: 'kickback ledger', detail: expect.stringContaining('injected ledger read failure'),
    });
  });

});

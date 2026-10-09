import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRemediationProjection,
  REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES,
  REMEDIATION_PROJECTION_ENVELOPE_OVERHEAD_BYTES,
  REMEDIATION_PROJECTION_LIMITS,
  REMEDIATION_PROJECTION_NAMED_BOUND_FLOOR_BYTES,
  REMEDIATION_PROJECTION_OPTIONAL_CONTEXT_FLOOR_BYTES,
  REMEDIATION_PROJECTION_VERSION,
  type RemediationProjectionLimits,
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
import { parsePlanTaskDoneWhen, parsePlanTaskTitles } from '../../src/engine/plan-task-parse.js';

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

async function largestPlanTasksBytes(directory: string): Promise<number> {
  const names = await readdir(directory);
  const sizes = await Promise.all(names.filter((name) => name.endsWith('.md')).map(async (name) => {
    const text = await readFile(join(directory, name), 'utf8');
    const titles = parsePlanTaskTitles(text);
    const doneWhen = parsePlanTaskDoneWhen(text);
    return Buffer.byteLength(JSON.stringify([...titles].map(([id, title]) => ({
      id, title, doneWhen: doneWhen.get(id) ?? [],
    }))), 'utf8');
  }));
  return Math.max(...sizes);
}

async function expectPreparationFault(
  result: Awaited<ReturnType<typeof buildRemediationProjection>>,
  expected: Record<string, unknown>,
): Promise<void> {
  expect(result).toMatchObject({ ok: false, kind: 'preparation-fault', fault: expected });
  expect(result).not.toHaveProperty('projection');
}

function roundUpPowerOfTwo(bytes: number): number {
  let rounded = 1;
  while (rounded < bytes) rounded *= 2;
  return rounded;
}

describe('remediation projection', () => {
  // Covers: task:8
  it('projects FIXABLE PRD criteria, their plan ownership, and engine vocabulary', async () => {
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
  });

  // Covers: rem-prd-audit-s1-1-2
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
        priorLaps: [{ gate: 'architecture_review_as_built', laps: 1 }],
      },
    });
  });

  // Covers: rem-prd-audit-s1-2-1
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

  // Covers: rem-prd-audit-s1-3-1
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

  // Covers: rem-prd-audit-s7-1-1
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

  // Covers: rem-as-built-ab1-1
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

  // Covers: rem-as-built-ab2-1
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

  // Covers: task:10
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

  // Covers: task:10
  it('ships finite corpus-sized structured limits and a total envelope', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const limits: RemediationProjectionLimits = REMEDIATION_PROJECTION_LIMITS;
    expect(limits).toEqual({
      requiredReferencesBytes: expect.any(Number),
      tasksBytes: expect.any(Number),
      pendingAsBuiltFindingsBytes: expect.any(Number),
      priorLapsBytes: expect.any(Number),
      refusalsBytes: expect.any(Number),
      totalBytes: expect.any(Number),
      perFileHunksBytes: expect.any(Number),
      totalDiffBytes: expect.any(Number),
    });
    expect(Object.values(limits).every((limit) => Number.isFinite(limit) && limit > 0)).toBe(true);
    expect(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.tasksBytes).toBe(
      await largestPlanTasksBytes(join(repositoryRoot, '.docs', 'plans')),
    );
    expect(limits.requiredReferencesBytes).toBe(roundUpPowerOfTwo(Math.max(
      REMEDIATION_PROJECTION_NAMED_BOUND_FLOOR_BYTES,
      REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.requiredReferencesBytes,
    )));
    expect(limits.tasksBytes).toBe(roundUpPowerOfTwo(Math.max(
      REMEDIATION_PROJECTION_NAMED_BOUND_FLOOR_BYTES,
      REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.tasksBytes,
    )));
    for (const [limit, measured] of [
      [limits.pendingAsBuiltFindingsBytes, REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.pendingAsBuiltFindingsBytes],
      [limits.priorLapsBytes, REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.priorLapsBytes],
      [limits.refusalsBytes, REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.refusalsBytes],
    ] as const) {
      expect(limit).toBe(roundUpPowerOfTwo(Math.max(REMEDIATION_PROJECTION_OPTIONAL_CONTEXT_FLOOR_BYTES, measured)));
    }
    expect(limits.totalBytes).toBe(roundUpPowerOfTwo(
      limits.requiredReferencesBytes + limits.tasksBytes + limits.pendingAsBuiltFindingsBytes +
      limits.priorLapsBytes + limits.refusalsBytes + REMEDIATION_PROJECTION_ENVELOPE_OVERHEAD_BYTES,
    ));
  });
});

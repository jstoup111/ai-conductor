import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRemediationProjection, REMEDIATION_PROJECTION_VERSION } from '../../src/engine/remediation-projection.js';
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
});

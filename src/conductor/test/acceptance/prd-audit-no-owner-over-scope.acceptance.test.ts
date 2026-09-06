/**
 * Covers: S4.1, S5.1
 *
 * Drives the no-owner finding through the real parser, scope router, operator
 * decision block, durable decision store, and next-lap router. The temporary
 * filesystem is the persistence boundary; no third-party service is used.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, routePrdAuditOverScope, type StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import {
  parseClearedOverScopeDecisions,
  readOverScopeDecisions,
  recordOverScopeDecisions,
  renderOverScopeDecisionBlock,
} from '../../src/engine/accepted-widenings.js';

const SUMMARY = 'unplanned npm test change';

// The Verdict Table's `Plan task` cell is resolved against the ids this text
// declares; the route is handed it so a legitimate citation is not rejected.
const ACTIVE_PLAN = '### Task 1: Planned behavior\n\n**Files:** src/example.ts\n';

function noOwnerReport(): string {
  return [
    '**PRD:** none',
    '',
    '## Verdict Table',
    '| Criterion | Grade | Plan task | Evidence | Intent relation |',
    '| --- | --- | --- | --- | --- |',
    '| S1.1 | PASS | 1 | Planned behavior is present. | within |',
    '',
    '## Findings without an owning criterion',
    '| Finding | Grade | Plan task | Evidence | Intent relation |',
    '| --- | --- | --- | --- | --- |',
    `| NC.1 | OVER_SCOPE | | ${SUMMARY} | outside-visible |`,
  ].join('\n');
}

describe('PRD-audit no-owner OVER_SCOPE decision lifecycle', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('blocks, records an accepted NC decision, and applies it on the identical next lap', async () => {
    root = await mkdtemp(join(tmpdir(), 'prd-audit-no-owner-'));
    const report = noOwnerReport();

    const firstLap = routePrdAuditOverScope(report, [], ACTIVE_PLAN);
    expect(firstLap).toMatchObject({
      kind: 'halt',
      haltClass: 'over-scope',
      undecided: [{ criterion: 'NC.1', summary: SUMMARY, relation: 'outside-visible' }],
    });
    if (firstLap.kind !== 'halt') return;

    const clearedBody = renderOverScopeDecisionBlock(firstLap.undecided)
      .replace('"pending"', '"accept"')
      .replace('"decision": "accept"', '"decision": "accept", "rationale": "Approved."');
    const cleared = parseClearedOverScopeDecisions(clearedBody, new Set(['NC.1']));
    expect(cleared).toMatchObject({
      kind: 'parsed',
      defects: [],
      decisions: [{ criterion: 'NC.1', summary: SUMMARY, decision: 'accept' }],
    });
    if (cleared.kind !== 'parsed') return;

    await expect(recordOverScopeDecisions(
      root,
      cleared.decisions.map((decision) => ({ ...decision, operator: 'acceptance-test' })),
    )).resolves.toMatchObject({
      recorded: [{ criterion: 'NC.1', summary: SUMMARY, decision: 'accept' }],
    });

    const persisted = await readOverScopeDecisions(root);
    expect(persisted.decisions).toEqual([
      expect.objectContaining({ criterion: 'NC.1', summary: SUMMARY, decision: 'accept' }),
    ]);
    expect(routePrdAuditOverScope(report, persisted.decisions, ACTIVE_PLAN)).toMatchObject({
      kind: 'record',
      findings: [{ criterion: 'NC.1', summary: SUMMARY, accepted: true }],
    });
  });
});

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
    await recordOverScopeDecisions(root, [{
      criterion: 'NC.1', summary: SUMMARY, decision: 'accept', rationale: 'Approved.', operator: 'acceptance-test',
    }]);

    let remediateRuns = 0;
    const runner: StepRunner = {
      run: async (step: StepName) => {
        if (step === 'remediate') {
          remediateRuns++;
          await writeFile(join(root!, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'S1.1',
              disposition: 'build',
              category: null,
              rationale: 'Planned behavior is missing.',
              tasks: [{ id: 'rem-s1-1', title: 'Implement the planned behavior' }],
            }],
          }));
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
    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState, steps: typeof ALL_STEPS, context: string,
        source: { source: string; evidence: ReadonlyArray<{ gate: string; evidenceFile: string }> },
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
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

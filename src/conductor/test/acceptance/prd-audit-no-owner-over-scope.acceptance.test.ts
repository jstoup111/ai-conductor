/**
 * Covers: S4.1, S5.1, task:8
 *
 * Drives the no-owner finding through the real parser, scope router, operator
 * decision block, durable decision store, and next-lap router. The temporary
 * filesystem is the persistence boundary; no third-party service is used.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { routePrdAuditOverScope } from '../../src/engine/conductor.js';
import {
  parseClearedOverScopeDecisions,
  readOverScopeDecisions,
  recordOverScopeDecisions,
  renderOverScopeDecisionBlock,
} from '../../src/engine/accepted-widenings.js';

const SUMMARY = 'unplanned npm test change';

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

    const firstLap = routePrdAuditOverScope(report, []);
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
    expect(routePrdAuditOverScope(report, persisted.decisions)).toMatchObject({
      kind: 'record',
      findings: [{ criterion: 'NC.1', summary: SUMMARY, accepted: true }],
    });
  });
});

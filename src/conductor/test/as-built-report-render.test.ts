// Covers: S5.2, S5.3, S5.4 (Task 13) — the rendered report equals the typed fields.
import { describe, expect, it } from 'vitest';

import { renderAsBuiltReport, type PersistedAsBuiltVerdict } from '../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../src/engine/as-built-policy.js';

const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'enabled for every tier' },
  planGap: { enabled: true, reason: 'enabled for every tier' },
  adrCompliance: { enabled: false, reason: 'no approved ADRs' },
  diagramDrift: { enabled: false, reason: 'architecture_review_as_built.checks.diagramDrift.tiers excludes Small' },
};

function persisted(verdict: PersistedAsBuiltVerdict['verdict']): PersistedAsBuiltVerdict {
  return { attemptId: 'attempt-7', codeStamp: 'c0ffee', verdict, policy, recordedFindings: [] };
}

describe('renderAsBuiltReport', () => {
  it('renders every field of two BLOCKED findings plus violation and resolution prose', () => {
    const report = renderAsBuiltReport(persisted({
      version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [
        { id: 'AB-1', class: 'REMEDIABLE', reference: { kind: 'adr-decision', stem: 'adr-2026-09-01-typed-verdict', decision: 3 }, summary: 'report is read as authority' },
        { id: 'AB-2', class: 'DESIGN', reference: { kind: 'plan-task', taskId: '12' }, summary: 'handshake lacks a rejection outcome' },
      ],
      violations: 'The finish path parses the Markdown report.',
      resolution: 'Route every consumer through readAsBuiltVerdict.',
    }));

    expect(report).toContain('Verdict: BLOCKED\n');
    expect(report).toContain('| AB-1 | REMEDIABLE | adr-2026-09-01-typed-verdict decision 3 | report is read as authority |');
    expect(report).toContain('| AB-2 | DESIGN | plan task 12 | handshake lacks a rejection outcome |');
    expect(report).toContain('## Violations\nThe finish path parses the Markdown report.\n');
    expect(report).toContain('## Resolution\nRoute every consumer through readAsBuiltVerdict.\n');
  });

  it('renders reachability chains, drift notes, and the applied check policy for APPROVED', () => {
    const report = renderAsBuiltReport(persisted({
      version: 'v1', verdict: 'APPROVED WITH DRIFT NOTES',
      reachability: [
        { primitive: 'persistAsBuiltVerdict', callerChain: ['bin/conduct', 'step-runners.ts:1160', 'as-built-verdict-store.ts:120'] },
        { primitive: 'readAsBuiltVerdict', callerChain: ['daemon loop', 'artifacts.ts:3378'] },
      ],
      driftNotes: [
        { note: 'diagram omits the report renderer' },
        { note: 'fault path is untested in production', unexercised: { primitive: 'haltForAsBuiltFault', signature: 'no mechanical-fault halt in events.jsonl' } },
      ],
    }));

    expect(report).toContain('Verdict: APPROVED WITH DRIFT NOTES\n');
    expect(report).toContain('## Production reachability\n'
      + '- persistAsBuiltVerdict: bin/conduct -> step-runners.ts:1160 -> as-built-verdict-store.ts:120\n'
      + '- readAsBuiltVerdict: daemon loop -> artifacts.ts:3378\n');
    expect(report).toContain('## Drift notes\n'
      + '- diagram omits the report renderer\n'
      + '- fault path is untested in production (UNEXERCISED haltForAsBuiltFault: no mechanical-fault halt in events.jsonl)\n');
    expect(report).toContain('## Applied check policy\n'
      + '- reachability: on — enabled for every tier\n'
      + '- planGap: on — enabled for every tier\n'
      + '- adrCompliance: off — no approved ADRs\n'
      + '- diagramDrift: off — architecture_review_as_built.checks.diagramDrift.tiers excludes Small\n');
    expect(report).not.toContain('## Blocking Findings');
  });

  it.each([
    [true, 'yes'],
    [false, 'no'],
  ])('renders a PLAN_GAP verdict with outcomeDelivered %s', (outcomeDelivered, rendered) => {
    const report = renderAsBuiltReport(persisted({
      version: 'v1', verdict: 'PLAN_GAP', reachability: [], driftNotes: [],
      outcomeDelivered, affectedOutcome: 'outcome-2: consumers read the typed verdict',
    }));

    expect(report).toContain('Verdict: PLAN_GAP\n');
    expect(report).toContain(`## Plan gap\nOutcome delivered: ${rendered}\nAffected outcome: outcome-2: consumers read the typed verdict\n`);
    expect(report).not.toContain('## Blocking Findings');
  });
});

import { describe, expect, it } from 'vitest';

import { appendRemediationTasks, PRD_AUDIT_REMEDIATION_GATE_SOURCE } from '../../src/engine/remediation-append.js';
import type { CriterionBoundRemediationGap } from '../../src/engine/remediation-append.js';

function gap(id: string, taskId: string, title: string): CriterionBoundRemediationGap {
  return {
    id,
    disposition: 'build',
    category: null,
    rationale: `Finding ${id} is unresolved.`,
    criterion: `Story 1 criterion for ${id}`,
    parentTask: 1,
    tasks: [{ id: taskId, title }],
  };
}

describe('remediation append with findings sharing one task', () => {
  it('returns each appended task id once so the pending repair stays well-formed', () => {
    const result = appendRemediationTasks('# Plan\n', [
      gap('S1.2', 't7-close-paths', 'Cover every close path'),
      gap('S1.3', 't7-close-paths', 'Cover every close path'),
      gap('S1.4', 't4-idempotence', 'Prove idempotence'),
      gap('S1.11', 't7-close-paths', 'Cover every close path'),
    ], PRD_AUDIT_REMEDIATION_GATE_SOURCE);

    expect(result.ids).toEqual(['rem-prd-audit-t7-close-paths', 'rem-prd-audit-t4-idempotence']);
    expect(result.planText.match(/^### Task rem-prd-audit-t7-close-paths:/gm)).toHaveLength(1);
  });
});

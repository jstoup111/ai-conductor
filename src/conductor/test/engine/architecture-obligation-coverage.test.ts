import { describe, expect, it } from 'vitest';
import {
  validateArchitectureObligationCoverage,
} from '../../src/engine/architecture-obligation-coverage.js';

const PLAN = `# Plan

### Task 2: Connect the boundary
**Done when:**
- Requests entering the public adapter exercise the new policy before persistence.
- The boundary-level integration test passes.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-example#D1 | task | task-2 | Requests entering the public adapter exercise the new policy before persistence. |
| adr-example#D2 | existing | — | Existing adapter contract already supplies the required isolation. |
| adr-example#D3 | no-change | none | This constraint documents retained behavior and requires no implementation change. |
`;

describe('validateArchitectureObligationCoverage', () => {
  it('accepts task, existing, and no-change dispositions for every required decision', () => {
    expect(
      validateArchitectureObligationCoverage(
        PLAN,
        new Set(['adr-example#D1', 'adr-example#D2', 'adr-example#D3']),
      ),
    ).toEqual([]);
  });

  it('requires one mapping for every decision and rejects invented or duplicate mappings', () => {
    const plan = PLAN
      .replace('| adr-example#D2 | existing | — | Existing adapter contract already supplies the required isolation. |\n', '')
      .replace(
        '| adr-example#D3 | no-change | none | This constraint documents retained behavior and requires no implementation change. |',
        '| adr-example#D1 | no-change | none | Duplicate. |\n| adr-invented#D9 | no-change | none | Invented. |',
      );

    expect(
      validateArchitectureObligationCoverage(
        plan,
        new Set(['adr-example#D1', 'adr-example#D2', 'adr-example#D3']),
      ),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ decisionId: 'adr-example#D1', reason: 'duplicate' }),
      expect.objectContaining({ decisionId: 'adr-example#D2', reason: 'missing' }),
      expect.objectContaining({ decisionId: 'adr-example#D3', reason: 'missing' }),
      expect.objectContaining({ decisionId: 'adr-invented#D9', reason: 'invented' }),
    ]));
  });

  it('grounds a task disposition in a real task and an exact Done-when fragment', () => {
    const missingTask = PLAN.replace('| task-2 | Requests', '| task-99 | Requests');
    expect(
      validateArchitectureObligationCoverage(
        missingTask,
        new Set(['adr-example#D1', 'adr-example#D2', 'adr-example#D3']),
      ),
    ).toContainEqual(expect.objectContaining({
      decisionId: 'adr-example#D1',
      reason: 'task-missing',
    }));

    const ungrounded = PLAN.replace(
      'Requests entering the public adapter exercise the new policy before persistence. |\n| adr-example#D2',
      'A paraphrase absent from the task Done-when block. |\n| adr-example#D2',
    );
    expect(
      validateArchitectureObligationCoverage(
        ungrounded,
        new Set(['adr-example#D1', 'adr-example#D2', 'adr-example#D3']),
      ),
    ).toContainEqual(expect.objectContaining({
      decisionId: 'adr-example#D1',
      reason: 'evidence-ungrounded',
    }));
  });

  it('rejects an absent table, unknown dispositions, malformed task ids, and tasks on non-task rows', () => {
    expect(
      validateArchitectureObligationCoverage('# Plan\n', new Set(['adr-example#D1'])),
    ).toEqual([
      expect.objectContaining({ decisionId: 'adr-example#D1', reason: 'missing' }),
    ]);

    const malformed = PLAN
      .replace('| adr-example#D1 | task | task-2 |', '| adr-example#D1 | task | 2 |')
      .replace('| adr-example#D2 | existing | — |', '| adr-example#D2 | maybe | — |')
      .replace('| adr-example#D3 | no-change | none |', '| adr-example#D3 | no-change | task-2 |');
    expect(
      validateArchitectureObligationCoverage(
        malformed,
        new Set(['adr-example#D1', 'adr-example#D2', 'adr-example#D3']),
      ),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ decisionId: 'adr-example#D1', reason: 'invalid-task-citation' }),
      expect.objectContaining({ decisionId: 'adr-example#D2', reason: 'invalid-disposition' }),
      expect.objectContaining({ decisionId: 'adr-example#D3', reason: 'unexpected-task' }),
    ]));
  });

  it('does not require a table when the change set has no architecture decisions', () => {
    expect(validateArchitectureObligationCoverage('# Plan\n', new Set())).toEqual([]);
  });
});

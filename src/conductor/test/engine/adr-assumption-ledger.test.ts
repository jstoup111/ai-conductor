// Covers: task:1, S1.1, S1.2, S1.3
import { describe, expect, it } from 'vitest';
import {
  ADR_ASSUMPTION_LEDGER_HEADER,
  parseAdrAssumptionLedger,
} from '../../src/engine/artifacts.js';

const LEDGER_HEADER = '| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |';

describe('parseAdrAssumptionLedger', () => {
  it('accepts a full ledger table with valid A1 and A2 rows', () => {
    const adr = `# ADR: Full ledger

## Assumptions

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| A1 | The parser receives Markdown | verified | 100% | yes | Valid ledgers could be rejected | — |
| A2 | Consumers import the parser | inferred | 80% | no | Callers may need a different API | |
`;

    expect(ADR_ASSUMPTION_LEDGER_HEADER).toBe(LEDGER_HEADER);
    expect(parseAdrAssumptionLedger(adr)).toEqual({ kind: 'ok' });
  });

  it('accepts the explicit no-load-bearing-assumptions statement', () => {
    expect(parseAdrAssumptionLedger(`# ADR: Empty ledger

## Assumptions

No load-bearing assumptions.
`)).toEqual({ kind: 'ok' });
  });

  it('accepts the explicit empty statement followed only by non-load-bearing rows', () => {
    expect(parseAdrAssumptionLedger(`# ADR: Empty ledger with context

## Assumptions

No load-bearing assumptions.

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| A1 | This is supplementary context | verified | 100% | no | The context may not be useful | — |
`)).toEqual({ kind: 'ok' });
  });
});

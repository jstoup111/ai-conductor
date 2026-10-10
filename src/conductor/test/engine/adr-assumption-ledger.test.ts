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

  it('diagnoses a missing assumptions section, including a heading found only in fenced code', () => {
    expect(parseAdrAssumptionLedger('# ADR: No ledger\n')).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'missing-section' }],
    });
    expect(parseAdrAssumptionLedger(`# ADR: Fenced heading

\`\`\`markdown
## Assumptions
\`\`\`
`)).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'missing-section' }],
    });
  });

  it('diagnoses a section with no body before the next section heading', () => {
    expect(parseAdrAssumptionLedger(`# ADR: Empty section

## Assumptions
## Consequences
`)).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'empty-section' }],
    });
  });

  it('diagnoses a ledger header that omits Load-bearing or reorders its columns', () => {
    const missingLoadBearing = '| # | Assumption | Basis | Confidence | Impact if wrong | Approval |';
    const reordered = '| # | Assumption | Basis | Load-bearing | Confidence | Impact if wrong | Approval |';

    for (const header of [missingLoadBearing, reordered]) {
      expect(parseAdrAssumptionLedger(`# ADR: Bad header

## Assumptions

${header}
|---|---|---|---|---|---|---|
| A1 | Parser input | verified | 100% | yes | The gate misreads it | — |
`)).toMatchObject({
        kind: 'diagnostics',
        diagnostics: [{ rule: 'malformed-header' }],
      });
    }
  });

  it('diagnoses an empty statement contradicted by a load-bearing row', () => {
    expect(parseAdrAssumptionLedger(`# ADR: Contradictory ledger

## Assumptions

No load-bearing assumptions.

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| A1 | Parser input | verified | 100% | yes | The gate misreads it | — |
`)).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'contradictory-empty-statement' }],
    });
  });

  it('diagnoses duplicate assumptions headings and names the duplicate', () => {
    const result = parseAdrAssumptionLedger(`# ADR: Duplicate section

## Assumptions

No load-bearing assumptions.

## Assumptions

No load-bearing assumptions.
`);

    expect(result).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'malformed-header' }],
    });
    expect(result.kind === 'diagnostics' && result.diagnostics[0]?.detail).toContain('duplicate');
  });

  it('diagnoses a correct ledger header without data rows', () => {
    expect(parseAdrAssumptionLedger(`# ADR: Header only

## Assumptions

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
`)).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'empty-section' }],
    });
  });
});

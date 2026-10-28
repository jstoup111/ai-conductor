// Covers: task:1, task:3, task:4, S1.1, S1.2, S1.3
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

  it('reports every malformed ledger row by its id', () => {
    const result = parseAdrAssumptionLedger(`# ADR: Malformed rows

## Assumptions

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| A1 | Parser input | guessed | 100% | yes | The gate misreads it | — |
| A2 | Consumer behavior | verified | high | no | Callers may need a different API | — |
| A3 | Output format | inferred | 80% | no | | — |
`);

    expect(result).toEqual({
      kind: 'diagnostics',
      diagnostics: [
        expect.objectContaining({ rule: 'malformed-entry', entryId: 'A1' }),
        expect.objectContaining({ rule: 'malformed-entry', entryId: 'A2' }),
        expect.objectContaining({ rule: 'malformed-entry', entryId: 'A3' }),
      ],
    });
  });

  it('reports a duplicate ledger entry id', () => {
    const result = parseAdrAssumptionLedger(`# ADR: Duplicate entry

## Assumptions

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| A1 | Parser input | verified | 100% | yes | The gate misreads it | — |
| A1 | Consumer behavior | inferred | 80% | no | Callers may need a different API | — |
`);

    expect(result).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'malformed-entry', entryId: 'A1' }],
    });
  });

  it('reports a confidence outside the allowed percentage range by its id', () => {
    const result = parseAdrAssumptionLedger(`# ADR: Invalid confidence

## Assumptions

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| A1 | Parser input | verified | 140% | yes | The gate misreads it | — |
`);

    expect(result).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'malformed-entry', entryId: 'A1' }],
    });
  });

  it('accepts approval only where a load-bearing non-verified row supplies a dated operator marker', () => {
    const result = parseAdrAssumptionLedger(`# ADR: Approved assumptions

## Assumptions

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| A1 | Operator confirmation is recorded | inferred | 80% | yes | An unverified assumption could drive the decision | APPROVED by operator 2026-10-10 |
| A2 | Source inspection established this fact | verified | 100% | yes | The verified premise could be misapplied | — |
| A3 | This non-load-bearing context is incomplete | unverified | 20% | no | The context may be misleading | |
`);

    expect(result).toEqual({ kind: 'ok' });
  });

  it.each([
    ['A2', 'unverified', '—'],
    ['A3', 'inferred', 'PENDING'],
    ['A4', 'inferred', 'APPROVED by operator 2026-02-30'],
    ['A5', 'inferred', 'approved'],
  ])('diagnoses a missing operator approval for %s', (id, basis, approval) => {
    const result = parseAdrAssumptionLedger(`# ADR: Missing approval

## Assumptions

${LEDGER_HEADER}
|---|---|---|---|---|---|---|
| ${id} | This assumption needs approval | ${basis} | 80% | yes | The decision could rest on an unapproved assumption | ${approval} |
`);

    expect(result).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ rule: 'missing-approval', entryId: id }],
    });
  });
});

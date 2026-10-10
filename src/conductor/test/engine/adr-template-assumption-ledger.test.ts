// Covers: task:10
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADR_ASSUMPTION_LEDGER_HEADER,
  parseAdrAssumptionLedger,
} from '../../src/engine/artifacts.js';

const TEMPLATE_PATH = fileURLToPath(
  new URL('../../../../skills/architecture-review/templates/adr.md.template', import.meta.url),
);

function assumptionsSection(template: string): string {
  const match = template.match(/^## Assumptions\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  expect(match, 'template must contain a ## Assumptions section').not.toBeNull();
  return match![1];
}

function firstDifferingColumn(actual: string, expected: string): string {
  const actualColumns = actual.split('|').map((column) => column.trim()).filter(Boolean);
  const expectedColumns = expected.split('|').map((column) => column.trim()).filter(Boolean);
  const index = expectedColumns.findIndex((column, position) => actualColumns[position] !== column);
  return expectedColumns[index === -1 ? actualColumns.length : index] ?? actualColumns[index] ?? 'column count';
}

describe('ADR template assumption ledger', () => {
  it('uses the parser header, with a mismatch that names the first differing column', async () => {
    const section = assumptionsSection(await readFile(TEMPLATE_PATH, 'utf8'));
    const header = section.split('\n').find((line) => line.trim().startsWith('| # |'));

    expect(header, 'template must contain an assumptions ledger table header').toBeDefined();
    expect(
      header?.trim(),
      `ADR assumption ledger header differs at ${firstDifferingColumn(header?.trim() ?? '', ADR_ASSUMPTION_LEDGER_HEADER)}`,
    ).toBe(ADR_ASSUMPTION_LEDGER_HEADER);
  });

  it('shows the no-load-bearing alternative and parses a completed template ledger', async () => {
    const template = await readFile(TEMPLATE_PATH, 'utf8');
    const section = assumptionsSection(template);

    expect(section).toContain('No load-bearing assumptions.');

    const completed = template
      .replace(/\nNo load-bearing assumptions\.\n/, '\n')
      .replace(/^\| A1 \|.*$/m, '| A1 | Parser requirements remain stable | inferred | 90% | yes | A template could drift from the parser | APPROVED by operator 2026-10-10 |');

    expect(parseAdrAssumptionLedger(completed)).toEqual({ kind: 'ok' });
  });

  it('rejects an untouched template ledger placeholder', async () => {
    const template = await readFile(TEMPLATE_PATH, 'utf8');

    expect(parseAdrAssumptionLedger(template)).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [expect.objectContaining({ rule: 'malformed-entry' })],
    });
  });
});

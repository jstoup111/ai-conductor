/**
 * Regression corpus for the retired discovery predicate and the shared
 * coherence parser. Both parser- and discovery-level tests consume this file
 * so their acceptance boundary cannot silently diverge.
 */
export interface CoherenceCorpusFixture {
  slug: string;
  name: string;
  content: string | null;
  oracleAccepted: boolean;
  parserAccepted: boolean;
  discovery: 'eligible' | 'blocked' | 'processed';
}

// Retired discovery predicate, copied verbatim from daemon-backlog.ts before
// the shared parser replaced it. It remains test-only regression evidence.
export function retiredHasCoherenceTableDataRow(content: string | null): boolean {
  if (content === null || content.trim().length === 0) return false;

  const rows = content.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
    return trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
  });

  for (let index = 0; index + 2 < rows.length; index += 1) {
    const header = rows[index];
    const separator = rows[index + 1];
    const data = rows[index + 2];
    if (
      header === null ||
      separator === null ||
      data === null ||
      header.length === 0 ||
      header.length !== separator.length ||
      data.length === 0 ||
      !separator.every((cell) => /^:?-{2,}:?$/.test(cell))
    ) {
      continue;
    }
    return true;
  }

  return false;
}

export const coherenceRegressionCorpus: readonly CoherenceCorpusFixture[] = [
  {
    slug: 'minimal-valid-table',
    name: 'minimal valid table',
    content: `| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:6 | story:2 | covered | fixture |
`,
    oracleAccepted: true,
    parserAccepted: true,
    discovery: 'eligible',
  },
  {
    slug: 'ragged-mixed-rows',
    name: 'ragged mixed legacy and criterion rows',
    content: `| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:6 | story:2 | covered | fixture |
| criterion | Given a fixture | task:6 | covered | fixture | diff-local |
`,
    oracleAccepted: true,
    parserAccepted: true,
    discovery: 'eligible',
  },
  {
    slug: 'five-wide-header-criterion',
    name: 'five-wide header over six-wide separator and criterion row',
    content: `| Row Class | Criterion | Cited Task Ids | Verdict | Quote |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a fixture | task:6 | covered | fixture | diff-local |
`,
    oracleAccepted: false,
    parserAccepted: true,
    discovery: 'eligible',
  },
  {
    slug: 'six-wide-header-legacy',
    name: 'six-wide header over five-wide separator and legacy row',
    content: `| Row Class | Id | Cited Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- |
| task | task:6 | story:2 | covered | fixture |
`,
    oracleAccepted: false,
    parserAccepted: true,
    discovery: 'eligible',
  },
  {
    slug: 'zero-criterion-legacy',
    name: 'zero-criterion legacy artifact',
    content: `| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome:1 | fr:1 | covered | fixture |
| fr | fr:1 | story:2 | covered | fixture |
| story | story:2 | task:6 | covered | fixture |
| task | task:6 | story:2 | covered | fixture |
| adr | adr-2026-08-26-example | task:6 | covered | fixture |
`,
    oracleAccepted: true,
    parserAccepted: true,
    discovery: 'eligible',
  },
  {
    // Real shipped-artifact shape: the retired predicate accepts the first
    // table, while the parser keeps scanning and rejects the later table.
    // Discovery must reach processed dedup before structural parsing.
    slug: 'decide-artifact-coherence-check',
    name: 'shipped second-table artifact',
    content: `| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:6 | story:2 | covered | fixture |

| Decision | Status |
| --- | --- |
| coherence parser | accepted |
`,
    oracleAccepted: true,
    parserAccepted: false,
    discovery: 'processed',
  },
  { slug: 'absent-artifact', name: 'absent artifact', content: null, oracleAccepted: false, parserAccepted: false, discovery: 'blocked' },
  { slug: 'empty-artifact', name: 'empty artifact', content: ' \t\n ', oracleAccepted: false, parserAccepted: false, discovery: 'blocked' },
  { slug: 'table-less-content', name: 'table-less content', content: '# Coherence\n\nNo table here.\n', oracleAccepted: false, parserAccepted: false, discovery: 'blocked' },
];

// Covers: task:1, task:2, task:3, task:4
// Test: direct coherence parser import isolation

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCoherenceArtifact, parsePlanCoverageCriterionRows } from '../../src/engine/coherence-parse.js';
import {
  coherenceRegressionCorpus,
  retiredHasCoherenceTableDataRow,
} from './coherence-corpus.js';

function staticImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/^\s*import(?:[\s\S]*?from\s*)?['"]([^'"]+)['"];?\s*$/gm)].map(
    ([, specifier]) => specifier,
  );
}

function transitiveStaticImports(moduleUrl: URL, visited = new Set<string>()): Array<{ specifier: string; target: URL }> {
  if (visited.has(moduleUrl.href)) return [];
  visited.add(moduleUrl.href);

  const imports = staticImportSpecifiers(readFileSync(moduleUrl, 'utf8'));
  return imports.flatMap((specifier) => {
    const target = specifier.startsWith('.')
      ? new URL(specifier.replace(/\.js$/, '.ts'), moduleUrl)
      : new URL(`file:///external/${specifier}`);
    const edge = { specifier, target };
    if (!specifier.startsWith('.')) return [edge];

    return [edge, ...transitiveStaticImports(target, visited)];
  });
}

describe('parseCoherenceArtifact', () => {
  it('parses a minimal valid coherence table without importing orchestration dependencies', () => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:2 | story:1 | covered | "parser remains isolated" |
`);

    expect(result).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'task',
          id: 'task:2',
          citedIds: ['story:1'],
          verdict: 'covered',
          quote: 'parser remains isolated',
        },
      ],
    });

    const staticImports = transitiveStaticImports(
      new URL('../../src/engine/coherence-parse.ts', import.meta.url),
    );

    for (const disallowed of [
      /(?:^|\/)overlap-scan\.ts$/,
      /(?:^|\/)rebase\.ts$/,
      /(?:^|\/)owner-gate\.ts$/,
      /(?:^|\/)blocker-resolver\.ts$/,
    ]) {
      expect(staticImports.some(({ target }) => disallowed.test(target.pathname))).toBe(false);
    }
    expect(staticImports.some(({ specifier }) => specifier.startsWith('node:fs'))).toBe(false);
    expect(staticImports.some(({ specifier }) => specifier.startsWith('node:child_process'))).toBe(false);
  });

  it('reports the source line and expected criterion width for a five-cell criterion row', () => {
    const result = parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a widget | task:3 | covered | evidence |
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-criterion-row',
      detail: {
        line: 3,
        message: expect.stringContaining('expected 6 and actual 5'),
      },
    });
  });

  it('reports the offending line when a header is not followed by a separator row', () => {
    const result = parseCoherenceArtifact(`introductory prose
| Row Class | Id | Cited Ids | Verdict | Quote |
| task | task:3 | story:3 | covered | evidence |
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: {
        line: 3,
        message: expect.stringContaining('separator row expected'),
      },
    });
  });

  it('reports the source line and token for an unknown data row class', () => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| widget | task:3 | story:3 | covered | evidence |
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: {
        line: 3,
        message: expect.stringContaining('widget'),
      },
    });
  });

  it('rejects an unknown data row class before a trailing separator row', () => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| widget | task:3 | story:3 | covered | evidence |
| --- | --- | --- | --- | --- |
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: {
        line: 3,
        message: expect.stringContaining('unknown coherence row class "widget"'),
      },
    });
  });

  it.each([
    ['verdict', 'probably-covered', 'diff-local'],
    ['disposition', 'covered', 'maybe-local'],
  ] as const)(
    'reports the source line and offending %s token for an invalid criterion value',
    (type, verdict, disposition) => {
      const token = type === 'verdict' ? verdict : disposition;
      const result = parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a widget | task:3 | ${verdict} | evidence | ${disposition} |
`);

      expect(result).toMatchObject({
        ok: false,
        reason: 'unparseable-criterion-row',
        detail: {
          line: 3,
          message: expect.stringContaining(token),
        },
      });
      if (result.ok) return;
      expect(result.detail?.message).toContain(type);
    },
  );

  it.each([
    ['missing', null, 'missing-coherence-artifact'],
    ['empty', ' \t\n ', 'empty-coherence-artifact'],
  ] as const)('does not fabricate structural detail for %s input', (_label, input, reason) => {
    const result = parseCoherenceArtifact(input);

    expect(result).toEqual({ ok: false, reason });
    if (result.ok) return;
    expect(result.detail).toBeUndefined();
  });

  it.each([
    ['empty criterion text', '| criterion |  | task:3 | covered | evidence | diff-local |', 'criterion text must not be empty'],
    ['criterion with no task ids', '| criterion | Given a widget |  | covered | evidence | diff-local |', 'criterion row must cite at least one task id'],
  ] as const)('reports the source line for %s', (_label, row, message) => {
    const result = parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
${row}
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-criterion-row',
      detail: { line: 3, message },
    });
  });

  it('reports the source line and actual width for a malformed legacy row', () => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:3 | story:3 | covered |
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: { line: 3, message: 'legacy row expected 5 and actual 4 cells' },
    });
  });

  it('returns only mapping rows when an ordinary-prose table follows the mapping table', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:1 | story:1 | covered | "mapping evidence" |

| Topic | Notes |
| --- | --- |
| Follow-up | This is ordinary prose in a table. |
`),
    ).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'task',
          id: 'task:1',
          citedIds: ['story:1'],
          verdict: 'covered',
          quote: 'mapping evidence',
        },
      ],
    });
  });

  it('rejects a trailing table whose first row is prose before a stranded task mapping row', () => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:1 | story:1 | covered | "mapping evidence" |

| Topic | Notes | Details | Status | Evidence |
| --- | --- | --- | --- | --- |
| Follow-up | This is ordinary prose. | No mapping. | noted | prose evidence |
| task | task:2 | story:1 | covered | "stranded mapping evidence" |
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: {
        line: 8,
        message: expect.stringContaining(
          'mapping rows must appear in a table whose first data row is a mapping row',
        ),
      },
    });
  });

  it('ignores a trailing table containing only ordinary-prose data rows', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:1 | story:1 | covered | "mapping evidence" |

| Topic | Notes |
| --- | --- |
| Follow-up | This is ordinary prose in a table. |
| Next step | This is more ordinary prose in a table. |
`),
    ).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'task',
          id: 'task:1',
          citedIds: ['story:1'],
          verdict: 'covered',
          quote: 'mapping evidence',
        },
      ],
    });
  });

  it('preserves mapping rows separated by a blank-line paragraph', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:1 | story:1 | covered | "first mapping evidence" |

This paragraph explains the mappings below.

| task | task:2 | story:2 | covered | "second mapping evidence" |
`),
    ).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'task',
          id: 'task:1',
          citedIds: ['story:1'],
          verdict: 'covered',
          quote: 'first mapping evidence',
        },
        {
          rowClass: 'task',
          id: 'task:2',
          citedIds: ['story:2'],
          verdict: 'covered',
          quote: 'second mapping evidence',
        },
      ],
    });
  });

  it('preserves a story mapping table followed by a valid task mapping table', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| story | story:1 | outcome:1 | covered | "story mapping evidence" |

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:2 | story:1 | covered | "task mapping evidence" |
`),
    ).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'story',
          id: 'story:1',
          citedIds: ['outcome:1'],
          verdict: 'covered',
          quote: 'story mapping evidence',
        },
        {
          rowClass: 'task',
          id: 'task:2',
          citedIds: ['story:1'],
          verdict: 'covered',
          quote: 'task mapping evidence',
        },
      ],
    });
  });

  it('reports the second data-row width in a later task mapping table', () => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| story | story:1 | outcome:1 | covered | "story mapping evidence" |

| Mapping kind | Mapping id | Cited ids | Status | Evidence |
| --- | --- | --- | --- | --- |
| task | task:2 | story:1 | covered | "first task mapping evidence" |
| task | task:3 | story:1 | covered |
`);

    expect(result).toEqual({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: { line: 8, message: 'legacy row expected 5 and actual 4 cells' },
    });
  });

  it.each([
    ['id', '| task |  | story:3 | covered | evidence |', 'legacy row has empty id'],
    ['verdict', '| task | task:3 | story:3 |  | evidence |', 'legacy row has empty verdict'],
  ] as const)('reports the source line for an empty legacy %s', (_field, row, message) => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
${row}
`);

    expect(result).toMatchObject({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: { line: 3, message },
    });
  });

  // Covers: task:4, task:6
  it('preserves legacy acceptances and pins the widened shared-parser corpus boundary', () => {
    const observations = coherenceRegressionCorpus.map((fixture) => ({
      ...fixture,
      oracleAccepted: retiredHasCoherenceTableDataRow(fixture.content),
      parserAccepted: parseCoherenceArtifact(fixture.content).ok,
    }));

    expect(observations).toEqual(coherenceRegressionCorpus);
    expect(
      observations
        .filter(({ oracleAccepted, parserAccepted }) => oracleAccepted && !parserAccepted)
        .map(({ slug }) => slug),
    ).toEqual([]);
    expect(observations
      .filter(({ oracleAccepted, parserAccepted }) => !oracleAccepted && parserAccepted)
      .map(({ name }) => name),
    ).toEqual([
      'five-wide header over six-wide separator and criterion row',
      'six-wide header over five-wide separator and legacy row',
    ]);

    expect(observations.filter(({ parserAccepted }) => parserAccepted).map(({ name }) => name)).toEqual([
      'minimal valid table',
      'ragged mixed legacy and criterion rows',
      'five-wide header over six-wide separator and criterion row',
      'six-wide header over five-wide separator and legacy row',
      'zero-criterion legacy artifact',
      'shipped second-table artifact',
      'two mapping tables',
    ]);

    const twoMappingTables = coherenceRegressionCorpus.find(({ slug }) => slug === 'two-mapping-tables');
    if (twoMappingTables?.content === undefined || twoMappingTables.content === null) {
      throw new Error('missing two-mapping-tables corpus fixture');
    }
    expect(parseCoherenceArtifact(twoMappingTables.content)).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'story',
          id: 'story:1',
          citedIds: ['outcome:1'],
          verdict: 'covered',
          quote: 'fixture',
        },
        {
          rowClass: 'task',
          id: 'task:2',
          citedIds: ['story:1'],
          verdict: 'covered',
          quote: 'fixture',
        },
      ],
    });
  });
});

describe('parsePlanCoverageCriterionRows', () => {
  it('parses a four-cell Coverage Check row into the shared criterion claim shape', () => {
    expect(
      parsePlanCoverageCriterionRows(`## Coverage Check

| Criterion | Tasks | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 2 happy: Given a plan, when it is parsed, then it yields a claim | 4 | "that quote" | diff-local |
`),
    ).toEqual([
      {
        rowClass: 'criterion',
        criterion: 'Story 2 happy: Given a plan, when it is parsed, then it yields a claim',
        citedIds: ['4'],
        verdict: 'covered',
        quote: 'that quote',
        disposition: 'diff-local',
      },
    ]);
  });

  it('does not return a legacy two-cell story-to-task row', () => {
    expect(
      parsePlanCoverageCriterionRows(`## Coverage Check

| Story | Tasks |
| --- | --- |
| 2 | 4, 5 |
`),
    ).toEqual([]);
  });

  it('returns only four-cell criterion rows from a mixed Coverage Check table', () => {
    expect(
      parsePlanCoverageCriterionRows(`## Coverage Check

| Story | Tasks | Quote | Disposition |
| --- | --- | --- | --- |
| 2 | 4, 5 |
| Story 2 happy: Given a plan, when it is parsed, then it yields a claim | 4 | “quoted evidence” | diff-local |
`),
    ).toEqual([
      {
        rowClass: 'criterion',
        criterion: 'Story 2 happy: Given a plan, when it is parsed, then it yields a claim',
        citedIds: ['4'],
        verdict: 'covered',
        quote: 'quoted evidence',
        disposition: 'diff-local',
      },
    ]);
  });

  it('returns no rows when the plan has no Coverage Check section', () => {
    expect(parsePlanCoverageCriterionRows('## Tasks\n\n### Task 1\n')).toEqual([]);
  });

  it('preserves empty citation segments for the shared resolver to reject', () => {
    const planRows = parsePlanCoverageCriterionRows(`## Coverage Check

| Criterion | Tasks | Done when quote | Disposition |
| --- | --- | --- | --- |
| Criterion | 4, , 5 | "quote" | diff-local |
`);
    expect(planRows[0]?.citedIds).toEqual(['4', '', '5']);

    const coherence = parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Criterion | task-4, , task-5 | covered | quote | diff-local |
`);
    expect(coherence).toMatchObject({ ok: true, rows: [{ citedIds: ['task-4', '', 'task-5'] }] });
  });
});

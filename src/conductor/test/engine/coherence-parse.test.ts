// Covers: task:2, task:3
// Test: direct coherence parser import isolation

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCoherenceArtifact } from '../../src/engine/coherence-parse.js';
import {
  coherenceRegressionCorpus,
  retiredHasCoherenceTableDataRow,
} from './coherence-corpus.js';

function staticImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/^\s*import(?:[\s\S]*?from\s*)?['"]([^'"]+)['"];?\s*$/gm)].map(
    ([, specifier]) => specifier,
  );
}

function transitiveStaticImports(moduleUrl: URL, visited = new Set<string>()): Array<{ source: URL; specifier: string }> {
  if (visited.has(moduleUrl.href)) return [];
  visited.add(moduleUrl.href);

  const imports = staticImportSpecifiers(readFileSync(moduleUrl, 'utf8'));
  return imports.flatMap((specifier) => {
    const edge = { source: moduleUrl, specifier };
    if (!specifier.startsWith('.')) return [edge];

    const dependencyUrl = new URL(specifier.replace(/\.js$/, '.ts'), moduleUrl);
    return [edge, ...transitiveStaticImports(dependencyUrl, visited)];
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
      expect(staticImports.some(({ source }) => disallowed.test(source.pathname))).toBe(false);
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

  // Covers: task:6
  it('preserves legacy acceptances and enumerates only shared-parser acceptance expansions', () => {
    const observations = coherenceRegressionCorpus.map((fixture) => ({
      ...fixture,
      oracleAccepted: retiredHasCoherenceTableDataRow(fixture.content),
      parserAccepted: parseCoherenceArtifact(fixture.content).ok,
    }));

    expect(observations).toEqual(coherenceRegressionCorpus);
    expect(observations.filter(({ oracleAccepted, parserAccepted, discovery }) => oracleAccepted && !parserAccepted && discovery !== 'processed')).toEqual([]);
    expect(observations
      .filter(({ oracleAccepted, parserAccepted }) => !oracleAccepted && parserAccepted)
      .map(({ name }) => name),
    ).toEqual([
      'five-wide header over six-wide separator and criterion row',
      'six-wide header over five-wide separator and legacy row',
    ]);
  });
});

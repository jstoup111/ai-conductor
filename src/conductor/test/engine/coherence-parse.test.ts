// Covers: task:2, task:3
// Test: direct coherence parser import isolation

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCoherenceArtifact } from '../../src/engine/coherence-parse.js';

// Retired discovery predicate, copied verbatim from daemon-backlog.ts before
// Task 5. It is deliberately test-local: the shared parser is the production
// authority, while this preserves the old acceptance set as a regression oracle.
function retiredHasCoherenceTableDataRow(content: string | null): boolean {
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

  // Covers: task:6
  it('preserves legacy acceptances and enumerates only shared-parser acceptance expansions', () => {
    const corpus = [
      {
        name: 'minimal valid table',
        content: `| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:6 | story:2 | covered | fixture |
`,
        oracleAccepted: true,
        parserAccepted: true,
      },
      {
        name: 'ragged mixed legacy and criterion rows',
        content: `| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| task | task:6 | story:2 | covered | fixture |
| criterion | Given a fixture | task:6 | covered | fixture | diff-local |
`,
        oracleAccepted: true,
        parserAccepted: true,
      },
      {
        name: 'five-wide header over six-wide separator and criterion row',
        content: `| Row Class | Criterion | Cited Task Ids | Verdict | Quote |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a fixture | task:6 | covered | fixture | diff-local |
`,
        oracleAccepted: false,
        parserAccepted: true,
      },
      {
        name: 'six-wide header over five-wide separator and legacy row',
        content: `| Row Class | Id | Cited Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- |
| task | task:6 | story:2 | covered | fixture |
`,
        oracleAccepted: false,
        parserAccepted: true,
      },
      {
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
      },
      { name: 'absent artifact', content: null, oracleAccepted: false, parserAccepted: false },
      { name: 'empty artifact', content: ' \t\n ', oracleAccepted: false, parserAccepted: false },
      { name: 'table-less content', content: '# Coherence\n\nNo table here.\n', oracleAccepted: false, parserAccepted: false },
    ] as const;

    const observations = corpus.map((fixture) => ({
      ...fixture,
      oracleAccepted: retiredHasCoherenceTableDataRow(fixture.content),
      parserAccepted: parseCoherenceArtifact(fixture.content).ok,
    }));

    expect(observations).toEqual(corpus);
    expect(observations.filter(({ oracleAccepted, parserAccepted }) => oracleAccepted && !parserAccepted)).toEqual([]);
    expect(observations
      .filter(({ oracleAccepted, parserAccepted }) => !oracleAccepted && parserAccepted)
      .map(({ name }) => name),
    ).toEqual([
      'five-wide header over six-wide separator and criterion row',
      'six-wide header over five-wide separator and legacy row',
    ]);
  });
});

// Covers: task:2, task:3
// Test: direct coherence parser import isolation

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCoherenceArtifact } from '../../src/engine/coherence-parse.js';

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

    const source = readFileSync(new URL('../../src/engine/coherence-parse.ts', import.meta.url), 'utf8');
    const staticImports = [...source.matchAll(/^\s*import(?:[\s\S]*?from\s*)?['"]([^'"]+)['"];?\s*$/gm)].map(
      ([, specifier]) => specifier,
    );

    for (const disallowed of [
      /(?:^|\/)overlap-scan(?:\.js)?$/,
      /(?:^|\/)rebase(?:\.js)?$/,
      /(?:^|\/)owner-gate(?:\.js)?$/,
      /(?:^|\/)blocker-resolver(?:\.js)?$/,
      /^node:fs$/,
      /^node:child_process$/,
    ]) {
      expect(staticImports.some((specifier) => disallowed.test(specifier))).toBe(false);
    }
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
});

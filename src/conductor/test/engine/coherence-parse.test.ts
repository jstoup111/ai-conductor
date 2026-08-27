// Covers: task:2
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
});

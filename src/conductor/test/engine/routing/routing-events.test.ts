// Covers: rem-prd-audit-W10
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_ROOT = join(import.meta.dirname, '../../../src');
const CANONICAL_ROUTING_EVENTS_MODULE = 'engine/routing/routing-events.ts';

type SourceFile = {
  path: string;
  source: string;
};

function collectSourceFiles(directory: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push({ path: relative(SOURCE_ROOT, path).split('\\').join('/'), source: readFileSync(path, 'utf8') });
    }
  }
  return files;
}

const ROUTING_EVENT_LITERAL = /\{\s*type\s*:\s*['"](?:remediation_routed|routed_repair_phase)['"]\s*(?=[,}])/;

function routingEventLiteralViolations(files: readonly SourceFile[]): string[] {
  return files
    .filter(({ path, source }) => path !== CANONICAL_ROUTING_EVENTS_MODULE && ROUTING_EVENT_LITERAL.test(source))
    .map(({ path }) => path)
    .sort();
}

describe('routing event constructors', () => {
  it('permits the canonical module and unrelated event syntax', () => {
    expect(routingEventLiteralViolations([
      { path: CANONICAL_ROUTING_EVENTS_MODULE, source: "return { type: 'remediation_routed' };" },
      { path: 'engine/other.ts', source: "const type = 'routed_repair_phase';" },
      { path: 'types/events.ts', source: "type Event = { type: 'remediation_routed'; };" },
    ])).toEqual([]);
  });

  it('reports the file that introduces a routed event literal outside the canonical module', () => {
    expect(routingEventLiteralViolations([
      { path: 'engine/other.ts', source: "return { type: 'routed_repair_phase' };" },
      { path: 'engine/another.ts', source: "return { type: 'remediation_routed' };" },
    ])).toEqual(['engine/another.ts', 'engine/other.ts']);
  });

  it('keeps routed event literals confined to routing-events.ts in source', () => {
    expect(routingEventLiteralViolations(collectSourceFiles(SOURCE_ROOT))).toEqual([]);
  });
});

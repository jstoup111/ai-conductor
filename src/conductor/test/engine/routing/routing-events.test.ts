// Covers: task:rem-prd-audit-W10, task:1
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseChildId } from '../../../src/engine/child-context.js';
import { routingRoundSupersededEvent } from '../../../src/engine/routing/routing-events.js';
import { parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';

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
  it('creates an identified supersession occurrence for the lowest dropped host', () => {
    const event = routingRoundSupersededEvent(
      { roundId: parseRoundId('r4')! } as RouteRecord,
      parseRoundId('r5')!,
      [parseChildId(2)!],
      ['finding-2'],
      'stale audit round',
      'operator@example.test',
    );

    expect(event).toMatchObject({
      type: 'routing_round_superseded', roundId: 'r4', supersededBy: 'r5',
      droppedHosts: [2], child: 2, findingIds: ['finding-2'],
      reason: 'stale audit round', operator: 'operator@example.test',
    });
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.eventId).not.toHaveLength(0);
    expect(event.occurredAt).toEqual(expect.any(String));
    expect(event.occurredAt).not.toHaveLength(0);
    expect(Number.isFinite(event.child)).toBe(true);
    expect(event.droppedHosts).toContain(event.child);
  });

  // Covers: task:11
  it('uses the current host when supersession drops no hosts', () => {
    const record = {
      roundId: parseRoundId('r2')!,
      hosts: { [parseChildId(1)!]: 'restacked', [parseChildId(2)!]: 'restacked' },
      currentHostIndex: 1,
    } as RouteRecord;

    const noDrops = routingRoundSupersededEvent(
      record,
      parseRoundId('r3')!,
      [],
      [],
      'already restacked',
      'operator@example.test',
    );
    const dropped = routingRoundSupersededEvent(
      record,
      parseRoundId('r3')!,
      [parseChildId(2)!, parseChildId(3)!],
      [],
      'pending hosts',
      'operator@example.test',
    );

    expect(noDrops).toMatchObject({ droppedHosts: [], child: parseChildId(2)! });
    expect(dropped).toMatchObject({ droppedHosts: [2, 3], child: parseChildId(2)! });
  });

  it('uses the lowest dropped host while preserving an unsorted dropped-host list', () => {
    const droppedHosts = [parseChildId(3)!, parseChildId(2)!, parseChildId(4)!];
    const event = routingRoundSupersededEvent(
      { roundId: parseRoundId('r4')! } as RouteRecord,
      parseRoundId('r5')!,
      droppedHosts,
      ['finding-3', 'finding-2', 'finding-4'],
      'stale audit round',
      'operator@example.test',
    );

    expect(event).toMatchObject({ droppedHosts: [3, 2, 4], child: parseChildId(2)! });
  });

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

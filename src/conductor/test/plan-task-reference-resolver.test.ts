// Covers: task:1, task:2
import { describe, expect, it } from 'vitest';
import { normalizePlanTaskId, resolvePlanTaskReference } from '../src/engine/plan-task-parse.js';

describe('resolvePlanTaskReference', () => {
  it('resolves a numeric plan task id', () => {
    expect(resolvePlanTaskReference('4', new Set(['4']))).toEqual({ kind: 'resolved', ids: ['4'] });
  });

  it('resolves a hyphenated remediation task id', () => {
    expect(resolvePlanTaskReference(
      'rem-prd-audit-rem-s1-6-1',
      new Set(['rem-prd-audit-rem-s1-6-1']),
    )).toEqual({ kind: 'resolved', ids: ['rem-prd-audit-rem-s1-6-1'] });
  });

  it('strips one trailing parenthesized annotation before resolving', () => {
    expect(resolvePlanTaskReference(
      'rem-as-built-rem-ab1-2 (landed)',
      new Set(['rem-as-built-rem-ab1-2']),
    )).toEqual({ kind: 'resolved', ids: ['rem-as-built-rem-ab1-2'] });
  });

  it('returns an unresolvable result for an absent plan task id', () => {
    expect(resolvePlanTaskReference(
      'rem-test-9-9',
      new Set(['1']),
    )).toEqual({ kind: 'unresolvable', ids: ['rem-test-9-9'] });
  });

  it('returns a malformed result for a task id outside the shared grammar', () => {
    expect(resolvePlanTaskReference('task#7', new Set())).toEqual({ kind: 'malformed', raw: 'task#7' });
  });

  it('does not treat trailing prose as a parenthesized annotation', () => {
    expect(resolvePlanTaskReference(
      '7 landed extra words',
      new Set(['7']),
    )).toEqual({ kind: 'malformed', raw: '7 landed extra words' });
  });

  // A criterion's evidence legitimately spans more than one plan task. The
  // single-id form made the honest citation unrepresentable, so an auditor
  // writing the truth had its row rejected as malformed.
  it('resolves a comma-separated citation to every id it names, in order', () => {
    expect(resolvePlanTaskReference('12, 13', new Set(['12', '13'])))
      .toEqual({ kind: 'resolved', ids: ['12', '13'] });
  });

  it('resolves a mixed numeric and remediation citation', () => {
    expect(resolvePlanTaskReference(
      '1, 2, rem-as-built-rem-ab1-2',
      new Set(['1', '2', 'rem-as-built-rem-ab1-2']),
    )).toEqual({ kind: 'resolved', ids: ['1', '2', 'rem-as-built-rem-ab1-2'] });
  });

  it('strips a trailing annotation from each id in a list', () => {
    expect(resolvePlanTaskReference('12 (landed), 13', new Set(['12', '13'])))
      .toEqual({ kind: 'resolved', ids: ['12', '13'] });
  });

  it('reports every absent id in a list, not only the first', () => {
    expect(resolvePlanTaskReference('12, 98, 99', new Set(['12'])))
      .toEqual({ kind: 'unresolvable', ids: ['98', '99'] });
  });

  it('rejects the whole citation when any segment is outside the grammar', () => {
    expect(resolvePlanTaskReference('12, task#7', new Set(['12'])))
      .toEqual({ kind: 'malformed', raw: '12, task#7' });
  });

  it('rejects an empty segment rather than silently dropping it', () => {
    expect(resolvePlanTaskReference('12, , 13', new Set(['12', '13'])))
      .toEqual({ kind: 'malformed', raw: '12, , 13' });
    expect(resolvePlanTaskReference('12,', new Set(['12'])))
      .toEqual({ kind: 'malformed', raw: '12,' });
  });

  it('collapses a repeated id rather than citing it twice', () => {
    expect(resolvePlanTaskReference('12, 12', new Set(['12'])))
      .toEqual({ kind: 'resolved', ids: ['12'] });
  });
});

describe('normalizePlanTaskId', () => {
  // The resolver strips a tolerated trailing annotation before it looks the id
  // up, so every caller that builds a lookup set must normalize the same way.
  // The set itself always comes from the ACTIVE PLAN — never from the citation
  // under judgement, which would let any grammar-valid id resolve against
  // itself (adr-2026-08-30-shared-plan-task-reference-resolver D1).
  it('strips a trailing annotation', () => {
    expect(normalizePlanTaskId('rem-prd-audit-rem-s1-6-1 (landed)')).toBe('rem-prd-audit-rem-s1-6-1');
  });

  it('leaves an unannotated id untouched', () => {
    expect(normalizePlanTaskId('  4  ')).toBe('4');
  });

  it('normalizes the citation to the bare id the active plan declares', () => {
    const activePlanTaskIds = new Set(['1', 'rem-as-built-rem-ab1-2']);
    expect(resolvePlanTaskReference('rem-as-built-rem-ab1-2 (landed)', activePlanTaskIds))
      .toEqual({ kind: 'resolved', ids: ['rem-as-built-rem-ab1-2'] });
    expect(resolvePlanTaskReference('rem-as-built-rem-ab1-9 (landed)', activePlanTaskIds))
      .toEqual({ kind: 'unresolvable', ids: ['rem-as-built-rem-ab1-9'] });
  });
});

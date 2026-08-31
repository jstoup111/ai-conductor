// Covers: task:1, task:2
import { describe, expect, it } from 'vitest';
import { normalizePlanTaskId, resolvePlanTaskReference } from '../src/engine/plan-task-parse.js';

describe('resolvePlanTaskReference', () => {
  it('resolves a numeric plan task id', () => {
    expect(resolvePlanTaskReference('4', new Set(['4']))).toEqual({ kind: 'resolved', id: '4' });
  });

  it('resolves a hyphenated remediation task id', () => {
    expect(resolvePlanTaskReference(
      'rem-prd-audit-rem-s1-6-1',
      new Set(['rem-prd-audit-rem-s1-6-1']),
    )).toEqual({ kind: 'resolved', id: 'rem-prd-audit-rem-s1-6-1' });
  });

  it('strips one trailing parenthesized annotation before resolving', () => {
    expect(resolvePlanTaskReference(
      'rem-as-built-rem-ab1-2 (landed)',
      new Set(['rem-as-built-rem-ab1-2']),
    )).toEqual({ kind: 'resolved', id: 'rem-as-built-rem-ab1-2' });
  });

  it('returns an unresolvable result for an absent plan task id', () => {
    expect(resolvePlanTaskReference(
      'rem-test-9-9',
      new Set(['1']),
    )).toEqual({ kind: 'unresolvable', id: 'rem-test-9-9' });
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
});

describe('normalizePlanTaskId', () => {
  // The prd_audit gate scorer calls the parser with no active plan and falls
  // back to a set built from the RAW cell. The resolver strips a trailing
  // annotation before lookup, so a fallback holding the annotated string could
  // never match its own citation — every annotated `rem-` row was rejected on
  // the one path that produces the halt this feature exists to end. Both sides
  // share this normalization now.
  it('strips a trailing annotation', () => {
    expect(normalizePlanTaskId('rem-prd-audit-rem-s1-6-1 (landed)')).toBe('rem-prd-audit-rem-s1-6-1');
  });

  it('leaves an unannotated id untouched', () => {
    expect(normalizePlanTaskId('  4  ')).toBe('4');
  });

  it('agrees with the resolver, so a set built from it always matches', () => {
    const raw = 'rem-as-built-rem-ab1-2 (landed)';
    expect(resolvePlanTaskReference(raw, new Set([normalizePlanTaskId(raw)])))
      .toEqual({ kind: 'resolved', id: 'rem-as-built-rem-ab1-2' });
  });
});

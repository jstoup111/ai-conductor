// Covers: task:1
import { describe, expect, it } from 'vitest';
import { resolvePlanTaskReference } from '../src/engine/plan-task-parse.js';

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
});

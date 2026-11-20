// Covers: task:14
import { describe, expect, it } from 'vitest';

import { classifyBuildStallStaleCitation } from '../../src/engine/build-stall-stale-citation.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { RemediationCaseRecord, RemediationCaseStoreReadResult, RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'stale-citation' } as const;
const child3 = parseChildId(3)!;
const child4 = parseChildId(4)!;

function record(id: string, resolution: RemediationCaseRecord['resolution']): RemediationCaseRecord {
  return {
    id,
    domain: 'build_review',
    disposition: 'act',
    priority: 'high',
    rationale: 'The test fixture supplies a durable case.',
    confidence: 'high',
    resolution,
    sources: [{ sourceId: `testQuality:${id}`, outcome: 'acted', recordedAt: '2026-11-19T00:00:00.000Z' }],
    effect: { id: `effect-${id}`, kind: 'action', status: 'applied', workOrderId: `order-${id}` },
  };
}

function readable(...cases: readonly RemediationCaseRecord[]): RemediationCaseStoreReadResult {
  const state: RemediationCaseStoreState = {
    version: 'v4',
    feature: FEATURE,
    cases,
    prdWideningCases: [],
    asBuiltCases: [],
    suppressions: [],
    outbox: [],
  };
  return { ok: true, state };
}

function classify(question: string | null | undefined, stores: ReadonlyMap<number, RemediationCaseStoreReadResult>) {
  return classifyBuildStallStaleCitation({
    question,
    activeChild: child3,
    caseStores: new Map([...stores].map(([child, result]) => [parseChildId(child)!, result])),
  });
}

describe('build-stall stale-citation classifier', () => {
  it('classifies a case resolved in another child as stale', () => {
    expect(classify('Please repair case-resolved before retrying BUILD.', new Map([
      [3, readable()],
      [4, readable(record('case-resolved', 'resolved'))],
    ]))).toEqual({ kind: 'stale', caseId: 'case-resolved', ownerChild: child4, state: 'resolved' });
  });

  it('classifies a case open only in another child as a foreign stale citation', () => {
    expect(classify('Please repair case-foreign before retrying BUILD.', new Map([
      [3, readable()],
      [4, readable(record('case-foreign', 'open'))],
    ]))).toEqual({ kind: 'stale', caseId: 'case-foreign', ownerChild: child4, state: 'foreign' });
  });

  it('does not classify active, absent, null, or empty citations as stale', () => {
    const activeStore = new Map([[3, readable(record('case-active', 'open'))], [4, readable()]]);

    expect(classify('Please repair case-active before retrying BUILD.', activeStore)).toEqual({ kind: 'not-stale' });
    expect(classify('Please repair an unknown case before retrying BUILD.', activeStore)).toEqual({ kind: 'not-stale' });
    expect(classify(null, activeStore)).toEqual({ kind: 'not-stale' });
    expect(classify('', activeStore)).toEqual({ kind: 'not-stale' });
  });

  it('does not classify a citation when any child case store is unreadable', () => {
    expect(classify('Please repair case-resolved before retrying BUILD.', new Map([
      [3, readable()],
      [4, readable(record('case-resolved', 'resolved'))],
      [5, { ok: false, reason: 'unreadable' }],
    ]))).toEqual({ kind: 'not-stale' });
  });

  it('does not classify a mixed citation that names an open active-child case', () => {
    expect(classify('Please repair case-resolved and case-active before retrying BUILD.', new Map([
      [3, readable(record('case-active', 'open'))],
      [4, readable(record('case-resolved', 'resolved'))],
    ]))).toEqual({ kind: 'not-stale' });
  });
});

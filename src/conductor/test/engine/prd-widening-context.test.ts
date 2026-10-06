// Covers: task:11, task:12
import { describe, expect, it } from 'vitest';
import { buildPrdWideningContext, prdWideningSourceId, PRD_WIDENING_CONTEXT_LIMITS } from '../../src/engine/prd-widening-context.js';
import type { AcceptedWideningDecision } from '../../src/engine/accepted-widenings.js';
import type { PrdAuditFinding } from '../../src/engine/artifacts.js';
import type { RemediationCasePrdWideningRecord } from '../../src/engine/remediation-case-store.js';

describe('PRD widening context', () => {
  const report = (findings: PrdAuditFinding[]) => ({ prd: 'present' as const, findings, rejectedRows: [] });
  const finding = { criterion: 'NC.1', grade: 'OVER_SCOPE' as const, evidence: 'A new externally visible behavior.', prdIds: [] };
  const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');
  const wideningCase = (overrides: Partial<RemediationCasePrdWideningRecord> = {}): RemediationCasePrdWideningRecord => ({
    id: 'case-1',
    domain: 'prd_widening',
    originalSources: [{ sourceId: 'original-1', snapshot: 'Original widening evidence.' }],
    currentSources: [{ sourceId: 'current-1', snapshot: 'Current widening evidence.', recordedAt: '2026-09-09T00:00:00.000Z' }],
    relationships: [{ currentSourceId: 'current-1', kind: 'same-case', caseId: 'case-1', reason: 'The evidence describes the same behavior.' }],
    ...overrides,
  });
  const decision = (overrides: Partial<AcceptedWideningDecision> = {}): AcceptedWideningDecision => ({
    id: 'decision-1', criterion: 'NC.1', authority: 'accept', rationale: 'The operator accepts this widening.', operator: 'operator', revision: 1,
    originalSource: { id: 'original-1', snapshot: 'Original widening evidence.' }, originalCaseId: 'case-1', offerEntryId: 'offer-1',
    ...overrides,
  });

  it('projects every current NC source and preserves independent case history', () => {
    const result = buildPrdWideningContext(report([finding, { ...finding, criterion: 'S1.1' }]), [], []);
    expect(result).toMatchObject({ ok: true, value: { currentSources: [{ id: prdWideningSourceId(finding) }] } });
  });

  it('binds identity to a parsed occurrence rather than the displayed NC ordinal', () => {
    const original = { ...finding, evidence: 'The first NC.1 names a public export.' };
    const later = { ...finding, evidence: 'A later NC.1 names a different public import.' };
    expect(prdWideningSourceId(original)).not.toBe(prdWideningSourceId(later));
    expect(buildPrdWideningContext(report([original]), [], [])).toMatchObject({
      ok: true, value: { currentSources: [{ id: prdWideningSourceId(original) }] },
    });
  });

  it('retains migrated criterion authority without making it an NC matching subject', () => {
    const criterionCase = wideningCase({ id: 'criterion-case' });
    const result = buildPrdWideningContext(report([finding]), [criterionCase], [
      decision({ criterion: 'S1.1', originalCaseId: 'criterion-case' }),
    ]);
    expect(result).toMatchObject({ ok: true, value: { cases: [], decisions: [] } });
  });


  it('rejects byte and count overflow without truncating the projected history', () => {
    const rows = Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.currentSources + 1 }, (_, index) => ({ ...finding, criterion: `NC.${index + 1}` }));
    expect(buildPrdWideningContext(report(rows), [], [])).toMatchObject({ ok: false, dimension: 'currentSources' });
    expect(buildPrdWideningContext(report([{ ...finding, evidence: '界'.repeat(PRD_WIDENING_CONTEXT_LIMITS.proseBytes) }]), [], [])).toMatchObject({ ok: false, dimension: 'proseBytes' });
  });

  it('rejects every retained-history field that exceeds its count or UTF-8 byte budget', () => {
    const referenceOverflow = '界'.repeat(86);
    const proseOverflow = '界'.repeat(2_667);
    const links = Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.sourceLinksPerCase + 1 }, (_, index) => ({ sourceId: `original-${index}`, snapshot: 'evidence' }));
    const candidates = Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.pointersPerSource + 1 }, (_, index) => `case-${index}`);
    const caseOverflow = Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.cases + 1 }, (_, index) => wideningCase({ id: `case-${index}` }));

    expect(buildPrdWideningContext(report([]), caseOverflow, [])).toMatchObject({
      ok: false, dimension: 'cases', actual: 129, limit: 128,
    });
    expect(buildPrdWideningContext(report([]), [wideningCase({ originalSources: links, currentSources: [], relationships: [] })], [])).toMatchObject({
      ok: false, dimension: 'sourceLinksPerCase', actual: 513, limit: 512,
    });
    expect(buildPrdWideningContext(report([]), [wideningCase({
      relationships: [{ currentSourceId: 'current-1', kind: 'uncertain', candidateCaseIds: candidates, reason: 'Need more evidence.' }],
    })], [])).toMatchObject({ ok: false, dimension: 'pointersPerSource', actual: 65, limit: 64 });

    expect(buildPrdWideningContext(report([]), [wideningCase({ id: referenceOverflow })], [])).toMatchObject({
      ok: false, dimension: 'referenceBytes', actual: bytes(referenceOverflow), limit: 256,
    });
    expect(buildPrdWideningContext(report([]), [wideningCase({
      currentSources: [{ sourceId: referenceOverflow, snapshot: 'Current widening evidence.', recordedAt: '2026-09-09T00:00:00.000Z' }],
    })], [])).toMatchObject({ ok: false, dimension: 'referenceBytes', actual: bytes(referenceOverflow), limit: 256 });
    expect(buildPrdWideningContext(report([]), [wideningCase({ originalSources: [{ sourceId: 'original-1', snapshot: proseOverflow }] })], [])).toMatchObject({
      ok: false, dimension: 'proseBytes', actual: bytes(proseOverflow), limit: 8_000,
    });
    expect(buildPrdWideningContext(report([]), [wideningCase({
      currentSources: [{ sourceId: 'current-1', snapshot: proseOverflow, recordedAt: '2026-09-09T00:00:00.000Z' }],
    })], [])).toMatchObject({ ok: false, dimension: 'proseBytes', actual: bytes(proseOverflow), limit: 8_000 });
    expect(buildPrdWideningContext(report([]), [wideningCase({
      relationships: [{ currentSourceId: 'current-1', kind: 'same-case', caseId: 'case-1', reason: proseOverflow }],
    })], [])).toMatchObject({ ok: false, dimension: 'proseBytes', actual: bytes(proseOverflow), limit: 8_000 });
    expect(buildPrdWideningContext(report([]), [wideningCase({
      relationships: [{ currentSourceId: 'current-1', kind: 'uncertain', candidateCaseIds: [referenceOverflow], reason: 'Need more evidence.' }],
    })], [])).toMatchObject({ ok: false, dimension: 'referenceBytes', actual: bytes(referenceOverflow), limit: 256 });
    expect(buildPrdWideningContext(report([]), [], [decision({ rationale: proseOverflow })])).toMatchObject({
      ok: false, dimension: 'proseBytes', actual: bytes(proseOverflow), limit: 8_000,
    });
    expect(buildPrdWideningContext(report([{ ...finding, prdIds: Array.from({ length: 65 }, (_, index) => `FR-${index}`) }]), [], [])).toMatchObject({
      ok: false, dimension: 'pointersPerSource', actual: 65, limit: 64,
    });
  });

  it('accepts exact limits, including a total serialized projection at 128 KiB', () => {
    const exactSources = Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.currentSources }, (_, index) => ({ ...finding, criterion: `NC.${index + 1}` }));
    const exactCase = wideningCase({
      originalSources: Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.sourceLinksPerCase }, (_, index) => ({ sourceId: `source-${index}`, snapshot: 'evidence' })),
      currentSources: [], relationships: [],
    });
    const exactPointers = wideningCase({
      relationships: [{ currentSourceId: 'current-1', kind: 'uncertain', candidateCaseIds: Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.pointersPerSource }, (_, index) => `case-${index}`), reason: 'Need more evidence.' }],
    });

    expect(buildPrdWideningContext(report(exactSources), [], [])).toMatchObject({ ok: true });
    expect(buildPrdWideningContext(report([]), Array.from({ length: PRD_WIDENING_CONTEXT_LIMITS.cases }, (_, index) => wideningCase({ id: `case-${index}` })), [])).toMatchObject({ ok: true });
    expect(buildPrdWideningContext(report([]), [exactCase], [])).toMatchObject({ ok: true });
    expect(buildPrdWideningContext(report([]), [exactPointers], [])).toMatchObject({ ok: true });
    expect(buildPrdWideningContext(report([{ ...finding, evidence: 'a'.repeat(PRD_WIDENING_CONTEXT_LIMITS.proseBytes) }]), [wideningCase({ id: 'a'.repeat(256) })], [decision({ rationale: 'a'.repeat(PRD_WIDENING_CONTEXT_LIMITS.proseBytes) })])).toMatchObject({ ok: true });

    const nearLimitSources = Array.from({ length: 16 }, (_, index) => ({ ...finding, criterion: `NC.${index + 1}`, evidence: 'a'.repeat(8_000) }));
    const nearLimit = buildPrdWideningContext(report(nearLimitSources), [], []);
    expect(nearLimit).toMatchObject({ ok: true });
    if (!nearLimit.ok) throw new Error('Expected a projection below the total limit.');
    const { digest: _digest, ...serializable } = nearLimit.value;
    const paddedSource = { ...finding, criterion: 'NC.17', evidence: '' };
    const serializedWithEmptyPadding = JSON.stringify({ ...serializable, currentSources: [...serializable.currentSources, { ...paddedSource, id: prdWideningSourceId(paddedSource) }] });
    const paddingBytes = PRD_WIDENING_CONTEXT_LIMITS.totalBytes - bytes(serializedWithEmptyPadding);
    expect(paddingBytes).toBeGreaterThan(0);
    expect(paddingBytes).toBeLessThanOrEqual(PRD_WIDENING_CONTEXT_LIMITS.proseBytes);
    const exactTotal = buildPrdWideningContext(report([...nearLimitSources, { ...paddedSource, evidence: 'a'.repeat(paddingBytes) }]), [], []);
    expect(exactTotal).toMatchObject({ ok: true });
    if (!exactTotal.ok) throw new Error('Expected an exactly bounded serialized projection.');
    const { digest: _exactDigest, ...exactSerializable } = exactTotal.value;
    expect(bytes(JSON.stringify(exactSerializable))).toBe(PRD_WIDENING_CONTEXT_LIMITS.totalBytes);

    const totalOverflow = buildPrdWideningContext(report(Array.from({ length: 17 }, (_, index) => ({
      ...finding, criterion: `NC.${index + 1}`, evidence: 'a'.repeat(PRD_WIDENING_CONTEXT_LIMITS.proseBytes),
    }))), [], []);
    expect(totalOverflow).toMatchObject({ ok: false, dimension: 'totalBytes', limit: PRD_WIDENING_CONTEXT_LIMITS.totalBytes });
    if (!totalOverflow.ok) expect(totalOverflow.actual).toBeGreaterThan(totalOverflow.limit);
  });
});

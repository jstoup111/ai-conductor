// Covers: task:1, task:2, task:24
import { describe, expect, it } from 'vitest';
import {
  PRD_WIDENING_CAPTURE_DEFECT_RECOVERY,
  PRD_WIDENING_MIGRATION_FAILURE_RECOVERY,
  renderPrdAuditProjectionHalt,
  renderPrdAuditScopeHalt,
  renderPrdWideningRecovery,
} from '../../src/engine/prd-widening-recovery.js';
import type { PrdWideningCaptureDefectKind } from '../../src/engine/prd-widening-capture.js';

const CAPTURE_DEFECT_KINDS: Record<PrdWideningCaptureDefectKind, true> = {
  'malformed-block': true,
  'malformed-entry': true,
  'changed-offer-reference': true,
  'duplicate-offer-entry': true,
  'invalid-decision': true,
  'missing-rationale': true,
  'missing-operator': true,
  'offer-read-failed': true,
  'write-failed': true,
  'unsupported-legacy-clear': true,
  'unknown-criterion': true,
  'offered-set-unavailable': true,
};

describe('renderPrdWideningRecovery', () => {
  it('maps every capture defect away from malformed history', () => {
    expect(Object.keys(PRD_WIDENING_CAPTURE_DEFECT_RECOVERY).sort()).toEqual(Object.keys(CAPTURE_DEFECT_KINDS).sort());

    for (const kind of Object.keys(CAPTURE_DEFECT_KINDS) as PrdWideningCaptureDefectKind[]) {
      expect(PRD_WIDENING_CAPTURE_DEFECT_RECOVERY[kind]).not.toBe('malformed-history');
    }
  });

  it('classifies every widening-history migration failure precisely', () => {
    expect(PRD_WIDENING_MIGRATION_FAILURE_RECOVERY).toEqual({
      'corrupt-history': 'malformed-history',
      'unknown-history-version': 'unsupported-history',
      'unsupported-history': 'unsupported-history',
      'unsupported-legacy-row': 'unsupported-history',
      'foreign-feature-history': 'foreign-feature',
      'unreadable-legacy': 'persistence-failed',
      'case-write-failed': 'persistence-failed',
      'decision-write-failed': 'persistence-failed',
    });
  });

  it.each([
    [
      'changed-offer-reference',
      ['NC-2'],
      /correct that entry against the latest halt or leave its decision pending before clearing again/i,
    ],
    ['missing-rationale', ['S3.17'], /rationale.*entry/i],
    ['duplicate-decision-entry', ['S3.17'], /keep one entry per criterion/i],
    ['unreadable-decision-block', [], /repair the block's JSON before clearing again/i],
    ['offered-set-unavailable', ['S3.17'], /leave the named entry pending so the next audit offers it again/i],
  ] as const)('uses the %s action without treating a cleared-block defect as history damage', (reason, affected, action) => {
    const recovery = renderPrdWideningRecovery(reason, affected);

    for (const criterion of affected) {
      expect(recovery).toContain(criterion);
    }
    expect(recovery).toMatch(action);
    expect(recovery).not.toMatch(/malformed-history/i);
    expect(recovery).not.toMatch(/known-good copy/i);
    expect(recovery).not.toMatch(/restore the original \.pipeline widening history/i);
  });

  it('keeps a readable malformed entry named in recovery', () => {
    const recovery = renderPrdWideningRecovery('unreadable-decision-entry', ['NC-1']);
    expect(recovery).toContain('NC-1');
    expect(recovery).not.toContain('no specific record');
  });

  it('keeps the reason, bounded record references, and actionable recovery together', () => {
    expect(renderPrdWideningRecovery('stale-relation', ['source-1', 'case-1'])).toContain('affected source-1, case-1');
    expect(renderPrdWideningRecovery('stale-relation', ['source-1'])).toContain('re-run reconciliation');
  });

  it('renders one typed recovery envelope for each PRD halt exit', () => {
    const detail = renderPrdWideningRecovery('stale-relation', ['prd-audit:NC.1', 'case-1']);

    expect(renderPrdAuditScopeHalt(detail, 'decision block')).toBe(
      `prd-audit halted: user-visible scope requires operator acceptance — ${detail}\n\ndecision block`,
    );
    expect(renderPrdAuditProjectionHalt('write failed', ['prd-audit:NC.1'])).toContain(
      'PRD widening recovery (projection-failed): affected prd-audit:NC.1',
    );
  });

  it.each([
    ['malformed-history', 'restore the original .pipeline widening history'],
    ['unsupported-history', 'upgrade with a supported conductor version'],
    ['missing-operator', 'configure the machine owner'],
    ['persistence-failed', 'resolve the store or lease failure'],
    ['invalid-provider-result', 'supports the required native output schema'],
    ['stale-relation', 're-run reconciliation'],
    ['context-overflow', 'no history was pruned'],
    ['projection-failed', 'without re-deciding valid authority'],
    ['uncertain-relation', 'submit a new explicit decision'],
  ] as const)('names the %s recovery action', (reason, action) => {
    expect(renderPrdWideningRecovery(reason, ['prd-audit:NC.1'])).toContain(action);
  });

  it('directs an unapplicable decision to correction or an inert pending entry without storage-failure wording', () => {
    const recovery = renderPrdWideningRecovery('invalid-decision', ['case-1']);

    expect(recovery).toContain('affected case-1');
    expect(recovery).toContain('correct');
    expect(recovery).toContain('pending');
    expect(recovery).toContain('prior decision');
    expect(recovery).not.toMatch(/store or lease failure/i);
  });
});

// Covers: task:24
import { describe, expect, it } from 'vitest';
import {
  renderPrdAuditProjectionHalt,
  renderPrdAuditScopeHalt,
  renderPrdWideningRecovery,
} from '../../src/engine/prd-widening-recovery.js';

describe('renderPrdWideningRecovery', () => {
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
});

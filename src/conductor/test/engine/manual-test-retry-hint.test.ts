// Covers: task:3
import { describe, expect, it } from 'vitest';

import { buildRetryHint } from '../../src/engine/remediation-hints.js';

describe('buildRetryHint manual_test recording guidance', () => {
  it('shows record commands without a pipeline directory for a missing results file', () => {
    const hint = buildRetryHint(
      'manual_test',
      '.pipeline/manual-test-results.md is missing — record per-story PASS/FAIL results before exiting',
    );

    expect(hint).toContain('ai-conductor manual-test-record --results <path>');
    expect(hint).toContain('ai-conductor manual-test-record --skip --reason <r>');
    expect(hint).not.toContain('--pipeline-dir');
  });

  it('keeps the generic hint when the completion miss is not a missing results file', () => {
    const reason = '.pipeline/manual-test-results.md contains FAIL rows';

    expect(buildRetryHint('manual_test', reason))
      .toBe(`Previous attempt did not satisfy the completion check: ${reason}. Finish the work now.`);
  });
});

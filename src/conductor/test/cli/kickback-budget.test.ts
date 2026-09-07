// Covers: task:11
import { describe, expect, it } from 'vitest';

import { detectKickbackBudgetCommand } from '../../src/cli.js';

describe('detectKickbackBudgetCommand', () => {
  it('accepts the three supported command shapes', () => {
    expect(detectKickbackBudgetCommand(['node', 'conduct', 'kickback-budget', 'inspect', '--feature', 'feature', '--format', 'json']))
      .toEqual({ kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' });
    expect(detectKickbackBudgetCommand(['node', 'conduct', 'kickback-budget', 'raise', '--feature', 'feature', '--gate', 'build_review', '--by', '2', '--rationale', 'evidence']))
      .toMatchObject({ action: 'raise', feature: 'feature', gate: 'build_review', by: 2, rationale: 'evidence' });
    expect(detectKickbackBudgetCommand(['node', 'conduct', 'kickback-budget', 'reset', '--feature', 'feature', '--gate', 'prd_audit', '--rationale', 'fresh review']))
      .toMatchObject({ action: 'reset', feature: 'feature', gate: 'prd_audit', rationale: 'fresh review' });
  });

  it.each([
    ['unknown action', ['node', 'conduct', 'kickback-budget', 'drop', '--feature', 'feature']],
    ['path-like feature', ['node', 'conduct', 'kickback-budget', 'inspect', '--feature', '../feature']],
    ['zero raise', ['node', 'conduct', 'kickback-budget', 'raise', '--feature', 'feature', '--gate', 'build_review', '--by', '0', '--rationale', 'why']],
    ['fractional raise', ['node', 'conduct', 'kickback-budget', 'raise', '--feature', 'feature', '--gate', 'build_review', '--by', '1.5', '--rationale', 'why']],
    ['empty rationale', ['node', 'conduct', 'kickback-budget', 'reset', '--feature', 'feature', '--gate', 'build_review', '--rationale', '  ']],
  ])('rejects %s', (_name, argv) => {
    expect(detectKickbackBudgetCommand(argv)).toBeNull();
  });
});

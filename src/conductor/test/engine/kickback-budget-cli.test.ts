// Covers: task:9

import { describe, expect, it } from 'vitest';
import { detectKickbackBudgetCommand } from '../../src/cli.js';

const argv = (...arguments_: string[]) => ['node', 'conduct', 'kickback-budget', ...arguments_];

describe('detectKickbackBudgetCommand', () => {
  it('parses human and JSON budget inspection requests', () => {
    expect(detectKickbackBudgetCommand(argv('inspect', '--feature', 'recovery'))).toEqual({
      kind: 'inspect', feature: 'recovery', format: 'human',
    });
    expect(detectKickbackBudgetCommand(argv('inspect', '--feature', 'recovery', '--format', 'human'))).toEqual({
      kind: 'inspect', feature: 'recovery', format: 'human',
    });
    expect(detectKickbackBudgetCommand(argv('inspect', '--feature', 'recovery', '--format', 'json'))).toEqual({
      kind: 'inspect', feature: 'recovery', format: 'json',
    });
  });

  it('parses reset and raise requests with bounded rationales', () => {
    expect(detectKickbackBudgetCommand(argv(
      'reset', '--feature', 'recovery', '--rationale', 'The prior review episode is obsolete.',
    ))).toEqual({
      kind: 'reset', feature: 'recovery', rationale: 'The prior review episode is obsolete.',
    });
    expect(detectKickbackBudgetCommand(argv(
      'raise', '--feature', 'recovery', '--amount', '3', '--rationale', 'Need three more reviewed attempts.',
    ))).toEqual({
      kind: 'raise', feature: 'recovery', amount: 3, rationale: 'Need three more reviewed attempts.',
    });
  });

  it.each([
    ['unknown inspection format', argv('inspect', '--feature', 'recovery', '--format', 'yaml')],
    ['missing inspection feature', argv('inspect')],
    ['missing reset feature', argv('reset', '--rationale', 'reason')],
    ['blank rationale', argv('reset', '--feature', 'recovery', '--rationale', '   ')],
    ['over-limit rationale', argv('reset', '--feature', 'recovery', '--rationale', 'x'.repeat(1001))],
    ['zero amount', argv('raise', '--feature', 'recovery', '--amount', '0', '--rationale', 'reason')],
    ['negative amount', argv('raise', '--feature', 'recovery', '--amount', '-1', '--rationale', 'reason')],
    ['fractional amount', argv('raise', '--feature', 'recovery', '--amount', '1.5', '--rationale', 'reason')],
    ['non-numeric amount', argv('raise', '--feature', 'recovery', '--amount', 'three', '--rationale', 'reason')],
    ['unsafe amount', argv('raise', '--feature', 'recovery', '--amount', '9007199254740992', '--rationale', 'reason')],
  ])('rejects %s before any command can be dispatched', (_case_, command) => {
    expect(detectKickbackBudgetCommand(command)).toBeNull();
  });
});

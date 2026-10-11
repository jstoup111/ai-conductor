// Covers: task:2
import { describe, expect, it } from 'vitest';
import { assertAcceptedByCli } from './remediation-commands.test.js';
import {
  formatOrphanedStateResetHint,
  formatOrphanedWorktreeMissing,
  formatRecoveryDeclinedInstructions,
  formatShipEvidenceGapInstructions,
} from '../src/remediation-guidance.js';

const BARE_FORM = /ai-conductor (--reset|--status|--fresh|")/;

/** Extracts whole, backtick-free ai-conductor command lines from guidance. */
function extractedCommands(text: string): string[] {
  return [...text.matchAll(/^.*?(ai-conductor inline(?: --(?:reset|status|fresh))?(?: "[^"]*")?)(?=\s+(?:to|from|and)|[,.]|$)/gm)]
    .map((match) => match[1]);
}

function expectOnlyAcceptedCommands(text: string): void {
  const commands = extractedCommands(text);
  expect(commands).not.toEqual([]);
  expect(text).not.toMatch(BARE_FORM);
  for (const command of commands) {
    expect(command).not.toContain('`');
    expect(() => assertAcceptedByCli(command)).not.toThrow();
  }
}

describe('remediation guidance', () => {
  it('formats the orphaned-state reset hint with an accepted inline reset command', () => {
    const text = formatOrphanedStateResetHint('/repo/.pipeline/conduct-state.json');

    expect(text).toContain('ai-conductor inline --reset');
    expectOnlyAcceptedCommands(text);
  });

  it('formats the orphaned-worktree recovery option with an accepted inline reset command', () => {
    const text = formatOrphanedWorktreeMissing({
      featureDesc: 'feat x',
      stateFilePath: '/repo/.pipeline/conduct-state.json',
      expectedLocations: ['/repo/.worktrees/feat-x', '/repo/.claude/worktrees/feat-x'],
    });

    expect(text).toContain('2) Run ai-conductor inline --reset from this directory');
    expectOnlyAcceptedCommands(text);
  });

  it('formats SHIP-evidence recovery commands with and without a feature', () => {
    const withFeature = formatShipEvidenceGapInstructions('feat x');
    const withoutFeature = formatShipEvidenceGapInstructions();

    expect(withFeature).toContain('ai-conductor inline "feat x"');
    expect(withFeature).toContain('ai-conductor inline --status');
    expect(withoutFeature).toContain('ai-conductor inline');
    expect(withoutFeature).not.toContain('""');
    expectOnlyAcceptedCommands(withFeature);
    expectOnlyAcceptedCommands(withoutFeature);
  });

  it('formats declined-recovery commands with and without a feature', () => {
    const withFeature = formatRecoveryDeclinedInstructions('feat x');
    const withoutFeature = formatRecoveryDeclinedInstructions();

    expect(withFeature).toContain('ai-conductor inline --status');
    expect(withFeature).toContain('ai-conductor inline --fresh "feat x"');
    expect(withoutFeature).toContain('ai-conductor inline --fresh');
    expect(withoutFeature).not.toContain('""');
    expectOnlyAcceptedCommands(withFeature);
    expectOnlyAcceptedCommands(withoutFeature);
  });
});

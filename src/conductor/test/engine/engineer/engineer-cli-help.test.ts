// #524: `engineer <subcommand> --help` must short-circuit to a help descriptor
// BEFORE the subcommand's own dispatch logic runs — otherwise the flag is
// silently ignored and the (potentially mutating) subcommand actually executes.
// Mirrors the `daemon --help` guard in src/index.ts:378-388.

import { describe, it, expect } from 'vitest';
import { detectEngineerCommand } from '../../../src/engine/engineer-cli.js';

// Helper: build argv arrays for testing
// detectEngineerCommand reads process.argv offsets: [node, entry, 'engineer', sub, ...].
const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];

const SUBCOMMANDS = [
  'projects',
  'worktree',
  'land',
  'handoff',
  'poll',
  'claim',
  'forget',
  'resolve',
  'migrate-issue-deps',
];

describe('detectEngineerCommand: --help/-h short-circuits every subcommand', () => {
  for (const sub of SUBCOMMANDS) {
    it(`\`engineer ${sub} --help\` returns {kind:'help', topic:'${sub}'} (not the subcommand's own kind)`, () => {
      const result = detectEngineerCommand(argv(sub, '--help'));
      expect(result).toEqual({ kind: 'help', topic: sub });
      expect(result).not.toEqual(expect.objectContaining({ kind: sub }));
    });

    it(`\`engineer ${sub} -h\` returns {kind:'help', topic:'${sub}'}`, () => {
      const result = detectEngineerCommand(argv(sub, '-h'));
      expect(result).toEqual({ kind: 'help', topic: sub });
    });
  }

  it('--help anywhere in argv (not just immediately after the subcommand) is caught', () => {
    const result = detectEngineerCommand(argv('land', '--project', 'x', '--help'));
    expect(result).toEqual({ kind: 'help', topic: 'land' });
  });

  it('exact issue repro: `engineer claim --help` does NOT execute the claim dispatch', () => {
    const result = detectEngineerCommand(argv('claim', '--help'));
    expect(result).toEqual({ kind: 'help', topic: 'claim' });
    expect(result).not.toEqual({ kind: 'claim' });
  });

  it('regression guard: bare `engineer --help` (no subcommand token) still returns {kind:"guide"}', () => {
    const result = detectEngineerCommand(argv('--help'));
    expect(result).toEqual({ kind: 'guide' });
  });
});

// #524: `engineer <subcommand> --help` must short-circuit to a help descriptor
// BEFORE the subcommand's own dispatch logic runs — otherwise the flag is
// silently ignored and the (potentially mutating) subcommand actually executes.
// Mirrors the `daemon --help` guard in src/index.ts:378-388.

import { describe, it, expect } from 'vitest';
import {
  detectEngineerCommand,
  dispatchEngineer,
  ENGINEER_SUBCOMMANDS,
  SUBCOMMAND_HELP,
} from '../../../src/engine/engineer-cli.js';

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

describe('dispatchEngineer: {kind:"help"} renders text with zero side effects (#524)', () => {
  function captureOut() {
    const out: string[] = [];
    const err: string[] = [];
    const opts = (extra: Partial<Parameters<typeof dispatchEngineer>[1]>): Parameters<typeof dispatchEngineer>[1] => ({
      print: (s) => out.push(s),
      printErr: (s) => err.push(s),
      ...extra,
    });
    return { out, err, opts };
  }

  for (const sub of SUBCOMMANDS) {
    it(`\`engineer ${sub} --help\` prints one line mentioning '${sub}' and touches nothing`, async () => {
      const { out, err, opts } = captureOut();
      let ghCalled = false;
      const gh = async (): Promise<{ stdout: string }> => {
        ghCalled = true;
        throw new Error(`gh must not be called for help topic '${sub}'`);
      };
      const code = await dispatchEngineer(
        { kind: 'help', topic: sub },
        opts({
          gh,
          engineerDir: `/tmp/engineer-cli-help-${Math.random().toString(36).slice(2)}/nope`,
        }),
      );
      expect(code).toBe(0);
      expect(out.length).toBe(1);
      expect(out[0]).toContain(sub);
      expect(ghCalled).toBe(false);
      expect(err.length).toBe(0);
    });
  }

  it('`claim` help text explicitly mentions what it mutates', async () => {
    const { out, opts } = captureOut();
    await dispatchEngineer({ kind: 'help', topic: 'claim' }, opts({}));
    const text = out[0].toLowerCase();
    expect(text.includes('ledger') || text.includes('inbox')).toBe(true);
  });

  it('`projects` help text explicitly states it is read-only', async () => {
    const { out, opts } = captureOut();
    await dispatchEngineer({ kind: 'help', topic: 'projects' }, opts({}));
    expect(out[0].toLowerCase()).toContain('read-only');
  });
});

describe('regression guard: ENGINEER_SUBCOMMANDS and SUBCOMMAND_HELP stay in sync (#524)', () => {
  it('every entry in ENGINEER_SUBCOMMANDS has a non-empty SUBCOMMAND_HELP entry', () => {
    for (const sub of ENGINEER_SUBCOMMANDS) {
      expect(SUBCOMMAND_HELP[sub]).toBeTruthy();
    }
  });

  it('SUBCOMMAND_HELP has no extra keys outside ENGINEER_SUBCOMMANDS', () => {
    const known = new Set<string>(ENGINEER_SUBCOMMANDS);
    for (const key of Object.keys(SUBCOMMAND_HELP)) {
      expect(known.has(key)).toBe(true);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { detectEngineerCommand } from '../../../src/engine/engineer-cli.js';

function argv(...rest: string[]): string[] {
  return ['node', 'conduct-ts', 'engineer', ...rest];
}

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

describe('engineer-cli --help/-h short-circuit (#524)', () => {
  for (const sub of SUBCOMMANDS) {
    it(`treats \`engineer ${sub} --help\` as help, not the subcommand`, () => {
      expect(detectEngineerCommand(argv(sub, '--help'))).toEqual({ kind: 'help', topic: sub });
    });

    it(`treats \`engineer ${sub} -h\` as help, not the subcommand`, () => {
      expect(detectEngineerCommand(argv(sub, '-h'))).toEqual({ kind: 'help', topic: sub });
    });
  }

  it('detects --help anywhere in argv, not just immediately after the subcommand', () => {
    expect(detectEngineerCommand(argv('land', '--project', 'x', '--help'))).toEqual({
      kind: 'help',
      topic: 'land',
    });
  });

  it('exact repro: `engineer claim --help` must not execute claim', () => {
    expect(detectEngineerCommand(argv('claim', '--help'))).toEqual({ kind: 'help', topic: 'claim' });
  });

  it('regression guard: bare `engineer --help` is unchanged (guide)', () => {
    expect(detectEngineerCommand(argv('--help'))).toEqual({ kind: 'guide' });
  });
});

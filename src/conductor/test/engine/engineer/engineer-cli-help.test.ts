import { describe, it, expect } from 'vitest';
import { detectEngineerCommand, dispatchEngineer } from '../../../src/engine/engineer-cli.js';

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

describe('dispatchEngineer per-subcommand help (#524, Task 2)', () => {
  // Nonexistent path — any fs/ledger access under this dir would throw ENOENT,
  // proving `help` dispatch has zero side effects.
  const NONEXISTENT_ENGINEER_DIR = '/nonexistent/engineer-dir-for-help-test-524';

  for (const sub of SUBCOMMANDS) {
    it(`prints exactly one line of help for \`engineer ${sub} --help\` with zero side effects`, async () => {
      const { out, err, opts } = captureOut();
      const gh = async (): Promise<{ stdout: string }> => {
        throw new Error(`gh must not be invoked for \`engineer ${sub} --help\``);
      };
      const code = await dispatchEngineer(
        { kind: 'help', topic: sub },
        opts({ gh, engineerDir: NONEXISTENT_ENGINEER_DIR }),
      );
      expect(code).toBe(0);
      expect(out.length).toBe(1);
      expect(out[0]).toContain(sub);
      expect(err.length).toBe(0);
    });
  }

  it('claim help mentions the ledger/inbox mechanics', async () => {
    const { out, opts } = captureOut();
    await dispatchEngineer({ kind: 'help', topic: 'claim' }, opts({ engineerDir: NONEXISTENT_ENGINEER_DIR }));
    const text = out[0].toLowerCase();
    expect(text.includes('ledger') || text.includes('inbox')).toBe(true);
  });

  it('projects help mentions read-only', async () => {
    const { out, opts } = captureOut();
    await dispatchEngineer({ kind: 'help', topic: 'projects' }, opts({ engineerDir: NONEXISTENT_ENGINEER_DIR }));
    expect(out[0].toLowerCase()).toContain('read-only');
  });
});

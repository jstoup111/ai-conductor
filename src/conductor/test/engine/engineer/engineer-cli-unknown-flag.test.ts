import { describe, it, expect } from 'vitest';
import { detectEngineerCommand } from '../../../src/engine/engineer-cli.js';

function argv(...rest: string[]): string[] {
  return ['node', 'conduct-ts', 'engineer', ...rest];
}

describe('engineer-cli unknown-flag rejection on zero/boolean-flag subcommands (#524)', () => {
  it('rejects an unknown flag on `claim`', () => {
    expect(detectEngineerCommand(argv('claim', '--verbose'))).toEqual({
      kind: 'reject',
      sub: 'claim',
      flag: '--verbose',
    });
  });

  it('rejects an unknown flag on `poll`', () => {
    expect(detectEngineerCommand(argv('poll', '--bogus'))).toEqual({
      kind: 'reject',
      sub: 'poll',
      flag: '--bogus',
    });
  });

  it('rejects an unknown flag on `projects`', () => {
    expect(detectEngineerCommand(argv('projects', '--typo'))).toEqual({
      kind: 'reject',
      sub: 'projects',
      flag: '--typo',
    });
  });

  it('rejects an unknown flag on `migrate-issue-deps`', () => {
    expect(detectEngineerCommand(argv('migrate-issue-deps', '--bogus'))).toEqual({
      kind: 'reject',
      sub: 'migrate-issue-deps',
      flag: '--bogus',
    });
  });

  it('regression: `migrate-issue-deps --confirm` still works', () => {
    expect(detectEngineerCommand(argv('migrate-issue-deps', '--confirm'))).toEqual({
      kind: 'migrate-issue-deps',
      confirm: true,
    });
  });

  it('regression: `claim` with no extra flags still returns claim', () => {
    expect(detectEngineerCommand(argv('claim'))).toEqual({ kind: 'claim' });
  });

  it('regression: `poll` with no extra flags still returns poll', () => {
    expect(detectEngineerCommand(argv('poll'))).toEqual({ kind: 'poll' });
  });

  it('regression: `projects` with no extra flags still returns projects', () => {
    expect(detectEngineerCommand(argv('projects'))).toEqual({ kind: 'projects' });
  });
});

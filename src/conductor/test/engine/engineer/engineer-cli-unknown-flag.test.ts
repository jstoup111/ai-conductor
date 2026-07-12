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

describe('engineer-cli unknown-flag rejection on positional/optional-flag subcommands (#524)', () => {
  it('rejects an unknown flag on `forget`', () => {
    expect(detectEngineerCommand(argv('forget', 'o/a#1', '--force'))).toEqual({
      kind: 'reject',
      sub: 'forget',
      flag: '--force',
    });
  });

  it('rejects an unknown flag on `resolve`', () => {
    expect(
      detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url', 'https://x/1', '--dry-run')),
    ).toEqual({
      kind: 'reject',
      sub: 'resolve',
      flag: '--dry-run',
    });
  });

  it('regression: `forget <sourceRef>` with no flags still returns forget', () => {
    expect(detectEngineerCommand(argv('forget', 'o/a#1'))).toEqual({
      kind: 'forget',
      sourceRef: 'o/a#1',
    });
  });
});

describe('engineer-cli unknown-flag rejection on required-named-flag subcommands (#524 Task 6)', () => {
  it('rejects an unknown flag on `worktree`', () => {
    expect(
      detectEngineerCommand(argv('worktree', '--project', 'p', '--idea', 'i', '--extra', 'x')),
    ).toEqual({
      kind: 'reject',
      sub: 'worktree',
      flag: '--extra',
    });
  });

  it('rejects an unknown flag on `land`', () => {
    expect(
      detectEngineerCommand(
        argv('land', '--project', 'p', '--idea', 'i', '--worktree', 'w', '--bogus'),
      ),
    ).toEqual({
      kind: 'reject',
      sub: 'land',
      flag: '--bogus',
    });
  });

  it('rejects an unknown flag on `land` even when --source-ref is also present', () => {
    expect(
      detectEngineerCommand(
        argv(
          'land',
          '--project',
          'p',
          '--idea',
          'i',
          '--worktree',
          'w',
          '--source-ref',
          'o/a#1',
          '--bogus',
        ),
      ),
    ).toEqual({
      kind: 'reject',
      sub: 'land',
      flag: '--bogus',
    });
  });

  it('rejects an unknown flag on `handoff`', () => {
    expect(
      detectEngineerCommand(
        argv('handoff', '--project', 'p', '--branch', 'b', '--worktree', 'w', '--nope'),
      ),
    ).toEqual({
      kind: 'reject',
      sub: 'handoff',
      flag: '--nope',
    });
  });

  it('rejects an unknown flag on `handoff` even when --source-ref is also present', () => {
    expect(
      detectEngineerCommand(
        argv(
          'handoff',
          '--project',
          'p',
          '--branch',
          'b',
          '--worktree',
          'w',
          '--source-ref',
          'o/a#1',
          '--nope',
        ),
      ),
    ).toEqual({
      kind: 'reject',
      sub: 'handoff',
      flag: '--nope',
    });
  });

  it('regression: `worktree` with only recognized flags still returns worktree', () => {
    expect(
      detectEngineerCommand(argv('worktree', '--project', 'p', '--idea', 'i')),
    ).toEqual({
      kind: 'worktree',
      project: 'p',
      idea: 'i',
    });
  });

  it('regression: `land` with only recognized flags (no source-ref) still returns land', () => {
    expect(
      detectEngineerCommand(argv('land', '--project', 'p', '--idea', 'i', '--worktree', 'w')),
    ).toEqual({
      kind: 'land',
      project: 'p',
      idea: 'i',
      worktree: 'w',
      sourceRef: undefined,
    });
  });

  it('regression: `land` with only recognized flags (with source-ref) still returns land', () => {
    expect(
      detectEngineerCommand(
        argv('land', '--project', 'p', '--idea', 'i', '--worktree', 'w', '--source-ref', 'o/a#1'),
      ),
    ).toEqual({
      kind: 'land',
      project: 'p',
      idea: 'i',
      worktree: 'w',
      sourceRef: 'o/a#1',
    });
  });

  it('regression: `handoff` with only recognized flags (no source-ref) still returns handoff', () => {
    expect(
      detectEngineerCommand(argv('handoff', '--project', 'p', '--branch', 'b', '--worktree', 'w')),
    ).toEqual({
      kind: 'handoff',
      project: 'p',
      branch: 'b',
      worktree: 'w',
      sourceRef: undefined,
    });
  });

  it('regression: `handoff` with only recognized flags (with source-ref) still returns handoff', () => {
    expect(
      detectEngineerCommand(
        argv(
          'handoff',
          '--project',
          'p',
          '--branch',
          'b',
          '--worktree',
          'w',
          '--source-ref',
          'o/a#1',
        ),
      ),
    ).toEqual({
      kind: 'handoff',
      project: 'p',
      branch: 'b',
      worktree: 'w',
      sourceRef: 'o/a#1',
    });
  });

  it('regression: `worktree` missing required flags still returns guide', () => {
    expect(detectEngineerCommand(argv('worktree', '--project', 'p'))).toEqual({ kind: 'guide' });
  });

  it('regression: `land` missing required flags still returns guide', () => {
    expect(detectEngineerCommand(argv('land', '--project', 'p', '--idea', 'i'))).toEqual({
      kind: 'guide',
    });
  });

  it('regression: `handoff` missing required flags still returns guide', () => {
    expect(detectEngineerCommand(argv('handoff', '--project', 'p', '--branch', 'b'))).toEqual({
      kind: 'guide',
    });
  });
});

// #524 Story 3: unknown-flag rejection for zero/boolean-flag engineer subcommands
// (projects, poll, claim, migrate-issue-deps). Previously an unrecognized flag
// like `--verbose` on `claim` was silently ignored and the subcommand ran anyway.

import { describe, it, expect } from 'vitest';
import { detectEngineerCommand } from '../../../src/engine/engineer-cli.js';

const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];

describe('detectEngineerCommand: unknown-flag rejection (#524 Story 3)', () => {
  it('rejects an unknown flag on `claim`', () => {
    const result = detectEngineerCommand(argv('claim', '--verbose'));
    expect(result).toEqual({ kind: 'reject', sub: 'claim', flag: '--verbose' });
  });

  it('rejects an unknown flag on `poll`', () => {
    const result = detectEngineerCommand(argv('poll', '--bogus'));
    expect(result).toEqual({ kind: 'reject', sub: 'poll', flag: '--bogus' });
  });

  it('rejects an unknown flag on `projects`', () => {
    const result = detectEngineerCommand(argv('projects', '--typo'));
    expect(result).toEqual({ kind: 'reject', sub: 'projects', flag: '--typo' });
  });

  it('rejects an unknown flag on `migrate-issue-deps`', () => {
    const result = detectEngineerCommand(argv('migrate-issue-deps', '--bogus'));
    expect(result).toEqual({ kind: 'reject', sub: 'migrate-issue-deps', flag: '--bogus' });
  });

  it('does not regress the real `--confirm` flag on `migrate-issue-deps`', () => {
    const result = detectEngineerCommand(argv('migrate-issue-deps', '--confirm'));
    expect(result).toEqual({ kind: 'migrate-issue-deps', confirm: true });
  });

  it('regression: `claim` with no flags is unchanged', () => {
    expect(detectEngineerCommand(argv('claim'))).toEqual({ kind: 'claim' });
  });

  it('regression: `poll` with no flags is unchanged', () => {
    expect(detectEngineerCommand(argv('poll'))).toEqual({ kind: 'poll' });
  });

  it('regression: `projects` with no flags is unchanged', () => {
    expect(detectEngineerCommand(argv('projects'))).toEqual({ kind: 'projects' });
  });

  it('rejects an unknown flag on `forget`', () => {
    const result = detectEngineerCommand(argv('forget', 'o/a#1', '--force'));
    expect(result).toEqual({ kind: 'reject', sub: 'forget', flag: '--force' });
  });

  it('rejects an unknown flag on `resolve`', () => {
    const result = detectEngineerCommand(
      argv('resolve', 'o/a#1', '--pr-url', 'https://x/1', '--dry-run')
    );
    expect(result).toEqual({ kind: 'reject', sub: 'resolve', flag: '--dry-run' });
  });

  // --- Story 3: worktree/land/handoff (required-named-flag subcommands) ---

  it('rejects an unknown flag on `worktree`', () => {
    const result = detectEngineerCommand(
      argv('worktree', '--project', 'p', '--idea', 'i', '--extra', 'x')
    );
    expect(result).toEqual({ kind: 'reject', sub: 'worktree', flag: '--extra' });
  });

  it('regression: `worktree` with only recognized flags is unchanged', () => {
    const result = detectEngineerCommand(argv('worktree', '--project', 'p', '--idea', 'i'));
    expect(result).toEqual({ kind: 'worktree', project: 'p', idea: 'i' });
  });

  it('regression: `worktree` missing required flags still guides', () => {
    expect(detectEngineerCommand(argv('worktree', '--project', 'p'))).toEqual({ kind: 'guide' });
  });

  it('rejects an unknown flag on `land`', () => {
    const result = detectEngineerCommand(
      argv('land', '--project', 'p', '--idea', 'i', '--worktree', 'w', '--bogus')
    );
    expect(result).toEqual({ kind: 'reject', sub: 'land', flag: '--bogus' });
  });

  it('rejects an unknown flag on `land` even when `--source-ref` is present', () => {
    const result = detectEngineerCommand(
      argv(
        'land',
        '--project',
        'p',
        '--idea',
        'i',
        '--worktree',
        'w',
        '--source-ref',
        's',
        '--bogus'
      )
    );
    expect(result).toEqual({ kind: 'reject', sub: 'land', flag: '--bogus' });
  });

  it('regression: `land` with only recognized flags is unchanged', () => {
    const result = detectEngineerCommand(
      argv('land', '--project', 'p', '--idea', 'i', '--worktree', 'w')
    );
    expect(result).toEqual({ kind: 'land', project: 'p', idea: 'i', worktree: 'w', sourceRef: undefined });
  });

  it('regression: `land` with `--source-ref` is unchanged', () => {
    const result = detectEngineerCommand(
      argv('land', '--project', 'p', '--idea', 'i', '--worktree', 'w', '--source-ref', 's')
    );
    expect(result).toEqual({ kind: 'land', project: 'p', idea: 'i', worktree: 'w', sourceRef: 's' });
  });

  it('regression: `land` missing required flags still guides', () => {
    expect(
      detectEngineerCommand(argv('land', '--project', 'p', '--idea', 'i'))
    ).toEqual({ kind: 'guide' });
  });

  it('rejects an unknown flag on `handoff`', () => {
    const result = detectEngineerCommand(
      argv('handoff', '--project', 'p', '--branch', 'b', '--worktree', 'w', '--nope')
    );
    expect(result).toEqual({ kind: 'reject', sub: 'handoff', flag: '--nope' });
  });

  it('regression: `handoff` with only recognized flags is unchanged', () => {
    const result = detectEngineerCommand(
      argv('handoff', '--project', 'p', '--branch', 'b', '--worktree', 'w')
    );
    expect(result).toEqual({
      kind: 'handoff',
      project: 'p',
      branch: 'b',
      worktree: 'w',
      sourceRef: undefined,
    });
  });

  it('regression: `handoff` with `--source-ref` is unchanged', () => {
    const result = detectEngineerCommand(
      argv(
        'handoff',
        '--project',
        'p',
        '--branch',
        'b',
        '--worktree',
        'w',
        '--source-ref',
        's'
      )
    );
    expect(result).toEqual({
      kind: 'handoff',
      project: 'p',
      branch: 'b',
      worktree: 'w',
      sourceRef: 's',
    });
  });

  it('regression: `handoff` missing required flags still guides', () => {
    expect(
      detectEngineerCommand(argv('handoff', '--project', 'p', '--branch', 'b'))
    ).toEqual({ kind: 'guide' });
  });
});

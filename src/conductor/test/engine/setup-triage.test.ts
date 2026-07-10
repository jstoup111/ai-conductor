import { describe, it, expect } from 'vitest';
import { classifyTree, type TriageOutcome, type GitRunner, type GitResult } from '../../src/engine/setup-triage.js';

// A scripted GitRunner: matches argv prefixes to canned results.
function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

describe('engine/setup-triage — classifyTree (TS-2/TS-3)', () => {
  it('returns "clean" for empty porcelain output', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: '' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('clean');
  });

  it('returns "dirty" for modified tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: ' M src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for added tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: 'A  src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for deleted tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: ' D src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for renamed tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: 'R  old.ts -> new.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for staged file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: 'M  src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for untracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: '?? src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for multiple changes', async () => {
    const { git } = fakeGit([
      {
        match: ['status', '--porcelain'],
        result: {
          stdout: ' M src/foo.ts\n?? src/bar.ts\nM  src/baz.ts\n',
        },
      },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });
});

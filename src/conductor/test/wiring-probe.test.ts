/**
 * Tests for the wiring-probe module (src/conductor/src/engine/wiring-probe.ts).
 *
 * Layer 1 of the wiring-reachability gate: extracting newly-added exported
 * symbols (with their defining file) from a feature's git diff.
 *
 * All tests use FAKE git runners that record calls; no real `git` binary is
 * required. Base-commit derivation reuses the anchor -> fork-point ->
 * merge-base fallback ladder (mirrored from getEvidenceRange in autoheal.ts,
 * adapted here to the injected-GitRunner convention used by
 * headPushedToUpstream in push-evidence.ts).
 */

import { describe, it, expect } from 'vitest';
import { extractNewExports } from '../src/engine/wiring-probe.js';
import type { GitRunner } from '../src/engine/pr-labels.js';

// ── Fake GitRunner factory ────────────────────────────────────────────────────

function fakeGit(
  responses: Array<{ stdout: string } | Error>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  const git: GitRunner = async (args, _opts) => {
    calls.push([...args]);
    const response = responses[index++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return response;
  };
  return { git, calls };
}

const DIFF_HEADER = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    'index abc1234..def5678 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,2 +1,4 @@',
  ].join('\n');

// ── Extraction of newly-added exports ─────────────────────────────────────────

describe('extractNewExports', () => {
  it('extracts an added export function with its defining file and symbol name', async () => {
    const diff = [
      DIFF_HEADER('src/foo.ts'),
      ' existing line',
      '+export function foo(x: number): number {',
      '+  return x + 1;',
      '+}',
    ].join('\n');

    const { git } = fakeGit([
      { stdout: 'abc123\n' }, // anchor rev-parse --verify succeeds
      { stdout: diff }, // git diff <base>...HEAD
    ]);

    const result = await extractNewExports(git, 'abc123');

    expect(result).toContainEqual({ file: 'src/foo.ts', symbol: 'foo' });
  });

  it('extracts an added export const with its defining file and symbol name', async () => {
    const diff = [
      DIFF_HEADER('src/bar.ts'),
      ' existing line',
      "+export const bar = 42;",
    ].join('\n');

    const { git } = fakeGit([
      { stdout: 'abc123\n' },
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, 'abc123');

    expect(result).toContainEqual({ file: 'src/bar.ts', symbol: 'bar' });
  });

  it('extracts an added re-export line', async () => {
    const diff = [
      DIFF_HEADER('src/index.ts'),
      ' existing line',
      "+export { baz } from './other';",
    ].join('\n');

    const { git } = fakeGit([
      { stdout: 'abc123\n' },
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, 'abc123');

    expect(result).toContainEqual({ file: 'src/index.ts', symbol: 'baz' });
  });

  it('does not include a symbol that already existed at base (unchanged context line)', async () => {
    const diff = [
      DIFF_HEADER('src/qux.ts'),
      ' export function existingFn() {}', // unchanged context line, not a '+' addition
      '+export function newFn() {}',
    ].join('\n');

    const { git } = fakeGit([
      { stdout: 'abc123\n' },
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, 'abc123');

    expect(result).toContainEqual({ file: 'src/qux.ts', symbol: 'newFn' });
    expect(result).not.toContainEqual({ file: 'src/qux.ts', symbol: 'existingFn' });
  });
});

// ── Base derivation ladder ────────────────────────────────────────────────────

describe('extractNewExports base derivation ladder', () => {
  it('uses the anchor directly when it is reachable', async () => {
    const diff = [
      DIFF_HEADER('src/anchor.ts'),
      '+export function fromAnchor() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      { stdout: 'abc123\n' }, // rev-parse --verify anchor^{commit} succeeds
      { stdout: diff }, // git diff anchor...HEAD
    ]);

    const result = await extractNewExports(git, 'my-anchor-sha');

    expect(result).toContainEqual({ file: 'src/anchor.ts', symbol: 'fromAnchor' });
    expect(calls[0]).toEqual(['rev-parse', '--verify', 'my-anchor-sha^{commit}']);
    expect(calls[1]).toEqual(['diff', 'my-anchor-sha...HEAD']);
  });

  it('falls back to fork-point merge-base when the anchor is unreachable', async () => {
    const diff = [
      DIFF_HEADER('src/fork.ts'),
      '+export function fromForkPoint() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      new Error('unknown revision or path not in the working tree'), // anchor unreachable
      { stdout: 'fork-point-sha\n' }, // merge-base --fork-point succeeds
      { stdout: diff }, // git diff fork-point-sha...HEAD
    ]);

    const result = await extractNewExports(git, 'unreachable-anchor');

    expect(result).toContainEqual({ file: 'src/fork.ts', symbol: 'fromForkPoint' });
    expect(calls[1]).toEqual(['merge-base', '--fork-point', 'origin/main', 'HEAD']);
    expect(calls[2]).toEqual(['diff', 'fork-point-sha...HEAD']);
  });

  it('falls back to plain merge-base when both anchor and fork-point fail', async () => {
    const diff = [
      DIFF_HEADER('src/merge.ts'),
      '+export function fromMergeBase() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      new Error('unknown revision or path not in the working tree'), // anchor unreachable
      { stdout: '' }, // fork-point returns empty (no result)
      { stdout: 'merge-base-sha\n' }, // plain merge-base succeeds
      { stdout: diff }, // git diff merge-base-sha...HEAD
    ]);

    const result = await extractNewExports(git, 'unreachable-anchor');

    expect(result).toContainEqual({ file: 'src/merge.ts', symbol: 'fromMergeBase' });
    expect(calls[2]).toEqual(['merge-base', 'origin/main', 'HEAD']);
    expect(calls[3]).toEqual(['diff', 'merge-base-sha...HEAD']);
  });

  it('derives the base directly via the ladder when no anchor is given (empty string)', async () => {
    const diff = [
      DIFF_HEADER('src/empty-anchor.ts'),
      '+export function fromEmptyAnchor() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      { stdout: 'fork-point-sha\n' }, // merge-base --fork-point succeeds directly
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, '');

    expect(result).toContainEqual({ file: 'src/empty-anchor.ts', symbol: 'fromEmptyAnchor' });
    expect(calls[0]).toEqual(['merge-base', '--fork-point', 'origin/main', 'HEAD']);
  });
});

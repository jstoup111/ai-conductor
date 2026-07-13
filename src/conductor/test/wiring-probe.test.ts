/**
 * Tests for the wiring-probe module (src/conductor/src/engine/wiring-probe.ts).
 *
 * Layer 1 of the wiring-reachability gate: extracting newly-added exported
 * symbols (with their defining file) from a feature's git diff.
 *
 * All tests use FAKE git runners that record calls; no real `git` binary is
 * required. Base-commit derivation reuses the anchor -> origin-ref-resolve ->
 * fork-point -> merge-base fallback ladder (mirrored from
 * getEvidenceRange/resolveOriginRef in autoheal.ts, adapted here to the
 * injected-GitRunner convention used by headPushedToUpstream in
 * push-evidence.ts). The origin ref is never hardcoded to `origin/main` — it
 * is resolved via `origin/HEAD`, falling back to probing `origin/main` then
 * `origin/master`.
 */

import { describe, it, expect } from 'vitest';
import {
  extractNewExports,
  verifyDeclaredSites,
  orphanBackstop,
  checkContractConsistency,
  runWiringProbe,
  evaluatePlanWiringDisposition,
  LEGACY_ADVISORY_REASON,
  WIRING_SCOPE_UNDETERMINABLE,
} from '../src/engine/wiring-probe.js';
import type { GitRunner } from '../src/engine/pr-labels.js';
import type { WiredIntoSite } from '../src/engine/wired-into.js';
import type { ReferenceSearchRunner, TaskWiringContract } from '../src/engine/wiring-probe.js';

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
      { stdout: 'refs/remotes/origin/main\n' }, // symbolic-ref origin/HEAD resolves
      { stdout: 'fork-point-sha\n' }, // merge-base --fork-point succeeds
      { stdout: diff }, // git diff fork-point-sha...HEAD
    ]);

    const result = await extractNewExports(git, 'unreachable-anchor');

    expect(result).toContainEqual({ file: 'src/fork.ts', symbol: 'fromForkPoint' });
    expect(calls[1]).toEqual(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    expect(calls[2]).toEqual(['merge-base', '--fork-point', 'origin/main', 'HEAD']);
    expect(calls[3]).toEqual(['diff', 'fork-point-sha...HEAD']);
  });

  it('falls back to plain merge-base when both anchor and fork-point fail', async () => {
    const diff = [
      DIFF_HEADER('src/merge.ts'),
      '+export function fromMergeBase() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      new Error('unknown revision or path not in the working tree'), // anchor unreachable
      { stdout: 'refs/remotes/origin/main\n' }, // symbolic-ref origin/HEAD resolves
      { stdout: '' }, // fork-point returns empty (no result)
      { stdout: 'merge-base-sha\n' }, // plain merge-base succeeds
      { stdout: diff }, // git diff merge-base-sha...HEAD
    ]);

    const result = await extractNewExports(git, 'unreachable-anchor');

    expect(result).toContainEqual({ file: 'src/merge.ts', symbol: 'fromMergeBase' });
    expect(calls[3]).toEqual(['merge-base', 'origin/main', 'HEAD']);
    expect(calls[4]).toEqual(['diff', 'merge-base-sha...HEAD']);
  });

  it('derives the base directly via the ladder when no anchor is given (empty string)', async () => {
    const diff = [
      DIFF_HEADER('src/empty-anchor.ts'),
      '+export function fromEmptyAnchor() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      { stdout: 'refs/remotes/origin/main\n' }, // symbolic-ref origin/HEAD resolves
      { stdout: 'fork-point-sha\n' }, // merge-base --fork-point succeeds directly
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, '');

    expect(result).toContainEqual({ file: 'src/empty-anchor.ts', symbol: 'fromEmptyAnchor' });
    expect(calls[0]).toEqual(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    expect(calls[1]).toEqual(['merge-base', '--fork-point', 'origin/main', 'HEAD']);
  });
});

// ── Origin ref resolution ladder ──────────────────────────────────────────────

describe('extractNewExports origin-ref resolution ladder', () => {
  it('resolves origin/HEAD and uses it as the origin ref for the merge-base ladder', async () => {
    const diff = [
      DIFF_HEADER('src/head.ts'),
      '+export function fromOriginHead() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      { stdout: 'refs/remotes/origin/develop\n' }, // symbolic-ref origin/HEAD -> develop
      { stdout: 'fork-point-sha\n' }, // merge-base --fork-point origin/develop HEAD
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, '');

    expect(result).toContainEqual({ file: 'src/head.ts', symbol: 'fromOriginHead' });
    expect(calls[0]).toEqual(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    expect(calls[1]).toEqual(['merge-base', '--fork-point', 'origin/develop', 'HEAD']);
  });

  it('falls back to probing origin/main when origin/HEAD is absent', async () => {
    const diff = [
      DIFF_HEADER('src/probe-main.ts'),
      '+export function fromProbedMain() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      new Error('ref refs/remotes/origin/HEAD is not a symbolic ref'), // origin/HEAD unset
      { stdout: 'abc123\n' }, // rev-parse --verify origin/main succeeds
      { stdout: 'fork-point-sha\n' }, // merge-base --fork-point origin/main HEAD
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, '');

    expect(result).toContainEqual({ file: 'src/probe-main.ts', symbol: 'fromProbedMain' });
    expect(calls[0]).toEqual(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    expect(calls[1]).toEqual(['rev-parse', '--verify', 'origin/main']);
    expect(calls[2]).toEqual(['merge-base', '--fork-point', 'origin/main', 'HEAD']);
  });

  it('falls back to probing origin/master when origin/HEAD and origin/main are both absent', async () => {
    const diff = [
      DIFF_HEADER('src/probe-master.ts'),
      '+export function fromProbedMaster() {}',
    ].join('\n');

    const { git, calls } = fakeGit([
      new Error('ref refs/remotes/origin/HEAD is not a symbolic ref'), // origin/HEAD unset
      new Error('fatal: Needed a single revision'), // origin/main does not exist
      { stdout: 'def456\n' }, // rev-parse --verify origin/master succeeds
      { stdout: 'fork-point-sha\n' }, // merge-base --fork-point origin/master HEAD
      { stdout: diff },
    ]);

    const result = await extractNewExports(git, '');

    expect(result).toContainEqual({ file: 'src/probe-master.ts', symbol: 'fromProbedMaster' });
    expect(calls[0]).toEqual(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    expect(calls[1]).toEqual(['rev-parse', '--verify', 'origin/main']);
    expect(calls[2]).toEqual(['rev-parse', '--verify', 'origin/master']);
    expect(calls[3]).toEqual(['merge-base', '--fork-point', 'origin/master', 'HEAD']);
  });

  it('fails closed (returns no exports, does not guess origin/main) when origin/HEAD, origin/main, and origin/master all fail to resolve', async () => {
    const { git, calls } = fakeGit([
      new Error('ref refs/remotes/origin/HEAD is not a symbolic ref'), // origin/HEAD unset
      new Error('fatal: Needed a single revision'), // origin/main does not exist
      new Error('fatal: Needed a single revision'), // origin/master does not exist
    ]);

    const result = await extractNewExports(git, '');

    expect(result).toEqual([]);
    expect(calls).toEqual([
      ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      ['rev-parse', '--verify', 'origin/main'],
      ['rev-parse', '--verify', 'origin/master'],
    ]);
    // no merge-base or diff call was ever attempted
    expect(calls.some((c) => c[0] === 'merge-base' || c[0] === 'diff')).toBe(false);
  });
});

// ── Probe-level fail-closed gap ───────────────────────────────────────────────

describe('runWiringProbe fail-closed base derivation', () => {
  it('returns a single "wiring scope undeterminable" gap (never a silent pass, never a throw) when anchor, origin ref, and merge-base all fail to resolve', async () => {
    const { git, calls } = fakeGit([
      new Error('fatal: Needed a single revision'), // anchor unreachable
      new Error('ref refs/remotes/origin/HEAD is not a symbolic ref'), // origin/HEAD unset
      new Error('fatal: Needed a single revision'), // origin/main does not exist
      new Error('fatal: Needed a single revision'), // origin/master does not exist
    ]);

    const result = await runWiringProbe(git, 'unreachable-anchor', '.');

    expect(result.gaps).toEqual([WIRING_SCOPE_UNDETERMINABLE]);
    expect(result.gaps[0]).toBe('wiring scope undeterminable');
    expect(result.newExports).toEqual([]);
    // no merge-base or diff call was ever attempted — fails closed before them
    expect(calls.some((c) => c[0] === 'merge-base' || c[0] === 'diff')).toBe(false);
  });
});

// ── verifyDeclaredSites ────────────────────────────────────────────────────

function fakeReader(files: Record<string, string>): (path: string) => Promise<string> {
  return async (path: string) => {
    if (!(path in files)) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return files[path];
  };
}

describe('verifyDeclaredSites', () => {
  it('passes a declared site whose file contains a non-test reference to the new symbol', async () => {
    const sites: WiredIntoSite[] = [{ path: 'src/x.ts', symbol: 'foo' }];
    const newExports = [{ file: 'src/foo.ts', symbol: 'foo' }];
    const readFile = fakeReader({
      'src/x.ts': "import { foo } from './foo.js';\nfoo(1);\n",
    });

    const result = await verifyDeclaredSites(sites, newExports, readFile);

    expect(result.gaps).toEqual([]);
    expect(result.evidence).toContainEqual({
      site: 'src/x.ts#foo',
      symbol: 'foo',
      matchedLine: "import { foo } from './foo.js';",
    });
  });

  it('reports a gap for a declared site whose file has no reference to the symbol', async () => {
    const sites: WiredIntoSite[] = [{ path: 'src/x.ts', symbol: 'foo' }];
    const newExports = [{ file: 'src/foo.ts', symbol: 'foo' }];
    const readFile = fakeReader({
      'src/x.ts': "export const unrelated = 1;\n",
    });

    const result = await verifyDeclaredSites(sites, newExports, readFile);

    expect(result.gaps).toEqual([
      'declared call site src/x.ts#foo has no non-test reference to «foo» (searched: src/x.ts)',
    ]);
    expect(result.evidence).toEqual([]);
  });

  it('reports a named gap for a declared site whose file does not exist', async () => {
    const sites: WiredIntoSite[] = [{ path: 'src/x.ts', symbol: 'foo' }];
    const newExports = [{ file: 'src/foo.ts', symbol: 'foo' }];
    const readFile = fakeReader({});

    const result = await verifyDeclaredSites(sites, newExports, readFile);

    expect(result.gaps).toEqual(['declared call site src/x.ts#foo: file not found']);
    expect(result.evidence).toEqual([]);
  });
});

// ── Orphan backstop ────────────────────────────────────────────────────────────

function fakeSearch(responses: Record<string, string[]>): ReferenceSearchRunner {
  return async (symbol: string) => responses[symbol] ?? [];
}

describe('orphanBackstop', () => {
  it('passes an export with at least one non-test reference outside its own defining file', async () => {
    const newExports = [{ file: 'src/foo.ts', symbol: 'foo' }];
    const search = fakeSearch({ foo: ['src/foo.ts', 'src/caller.ts'] });

    const results = await orphanBackstop(newExports, search);

    expect(results).toEqual([
      { file: 'src/foo.ts', symbol: 'foo', status: 'ok', evidence: ['src/caller.ts'] },
    ]);
  });

  it('reports a gap when an export is referenced only in test files', async () => {
    const newExports = [{ file: 'src/foo.ts', symbol: 'foo' }];
    const search = fakeSearch({
      foo: ['src/foo.ts', 'src/foo.test.ts', 'test/other-thing.ts'],
    });

    const results = await orphanBackstop(newExports, search);

    expect(results).toEqual([
      {
        file: 'src/foo.ts',
        symbol: 'foo',
        status: 'gap',
        message: 'foo exported but referenced by no production code (2 test-only references excluded)',
      },
    ]);
  });

  it('reports a gap when an export is referenced only within its own defining file (self-reference)', async () => {
    const newExports = [{ file: 'src/foo.ts', symbol: 'foo' }];
    const search = fakeSearch({ foo: ['src/foo.ts'] });

    const results = await orphanBackstop(newExports, search);

    expect(results).toEqual([
      {
        file: 'src/foo.ts',
        symbol: 'foo',
        status: 'gap',
        message: 'foo exported but referenced only within its own defining file (no external wiring)',
      },
    ]);
  });
});

// ── checkContractConsistency ────────────────────────────────────────────────

describe('checkContractConsistency', () => {
  it('passes a task declaring no_new_surface whose files add no new exports', () => {
    const tasks: TaskWiringContract[] = [
      {
        taskId: '1',
        files: ['src/a.ts'],
        parseResult: { kind: 'no_new_surface' },
      },
    ];
    const newExports = [{ file: 'src/other.ts', symbol: 'unrelated' }];

    const gaps = checkContractConsistency(tasks, newExports);

    expect(gaps).toEqual([]);
  });

  it('reports a gap when a task declares no_new_surface but its diff adds new exports', () => {
    const tasks: TaskWiringContract[] = [
      {
        taskId: '1',
        files: ['src/a.ts'],
        parseResult: { kind: 'no_new_surface' },
      },
    ];
    const newExports = [
      { file: 'src/a.ts', symbol: 'fooExport' },
      { file: 'src/a.ts', symbol: 'barExport' },
    ];

    const gaps = checkContractConsistency(tasks, newExports);

    expect(gaps).toEqual([
      "task 1: declared 'no new production surface' but diff adds new export(s): fooExport, barExport",
    ]);
  });

  it('reports an undeclared new-export surface gap when a contract-bearing plan has a task with new exports and no Wired-into line', () => {
    const tasks: TaskWiringContract[] = [
      {
        taskId: '1',
        files: ['src/a.ts'],
        parseResult: { kind: 'declared', sites: [{ path: 'src/b.ts', symbol: 'used' }] },
      },
      {
        taskId: '2',
        files: ['src/c.ts'],
        parseResult: null,
      },
    ];
    const newExports = [{ file: 'src/c.ts', symbol: 'newThing' }];

    const gaps = checkContractConsistency(tasks, newExports);

    expect(gaps).toEqual([
      'task 2: undeclared new-export surface — diff adds new export(s): newThing but task has no Wired-into declaration',
    ]);
  });
});

// ── evaluatePlanWiringDisposition ───────────────────────────────────────────

describe('evaluatePlanWiringDisposition', () => {
  it('treats a plan with zero Wired-into lines as legacy advisory-only, demoting gaps to advisories', () => {
    const tasks: TaskWiringContract[] = [
      { taskId: '1', files: ['src/a.ts'], parseResult: null },
      { taskId: '2', files: ['src/b.ts'], parseResult: null },
    ];
    const layer1Gaps = [
      'newThing exported but referenced only within its own defining file (no external wiring)',
    ];

    const result = evaluatePlanWiringDisposition(tasks, layer1Gaps);

    expect(result.satisfied).toBe(true);
    expect(result.reason).toContain(LEGACY_ADVISORY_REASON);
    expect(result.reason).toContain('legacy plan (pre-Wired-into contract): wiring gate advisory-only');
    expect(result.gaps).toEqual([]);
    expect(result.advisories).toEqual(layer1Gaps);
  });

  it('fully gates a plan with exactly one Wired-into line anywhere — legacy disposition does not apply', () => {
    const tasks: TaskWiringContract[] = [
      {
        taskId: '1',
        files: ['src/a.ts'],
        parseResult: { kind: 'declared', sites: [{ path: 'src/b.ts', symbol: 'used' }] },
      },
      { taskId: '2', files: ['src/c.ts'], parseResult: null },
    ];
    const layer1Gaps = [
      'task 2: undeclared new-export surface — diff adds new export(s): newThing but task has no Wired-into declaration',
    ];

    const result = evaluatePlanWiringDisposition(tasks, layer1Gaps);

    expect(result.satisfied).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.gaps).toEqual(layer1Gaps);
    expect(result.advisories).toEqual([]);
  });
});

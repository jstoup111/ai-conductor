// ─────────────────────────────────────────────────────────────────────────────
// Test: enumerate every build-start / dispatch call site across daemon.ts,
// daemon-cli.ts, and daemon-rekick.ts and assert each one is guarded by an
// operator-park check (Task 2, park-all-dispatch-paths, #651).
//
// This is a source-assembly regression test — mirroring the pattern used by
// daemon-cli-rekick-sentinel-park-guard.test.ts — that fails loudly if a
// future change adds a new build-start call site that bypasses the park
// check (Story 3 negative). It does not execute daemon logic; it scans the
// source text for the known-guarded call-site set and asserts the guard
// ordering holds textually.
//
// Known-guarded set (as of Task 1, commit 737c705e):
//   1. daemon.ts: the single `deps.runFeature(item)` call lives inside the
//      `dispatch` closure, whose only production caller is `guardedDispatch`
//      (itself delegating to the exported `guardedDispatchWith`, which awaits
//      `isParked` BEFORE invoking `onDispatch`/`dispatch`).
//   2. daemon-cli.ts: the re-kick resume call (`resumeRebaseFirst`, one-shot —
//      consumes `.pipeline/REKICK` regardless of outcome) is preceded by an
//      `isOperatorParked` check that returns before the call.
//   3. daemon-rekick.ts: the re-kick sweep loop checks `deps.isOperatorParked`
//      before any per-slug action (abort/clear/sentinel/lastRekickSha).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SRC = join(__dirname, '../../src/engine/daemon.ts');
const DAEMON_REKICK_SRC = join(__dirname, '../../src/engine/daemon-rekick.ts');
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('Task 2 — every build-start call site is park-guarded (enumeration regression)', () => {
  it('daemon.ts has exactly one deps.runFeature( call site, and it lives inside the dispatch closure', async () => {
    const source = await readFile(DAEMON_SRC, 'utf-8');

    const runFeatureCalls = source.match(/\.runFeature\(/g) ?? [];
    // One real call site (`deps.runFeature(item)` inside `dispatch`) plus the
    // interface member declaration `runFeature: (item: BacklogItem) => ...`
    // does not match `/\.runFeature\(/` (no leading dot before the call), so
    // this should match exactly the one call site.
    expect(runFeatureCalls.length).toBe(1);

    // Isolate the `dispatch` closure body and confirm the call lives inside it.
    const dispatchMatch = source.match(
      /const dispatch = \(item: BacklogItem\): void => \{[\s\S]*?\n  \};/,
    );
    expect(dispatchMatch, 'expected to locate the `dispatch` closure body').toBeTruthy();
    expect(dispatchMatch![0]).toMatch(/\.runFeature\(/);
  });

  it('dispatch( is only ever invoked from inside guardedDispatch / guardedDispatchWith in daemon.ts', async () => {
    const source = await readFile(DAEMON_SRC, 'utf-8');

    // Find every occurrence of `dispatch(` that is a real call (not part of
    // `guardedDispatch(` / `guardedDispatchWith(` / the interface member name
    // `onDispatch`), by requiring a non-word character (or start) immediately
    // before `dispatch(` and rejecting matches preceded by "guarded" or "on".
    const allDispatchCalls = [...source.matchAll(/(\w*)dispatch\(/gi)];
    const bareDispatchCalls = allDispatchCalls.filter(
      (m) => m[1] === '' || m[1].toLowerCase() === '', // no prefix word chars captured
    );
    // Every bare `dispatch(` call must appear either as the definition site
    // (`const dispatch = (item...` — not a call) or inside `guardedDispatchWith`'s
    // `onDispatch` invocation, or as the `onDispatch(item)` call itself, or as
    // the argument passed into `guardedDispatchWith(item, deps.isParked,
    // dispatch, log)` (a reference, not a call — won't match `dispatch(`).
    // Concretely: the only textual call-shaped occurrence of `dispatch(` that
    // isn't `guardedDispatch(` should be the `onDispatch(item)` call inside
    // `guardedDispatchWith`.
    const nonGuardedBareCalls = bareDispatchCalls.filter((m) => {
      const idx = m.index ?? 0;
      const context = source.slice(Math.max(0, idx - 20), idx);
      return !/guarded$/i.test(context) && !/on$/i.test(context);
    });
    expect(
      nonGuardedBareCalls.length,
      `expected no un-guarded dispatch( calls; found: ${nonGuardedBareCalls
        .map((m) => source.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 15))
        .join(' | ')}`,
    ).toBe(0);

    // And the actual pool call site must go through `guardedDispatch(`.
    expect(source).toMatch(/const dispatched = await guardedDispatch\(next\);/);
  });

  it('guardedDispatchWith awaits isParked BEFORE invoking onDispatch (the guard runs before the call)', async () => {
    const source = await readFile(DAEMON_SRC, 'utf-8');

    const fnMatch = source.match(
      /export async function guardedDispatchWith\([\s\S]*?\n\}/,
    );
    expect(fnMatch, 'expected to locate guardedDispatchWith').toBeTruthy();
    const body = fnMatch![0];

    const isParkedIdx = body.search(/isParked\?\.\(/);
    const onDispatchIdx = body.search(/onDispatch\(item\)/);
    expect(isParkedIdx).toBeGreaterThan(-1);
    expect(onDispatchIdx).toBeGreaterThan(-1);
    expect(isParkedIdx).toBeLessThan(onDispatchIdx);

    // The parked branch must return before onDispatch ever runs.
    const between = body.slice(isParkedIdx, onDispatchIdx);
    expect(between).toMatch(/return false;/);
  });

  it('daemon-cli.ts checks isOperatorParked and returns BEFORE the resumeRebaseFirst re-kick resume call', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /import\s*\{[^}]*\bisOperatorParked\b[^}]*\}\s*from\s*['"]\.\/engine\/park-marker\.js['"]/,
    );

    const region = source.match(
      /const ranManualTest[\s\S]*?await resumeRebaseFirst\(\{[\s\S]*?\}\);/,
    );
    expect(
      region,
      'expected a block spanning ranManualTest through the resumeRebaseFirst(...) call',
    ).toBeTruthy();
    const block = region![0];

    const parkedCheckIdx = block.search(/isOperatorParked\(/);
    const resumeCallIdx = block.search(/await resumeRebaseFirst\(\{/);
    expect(parkedCheckIdx).toBeGreaterThan(-1);
    expect(resumeCallIdx).toBeGreaterThan(-1);
    expect(parkedCheckIdx).toBeLessThan(resumeCallIdx);

    const between = block.slice(parkedCheckIdx, resumeCallIdx);
    expect(between).toMatch(/return;/);
  });

  it('daemon-rekick.ts sweep checks deps.isOperatorParked before any per-slug dispatch-adjacent action', async () => {
    const source = await readFile(DAEMON_REKICK_SRC, 'utf-8');

    const loopMatch = source.match(
      /for \(const slug of slugs\) \{[\s\S]*?deps\.isOperatorParked[\s\S]*?\n    \}\n/,
    );
    expect(loopMatch, 'expected to locate the re-kick sweep loop body opening').toBeTruthy();

    const body = loopMatch![0];
    const parkCheckIdx = body.search(/deps\.isOperatorParked/);
    expect(parkCheckIdx).toBe(body.indexOf('deps.isOperatorParked'));
    // The park check must be the first conditional in the loop body — i.e. it
    // appears before any other `deps.` guard (isProcessed, SHA guard, etc.).
    const firstDepsCall = body.search(/deps\.\w+/);
    expect(firstDepsCall).toBe(parkCheckIdx);

    // A parked slug must `continue` (skip this slug entirely) rather than
    // merely logging.
    expect(body).toMatch(/skipped\.push\(slug\);[\s\S]*?continue;/);
  });
});

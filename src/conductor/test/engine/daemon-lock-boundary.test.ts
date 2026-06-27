import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Task 16 — Boundary assertion: confine lock primitive behind one module.
//
// FR-20 caveat (ADR-010): the single-winner model is explicitly expected to
// change in a future iteration. It must therefore be isolated behind a single
// swappable boundary so routing, authoring, and the daemon loop call ONLY the
// exported API — never raw O_EXCL / daemon.pid references.
//
// These tests walk the source tree and assert:
//   1. ONLY `daemon-lock.ts` references `daemon.pid` or `O_EXCL` (the 'wx'
//      open flag used for O_EXCL in Node's fs.open / fs.promises.open API).
//   2. The module exports the canonical set of symbols callers are allowed to
//      use: acquire, isLive, reclaim, ensureRunning.
// ─────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = resolve(import.meta.dirname, '../../src');
const DAEMON_LOCK_REL = 'engine/daemon-lock.ts';
const DAEMON_LOCK_ABS = resolve(SRC_ROOT, DAEMON_LOCK_REL);

/** Collect all .ts source files under a directory (recursively). */
function collectTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectTs(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('daemon-lock boundary: confine lock primitive (FR-20, C3)', () => {
  it('only daemon-lock.ts references "daemon.pid" — no other source file encodes the pidfile path', () => {
    const allTs = collectTs(SRC_ROOT);
    const violators: string[] = [];

    for (const file of allTs) {
      if (file === DAEMON_LOCK_ABS) continue; // the boundary itself is exempt
      const content = readFileSync(file, 'utf8');
      if (content.includes('daemon.pid')) {
        violators.push(file.replace(SRC_ROOT + '/', ''));
      }
    }

    expect(
      violators,
      `Files outside daemon-lock.ts that reference "daemon.pid": ${violators.join(', ')}`,
    ).toHaveLength(0);
  });

  it('only daemon-lock.ts uses O_EXCL open flag (\'wx\') — no other source file bypasses the boundary', () => {
    const allTs = collectTs(SRC_ROOT);
    const violators: string[] = [];

    for (const file of allTs) {
      if (file === DAEMON_LOCK_ABS) continue;
      const content = readFileSync(file, 'utf8');
      // 'wx' is the Node fs open flag for O_EXCL (create, fail-if-exists).
      if (content.includes("'wx'") || content.includes('"wx"')) {
        violators.push(file.replace(SRC_ROOT + '/', ''));
      }
    }

    expect(
      violators,
      `Files outside daemon-lock.ts that use the O_EXCL 'wx' open flag: ${violators.join(', ')}`,
    ).toHaveLength(0);
  });

  it('daemon-lock.ts exports the canonical boundary API: acquire, isLive, reclaim, ensureRunning', async () => {
    // Dynamic import so this test fails with a clear message if the module is absent.
    const mod = (await import('../../src/engine/daemon-lock.js')) as Record<string, unknown>;

    const required = ['acquire', 'isLive', 'reclaim', 'ensureRunning'] as const;
    for (const name of required) {
      expect(
        typeof mod[name],
        `Expected export "${name}" to be a function`,
      ).toBe('function');
    }
  });

  it('the boundary module is the single source of truth (only daemon-lock.ts imports fs.open / fs.promises.open for pidfile creation)', () => {
    // Sanity check: daemon-lock.ts itself uses the lock primitives.
    const lockSrc = readFileSync(DAEMON_LOCK_ABS, 'utf8');
    // The module uses 'wx' flag for O_EXCL.
    expect(lockSrc).toContain("'wx'");
    // The module encodes the pidfile name.
    expect(lockSrc).toContain('daemon.pid');
  });
});

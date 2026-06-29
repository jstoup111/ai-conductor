import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for clampDaemonConcurrency — NOT YET BUILT.
//
// ADR-014 (FR-13): the daemon pool is SERIAL (concurrency 1). Any requested
// value > 1 must be clamped to 1 and a diagnostic must be emitted exactly once.
//
// `clampDaemonConcurrency` is not yet exported from
// `src/engine/daemon-command.ts`. Each test dynamically imports the symbol so
// a missing export surfaces as that test's own RED failure rather than a
// whole-file collection crash that would mask which behavior is unimplemented.
// ─────────────────────────────────────────────────────────────────────────────

const CMD_MOD = '../../src/engine/daemon-command.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  // Throws (RED) when the module doesn't export the symbol yet.
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

describe('clampDaemonConcurrency (ADR-014 / FR-13 serial pool)', () => {
  it('returns 1 and does NOT log when requested is 1', async () => {
    const clamp = requireFn(await load(CMD_MOD), 'clampDaemonConcurrency');
    const logged: string[] = [];
    const result = clamp(1, (m: string) => logged.push(m));
    expect(result).toBe(1);
    expect(logged).toHaveLength(0);
  });

  it('returns 1 when requested is 4 and calls log exactly once with a message matching /serial|concurrenc|out of scope/i', async () => {
    const clamp = requireFn(await load(CMD_MOD), 'clampDaemonConcurrency');
    const logged: string[] = [];
    const result = clamp(4, (m: string) => logged.push(m));
    expect(result).toBe(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/serial|concurrenc|out of scope/i);
  });

  it('returns 1 for any requested > 1 (spot-checks: 2 and 8)', async () => {
    const clamp = requireFn(await load(CMD_MOD), 'clampDaemonConcurrency');
    const noop = () => {};
    expect(clamp(2, noop)).toBe(1);
    expect(clamp(8, noop)).toBe(1);
  });
});

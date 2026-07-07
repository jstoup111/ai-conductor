import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the "Latched single-shot Waker" module (Task 2, FR-6).
// A pure synchronous/async utility for event-driven daemon wake signals.
// This module is unit-covered by these specs (no acceptance test duplication).
// ─────────────────────────────────────────────────────────────────────────────

const MOD_PATH = '../src/engine/waker.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

describe('waker', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (a): wake() then armed() resolves immediately
  // ───────────────────────────────────────────────────────────────────────────
  it('armed() resolves immediately if wake() was already called', async () => {
    const mod = await load();
    const Waker = requireFn(mod, 'Waker');

    const waker = Waker();
    waker.wake();

    // armed() should resolve right away, not hang
    await expect(waker.armed()).resolves.toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (b): three wake()s then one armed() resolves once, next armed() blocks
  // ───────────────────────────────────────────────────────────────────────────
  it('multiple wake() calls result in armed() resolving once, then blocking on the next armed()', async () => {
    const mod = await load();
    const Waker = requireFn(mod, 'Waker');

    const waker = Waker();

    // Three wake calls
    waker.wake();
    waker.wake();
    waker.wake();

    // First armed() should resolve
    await expect(waker.armed()).resolves.toBeUndefined();

    // Second armed() should block (use a race with a sentinel to prove it stays pending)
    const blockingSentinel = Promise.resolve('sentinel');
    const race = Promise.race([waker.armed(), blockingSentinel]);
    const result = await race;

    expect(result).toBe('sentinel'); // proves armed() did not resolve
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (c): armed() without wake stays pending
  // ───────────────────────────────────────────────────────────────────────────
  it('armed() without a prior wake() call stays pending indefinitely (race with sentinel)', async () => {
    const mod = await load();
    const Waker = requireFn(mod, 'Waker');

    const waker = Waker();

    // Do NOT call wake()
    // armed() should stay pending; we prove it with a race against a resolved sentinel
    const blockingSentinel = Promise.resolve('sentinel');
    const race = Promise.race([waker.armed(), blockingSentinel]);
    const result = await race;

    expect(result).toBe('sentinel'); // proves armed() did not resolve
  });
});

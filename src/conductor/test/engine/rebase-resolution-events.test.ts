/**
 * Type-level acceptance tests for the four rebase_resolution_* event variants.
 * Each test constructs an event as a ConductorEvent (catching union membership
 * at compile time) and then emits it through ConductorEventEmitter to confirm
 * the runtime no-op emit path works without throwing.
 */
import { describe, it, expect } from 'vitest';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('rebase_resolution_* event types', () => {
  // ── Type-level: each assignment must satisfy ConductorEvent ──────────────

  it('rebase_resolution_attempt is a valid ConductorEvent', () => {
    const evt: ConductorEvent = {
      type: 'rebase_resolution_attempt',
      index: 1,
      cap: 3,
    };
    expect(evt.type).toBe('rebase_resolution_attempt');
    expect((evt as { index: number }).index).toBe(1);
    expect((evt as { cap: number }).cap).toBe(3);
  });

  it('rebase_resolution_succeeded is a valid ConductorEvent', () => {
    const evt: ConductorEvent = { type: 'rebase_resolution_succeeded' };
    expect(evt.type).toBe('rebase_resolution_succeeded');
  });

  it('rebase_resolution_failed is a valid ConductorEvent', () => {
    const evt: ConductorEvent = { type: 'rebase_resolution_failed' };
    expect(evt.type).toBe('rebase_resolution_failed');
  });

  it('rebase_resolution_exhausted is a valid ConductorEvent', () => {
    const evt: ConductorEvent = { type: 'rebase_resolution_exhausted' };
    expect(evt.type).toBe('rebase_resolution_exhausted');
  });

  // ── Runtime: emit each through ConductorEventEmitter (no-op listeners) ──

  it('emits rebase_resolution_attempt without throwing', async () => {
    const emitter = new ConductorEventEmitter();
    await expect(
      emitter.emit({ type: 'rebase_resolution_attempt', index: 2, cap: 5 }),
    ).resolves.not.toThrow();
  });

  it('emits rebase_resolution_succeeded without throwing', async () => {
    const emitter = new ConductorEventEmitter();
    await expect(
      emitter.emit({ type: 'rebase_resolution_succeeded' }),
    ).resolves.not.toThrow();
  });

  it('emits rebase_resolution_failed without throwing', async () => {
    const emitter = new ConductorEventEmitter();
    await expect(
      emitter.emit({ type: 'rebase_resolution_failed' }),
    ).resolves.not.toThrow();
  });

  it('emits rebase_resolution_exhausted without throwing', async () => {
    const emitter = new ConductorEventEmitter();
    await expect(
      emitter.emit({ type: 'rebase_resolution_exhausted' }),
    ).resolves.not.toThrow();
  });
});

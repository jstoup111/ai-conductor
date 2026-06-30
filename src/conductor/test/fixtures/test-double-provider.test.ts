/**
 * Self-test for the test-double memory provider fixture.
 * Verifies all toggleable state: availability, write-accept/reject, reconnect, entry log.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDoubleProvider } from './test-double-provider.js';

describe('makeTestDoubleProvider fixture', () => {
  describe('kind / name metadata', () => {
    it('has kind memory_provider', () => {
      const p = makeTestDoubleProvider();
      expect(p.kind).toBe('memory_provider');
    });

    it('defaults name to "double"', () => {
      const p = makeTestDoubleProvider();
      expect(p.name).toBe('double');
    });

    it('accepts a custom name', () => {
      const p = makeTestDoubleProvider({ name: 'serena' });
      expect(p.name).toBe('serena');
    });
  });

  describe('availability', () => {
    it('defaults to available', () => {
      const p = makeTestDoubleProvider();
      expect(p.isAvailable()).toBe(true);
      expect(p.available).toBe(true);
    });

    it('can start unavailable', () => {
      const p = makeTestDoubleProvider({ available: false });
      expect(p.isAvailable()).toBe(false);
      expect(p.available).toBe(false);
    });

    it('setAvailable toggles availability', () => {
      const p = makeTestDoubleProvider({ available: true });
      p.setAvailable(false);
      expect(p.isAvailable()).toBe(false);
      expect(p.available).toBe(false);
      p.setAvailable(true);
      expect(p.isAvailable()).toBe(true);
    });
  });

  describe('write', () => {
    it('accepts writes and records them to the entry log', async () => {
      const p = makeTestDoubleProvider();
      await p.write({ content: 'hello' });
      expect(p.entryLog).toHaveLength(1);
      expect(p.entryLog[0]).toMatchObject({ content: 'hello' });
    });

    it('rejects writes when in reject mode', async () => {
      const p = makeTestDoubleProvider({ rejectWrites: true });
      await expect(p.write({ content: 'hello' })).rejects.toThrow();
      expect(p.entryLog).toHaveLength(0);
    });

    it('setRejectWrites toggles rejection', async () => {
      const p = makeTestDoubleProvider();
      await p.write({ content: 'first' });
      p.setRejectWrites(true);
      await expect(p.write({ content: 'second' })).rejects.toThrow();
      p.setRejectWrites(false);
      await p.write({ content: 'third' });
      expect(p.entryLog).toHaveLength(2);
    });
  });

  describe('reconnect', () => {
    it('setReconnected marks the provider as reconnected', () => {
      const p = makeTestDoubleProvider({ available: false });
      expect(p.reconnected).toBe(false);
      p.setAvailable(true);
      p.setReconnected(true);
      expect(p.reconnected).toBe(true);
      expect(p.isAvailable()).toBe(true);
    });
  });

  describe('entry log', () => {
    it('log accumulates across multiple writes', async () => {
      const p = makeTestDoubleProvider();
      await p.write({ content: 'a' });
      await p.write({ content: 'b' });
      await p.write({ content: 'c' });
      expect(p.entryLog).toHaveLength(3);
    });

    it('clearLog empties the log', async () => {
      const p = makeTestDoubleProvider();
      await p.write({ content: 'x' });
      p.clearLog();
      expect(p.entryLog).toHaveLength(0);
    });
  });
});

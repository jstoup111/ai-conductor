import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { type ObservationEntry } from '../src/engine/observation-sweep.js';

const MOD_PATH = '../src/engine/observation-sweep.js';

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

describe('observation-sweep', () => {
  describe('awaiting-merge state machine', () => {
    let mod: Record<string, unknown>;
    let sweepObservationWatch: any;
    let tempDir: string;

    beforeEach(async () => {
      mod = await load();
      sweepObservationWatch = requireFn(mod, 'sweepObservationWatch');

      // Create a temp directory for the registry
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      tempDir = path.join(os.tmpdir(), `obs-sweep-test-${Date.now()}-${Math.random()}`);
      await fs.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      // Clean up temp directory
      const fs = await import('fs/promises');
      try {
        await fs.rm(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('MERGED state records mergedAt and transitions to watching', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Setup: entry in awaiting-merge state (no mergedAt)
      const entry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: Date.now() - 60000,
      };

      // Write entry to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(entry) + '\n',
      );

      const beforeSweep = Date.now();

      // Mock gh runner
      const fakeGh = vi.fn(async () => ({
        stdout: JSON.stringify({ state: 'MERGED', mergedAt: beforeSweep + 1000 }),
      }));

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh });

      // Expected:
      // - gh poll was called
      expect(fakeGh).toHaveBeenCalled();

      // - Entry is in survivors with updated fields
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(1);

      const survivor = JSON.parse(lines[0]);
      expect(survivor.mergedAt).toBeDefined();
      expect(survivor.mergedAt).toBe(beforeSweep + 1000);
      expect(survivor.lastPollAt).toBeGreaterThanOrEqual(beforeSweep);
      expect(survivor.sourceRef).toBe('#42');
    });

    it('respects 5-minute per-entry throttle', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();
      const fourMinutesAgo = now - 4 * 60 * 1000;

      // Setup: entry with lastPollAt = now - 4 minutes (not due yet)
      const recentlyPolledEntry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 60000,
        lastPollAt: fourMinutesAgo,
      };

      // Setup: entry with lastPollAt > 5 minutes ago (due for poll)
      const oldEntry: ObservationEntry = {
        v: 1,
        sourceRef: '#43',
        prUrl: 'https://github.com/owner/repo/pull/124',
        slug: 'fix-bug-2',
        signature: 'fixed2',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 60000,
        lastPollAt: now - 6 * 60 * 1000,
      };

      // Write entries to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(recentlyPolledEntry) + '\n' + JSON.stringify(oldEntry) + '\n',
      );

      // Mock gh runner
      const fakeGh = vi.fn(async () => ({
        stdout: JSON.stringify({ state: 'MERGED', mergedAt: now }),
      }));

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh });

      // Expected:
      // - gh poll was called only once (for oldEntry, not recentlyPolledEntry)
      expect(fakeGh).toHaveBeenCalledTimes(1);

      // - Both entries survive
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(2);

      // - Recently polled entry is unchanged
      const entries = lines.map((l) => JSON.parse(l));
      const recentEntry = entries.find((e) => e.sourceRef === '#42');
      expect(recentEntry.lastPollAt).toBe(fourMinutesAgo);
      expect(recentEntry.mergedAt).toBeUndefined();
    });

    it('CLOSED unmerged PR cancels observation and prunes', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Setup: entry in awaiting-merge state
      const entry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: Date.now() - 60000,
      };

      // Write entry to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(entry) + '\n',
      );

      // Mock gh runner: returns CLOSED state
      const fakeGh = vi.fn(async () => ({
        stdout: JSON.stringify({ state: 'CLOSED' }),
      }));

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh });

      // Expected:
      // - Entry is pruned (not in survivors)
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(0);
    });

    it('gh failure logs but entry survives', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();

      // Setup: entry in awaiting-merge state
      const entry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 60000,
      };

      // Write entry to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(entry) + '\n',
      );

      // Mock gh runner that throws
      const fakeGh = vi.fn(async () => {
        throw new Error('Network error');
      });

      const logs: string[] = [];
      const mockLogger = (msg: string) => logs.push(msg);

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh, log: mockLogger });

      // Expected:
      // - Error is logged
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.includes('poll failed') || l.includes('error'))).toBe(true);

      // - Entry survives in survivors
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(1);

      const survivor = JSON.parse(lines[0]);
      expect(survivor.sourceRef).toBe('#42');
      // lastPollAt should be updated
      expect(survivor.lastPollAt).toBeGreaterThanOrEqual(now);
    });

    it('ten due entries result in exactly one gh state call each', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();

      // Setup: ten entries, all due for poll
      const entries: ObservationEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push({
          v: 1,
          sourceRef: `#${i}`,
          prUrl: `https://github.com/owner/repo/pull/${i}`,
          slug: `fix-${i}`,
          signature: `fixed${i}`,
          isRegex: false,
          windowDays: 14,
          enrolledAt: now - 60000,
          lastPollAt: now - 6 * 60 * 1000, // Due for poll
        });
      }

      // Write entries to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.writeFile(path.join(tempDir, '.daemon/observation-watch.jsonl'), content);

      // Mock gh runner
      const fakeGh = vi.fn(async () => ({
        stdout: JSON.stringify({ state: 'MERGED', mergedAt: now }),
      }));

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh });

      // Expected:
      // - Exactly ten gh state API calls made
      expect(fakeGh).toHaveBeenCalledTimes(10);
    });
  });
});

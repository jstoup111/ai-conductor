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

  describe('watching state machine', () => {
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
      tempDir = path.join(os.tmpdir(), `obs-watching-test-${Date.now()}-${Math.random()}`);
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

    it('watching: first post-merge observation closes the issue with quoted line', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();
      const mergedAt = now - 30000;

      // Setup: entry in watching state (mergedAt set), no lastScanAt yet
      const entry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'test-fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 100000,
        mergedAt,
      };

      // Write entry to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(entry) + '\n',
      );

      // Write fake daemon.log with matching observation
      const logDir = path.join(tempDir, '.daemon');
      const logContent = `2026-07-11T10:00:00Z [daemon] starting
2026-07-11T10:05:00Z [daemon] test-fixed: bug is fixed now
2026-07-11T10:10:00Z [daemon] continuing
`;
      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Mock gh runner
      const fakeGh = vi.fn(async (args) => {
        if (args[0] === 'issue' && args[1] === 'close') {
          // Verify the comment argument
          const commentIdx = args.indexOf('--comment');
          expect(commentIdx).toBeGreaterThan(-1);
          const comment = args[commentIdx + 1];
          expect(comment).toContain('test-fixed: bug is fixed now');
          expect(comment).toContain('Observation:');
          return { stdout: '' };
        }
        return { stdout: '' };
      });

      const logs: string[] = [];
      const mockLogger = (msg: string) => logs.push(msg);

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh, logDir, log: mockLogger });

      // Expected:
      // - gh close was called
      expect(fakeGh).toHaveBeenCalledWith(
        expect.arrayContaining(['issue', 'close']),
        expect.any(Object),
      );

      // - Entry is pruned (removed from survivors)
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(0);

      // - Success logged
      expect(logs.some((l) => l.includes('closed') || l.includes('observe'))).toBe(true);
    });

    it('watching: close failure retries on next tick', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();
      const mergedAt = now - 30000;

      // Setup: entry in watching state
      const entry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'test-fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 100000,
        mergedAt,
      };

      // Write entry to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(entry) + '\n',
      );

      // Write fake daemon.log with matching observation
      const logDir = path.join(tempDir, '.daemon');
      const logContent = `2026-07-11T10:00:00Z [daemon] starting
2026-07-11T10:05:00Z [daemon] test-fixed: bug is fixed now
`;
      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Mock gh runner that throws
      const fakeGh = vi.fn(async () => {
        throw new Error('Failed to close issue');
      });

      const logs: string[] = [];
      const mockLogger = (msg: string) => logs.push(msg);

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh, logDir, log: mockLogger });

      // Expected:
      // - Error is logged
      expect(logs.some((l) => l.includes('close failed') || l.includes('error'))).toBe(true);

      // - Entry survives in survivors unchanged
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(1);

      const survivor = JSON.parse(lines[0]);
      expect(survivor.sourceRef).toBe('#42');
      expect(survivor.mergedAt).toBe(mergedAt);
      // lastScanAt should be updated for throttle
      expect(survivor.lastScanAt).toBeGreaterThanOrEqual(now);
    });

    it('watching: already-closed issue doesn\'t error, entry is pruned', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();
      const mergedAt = now - 30000;

      // Setup: entry in watching state
      const entry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'test-fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 100000,
        mergedAt,
      };

      // Write entry to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(entry) + '\n',
      );

      // Write fake daemon.log with matching observation
      const logDir = path.join(tempDir, '.daemon');
      const logContent = `2026-07-11T10:00:00Z [daemon] starting
2026-07-11T10:05:00Z [daemon] test-fixed: bug is fixed now
`;
      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Mock gh runner that throws "already closed" error
      const fakeGh = vi.fn(async () => {
        const err = new Error('This issue is already closed');
        (err as any).code = 422;
        throw err;
      });

      const logs: string[] = [];
      const mockLogger = (msg: string) => logs.push(msg);

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh, logDir, log: mockLogger });

      // Expected:
      // - No loud error message (just debug)
      expect(logs.some((l) => l.includes('already closed'))).toBe(true);

      // - Entry is pruned anyway (expected race condition)
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(0);
    });

    it('watching: respects 60-second scan throttle', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();
      const mergedAt = now - 300000;

      // Setup: entry with lastScanAt = now - 45 seconds (under 60s throttle)
      const recentScanEntry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'test-fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 100000,
        mergedAt,
        lastScanAt: now - 45 * 1000,
      };

      // Setup: another entry due for scan (lastScanAt > 60s ago)
      const dueScanEntry: ObservationEntry = {
        v: 1,
        sourceRef: '#43',
        prUrl: 'https://github.com/owner/repo/pull/124',
        slug: 'fix-bug-2',
        signature: 'test-fixed-2',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 100000,
        mergedAt: now - 300000,
        lastScanAt: now - 70 * 1000,
      };

      // Write entries to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(recentScanEntry) + '\n' + JSON.stringify(dueScanEntry) + '\n',
      );

      // Write fake daemon.log with matching observations
      const logDir = path.join(tempDir, '.daemon');
      const logContent = `2026-07-11T10:00:00Z [daemon] starting
2026-07-11T10:05:00Z [daemon] test-fixed: bug is fixed
2026-07-11T10:10:00Z [daemon] test-fixed-2: another bug is fixed
`;
      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Mock gh runner
      const fakeGh = vi.fn(async () => {
        return { stdout: '' };
      });

      // Call sweep
      await sweepObservationWatch(tempDir, { gh: fakeGh, logDir });

      // Expected:
      // - Only dueScanEntry should be closed (gh called once)
      expect(fakeGh).toHaveBeenCalledTimes(1);

      // - recentScanEntry survives unchanged
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      const entries = lines.map((l) => JSON.parse(l));

      const unchanged = entries.find((e) => e.sourceRef === '#42');
      expect(unchanged).toBeDefined();
      expect(unchanged.lastScanAt).toBe(now - 45 * 1000); // Unchanged
    });

    it('watching: scan throttle is reset after close', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      const now = Date.now();
      const mergedAt = now - 30000;

      // Setup: entry in watching state
      const entry: ObservationEntry = {
        v: 1,
        sourceRef: '#42',
        prUrl: 'https://github.com/owner/repo/pull/123',
        slug: 'fix-bug',
        signature: 'test-fixed',
        isRegex: false,
        windowDays: 14,
        enrolledAt: now - 100000,
        mergedAt,
      };

      // Write entry to registry
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        JSON.stringify(entry) + '\n',
      );

      // Write fake daemon.log with matching observation
      const logDir = path.join(tempDir, '.daemon');
      const logContent = `2026-07-11T10:00:00Z [daemon] starting
2026-07-11T10:05:00Z [daemon] test-fixed: bug is fixed now
`;
      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Mock gh runner
      const fakeGh = vi.fn(async () => {
        return { stdout: '' };
      });

      // Call sweep (entry is closed and removed from registry)
      await sweepObservationWatch(tempDir, { gh: fakeGh, logDir });

      // Expected:
      // - Entry is removed (pruned)
      const content = await fs.readFile(
        path.join(tempDir, '.daemon/observation-watch.jsonl'),
        'utf-8',
      );
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(0);
    });
  });

  describe('log-scan matcher', () => {
    let mod: Record<string, unknown>;
    let findObservation: any;
    let tempDir: string;

    beforeEach(async () => {
      mod = await load();
      findObservation = requireFn(mod, 'findObservation');

      // Create a temp directory for the logs
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      tempDir = path.join(os.tmpdir(), `obs-log-test-${Date.now()}-${Math.random()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await fs.mkdir(path.join(tempDir, '.daemon'), { recursive: true });
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

    it('log-scan: substring signature matches in daemon.log', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Setup: fixture daemon.log with lines
      const logDir = path.join(tempDir, '.daemon');
      const beforeTime = new Date('2026-07-11T09:59:00Z').getTime();
      const afterTime = new Date('2026-07-11T10:05:00Z').getTime();

      const logContent = `2026-07-11T10:00:00Z [daemon] some error occurred
2026-07-11T10:05:00Z [daemon] test-substring: fixed
2026-07-11T10:10:00Z [daemon] other info
`;

      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Call: findObservation with substring signature
      const result = await findObservation(logDir, 'test-substring', false, beforeTime);

      // Expected: returns match object with matched line and timestamp
      expect(result).not.toBeNull();
      expect(result.line).toContain('test-substring: fixed');
      expect(result.timestamp).toBe(afterTime);
    });

    it('log-scan: regex signature matches in daemon.log', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Setup: fixture log with line matching pattern
      const logDir = path.join(tempDir, '.daemon');
      const beforeTime = new Date('2026-07-11T09:59:00Z').getTime();
      const errorTime = new Date('2026-07-11T10:05:00Z').getTime();

      const logContent = `2026-07-11T10:00:00Z [daemon] starting service
2026-07-11T10:05:00Z [daemon] error detected timeout
2026-07-11T10:10:00Z [daemon] recovery
`;

      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Call: findObservation with regex signature
      const result = await findObservation(logDir, 'error.*timeout', true, beforeTime);

      // Expected: returns match
      expect(result).not.toBeNull();
      expect(result.line).toContain('error detected timeout');
      expect(result.timestamp).toBe(errorTime);
    });

    it('log-scan: match timestamped before mergedAt does NOT count', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Setup: log with matching line timestamped before mergedAt
      const logDir = path.join(tempDir, '.daemon');
      const mergedAt = new Date('2026-07-11T10:00:00Z').getTime();

      const logContent = `2026-07-11T09:50:00Z [daemon] test-substring: fixed before
2026-07-11T10:05:00Z [daemon] other content
`;

      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Call: findObservation with after filter
      const result = await findObservation(logDir, 'test-substring', false, mergedAt);

      // Expected: returns null (no match found after mergedAt)
      expect(result).toBeNull();
    });

    it('log-scan: finds match in rotated daemon.log.1', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Setup: daemon.log.1 contains the only matching line
      const logDir = path.join(tempDir, '.daemon');
      const beforeTime = new Date('2026-07-11T09:59:00Z').getTime();
      const matchTime = new Date('2026-07-11T10:05:00Z').getTime();

      const currentLog = `2026-07-11T10:10:00Z [daemon] unrelated
2026-07-11T10:15:00Z [daemon] more unrelated
`;

      const rotatedLog = `2026-07-11T10:00:00Z [daemon] some error occurred
2026-07-11T10:05:00Z [daemon] test-substring: fixed
`;

      await fs.writeFile(path.join(logDir, 'daemon.log'), currentLog);
      await fs.writeFile(path.join(logDir, 'daemon.log.1'), rotatedLog);

      // Call: findObservation
      const result = await findObservation(logDir, 'test-substring', false, beforeTime);

      // Expected: finds and returns the match from daemon.log.1
      expect(result).not.toBeNull();
      expect(result.line).toContain('test-substring: fixed');
      expect(result.timestamp).toBe(matchTime);
    });

    it('log-scan: ignores lines without leading ISO timestamp', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Setup: log with un-timestamped lines
      const logDir = path.join(tempDir, '.daemon');
      const beforeTime = new Date('2026-07-11T09:59:00Z').getTime();
      const matchTime = new Date('2026-07-11T10:05:00Z').getTime();

      const logContent = `This line has no timestamp and contains test-substring
2026-07-11T10:05:00Z [daemon] test-substring: fixed
Another line without timestamp test-substring
`;

      await fs.writeFile(path.join(logDir, 'daemon.log'), logContent);

      // Call: findObservation
      const result = await findObservation(logDir, 'test-substring', false, beforeTime);

      // Expected: un-timestamped lines are skipped, only the timestamped match is found
      expect(result).not.toBeNull();
      expect(result.timestamp).toBe(matchTime);
      expect(result.line).toContain('[daemon] test-substring: fixed');
    });
  });
});

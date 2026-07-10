/**
 * Tests for halt-issues sweep orchestrator.
 *
 * Covers acceptance criteria:
 * 1. Full sweep fixture → summary with expected counts: parsed, stamped, closed, guarded, errors
 * 2. Entry with gh failure → next entry still processed, `lastError` recorded, exit 0
 * 3. Unauthenticated gh (all gh calls fail) → parse/ledger complete, all gh marked errors, exit 0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sweep, SweepConfig, SweepResult } from '../../../src/engine/halt-issues/sweep';
import { LedgerEntry } from '../../../src/engine/halt-issues/ledger';

/**
 * Mock file system abstraction for testing
 */
class MockFs {
  private files: Map<string, string> = new Map();
  private fileMtimes: Map<string, Date> = new Map();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) {
      throw new Error(`File not found: ${oldPath}`);
    }
    this.files.set(newPath, content);
    this.files.delete(oldPath);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async getFileStats(path: string): Promise<{ mtime: Date }> {
    const mtime = this.fileMtimes.get(path);
    if (!mtime) {
      throw new Error(`File not found: ${path}`);
    }
    return { mtime };
  }

  setFile(path: string, content: string, mtime?: Date): void {
    this.files.set(path, content);
    if (mtime) {
      this.fileMtimes.set(path, mtime);
    }
  }
}

/**
 * Mock GitHub abstraction for testing
 */
class MockGh {
  private editIndex = 0;
  private stampIndex = 0;
  private closeIndex = 0;
  private commentIndex = 0;

  private bodies: Map<string, string | null> = new Map();
  private labels: Map<string, string[]> = new Map();
  private states: Map<string, 'open' | 'closed' | null> = new Map();

  private stampResponses: Array<{ shouldFail?: boolean; error?: string }> = [];
  private closeResponses: Array<{ shouldFail?: boolean; error?: string }> = [];
  private commentResponses: Array<{ shouldFail?: boolean; error?: string }> = [];

  setBody(repo: string, issue: string, body: string | null): void {
    this.bodies.set(`${repo}/${issue}`, body);
  }

  setLabels(repo: string, issue: string, labels: string[]): void {
    this.labels.set(`${repo}/${issue}`, labels);
  }

  setState(repo: string, issue: string, state: 'open' | 'closed' | null): void {
    this.states.set(`${repo}/${issue}`, state);
  }

  setStampResponse(shouldFail?: boolean, error?: string): void {
    this.stampResponses.push({ shouldFail, error });
  }

  setCloseResponse(shouldFail?: boolean, error?: string): void {
    this.closeResponses.push({ shouldFail, error });
  }

  setCommentResponse(shouldFail?: boolean, error?: string): void {
    this.commentResponses.push({ shouldFail, error });
  }

  async getIssueBody(repo: string, issue: string): Promise<string | null> {
    return this.bodies.get(`${repo}/${issue}`) ?? null;
  }

  async upsertIssueBody(repo: string, issue: string, body: string): Promise<void> {
    const response = this.stampResponses[this.stampIndex++];
    if (response?.shouldFail) {
      throw new Error(response.error ?? 'stamp failed');
    }
    this.bodies.set(`${repo}/${issue}`, body);
  }

  async getIssueLabels(repo: string, issue: string): Promise<string[]> {
    return this.labels.get(`${repo}/${issue}`) ?? [];
  }

  async getIssueState(repo: string, issue: string): Promise<'open' | 'closed' | null> {
    return this.states.get(`${repo}/${issue}`) ?? null;
  }

  async upsertIssueComment(repo: string, issue: string, body: string): Promise<void> {
    const response = this.commentResponses[this.commentIndex++];
    if (response?.shouldFail) {
      throw new Error(response.error ?? 'comment failed');
    }
  }

  async closeIssue(repo: string, issue: string): Promise<void> {
    const response = this.closeResponses[this.closeIndex++];
    if (response?.shouldFail) {
      throw new Error(response.error ?? 'close failed');
    }
    this.states.set(`${repo}/${issue}`, 'closed');
  }
}

/**
 * Simple monitor log for testing
 */
const SIMPLE_MONITOR_LOG = `2026-07-04T11:59:37Z NEW HALT: 2026-07-04T11:58:38.984Z [daemon] ✋ daemon-lifecycle-controls halted
HALT daemon-lifecycle-controls -> filed #297
2026-07-04T15:02:02Z RESULT: HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300`;

describe('sweep', () => {
  let mockFs: MockFs;
  let mockGh: MockGh;
  let baseConfig: Omit<SweepConfig, 'fs' | 'gh' | 'clock'>;

  beforeEach(() => {
    mockFs = new MockFs();
    mockGh = new MockGh();

    baseConfig = {
      monitorLogPath: '/test/monitor.log',
      ledgerPath: '/test/ledger.json',
      repoDir: '/test/repo',
      repo: 'test/repo',
      dryRun: false
    };

    // Set up default bodies and states
    mockGh.setBody('test/repo', '297', 'Issue body without marker\n');
    mockGh.setState('test/repo', '297', 'open');
    mockGh.setLabels('test/repo', '297', []);

    mockGh.setBody('test/repo', '300', 'Another issue\n');
    mockGh.setState('test/repo', '300', 'open');
    mockGh.setLabels('test/repo', '300', []);
  });

  describe('full sweep with fixture', () => {
    it('parses monitor log and produces summary with all counts', async () => {
      // Set up monitor log
      mockFs.setFile(baseConfig.monitorLogPath, SIMPLE_MONITOR_LOG);

      const config: SweepConfig = {
        ...baseConfig,
        fs: mockFs,
        gh: mockGh,
        clock: { now: () => new Date('2026-07-05T10:00:00Z') }
      };

      const result = await sweep(config);

      expect(result.exitCode).toBe(0);
      expect(result.parsed).toBe(2);
      expect(result.summary).toMatch(/halt-issues sweep: parsed 2, stamped \d+, closed \d+, guarded \d+, errors \d+/);
    });

    it('increments stamped when issue body is updated with marker', async () => {
      mockFs.setFile(baseConfig.monitorLogPath, SIMPLE_MONITOR_LOG);

      // Set up stamp responses to succeed
      mockGh.setStampResponse(false); // First stamp succeeds
      mockGh.setStampResponse(false); // Second stamp succeeds

      // Set up close responses to fail (so we don't close, just stamp)
      mockGh.setCloseResponse(true, 'close not implemented in this test');
      mockGh.setCloseResponse(true, 'close not implemented in this test');

      const config: SweepConfig = {
        ...baseConfig,
        fs: mockFs,
        gh: mockGh,
        clock: { now: () => new Date('2026-07-05T10:00:00Z') }
      };

      const result = await sweep(config);

      expect(result.stamped).toBeGreaterThan(0);
    });
  });

  describe('error isolation', () => {
    it('continues processing entries after gh failure on one entry', async () => {
      mockFs.setFile(baseConfig.monitorLogPath, SIMPLE_MONITOR_LOG);

      // First issue fails to stamp
      mockGh.setStampResponse(true, 'network error');

      // Second issue succeeds
      mockGh.setStampResponse(false);

      const config: SweepConfig = {
        ...baseConfig,
        fs: mockFs,
        gh: mockGh,
        clock: { now: () => new Date('2026-07-05T10:00:00Z') }
      };

      const result = await sweep(config);

      // Should have exit code 0 despite error
      expect(result.exitCode).toBe(0);
      // Should have parsed both entries
      expect(result.parsed).toBe(2);
      // Should have recorded at least one error
      expect(result.errors).toBeGreaterThan(0);
    });

    it('records lastError in ledger when entry fails', async () => {
      mockFs.setFile(baseConfig.monitorLogPath, SIMPLE_MONITOR_LOG);

      // First issue fails
      mockGh.setStampResponse(true, 'auth failed');

      // Second succeeds (to avoid blocking)
      mockGh.setStampResponse(false);

      const config: SweepConfig = {
        ...baseConfig,
        fs: mockFs,
        gh: mockGh,
        clock: { now: () => new Date('2026-07-05T10:00:00Z') }
      };

      const result = await sweep(config);

      // Read back ledger
      const ledgerContent = await mockFs.readFile(baseConfig.ledgerPath);
      const ledger = JSON.parse(ledgerContent);

      // Entry 297 should have lastError set
      expect(ledger.entries['297'].lastError).toBeDefined();
      expect(ledger.entries['297'].lastError).toContain('auth failed');
    });
  });

  describe('unauthenticated gh', () => {
    it('completes parse and ledger with all gh actions as errors when gh unavailable', async () => {
      mockFs.setFile(baseConfig.monitorLogPath, SIMPLE_MONITOR_LOG);

      // All gh calls fail
      mockGh.setStampResponse(true, 'unauthenticated');
      mockGh.setStampResponse(true, 'unauthenticated');

      const config: SweepConfig = {
        ...baseConfig,
        fs: mockFs,
        gh: mockGh,
        clock: { now: () => new Date('2026-07-05T10:00:00Z') }
      };

      const result = await sweep(config);

      // Should exit 0
      expect(result.exitCode).toBe(0);
      // Should have parsed entries
      expect(result.parsed).toBe(2);
      // All gh operations should fail
      expect(result.stamped).toBe(0);
      expect(result.closed).toBe(0);
      // Errors should be recorded
      expect(result.errors).toBe(2);

      // Ledger should be written
      const ledgerContent = await mockFs.readFile(baseConfig.ledgerPath);
      const ledger = JSON.parse(ledgerContent);
      expect(ledger.entries['297']).toBeDefined();
      expect(ledger.entries['300']).toBeDefined();
    });
  });

  describe('monitor log handling', () => {
    it('exits 0 with nothing to do when monitor log does not exist', async () => {
      const config: SweepConfig = {
        ...baseConfig,
        fs: mockFs,
        gh: mockGh,
        clock: { now: () => new Date('2026-07-05T10:00:00Z') }
      };

      const result = await sweep(config);

      expect(result.exitCode).toBe(0);
      expect(result.parsed).toBe(0);
      expect(result.summary).toContain('nothing to do');
    });
  });

  describe('dry-run mode', () => {
    it('does not write ledger in dry-run mode', async () => {
      mockFs.setFile(baseConfig.monitorLogPath, SIMPLE_MONITOR_LOG);

      const config: SweepConfig = {
        ...baseConfig,
        dryRun: true,
        fs: mockFs,
        gh: mockGh,
        clock: { now: () => new Date('2026-07-05T10:00:00Z') }
      };

      const result = await sweep(config);

      expect(result.exitCode).toBe(0);
      // Ledger should not be written
      expect(await mockFs.fileExists(baseConfig.ledgerPath)).toBe(false);
    });
  });
});

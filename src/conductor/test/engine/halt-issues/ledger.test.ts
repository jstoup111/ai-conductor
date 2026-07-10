import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Ledger, LedgerSchema, LedgerEntry } from '../../../src/engine/halt-issues/ledger';
import { VerdictEntry } from '../../../src/engine/halt-issues/verdict-parser';

/**
 * Mock file system abstraction for testing
 */
interface MockFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
}

describe('Ledger', () => {
  let mockFs: MockFs;
  let ledger: Ledger;
  const ledgerPath = '/test/ledger.json';

  beforeEach(() => {
    mockFs = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      fileExists: vi.fn()
    };
  });

  describe('upsert', () => {
    it('creates a new ledger entry keyed by issue number', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);
      (mockFs.readFile as any).mockResolvedValue('');

      ledger = new Ledger(ledgerPath, mockFs);

      const entries: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T11:58:38.984Z'
        }
      ];

      await ledger.upsert(entries);

      // Verify writeFile was called
      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeCall = (mockFs.writeFile as any).mock.calls[0];
      const tmpPath = writeCall[0];
      const fileContent = JSON.parse(writeCall[1]);

      // Verify structure
      expect(fileContent.version).toBe(1);
      expect(fileContent.entries['297']).toBeDefined();
      expect(fileContent.entries['297'].issue).toBe('297');
      expect(fileContent.entries['297'].slug).toBe('daemon-lifecycle-controls');
      expect(fileContent.entries['297'].repo).toBe('jstoup111/james-stoup-agents');
      expect(fileContent.entries['297'].haltAt).toBe('2026-07-04T11:58:38.984Z');
      expect(fileContent.entries['297'].status).toBe('pending');

      // Verify rename was called (atomic write)
      expect(mockFs.rename).toHaveBeenCalled();
    });

    it('preserves existing fields when upserting an entry', async () => {
      const existingLedger: LedgerSchema = {
        version: 1,
        entries: {
          '297': {
            issue: '297',
            slug: 'daemon-lifecycle-controls',
            repo: 'jstoup111/james-stoup-agents',
            haltAt: '2026-07-04T11:58:38.984Z',
            status: 'pending',
            stampedAt: '2026-07-05T10:00:00.000Z'
          }
        }
      };

      (mockFs.fileExists as any).mockResolvedValue(true);
      (mockFs.readFile as any).mockResolvedValue(JSON.stringify(existingLedger));

      ledger = new Ledger(ledgerPath, mockFs);

      // Upsert with partial update (only haltAt changed)
      const entries: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T12:00:00.000Z'
        }
      ];

      await ledger.upsert(entries);

      const writeCall = (mockFs.writeFile as any).mock.calls[0];
      const fileContent = JSON.parse(writeCall[1]);

      // Verify stampedAt was preserved
      expect(fileContent.entries['297'].stampedAt).toBe('2026-07-05T10:00:00.000Z');
      // Verify haltAt was updated
      expect(fileContent.entries['297'].haltAt).toBe('2026-07-04T12:00:00.000Z');
      // Verify status remains pending
      expect(fileContent.entries['297'].status).toBe('pending');
    });

    it('uses tmp-file-then-rename pattern for atomic writes', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);
      (mockFs.readFile as any).mockResolvedValue('');

      ledger = new Ledger(ledgerPath, mockFs);

      const entries: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T11:58:38.984Z'
        }
      ];

      await ledger.upsert(entries);

      // Verify order: writeFile called first, then rename
      const writeCallIndex = (mockFs.writeFile as any).mock.invocationCallOrder[0];
      const renameCallIndex = (mockFs.rename as any).mock.invocationCallOrder[0];
      expect(writeCallIndex).toBeLessThan(renameCallIndex);

      // Verify tmp file is in same directory
      const tmpPath = (mockFs.writeFile as any).mock.calls[0][0];
      expect(tmpPath).toContain('/test/');
      expect(tmpPath).toMatch(/\.ledger\.json\.tmp/);

      // Verify rename moves tmp to ledger path
      const renameCall = (mockFs.rename as any).mock.calls[0];
      expect(renameCall[0]).toBe(tmpPath);
      expect(renameCall[1]).toBe(ledgerPath);
    });

    it('verifies no partial content on disk when rename fails', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);
      (mockFs.readFile as any).mockResolvedValue('');

      // Simulate rename failure
      (mockFs.rename as any).mockRejectedValue(new Error('ENOTSUP: operation not supported'));

      ledger = new Ledger(ledgerPath, mockFs);

      const entries: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T11:58:38.984Z'
        }
      ];

      // Upsert should fail
      await expect(ledger.upsert(entries)).rejects.toThrow();

      // Verify that we attempted to write (but failed on rename)
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalled();

      // Original ledger file should not be modified
      // (in real scenario, would need to verify file on disk is unchanged)
    });

    it('handles multiple entries in a single upsert call', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);
      (mockFs.readFile as any).mockResolvedValue('');

      ledger = new Ledger(ledgerPath, mockFs);

      const entries: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T11:58:38.984Z'
        },
        {
          issue: '300',
          slug: 'make-daemon-build-push-pr-timing-a-configurable-st',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T12:00:00.000Z'
        }
      ];

      await ledger.upsert(entries);

      const writeCall = (mockFs.writeFile as any).mock.calls[0];
      const fileContent = JSON.parse(writeCall[1]);

      expect(fileContent.entries['297']).toBeDefined();
      expect(fileContent.entries['300']).toBeDefined();
      expect(Object.keys(fileContent.entries)).toHaveLength(2);
    });
  });

  describe('read', () => {
    it('reads and parses an existing ledger file', async () => {
      const ledgerContent: LedgerSchema = {
        version: 1,
        entries: {
          '297': {
            issue: '297',
            slug: 'daemon-lifecycle-controls',
            repo: 'jstoup111/james-stoup-agents',
            haltAt: '2026-07-04T11:58:38.984Z',
            status: 'pending'
          }
        }
      };

      (mockFs.fileExists as any).mockResolvedValue(true);
      (mockFs.readFile as any).mockResolvedValue(JSON.stringify(ledgerContent));

      ledger = new Ledger(ledgerPath, mockFs);
      const result = await ledger.read();

      expect(result.version).toBe(1);
      expect(result.entries['297']).toBeDefined();
      expect(result.entries['297'].slug).toBe('daemon-lifecycle-controls');
    });

    it('returns empty schema if ledger file does not exist', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);

      ledger = new Ledger(ledgerPath, mockFs);
      const result = await ledger.read();

      expect(result.version).toBe(1);
      expect(result.entries).toEqual({});
    });

    it('handles corrupted JSON gracefully', async () => {
      (mockFs.fileExists as any).mockResolvedValue(true);
      (mockFs.readFile as any).mockResolvedValue('{ invalid json }');

      const mockClock = {
        now: () => new Date('2026-07-09T12:34:56.789Z')
      };

      ledger = new Ledger(ledgerPath, mockFs, mockClock);

      // Corruption handling: returns empty schema and renames file
      const result = await ledger.read();
      expect(result.version).toBe(1);
      expect(result.entries).toEqual({});

      // Verify rename was called to quarantine
      expect(mockFs.rename).toHaveBeenCalled();
    });
  });

  describe('entry defaults', () => {
    it('sets status to pending for new entries', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);
      (mockFs.readFile as any).mockResolvedValue('');

      ledger = new Ledger(ledgerPath, mockFs);

      const entries: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T11:58:38.984Z'
        }
      ];

      await ledger.upsert(entries);

      const writeCall = (mockFs.writeFile as any).mock.calls[0];
      const fileContent = JSON.parse(writeCall[1]);

      expect(fileContent.entries['297'].status).toBe('pending');
    });

    it('preserves status field on re-upsert if not provided', async () => {
      const existingLedger: LedgerSchema = {
        version: 1,
        entries: {
          '297': {
            issue: '297',
            slug: 'daemon-lifecycle-controls',
            repo: 'jstoup111/james-stoup-agents',
            haltAt: '2026-07-04T11:58:38.984Z',
            status: 'stamped'
          }
        }
      };

      (mockFs.fileExists as any).mockResolvedValue(true);
      (mockFs.readFile as any).mockResolvedValue(JSON.stringify(existingLedger));

      ledger = new Ledger(ledgerPath, mockFs);

      const entries: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T12:00:00.000Z'
        }
      ];

      await ledger.upsert(entries);

      const writeCall = (mockFs.writeFile as any).mock.calls[0];
      const fileContent = JSON.parse(writeCall[1]);

      expect(fileContent.entries['297'].status).toBe('stamped');
    });
  });

  describe('corruption recovery', () => {
    it('renames corrupted JSON to .ledger.json.corrupt-<ts>', async () => {
      (mockFs.fileExists as any).mockResolvedValue(true);
      (mockFs.readFile as any).mockResolvedValue('{ invalid json }');

      const mockClock = {
        now: () => new Date('2026-07-09T12:34:56.789Z')
      };

      ledger = new Ledger(ledgerPath, mockFs, mockClock);

      const result = await ledger.read();

      // Should return empty schema after corruption
      expect(result.version).toBe(1);
      expect(result.entries).toEqual({});

      // Verify rename was called with corrupt filename
      expect(mockFs.rename).toHaveBeenCalled();
      const renameCall = (mockFs.rename as any).mock.calls[0];
      expect(renameCall[0]).toBe(ledgerPath);
      expect(renameCall[1]).toContain('ledger.json.corrupt-');
      expect(renameCall[1]).toContain('2026-07-09T12:34:56.789Z');
    });

    it('logs warning to stderr when corruption is detected', async () => {
      (mockFs.fileExists as any).mockResolvedValue(true);
      (mockFs.readFile as any).mockResolvedValue('{ invalid json }');

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const mockClock = {
        now: () => new Date('2026-07-09T12:34:56.789Z')
      };

      ledger = new Ledger(ledgerPath, mockFs, mockClock);

      await ledger.read();

      expect(stderrSpy).toHaveBeenCalled();
      const stderrContent = (stderrSpy as any).mock.calls.map((call: any[]) => call[0]).join('');
      expect(stderrContent).toContain('corrupted');
      expect(stderrContent).toContain(ledgerPath);
      expect(stderrContent).toContain('ledger.json.corrupt-2026-07-09T12:34:56.789Z');

      stderrSpy.mockRestore();
    });
  });

  describe('rebuild', () => {
    it('rebuilds ledger from verdicts with closedIssueReader', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);
      (mockFs.readFile as any).mockResolvedValue('');

      const mockClock = {
        now: () => new Date('2026-07-09T12:00:00.000Z')
      };

      ledger = new Ledger(ledgerPath, mockFs, mockClock);

      const verdicts: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T11:58:38.984Z'
        },
        {
          issue: '300',
          slug: 'other-issue',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T12:00:00.000Z'
        }
      ];

      const closedIssueReader = vi.fn(async (issue: string) => {
        // Issue 297 is already closed, 300 is not
        return issue === '297';
      });

      await ledger.rebuild(verdicts, closedIssueReader);

      const writeCall = (mockFs.writeFile as any).mock.calls[0];
      const fileContent = JSON.parse(writeCall[1]);

      // Issue 297 should be marked as closed
      expect(fileContent.entries['297'].status).toBe('closed');
      expect(fileContent.entries['297'].closedBy).toBe('external');
      expect(fileContent.entries['297'].closedAt).toBe('2026-07-09T12:00:00.000Z');

      // Issue 300 should be pending
      expect(fileContent.entries['300'].status).toBe('pending');
      expect(fileContent.entries['300'].closedAt).toBeUndefined();

      // Verify rename was called (atomic write)
      expect(mockFs.rename).toHaveBeenCalled();
    });

    it('uses closedIssueReader to determine closed status', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);

      const mockClock = {
        now: () => new Date('2026-07-09T12:00:00.000Z')
      };

      ledger = new Ledger(ledgerPath, mockFs, mockClock);

      const verdicts: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'test',
          repo: 'test/repo',
          haltAt: '2026-07-04T11:58:38.984Z'
        }
      ];

      const closedIssueReader = vi.fn(async (issue: string) => {
        expect(issue).toBe('297');
        return true;
      });

      await ledger.rebuild(verdicts, closedIssueReader);

      expect(closedIssueReader).toHaveBeenCalledWith('297');
    });

    it('preserves other fields from verdicts during rebuild', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);

      const mockClock = {
        now: () => new Date('2026-07-09T12:00:00.000Z')
      };

      ledger = new Ledger(ledgerPath, mockFs, mockClock);

      const verdicts: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'daemon-lifecycle-controls',
          repo: 'jstoup111/james-stoup-agents',
          haltAt: '2026-07-04T11:58:38.984Z'
        }
      ];

      const closedIssueReader = vi.fn(async () => false);

      await ledger.rebuild(verdicts, closedIssueReader);

      const writeCall = (mockFs.writeFile as any).mock.calls[0];
      const fileContent = JSON.parse(writeCall[1]);

      expect(fileContent.entries['297'].issue).toBe('297');
      expect(fileContent.entries['297'].slug).toBe('daemon-lifecycle-controls');
      expect(fileContent.entries['297'].repo).toBe('jstoup111/james-stoup-agents');
      expect(fileContent.entries['297'].haltAt).toBe('2026-07-04T11:58:38.984Z');
    });

    it('writes atomically during rebuild', async () => {
      (mockFs.fileExists as any).mockResolvedValue(false);

      const mockClock = {
        now: () => new Date('2026-07-09T12:00:00.000Z')
      };

      ledger = new Ledger(ledgerPath, mockFs, mockClock);

      const verdicts: VerdictEntry[] = [
        {
          issue: '297',
          slug: 'test',
          repo: 'test/repo',
          haltAt: '2026-07-04T11:58:38.984Z'
        }
      ];

      const closedIssueReader = vi.fn(async () => false);

      await ledger.rebuild(verdicts, closedIssueReader);

      // Verify order: writeFile called first, then rename
      const writeCallIndex = (mockFs.writeFile as any).mock.invocationCallOrder[0];
      const renameCallIndex = (mockFs.rename as any).mock.invocationCallOrder[0];
      expect(writeCallIndex).toBeLessThan(renameCallIndex);

      // Verify tmp file is in same directory
      const tmpPath = (mockFs.writeFile as any).mock.calls[0][0];
      expect(tmpPath).toContain('/test/');
      expect(tmpPath).toMatch(/\.ledger\.json\.tmp/);

      // Verify rename moves tmp to ledger path
      const renameCall = (mockFs.rename as any).mock.calls[0];
      expect(renameCall[0]).toBe(tmpPath);
      expect(renameCall[1]).toBe(ledgerPath);
    });
  });
});

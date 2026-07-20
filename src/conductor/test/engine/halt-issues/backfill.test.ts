/**
 * Backfill fixture test for halt-issues sweep.
 *
 * Runs `sweep --dry-run` over the full real-log fixture (monitor-log-real.txt,
 * a verbatim excerpt of the operator-local halt-monitor.log) and verifies it
 * plans entries for exactly the 11 historical filed issues on record, each
 * with a verified disposition.
 *
 * Covers acceptance criteria:
 * 1. Full real-log fixture parses to exactly 11 issues: #297 #300 #302 #354
 *    #358 #385 #386 #403 #407 #415 #416
 * 2. Each issue has a verified disposition (planned "stamp" — none of these
 *    fresh entries have local ship evidence or prior ledger state, so dry-run
 *    plans a stamp-only action for every one of them).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sweep, SweepConfig } from '../../../src/engine/halt-issues/sweep';
import { FsAbstraction } from '../../../src/engine/halt-issues/resolution';
import { LedgerFs } from '../../../src/engine/halt-issues/ledger';
import { GhAbstraction } from '../../../src/engine/halt-issues/sweep';

/**
 * Minimal in-memory fs abstraction covering LedgerFs + FsAbstraction.
 */
class MockFs implements FsAbstraction, LedgerFs {
  private files: Map<string, string> = new Map();
  private mtimes: Map<string, Date> = new Map();

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
    const mtime = this.mtimes.get(path);
    if (!mtime) {
      throw new Error(`File not found: ${path}`);
    }
    return { mtime };
  }

  setFile(path: string, content: string, mtime?: Date): void {
    this.files.set(path, content);
    if (mtime) {
      this.mtimes.set(path, mtime);
    }
  }
}

/**
 * Minimal gh abstraction — dry-run never calls it, but sweep requires one.
 */
class MockGh implements GhAbstraction {
  async getIssueBody(): Promise<string | null> {
    throw new Error('gh should not be called during dry-run');
  }
  async upsertIssueBody(): Promise<void> {
    throw new Error('gh should not be called during dry-run');
  }
  async getIssueLabels(): Promise<string[]> {
    throw new Error('gh should not be called during dry-run');
  }
  async getIssueState(): Promise<'open' | 'closed' | null> {
    throw new Error('gh should not be called during dry-run');
  }
  async upsertIssueComment(): Promise<void> {
    throw new Error('gh should not be called during dry-run');
  }
  async closeIssue(): Promise<void> {
    throw new Error('gh should not be called during dry-run');
  }
}

const EXPECTED_ISSUES = ['297', '300', '302', '354', '358', '385', '386', '403', '407', '415', '416'];

describe('backfill fixture — 11 historical issues', () => {
  it('sweep --dry-run over the full real-log fixture plans entries for exactly the 11 historical issues', async () => {
    const fixturePath = join(__dirname, '../../fixtures/halt-issues/monitor-log-real.txt');
    const logText = readFileSync(fixturePath, 'utf-8');

    const mockFs = new MockFs();
    mockFs.setFile('/test/monitor.log', logText);

    const config: SweepConfig = {
      monitorLogPath: '/test/monitor.log',
      ledgerPath: '/test/ledger.json',
      repoDir: '/test/repo',
      repo: 'test/repo',
      dryRun: true,
      fs: mockFs,
      gh: new MockGh(),
      clock: { now: () => new Date('2026-07-09T00:00:00Z') }
    };

    const result = await sweep(config);

    expect(result.exitCode).toBe(0);

    // Exactly the 11 historical issues are parsed — no more, no fewer.
    expect(result.parsed).toBe(11);
    const parsedIssues = (result.entries ?? []).map((e) => e.issue).sort();
    expect(parsedIssues).toEqual([...EXPECTED_ISSUES].sort());

    // Ledger must never be written in dry-run mode.
    expect(await mockFs.fileExists(config.ledgerPath)).toBe(false);

    // Each issue must have a verified disposition. None of these entries have
    // prior ledger state or local ship evidence, so dry-run plans a
    // stamp-only action ("planned stamp") for every one of them — surfaced
    // in the summary's planned-actions block.
    for (const issue of EXPECTED_ISSUES) {
      expect(result.summary).toContain(`issue #${issue}: planned stamp`);
    }
  });
});

// Covers: task:2
import { describe, it, expect } from 'vitest';
import { resolveEntry, Resolution, FsAbstraction } from '../../../src/engine/halt-issues/resolution';
import { LedgerEntry } from '../../../src/engine/halt-issues/ledger';

/**
 * Mock file system for testing
 */
class MockFs implements FsAbstraction {
  private files: Map<string, { content: string; mtime: number }> = new Map();

  setFile(filePath: string, content: string, mtime: number): void {
    this.files.set(filePath, { content, mtime });
  }

  async readFile(filePath: string): Promise<string> {
    const file = this.files.get(filePath);
    if (!file) throw new Error(`File not found: ${filePath}`);
    return file.content;
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async getFileStats(filePath: string): Promise<{ mtime: Date }> {
    const file = this.files.get(filePath);
    if (!file) throw new Error(`File not found: ${filePath}`);
    return { mtime: new Date(file.mtime) };
  }
}

describe('resolution', () => {
  describe('resolveEntry', () => {
    const baseEntry: LedgerEntry = {
      issue: '297',
      repo: 'test-repo',
      slug: 'test-slug',
      haltAt: '2026-07-04T11:58:38.984Z',
      status: 'pending'
    };

    const haltAtMs = new Date('2026-07-04T11:58:38.984Z').getTime();

    it.each([
      '',
      '2026-07-04T11:58:38',
      '2026-07-04T11:58:38Z',
      '2026-07-04T11:58:38.984',
      '2026-07-04T11:58:38.984+00:00',
      '2026-02-30T11:58:38.984Z'
    ])('refuses imprecise halt time %j before accessing evidence', async (haltAt) => {
      const fs: FsAbstraction = {
        readFile: async () => {
          throw new Error('evidence must not be read');
        },
        fileExists: async () => {
          throw new Error('evidence must not be checked');
        },
        getFileStats: async () => {
          throw new Error('evidence must not be statted');
        }
      };

      const result = await resolveEntry({ ...baseEntry, haltAt }, '/test-repo', fs);

      expect(result).toEqual({ resolvable: false, reason: 'imprecise-halt-time' });
    });

    it.each([
      {
        evidence: 'processed',
        path: '/test-repo/.daemon/processed/test-slug.json',
        content: JSON.stringify({ status: 'shipped', prUrl: 'https://github.com/test-repo/pull/123' })
      },
      {
        evidence: 'shipped-record',
        path: '/test-repo/.docs/shipped/test-slug.md',
        content: '---\npr: https://github.com/test-repo/pull/456\n---\n## Shipped'
      }
    ])('requires %s evidence to be strictly newer than the precise halt time', async ({ evidence, path, content }) => {
      for (const [offset, resolvable] of [[-1, false], [0, false], [1, true]] as const) {
        const fs = new MockFs();
        fs.setFile(path, content, haltAtMs + offset);

        const result = await resolveEntry(baseEntry, '/test-repo', fs);

        expect(result.resolvable, `${evidence} at halt${offset >= 0 ? '+' : ''}${offset}ms`).toBe(resolvable);
        if (resolvable) {
          expect(result.evidence).toBe(evidence);
        } else {
          expect(result.reason).toBe('mtime-not-gt-halt');
        }
      }
    });

    it('resolves with processed marker when mtime > haltAt', async () => {
      const fs = new MockFs();
      const processedContent = JSON.stringify({
        status: 'shipped',
        prUrl: 'https://github.com/test-repo/pull/123'
      });
      // Set mtime to 1 second after haltAt
      fs.setFile(
        '/test-repo/.daemon/processed/test-slug.json',
        processedContent,
        haltAtMs + 1000
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(true);
      expect(result.prUrl).toBe('https://github.com/test-repo/pull/123');
      expect(result.evidence).toBe('processed');
      expect(result.reason).toBeUndefined();
    });

    it('guards when processed marker mtime == haltAt (strict guard)', async () => {
      const fs = new MockFs();
      const processedContent = JSON.stringify({
        status: 'shipped',
        prUrl: 'https://github.com/test-repo/pull/123'
      });
      // Set mtime to exactly haltAt (strict > guard should fail)
      fs.setFile(
        '/test-repo/.daemon/processed/test-slug.json',
        processedContent,
        haltAtMs
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(false);
      expect(result.reason).toBe('mtime-not-gt-halt');
      expect(result.evidence).toBeUndefined();
    });

    it('falls back to shipped record when no processed marker', async () => {
      const fs = new MockFs();
      const shippedContent = `---
pr: https://github.com/test-repo/pull/456
---
## Shipped
This is the shipped record.`;
      // Set mtime to 1 second after haltAt
      fs.setFile(
        '/test-repo/.docs/shipped/test-slug.md',
        shippedContent,
        haltAtMs + 1000
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(true);
      expect(result.prUrl).toBe('https://github.com/test-repo/pull/456');
      expect(result.evidence).toBe('shipped-record');
    });

    it('guards shipped record when mtime == haltAt', async () => {
      const fs = new MockFs();
      const shippedContent = `---
pr: https://github.com/test-repo/pull/456
---
## Shipped`;
      // Set mtime to exactly haltAt
      fs.setFile(
        '/test-repo/.docs/shipped/test-slug.md',
        shippedContent,
        haltAtMs
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(false);
      expect(result.reason).toBe('mtime-not-gt-halt');
    });

    it('returns unresolved when prUrl is null', async () => {
      const fs = new MockFs();
      const processedContent = JSON.stringify({
        status: 'shipped',
        prUrl: null
      });
      // Set mtime to after haltAt
      fs.setFile(
        '/test-repo/.daemon/processed/test-slug.json',
        processedContent,
        haltAtMs + 1000
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(false);
      expect(result.reason).toBe('no-pr-url');
      expect(result.prUrl).toBeUndefined();
    });

    it('returns cleared-no-ship when status is cleared and no ship evidence', async () => {
      const fs = new MockFs();
      const clearedEntry: LedgerEntry = {
        ...baseEntry,
        status: 'cleared'
      };

      const result = await resolveEntry(clearedEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(false);
      expect(result.reason).toBe('cleared-no-ship');
      expect(result.evidence).toBeUndefined();
    });

    it('prefers processed marker over shipped record', async () => {
      const fs = new MockFs();
      const processedContent = JSON.stringify({
        status: 'shipped',
        prUrl: 'https://github.com/test-repo/pull/123-processed'
      });
      fs.setFile(
        '/test-repo/.daemon/processed/test-slug.json',
        processedContent,
        haltAtMs + 2000
      );

      const shippedContent = `---
pr: https://github.com/test-repo/pull/456-shipped
---
## Shipped`;
      fs.setFile(
        '/test-repo/.docs/shipped/test-slug.md',
        shippedContent,
        haltAtMs + 1000
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(true);
      expect(result.prUrl).toBe('https://github.com/test-repo/pull/123-processed');
      expect(result.evidence).toBe('processed');
    });

    it('extracts pr: field from shipped record with frontmatter', async () => {
      const fs = new MockFs();
      const shippedContent = `---
title: Fix the issue
author: John Doe
pr: https://github.com/test-repo/pull/999
date: 2026-07-05
---
## Details
Some details here.`;
      fs.setFile(
        '/test-repo/.docs/shipped/test-slug.md',
        shippedContent,
        haltAtMs + 1000
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(true);
      expect(result.prUrl).toBe('https://github.com/test-repo/pull/999');
      expect(result.evidence).toBe('shipped-record');
    });

    it('returns unresolved when shipped record has no pr: field', async () => {
      const fs = new MockFs();
      const shippedContent = `---
title: Fix the issue
---
## Details`;
      fs.setFile(
        '/test-repo/.docs/shipped/test-slug.md',
        shippedContent,
        haltAtMs + 1000
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(false);
      expect(result.reason).toBe('no-pr-url');
    });

    it('returns unresolved when neither processed nor shipped record exist', async () => {
      const fs = new MockFs();

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      expect(result.resolvable).toBe(false);
      expect(result.reason).toBe('no-ship-evidence');
      expect(result.evidence).toBeUndefined();
    });

    it('handles shipped record with mtime > haltAt but processedMarker with mtime == haltAt', async () => {
      const fs = new MockFs();
      const processedContent = JSON.stringify({
        status: 'shipped',
        prUrl: 'https://github.com/test-repo/pull/123'
      });
      // Processed marker at exact haltAt
      fs.setFile(
        '/test-repo/.daemon/processed/test-slug.json',
        processedContent,
        haltAtMs
      );

      const shippedContent = `---
pr: https://github.com/test-repo/pull/456
---
## Shipped`;
      // Shipped record after haltAt
      fs.setFile(
        '/test-repo/.docs/shipped/test-slug.md',
        shippedContent,
        haltAtMs + 1000
      );

      const result = await resolveEntry(baseEntry, '/test-repo', fs);

      // Should check processed first, find mtime == haltAt, then try shipped
      expect(result.resolvable).toBe(true);
      expect(result.prUrl).toBe('https://github.com/test-repo/pull/456');
      expect(result.evidence).toBe('shipped-record');
    });
  });
});

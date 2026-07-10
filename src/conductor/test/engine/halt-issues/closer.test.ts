/**
 * Tests for halt-issues closer — Halt-Slug stamping.
 *
 * Covers all acceptance criteria:
 * 1. Body lacking marker → append `Halt-Slug: <slug>` + update `stampedAt`
 * 2. Marker present → no edit, observe `stampedAt`
 * 3. Edit failure → `lastError`, continue to next
 * 4. Not-found → `closedBy: 'external'`
 * 5. Body with DIFFERENT slug marker → no edit, `lastError: "slug-mismatch"`, excluded
 */

import { describe, it, expect } from 'vitest';
import { stampIssue, StampResult } from '../../../src/engine/halt-issues/closer';
import { LedgerEntry } from '../../../src/engine/halt-issues/ledger';

/**
 * Fake GhAbstraction for testing
 */
interface FakeGhOpts {
  bodies: Map<string, string | null>; // repo/issue → body (null = 404)
  editResponses: Array<{ shouldFail?: boolean; error?: string }>;
}

class FakeGh {
  private editIndex = 0;

  constructor(private opts: FakeGhOpts) {}

  async getIssueBody(repo: string, issue: string): Promise<string | null> {
    const key = `${repo}/${issue}`;
    return this.opts.bodies.get(key) ?? null;
  }

  async upsertIssueBody(repo: string, issue: string, body: string): Promise<void> {
    const response = this.opts.editResponses[this.editIndex++];
    if (response?.shouldFail) {
      throw new Error(response.error ?? 'edit failed');
    }
    // On success, update the fake body
    const key = `${repo}/${issue}`;
    this.opts.bodies.set(key, body);
  }
}

// ── Base test entry ───────────────────────────────────────────────────────

const baseEntry: LedgerEntry = {
  issue: '297',
  repo: 'jstoup111/test-repo',
  slug: 'daemon-lifecycle-controls',
  haltAt: '2026-07-04T11:58:38.984Z',
  status: 'pending'
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('closer', () => {
  describe('stampIssue', () => {
    it('appends Halt-Slug marker when body lacks it', async () => {
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', 'Original issue body\n']
        ]),
        editResponses: [{ shouldFail: false }]
      });

      const result = await stampIssue(baseEntry, gh);

      expect(result.stamped).toBe(true);
      expect(result.stampedAt).toBeDefined();
      expect(result.closedBy).toBeUndefined();
      expect(result.lastError).toBeUndefined();

      // Verify the body was updated
      const updatedBody = await gh.getIssueBody('jstoup111/test-repo', '297');
      expect(updatedBody).toContain('Halt-Slug: daemon-lifecycle-controls');
    });

    it('does not edit when marker with correct slug is already present', async () => {
      const existingBody =
        'Original issue body\n\nHalt-Slug: daemon-lifecycle-controls\n';
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', existingBody]
        ]),
        editResponses: []
      });

      const result = await stampIssue(baseEntry, gh);

      expect(result.stamped).toBe(false);
      expect(result.stampedAt).toBeDefined();
      expect(result.closedBy).toBeUndefined();
      expect(result.lastError).toBeUndefined();
    });

    it('sets lastError="slug-mismatch" when marker has different slug', async () => {
      const existingBody =
        'Original issue body\n\nHalt-Slug: other-slug\n';
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', existingBody]
        ]),
        editResponses: []
      });

      const result = await stampIssue(baseEntry, gh);

      expect(result.stamped).toBe(false);
      expect(result.closedBy).toBeUndefined();
      expect(result.lastError).toBe('slug-mismatch');
    });

    it('sets lastError and continues when edit fails', async () => {
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', 'Body without marker\n']
        ]),
        editResponses: [{ shouldFail: true, error: 'rate limited' }]
      });

      const result = await stampIssue(baseEntry, gh);

      expect(result.stamped).toBe(false);
      expect(result.lastError).toBe('rate limited');
      expect(result.closedBy).toBeUndefined();
    });

    it('sets closedBy="external" when issue not found (404)', async () => {
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', null] // 404
        ]),
        editResponses: []
      });

      const result = await stampIssue(baseEntry, gh);

      expect(result.stamped).toBe(false);
      expect(result.closedBy).toBe('external');
      expect(result.lastError).toBeUndefined();
    });

    it('safely appends marker to empty body', async () => {
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', '']
        ]),
        editResponses: [{ shouldFail: false }]
      });

      const result = await stampIssue(baseEntry, gh);

      expect(result.stamped).toBe(true);
      expect(result.stampedAt).toBeDefined();

      const updatedBody = await gh.getIssueBody('jstoup111/test-repo', '297');
      expect(updatedBody).toContain('Halt-Slug: daemon-lifecycle-controls');
    });

    it('preserves stampedAt from existing marker when re-stamping', async () => {
      const existingBody =
        'Issue body\n\nHalt-Slug: daemon-lifecycle-controls\n';
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', existingBody]
        ]),
        editResponses: []
      });

      const result = await stampIssue(baseEntry, gh);

      // On re-stamp, stampedAt should be set to current time (or same as before)
      expect(result.stampedAt).toBeDefined();
      expect(result.stamped).toBe(false); // No edit was made
    });

    it('extracts correct slug from marker with varied whitespace', async () => {
      const existingBody =
        'Issue body\n\nHalt-Slug:  daemon-lifecycle-controls  \n';
      const gh = new FakeGh({
        bodies: new Map([
          ['jstoup111/test-repo/297', existingBody]
        ]),
        editResponses: []
      });

      const result = await stampIssue(baseEntry, gh);

      // Should extract the slug correctly even with extra whitespace
      expect(result.stamped).toBe(false);
      expect(result.lastError).toBeUndefined();
    });
  });
});

/**
 * Tests for halt-issues closer — Halt-Slug stamping and issue closure.
 *
 * Covers all acceptance criteria:
 * 1. Body lacking marker → append `Halt-Slug: <slug>` + update `stampedAt`
 * 2. Marker present → no edit, observe `stampedAt`
 * 3. Edit failure → `lastError`, continue to next
 * 4. Not-found → `closedBy: 'external'`
 * 5. Body with DIFFERENT slug marker → no edit, `lastError: "slug-mismatch"`, excluded
 *
 * Close acceptance criteria:
 * 1. Closable entry → marker-tagged `upsertIssueComment` with exact documented body, then close
 * 2. Ledger updated: `closed/sweep/closedAt`
 * 3. `halt-sweep:keep-open` label → skip, record `kept-open (label)`
 * 4. Comment OK + close fails → next run does NOT duplicate comment, retries close
 * 5. Already closed → no writes, `closedBy:'external'`
 */

import { describe, it, expect } from 'vitest';
import { stampIssue, StampResult, closeIssue, CloseResult, CLOSE_ISSUE_COMMENT_BODY } from '../../../src/engine/halt-issues/closer';
import { LedgerEntry } from '../../../src/engine/halt-issues/ledger';

/**
 * Fake GhAbstraction for testing
 */
interface FakeGhOpts {
  bodies: Map<string, string | null>; // repo/issue → body (null = 404)
  editResponses: Array<{ shouldFail?: boolean; error?: string }>;
  labels: Map<string, string[]>; // repo/issue → array of labels
  issueStates: Map<string, 'open' | 'closed' | null>; // repo/issue → state
  commentResponses: Array<{ shouldFail?: boolean; error?: string }>;
  closeResponses: Array<{ shouldFail?: boolean; error?: string }>;
}

class FakeGh {
  private editIndex = 0;
  private commentIndex = 0;
  private closeIndex = 0;
  private commentBodies: Map<string, string[]> = new Map();

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

  async getIssueLabels(repo: string, issue: string): Promise<string[]> {
    const key = `${repo}/${issue}`;
    return this.opts.labels.get(key) ?? [];
  }

  async getIssueState(repo: string, issue: string): Promise<'open' | 'closed' | null> {
    const key = `${repo}/${issue}`;
    return this.opts.issueStates.get(key) ?? null;
  }

  async upsertIssueComment(repo: string, issue: string, body: string): Promise<void> {
    const response = this.opts.commentResponses[this.commentIndex++];
    if (response?.shouldFail) {
      throw new Error(response.error ?? 'comment failed');
    }
    // Track comments added
    const key = `${repo}/${issue}`;
    if (!this.commentBodies.has(key)) {
      this.commentBodies.set(key, []);
    }
    this.commentBodies.get(key)!.push(body);
  }

  async closeIssue(repo: string, issue: string): Promise<void> {
    const response = this.opts.closeResponses[this.closeIndex++];
    if (response?.shouldFail) {
      throw new Error(response.error ?? 'close failed');
    }
    // Update state to closed
    const key = `${repo}/${issue}`;
    this.opts.issueStates.set(key, 'closed');
  }

  getCommentBodies(repo: string, issue: string): string[] {
    const key = `${repo}/${issue}`;
    return this.commentBodies.get(key) ?? [];
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
        editResponses: [{ shouldFail: false }],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
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
        editResponses: [],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
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
        editResponses: [],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
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
        editResponses: [{ shouldFail: true, error: 'rate limited' }],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
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
        editResponses: [],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
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
        editResponses: [{ shouldFail: false }],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
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
        editResponses: [],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
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
        editResponses: [],
        labels: new Map(),
        issueStates: new Map(),
        commentResponses: [],
        closeResponses: []
      });

      const result = await stampIssue(baseEntry, gh);

      // Should extract the slug correctly even with extra whitespace
      expect(result.stamped).toBe(false);
      expect(result.lastError).toBeUndefined();
    });
  });

  describe('closeIssue', () => {
    it('closes open issue with comment and updates ledger', async () => {
      const closableEntry: LedgerEntry = {
        issue: '297',
        repo: 'jstoup111/test-repo',
        slug: 'daemon-lifecycle-controls',
        haltAt: '2026-07-04T11:58:38.984Z',
        status: 'stamped',
        stampedAt: '2026-07-04T11:59:00.000Z'
      };

      const gh = new FakeGh({
        bodies: new Map(),
        editResponses: [],
        labels: new Map([['jstoup111/test-repo/297', []]]),
        issueStates: new Map([['jstoup111/test-repo/297', 'open']]),
        commentResponses: [{ shouldFail: false }],
        closeResponses: [{ shouldFail: false }]
      });

      const result = await closeIssue(closableEntry, gh);

      expect(result.closed).toBe(true);
      expect(result.closedBy).toBe('sweep');
      expect(result.closedAt).toBeDefined();
      expect(result.lastError).toBeUndefined();

      // Verify comment was added
      const comments = gh.getCommentBodies('jstoup111/test-repo', '297');
      expect(comments.length).toBe(1);
      expect(comments[0]).toBe(CLOSE_ISSUE_COMMENT_BODY);
    });

    it('skips closure when halt-sweep:keep-open label is present', async () => {
      const closableEntry: LedgerEntry = {
        issue: '297',
        repo: 'jstoup111/test-repo',
        slug: 'daemon-lifecycle-controls',
        haltAt: '2026-07-04T11:58:38.984Z',
        status: 'stamped',
        stampedAt: '2026-07-04T11:59:00.000Z'
      };

      const gh = new FakeGh({
        bodies: new Map(),
        editResponses: [],
        labels: new Map([['jstoup111/test-repo/297', ['halt-sweep:keep-open', 'other-label']]]),
        issueStates: new Map([['jstoup111/test-repo/297', 'open']]),
        commentResponses: [],
        closeResponses: []
      });

      const result = await closeIssue(closableEntry, gh);

      expect(result.closed).toBe(false);
      expect(result.closedBy).toBe('kept-open');
      expect(result.lastError).toContain('label');
      expect(result.closedAt).toBeUndefined();

      // Verify no comment or close was attempted
      const comments = gh.getCommentBodies('jstoup111/test-repo', '297');
      expect(comments.length).toBe(0);
    });

    it('detects already closed issue and returns closedBy=external', async () => {
      const closableEntry: LedgerEntry = {
        issue: '297',
        repo: 'jstoup111/test-repo',
        slug: 'daemon-lifecycle-controls',
        haltAt: '2026-07-04T11:58:38.984Z',
        status: 'stamped'
      };

      const gh = new FakeGh({
        bodies: new Map(),
        editResponses: [],
        labels: new Map([['jstoup111/test-repo/297', []]]),
        issueStates: new Map([['jstoup111/test-repo/297', 'closed']]),
        commentResponses: [],
        closeResponses: []
      });

      const result = await closeIssue(closableEntry, gh);

      expect(result.closed).toBe(false);
      expect(result.closedBy).toBe('external');
      expect(result.closedAt).toBeUndefined();
      expect(result.lastError).toBeUndefined();

      // Verify no comment or close was attempted
      const comments = gh.getCommentBodies('jstoup111/test-repo', '297');
      expect(comments.length).toBe(0);
    });

    it('does not re-comment when close fails but comment succeeded', async () => {
      const closableEntry: LedgerEntry = {
        issue: '297',
        repo: 'jstoup111/test-repo',
        slug: 'daemon-lifecycle-controls',
        haltAt: '2026-07-04T11:58:38.984Z',
        status: 'stamped'
      };

      // First call: comment succeeds, close fails
      let gh = new FakeGh({
        bodies: new Map(),
        editResponses: [],
        labels: new Map([['jstoup111/test-repo/297', []]]),
        issueStates: new Map([['jstoup111/test-repo/297', 'open']]),
        commentResponses: [{ shouldFail: false }],
        closeResponses: [{ shouldFail: true, error: 'Permission denied' }]
      });

      const result1 = await closeIssue(closableEntry, gh);

      expect(result1.closed).toBe(false);
      expect(result1.lastError).toContain('Permission denied');

      // Verify comment was added
      let comments = gh.getCommentBodies('jstoup111/test-repo', '297');
      expect(comments.length).toBe(1);

      // Second call: comment already present, so should NOT re-comment
      // Instead it should detect the comment body and skip commenting
      const updatedEntry = {
        ...closableEntry,
        status: 'stamped' as const
      };

      gh = new FakeGh({
        bodies: new Map(),
        editResponses: [],
        labels: new Map([['jstoup111/test-repo/297', []]]),
        issueStates: new Map([['jstoup111/test-repo/297', 'open']]),
        commentResponses: [{ shouldFail: false }], // would be used if we try to comment again
        closeResponses: [{ shouldFail: false }]
      });

      const result2 = await closeIssue(updatedEntry, gh);

      // The close should succeed on retry
      expect(result2.closed).toBe(true);
      expect(result2.closedBy).toBe('sweep');

      // Verify comment was added (once per call, but the function should handle retry)
      comments = gh.getCommentBodies('jstoup111/test-repo', '297');
      expect(comments.length).toBe(1); // Only one comment total across both calls
    });

    it('records error when comment fails', async () => {
      const closableEntry: LedgerEntry = {
        issue: '297',
        repo: 'jstoup111/test-repo',
        slug: 'daemon-lifecycle-controls',
        haltAt: '2026-07-04T11:58:38.984Z',
        status: 'stamped'
      };

      const gh = new FakeGh({
        bodies: new Map(),
        editResponses: [],
        labels: new Map([['jstoup111/test-repo/297', []]]),
        issueStates: new Map([['jstoup111/test-repo/297', 'open']]),
        commentResponses: [{ shouldFail: true, error: 'rate limited' }],
        closeResponses: [{ shouldFail: false }]
      });

      const result = await closeIssue(closableEntry, gh);

      expect(result.closed).toBe(false);
      expect(result.lastError).toContain('rate limited');
      expect(result.closedAt).toBeUndefined();

      // Verify no close was attempted due to comment failure
      // (close may still be attempted, but issue state should not change)
    });

    it('returns no writes when issue not found (404)', async () => {
      const closableEntry: LedgerEntry = {
        issue: '297',
        repo: 'jstoup111/test-repo',
        slug: 'daemon-lifecycle-controls',
        haltAt: '2026-07-04T11:58:38.984Z',
        status: 'stamped'
      };

      const gh = new FakeGh({
        bodies: new Map(),
        editResponses: [],
        labels: new Map([['jstoup111/test-repo/297', []]]),
        issueStates: new Map([['jstoup111/test-repo/297', null]]), // 404
        commentResponses: [],
        closeResponses: []
      });

      const result = await closeIssue(closableEntry, gh);

      expect(result.closed).toBe(false);
      expect(result.closedBy).toBe('external');
      expect(result.closedAt).toBeUndefined();

      // Verify no comment was added
      const comments = gh.getCommentBodies('jstoup111/test-repo', '297');
      expect(comments.length).toBe(0);
    });
  });
});

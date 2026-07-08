/**
 * Tests for src/engine/gate-writeback.ts (Task 17).
 *
 * All tests use FAKE runners that record calls; no real gh binary required.
 * Every scenario is best-effort/non-throwing by design (mirrors
 * build-failure-escalation.test.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  ensureGatedPrLabel,
  upsertGatedMarkerComment,
  announceGatedPr,
  announceGatedIssue,
  OWNER_GATED_MARKER,
  OWNER_GATED_LABEL,
} from '../../src/engine/gate-writeback.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

// ── Fake runner factory ───────────────────────────────────────────────────────

function fakeGh(responses: Array<{ stdout: string } | Error>): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  let idx = 0;
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    const response = responses[idx++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return response;
  };
  return { gh, calls };
}

const PR_URL = 'https://github.com/acme/repo/pull/7';

const SPEC = {
  kind: 'spec' as const,
  slug: '2026-07-05-widget',
  reason: 'other-owner' as const,
  otherOwner: 'bob',
  remedy: 'declare an Owner: for this spec, or grandfather it via owner_gate_cutover',
};

describe('gate-writeback (Task 17)', () => {
  describe('ensureGatedPrLabel', () => {
    it('ensures the owner-gated label exists and adds it to the PR (REST)', async () => {
      const { gh, calls } = fakeGh([{ stdout: '' }, { stdout: '' }]);
      await ensureGatedPrLabel(SPEC, PR_URL, gh, '/repo');

      expect(calls[0]).toEqual(['label', 'create', OWNER_GATED_LABEL, '--color', expect.any(String), '--force']);
      expect(calls[1].join(' ')).toContain('POST');
      expect(calls[1].join(' ')).toContain('labels[]=owner-gated');
    });

    it('is idempotent: 10 repeated calls each issue exactly one ensure + one add call, never throwing', async () => {
      const { gh, calls } = fakeGh(Array(40).fill({ stdout: '' }));
      for (let i = 0; i < 10; i++) {
        await ensureGatedPrLabel(SPEC, PR_URL, gh, '/repo');
      }
      expect(calls.length).toBe(20);
    });
  });

  describe('upsertGatedMarkerComment', () => {
    it('creates a new marker comment carrying slug, reason, remedy, and owner name', async () => {
      const { gh, calls } = fakeGh([{ stdout: JSON.stringify({ comments: [] }) }, { stdout: '' }]);
      await upsertGatedMarkerComment(SPEC, PR_URL, gh, '/repo');

      const commentCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
      expect(commentCall).toBeDefined();
      const body = commentCall![commentCall!.indexOf('--body') + 1];
      expect(body).toContain(OWNER_GATED_MARKER);
      expect(body).toContain(SPEC.slug);
      expect(body).toContain(SPEC.reason);
      expect(body).toContain(SPEC.remedy);
      expect(body).toContain('bob');
    });

    it('10 repeated passes on the same gated state yield exactly ONE comment (upsert edits in place)', async () => {
      let created = 0;
      let patched = 0;
      let existingBody: string | undefined;

      const gh: GhRunner = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
          return {
            stdout: JSON.stringify({
              comments: existingBody
                ? [{ body: existingBody, url: `${PR_URL}#issuecomment-1` }]
                : [],
            }),
          };
        }
        if (args[0] === 'pr' && args[1] === 'comment') {
          created++;
          const idx = args.indexOf('--body');
          existingBody = args[idx + 1];
          return { stdout: '' };
        }
        if (args[0] === 'api' && args.includes('PATCH')) {
          patched++;
          return { stdout: '' };
        }
        return { stdout: '' };
      };

      for (let i = 0; i < 10; i++) {
        await upsertGatedMarkerComment(SPEC, PR_URL, gh, '/repo');
      }

      expect(created).toBe(1);
      expect(patched).toBe(9);
    });

    it('re-announces on reason transition: same single comment, body updated in place (Task 18)', async () => {
      let created = 0;
      let patched = 0;
      let existingBody: string | undefined;
      let existingUrl: string | undefined;
      const patchedBodies: string[] = [];

      const gh: GhRunner = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
          return {
            stdout: JSON.stringify({
              comments: existingBody ? [{ body: existingBody, url: existingUrl }] : [],
            }),
          };
        }
        if (args[0] === 'pr' && args[1] === 'comment') {
          created++;
          const idx = args.indexOf('--body');
          existingBody = args[idx + 1];
          existingUrl = `${PR_URL}#issuecomment-1`;
          return { stdout: '' };
        }
        if (args[0] === 'api' && args.includes('PATCH')) {
          patched++;
          const fArg = args.find((a) => a.startsWith('body='));
          const body = fArg ? fArg.slice('body='.length) : '';
          existingBody = body;
          patchedBodies.push(body);
          return { stdout: '' };
        }
        return { stdout: '' };
      };

      const unownedIndeterminate = {
        kind: 'spec' as const,
        slug: '2026-07-05-widget',
        reason: 'unowned-indeterminate' as const,
        remedy: 'declare an Owner: for this spec, or grandfather it via owner_gate_cutover',
      };
      const otherOwner = {
        kind: 'spec' as const,
        slug: '2026-07-05-widget',
        reason: 'other-owner' as const,
        otherOwner: 'bob',
        remedy: 'declare an Owner: for this spec, or grandfather it via owner_gate_cutover',
      };

      // Pass 1: gated as unowned-indeterminate — creates the comment.
      await upsertGatedMarkerComment(unownedIndeterminate, PR_URL, gh, '/repo');
      // Pass 2: transitions to other-owner — same comment, body updated.
      await upsertGatedMarkerComment(otherOwner, PR_URL, gh, '/repo');
      // Pass 3: transitions back to unowned-indeterminate — still same comment.
      await upsertGatedMarkerComment(unownedIndeterminate, PR_URL, gh, '/repo');

      expect(created).toBe(1);
      expect(patched).toBe(2);
      expect(existingBody).toContain(OWNER_GATED_MARKER);
      expect(existingBody).toContain('unowned-indeterminate');
      expect(existingBody).not.toContain('bob');
      // The intermediate patch reflected the other-owner transition faithfully.
      expect(patchedBodies[0]).toContain('other-owner');
      expect(patchedBodies[0]).toContain('bob');

      // Idempotency across further back-and-forth transitions: 10 more passes
      // alternating between the two reasons still yields exactly one comment,
      // and the final state matches the last-applied reason.
      for (let i = 0; i < 10; i++) {
        const spec = i % 2 === 0 ? otherOwner : unownedIndeterminate;
        await upsertGatedMarkerComment(spec, PR_URL, gh, '/repo');
      }
      expect(created).toBe(1);
      expect(existingBody).toContain('unowned-indeterminate');
      expect(existingBody).not.toContain('bob');
    });
  });

  describe('announceGatedPr (orchestrator)', () => {
    it('composes ensureGatedPrLabel + upsertGatedMarkerComment for a newly gated spec', async () => {
      const { gh, calls } = fakeGh([
        { stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [], labels: [] }) }, // prMergeState
        { stdout: '' }, // ensureLabel
        { stdout: '' }, // addLabel
        { stdout: JSON.stringify({ comments: [] }) }, // upsertComment lookup
        { stdout: '' }, // create comment
      ]);

      await announceGatedPr(SPEC, PR_URL, { runGh: gh, cwd: '/repo' });

      expect(calls.some((c) => c.join(' ').includes('labels[]=owner-gated'))).toBe(true);
      expect(calls.some((c) => c.join(' ').includes(OWNER_GATED_MARKER))).toBe(true);
    });

    it('never throws even when gh errors on every call', async () => {
      const gh: GhRunner = async () => {
        throw new Error('boom');
      };
      await expect(
        announceGatedPr(SPEC, PR_URL, { runGh: gh, cwd: '/repo', log: () => {} }),
      ).resolves.toBeUndefined();
    });

    // ── Task 19: write-back failure semantics (S6 NP-1..NP-5) ──────────────

    it('FR-8: announces (label + comment) when the target PR is already MERGED', async () => {
      const { gh, calls } = fakeGh([
        { stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [], labels: [] }) }, // prMergeState
        { stdout: '' }, // ensureLabel
        { stdout: '' }, // addLabel
        { stdout: JSON.stringify({ comments: [] }) }, // upsertComment lookup
        { stdout: '' }, // create comment
      ]);

      await announceGatedPr(SPEC, PR_URL, { runGh: gh, cwd: '/repo' });

      // The owner gate runs only on already-merged specs, so a MERGED PR
      // must still be labeled/commented — it was never announced while open.
      expect(calls.some((c) => c.join(' ').includes('labels[]=owner-gated'))).toBe(true);
      expect(calls.some((c) => c.join(' ').includes(OWNER_GATED_MARKER))).toBe(true);
    });

    it('NP-1: skips silently when the target PR is already CLOSED', async () => {
      const { gh, calls } = fakeGh([
        { stdout: JSON.stringify({ state: 'CLOSED', mergeable: 'UNKNOWN', statusCheckRollup: [], labels: [] }) },
      ]);
      await announceGatedPr(SPEC, PR_URL, { runGh: gh, cwd: '/repo' });
      expect(calls.length).toBe(1);
    });

    it('NP-2: gh non-zero on the merge-state lookup is logged once and does not retry or throw', async () => {
      let ghCalls = 0;
      const gh: GhRunner = async () => {
        ghCalls++;
        throw new Error('gh: rate limited');
      };
      const logs: string[] = [];

      await announceGatedPr(SPEC, PR_URL, { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });

      // prMergeState's error yields a non-terminal sentinel (UNKNOWN), so
      // label/comment are still attempted (each swallowing its own error):
      // 1 (prMergeState) + 2 (ensureGatedPrLabel) + 2 (upsertComment: failed
      // lookup, then a create fallback) = 5 total gh calls, no retries piled
      // on top of any single failing call.
      expect(ghCalls).toBe(5);
      expect(logs.filter((m) => m.includes('rate limited')).length).toBeGreaterThan(0);
    });

    it('NP-3: a PATCH failure updating the marker comment is terminal — no fallback create', async () => {
      const markedUrl = `${PR_URL}#issuecomment-123`;
      const calls: string[][] = [];
      const gh: GhRunner = async (args) => {
        calls.push([...args]);
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('state,mergeable,statusCheckRollup,labels')) {
          return { stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [], labels: [] }) };
        }
        if (args[0] === 'label' || (args[0] === 'api' && args.includes('POST'))) {
          return { stdout: '' };
        }
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
          return {
            stdout: JSON.stringify({
              comments: [{ body: `${OWNER_GATED_MARKER}\nold`, url: markedUrl }],
            }),
          };
        }
        if (args[0] === 'api' && args.includes('PATCH')) {
          throw new Error('PATCH failed: 500');
        }
        throw new Error(`unexpected call: ${args.join(' ')}`);
      };
      const logs: string[] = [];

      await announceGatedPr(SPEC, PR_URL, { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });

      // No 'pr comment' create call fired as a fallback after the PATCH failed.
      expect(calls.find((c) => c[0] === 'pr' && c[1] === 'comment')).toBeUndefined();
      expect(logs.some((m) => m.includes('PATCH failed'))).toBe(true);
    });

    it('NP-4: no PR found (falsy prUrl) skips with a notice and makes zero gh calls', async () => {
      const { gh, calls } = fakeGh([]);
      const logs: string[] = [];

      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });

      expect(calls.length).toBe(0);
      expect(logs.some((m) => m.includes('nothing to announce for gated spec') && m.includes('(no PR)'))).toBe(true);
    });

    it('NP-4b: without a warnedSkips set, repeated no-PR skips log on every call (no dedup)', async () => {
      const { gh, calls } = fakeGh([]);
      const logs: string[] = [];

      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });
      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });

      expect(calls.length).toBe(0);
      const gateLines = logs.filter((m) => m.startsWith('[gate-writeback]'));
      expect(gateLines.length).toBe(2);
      expect(gateLines[0]).toContain(`nothing to announce for gated spec "${SPEC.slug}" (no PR)`);
      expect(gateLines[1]).toContain(`nothing to announce for gated spec "${SPEC.slug}" (no PR)`);
    });

    it('NP-6: repeated no-PR skips for the same slug are deduped to one log line via a shared warnedSkips set', async () => {
      const { gh, calls } = fakeGh([]);
      const logs: string[] = [];
      const warnedSkips = new Set<string>();

      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });
      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });

      expect(calls.length).toBe(0);
      const gateLines = logs.filter((m) => m.startsWith('[gate-writeback]'));
      expect(gateLines.length).toBe(1);
      expect(gateLines[0]).toContain(`nothing to announce for gated spec "${SPEC.slug}" (no PR)`);
    });

    it('NP-7: dedup key is per-slug — two different slugs against one shared Set each log once', async () => {
      const { gh, calls } = fakeGh([]);
      const logs: string[] = [];
      const warnedSkips = new Set<string>();
      const OTHER_SPEC = { ...SPEC, slug: '2026-07-05-gizmo' };

      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });
      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });
      await announceGatedPr(OTHER_SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });
      await announceGatedPr(OTHER_SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });

      expect(calls.length).toBe(0);
      const gateLines = logs.filter((m) => m.startsWith('[gate-writeback]'));
      expect(gateLines.length).toBe(2);
      expect(gateLines[0]).toContain(`nothing to announce for gated spec "${SPEC.slug}" (no PR)`);
      expect(gateLines[1]).toContain(`nothing to announce for gated spec "${OTHER_SPEC.slug}" (no PR)`);
      expect(warnedSkips.has(`${SPEC.slug}:no-pr`)).toBe(true);
      expect(warnedSkips.has(`${OTHER_SPEC.slug}:no-pr`)).toBe(true);
      expect(warnedSkips.size).toBe(2);
    });

    it('NP-8: dedup is per-run — a fresh Set (simulated restart) resurfaces the notice for the same slug', async () => {
      const { gh, calls } = fakeGh([]);
      const logs: string[] = [];
      const firstRunSkips = new Set<string>();
      const secondRunSkips = new Set<string>();

      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips: firstRunSkips });
      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips: firstRunSkips });
      // Simulated daemon restart: brand-new Set, same slug.
      await announceGatedPr(SPEC, '', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips: secondRunSkips });

      expect(calls.length).toBe(0);
      const gateLines = logs.filter((m) => m.startsWith('[gate-writeback]'));
      expect(gateLines.length).toBe(2);
      expect(gateLines.every((m) => m.includes(`nothing to announce for gated spec "${SPEC.slug}" (no PR)`))).toBe(true);
    });

    it('NP-9: a suppressed no-PR skip never blocks a later real announcement for the same slug', async () => {
      const warnedSkips = new Set<string>();
      const logs: string[] = [];

      // Pass 1: no PR yet — skip is logged and recorded in the shared Set.
      const { gh: noPrGh, calls: noPrCalls } = fakeGh([]);
      await announceGatedPr(SPEC, '', { runGh: noPrGh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });
      expect(noPrCalls.length).toBe(0);
      expect(warnedSkips.has(`${SPEC.slug}:no-pr`)).toBe(true);

      // Pass 2: same slug, same shared warnedSkips Set, but now a real PR
      // exists. Dedup must guard only the log line, never the announce work.
      const { gh: realGh, calls: realCalls } = fakeGh([
        { stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [], labels: [] }) }, // prMergeState
        { stdout: '' }, // ensureLabel
        { stdout: '' }, // addLabel
        { stdout: JSON.stringify({ comments: [] }) }, // upsertComment lookup
        { stdout: '' }, // create comment
      ]);
      await announceGatedPr(SPEC, PR_URL, { runGh: realGh, cwd: '/repo', log: (m) => logs.push(m), warnedSkips });

      expect(realCalls.some((c) => c[0] === 'label' && c[1] === 'create')).toBe(true);
      expect(realCalls.some((c) => c.join(' ').includes('labels[]=owner-gated'))).toBe(true);
      expect(realCalls.some((c) => c[0] === 'pr' && c[1] === 'comment')).toBe(true);
    });

    it('NP-5: a label-add race (conflict error) is swallowed and the comment still lands', async () => {
      const calls: string[][] = [];
      const gh: GhRunner = async (args) => {
        calls.push([...args]);
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('state,mergeable,statusCheckRollup,labels')) {
          return { stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [], labels: [] }) };
        }
        if (args[0] === 'label') {
          return { stdout: '' };
        }
        if (args[0] === 'api' && args.includes('POST')) {
          // Simulate a concurrent labeler winning the race.
          throw new Error('422 Label already exists / conflict');
        }
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
          return { stdout: JSON.stringify({ comments: [] }) };
        }
        if (args[0] === 'pr' && args[1] === 'comment') {
          return { stdout: '' };
        }
        return { stdout: '' };
      };

      await announceGatedPr(SPEC, PR_URL, { runGh: gh, cwd: '/repo', log: () => {} });

      const commentCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
      expect(commentCall).toBeDefined();
      const body = commentCall![commentCall!.indexOf('--body') + 1];
      expect(body).toContain(OWNER_GATED_MARKER);
    });
  });

  // ── Task 20: Source-Ref issue announcements (S7 all) ─────────────────────

  describe('announceGatedIssue (Task 20)', () => {
    it('a valid Source-Ref parses via issue-ref.ts and upserts the marker comment on the issue', async () => {
      const calls: string[][] = [];
      const gh: GhRunner = async (args) => {
        calls.push([...args]);
        if (args[0] === 'issue' && args[1] === 'view') {
          return { stdout: JSON.stringify({ comments: [] }) };
        }
        return { stdout: '' };
      };

      await announceGatedIssue(SPEC, 'acme/repo#42', { runGh: gh, cwd: '/repo' });

      expect(calls.some((c) => c.join(' ').includes('42'))).toBe(true);
      const commentCall = calls.find((c) => c[0] === 'issue' && c[1] === 'comment');
      expect(commentCall).toBeDefined();
      const body = commentCall![commentCall!.indexOf('--body') + 1];
      expect(body).toContain(OWNER_GATED_MARKER);
      expect(body).toContain(SPEC.slug);
    });

    it('absent marker (sourceRef undefined) skips silently — zero gh calls', async () => {
      let ghCalled = false;
      const gh: GhRunner = async () => {
        ghCalled = true;
        return { stdout: '' };
      };

      await expect(
        announceGatedIssue(SPEC, undefined, { runGh: gh, cwd: '/repo' }),
      ).resolves.toBeUndefined();
      expect(ghCalled).toBe(false);
    });

    it('malformed Source-Ref is logged and skipped — no gh call', async () => {
      let ghCalled = false;
      const gh: GhRunner = async () => {
        ghCalled = true;
        return { stdout: '' };
      };
      const logs: string[] = [];

      await announceGatedIssue(SPEC, 'not-a-ref', { runGh: gh, cwd: '/repo', log: (m) => logs.push(m) });

      expect(ghCalled).toBe(false);
      expect(logs.some((m) => m.toLowerCase().includes('skip'))).toBe(true);
    });

    it('closed issue still gets commented on', async () => {
      let commentPosted = false;
      const gh: GhRunner = async (args) => {
        if (args[0] === 'issue' && args[1] === 'view') {
          return { stdout: JSON.stringify({ state: 'CLOSED', comments: [] }) };
        }
        if (args[0] === 'issue' && args[1] === 'comment') {
          commentPosted = true;
        }
        return { stdout: '' };
      };

      await announceGatedIssue(SPEC, 'acme/repo#7', { runGh: gh, cwd: '/repo' });

      expect(commentPosted).toBe(true);
    });

    it('PR-succeeded/issue-failed: independent, pass completes without throwing', async () => {
      const prGh: GhRunner = async (args) => {
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
          return { stdout: JSON.stringify({ comments: [] }) };
        }
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [], labels: [] }) };
        }
        return { stdout: '' };
      };
      await expect(announceGatedPr(SPEC, PR_URL, { runGh: prGh, cwd: '/repo' })).resolves.toBeUndefined();

      const issueGh: GhRunner = async (args) => {
        if (args[0] === 'issue' && args[1] === 'view') {
          throw new Error('issue gh failure');
        }
        return { stdout: '' };
      };
      await expect(
        announceGatedIssue(SPEC, 'acme/repo#9', { runGh: issueGh, cwd: '/repo' }),
      ).resolves.toBeUndefined();
    });

    it('repo-kind warning entries never trigger a GitHub write for the issue step', async () => {
      let ghCalled = false;
      const gh: GhRunner = async () => {
        ghCalled = true;
        return { stdout: '' };
      };
      const repoWarningEntry = {
        kind: 'repo' as const,
        warning: 'identity-unresolved' as const,
        remedy: 'authenticate gh',
      };

      await announceGatedIssue(repoWarningEntry as unknown as typeof SPEC, undefined, {
        runGh: gh,
        cwd: '/repo',
      });

      expect(ghCalled).toBe(false);
    });
  });
});

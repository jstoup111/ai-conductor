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
  });

  describe('announceGatedPr (orchestrator)', () => {
    it('composes ensureGatedPrLabel + upsertGatedMarkerComment for a newly gated spec', async () => {
      const { gh, calls } = fakeGh([
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
  });
});

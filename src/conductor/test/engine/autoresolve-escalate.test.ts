/**
 * Tests for `escalate` in src/engine/autoresolve.ts (Task 15).
 *
 * Story: "Escalation marks the PR for a human with a concrete reason"
 *
 * Escalation removes the `mergeable` label, adds the `needs-remediation`
 * label, and posts/updates a marker-tagged comment describing the stage and
 * reason. All operations are best-effort / non-throwing: a label failure
 * still results in a comment attempt, and a comment failure never throws.
 *
 * All tests use FAKE gh runners that record calls; no real gh binary required.
 */

import { describe, it, expect } from 'vitest';
import { escalate } from '../../src/engine/autoresolve.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { NEEDS_REMEDIATION_MARKER } from '../../src/engine/pr-labels.js';

const PR_URL = 'https://github.com/foo/bar/pull/42';

/**
 * Scripted GhRunner: matches on args shape rather than strict order, since
 * escalate issues label REST calls (POST/DELETE via `api`) and an
 * upsertComment lookup (`pr view --json comments`) whose relative order is
 * an implementation detail we don't want to over-pin.
 */
function fakeGh(
  handler: (args: string[]) => { stdout: string } | Error,
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args, _opts) => {
    calls.push([...args]);
    const result = handler(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { gh, calls };
}

describe('engine/autoresolve — escalate', () => {
  it('happy path: removes mergeable label, adds needs-remediation label, posts marker-tagged comment', async () => {
    const { gh, calls } = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      // label add/remove and comment creation all succeed
      return { stdout: '' };
    });

    await escalate(PR_URL, 'tier2-resolve', 'rebase resolver could not resolve conflicts', {
      runGh: gh,
      cwd: '/repo',
    });

    // DELETE mergeable label
    const removeCall = calls.find(
      (c) => c[0] === 'api' && c.includes('--method') && c.includes('DELETE'),
    );
    expect(removeCall).toBeDefined();
    expect(removeCall!.some((a) => a.includes('labels/mergeable'))).toBe(true);

    // POST needs-remediation label
    const addCall = calls.find(
      (c) => c[0] === 'api' && c.includes('--method') && c.includes('POST') && c.some((a) => a.includes('labels')),
    );
    expect(addCall).toBeDefined();
    expect(addCall!.some((a) => a.includes('labels[]=needs-remediation'))).toBe(true);

    // Comment created with marker + stage + reason
    const commentCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCall).toBeDefined();
    const body = commentCall![commentCall!.indexOf('--body') + 1];
    expect(body).toContain(NEEDS_REMEDIATION_MARKER);
    expect(body).toContain('tier2-resolve');
    expect(body).toContain('rebase resolver could not resolve conflicts');
  });

  it('posts through upsertComment: a second escalation on the same PR edits the existing comment, never creating a second one', async () => {
    const existingCommentUrl = `${PR_URL}#issuecomment-999`;
    const { gh, calls } = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            comments: [
              { body: `${NEEDS_REMEDIATION_MARKER}\nold stage: old reason`, url: existingCommentUrl },
            ],
          }),
        };
      }
      return { stdout: '' };
    });

    await escalate(PR_URL, 'suite-gate', 'suite failed with exit code 1', {
      runGh: gh,
      cwd: '/repo',
    });

    // No new comment created via `pr comment`
    const createCommentCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(createCommentCall).toBeUndefined();

    // Existing comment edited via PATCH
    const patchCall = calls.find(
      (c) => c[0] === 'api' && c.includes('--method') && c.includes('PATCH'),
    );
    expect(patchCall).toBeDefined();
    expect(patchCall!.some((a) => a.includes('issues/comments/999'))).toBe(true);
    const bodyArg = patchCall!.find((a) => a.startsWith('body='));
    expect(bodyArg).toContain('suite-gate');
    expect(bodyArg).toContain('suite failed with exit code 1');
  });

  it('label call failure: comment is still attempted, escalate does not throw', async () => {
    const { gh, calls } = fakeGh((args) => {
      if (args[0] === 'api' && args.includes('DELETE')) {
        return new Error('label DELETE failed: 404');
      }
      if (args[0] === 'api' && args.includes('POST') && args.some((a) => a.includes('labels'))) {
        return new Error('label POST failed: 500');
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ comments: [] }) };
      }
      return { stdout: '' };
    });

    await expect(
      escalate(PR_URL, 'tier2-resolve', 'label failure scenario', { runGh: gh, cwd: '/repo' }),
    ).resolves.not.toThrow();

    const commentCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCall).toBeDefined();
  });

  it('comment failure with label success: escalate does not throw and does not retry/create a fallback comment', async () => {
    const { gh, calls } = fakeGh((args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return new Error('lookup failed: network error');
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        return new Error('comment creation failed: 500');
      }
      // label calls succeed
      return { stdout: '' };
    });

    await expect(
      escalate(PR_URL, 'tier2-resolve', 'comment failure scenario', { runGh: gh, cwd: '/repo' }),
    ).resolves.not.toThrow();

    // Label calls were attempted (the gate) despite the later comment failure
    const removeCall = calls.find((c) => c[0] === 'api' && c.includes('DELETE'));
    const addCall = calls.find((c) => c[0] === 'api' && c.includes('POST') && c.some((a) => a.includes('labels')));
    expect(removeCall).toBeDefined();
    expect(addCall).toBeDefined();

    // Only one comment creation attempt (from upsertComment's fallback-on-lookup-failure path);
    // no additional retry attempts by escalate itself.
    const commentCalls = calls.filter((c) => c[0] === 'pr' && c[1] === 'comment');
    expect(commentCalls.length).toBe(1);
  });
});

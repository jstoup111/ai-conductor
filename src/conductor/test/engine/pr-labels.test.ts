/**
 * Tests for the pr-labels seam (src/engine/pr-labels.ts).
 *
 * All tests use FAKE runners that record calls; no real `gh` binary is
 * required. The module contract: every function is best-effort/non-throwing —
 * runner errors are swallowed and logged internally.
 */

import { describe, it, expect } from 'vitest';
import {
  ensureLabel,
  addLabel,
  removeLabel,
  prMergeState,
  isMergeable,
  findOrCreatePr,
  resolveSpecPrUrl,
  comment,
  upsertComment,
  upsertIssueComment,
  NEEDS_REMEDIATION_MARKER,
  NEEDS_REMEDIATION_BODY_MARKER,
  setReady,
  convertToDraft,
  readHaltPresentation,
  ensureBodyMarker,
  ensureHaltPresentation,
  makeProductionGh,
  makeProductionGit,
} from '../../src/engine/pr-labels.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

// ── Fake GhRunner factory ─────────────────────────────────────────────────────

function fakeGh(
  responses: Array<{ stdout: string } | Error>,
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  const gh: GhRunner = async (args, _opts) => {
    calls.push([...args]);
    const response = responses[index++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return response;
  };
  return { gh, calls };
}

// ── Shared test URL ───────────────────────────────────────────────────────────

const TEST_PR_URL = 'https://github.com/foo/bar/pull/42';

// ── ensureLabel ───────────────────────────────────────────────────────────────

describe('ensureLabel', () => {
  it('calls gh label create with --color and --force', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await ensureLabel(gh, '/repo', 'in-progress', 'ff0000');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['label', 'create', 'in-progress', '--color', 'ff0000', '--force']);
  });

  it('swallows a rejecting runner without throwing', async () => {
    const { gh } = fakeGh([new Error('auth failed')]);
    await expect(ensureLabel(gh, '/repo', 'x', 'aabbcc')).resolves.toBeUndefined();
  });
});

// ── addLabel ──────────────────────────────────────────────────────────────────

describe('addLabel', () => {
  it('adds the label via the REST endpoint (gh api), NOT gh pr edit (Projects-classic safe)', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await addLabel(gh, '/repo', TEST_PR_URL, 'in-progress');
    expect(calls[0]).toEqual([
      'api',
      '--method',
      'POST',
      'repos/foo/bar/issues/42/labels',
      '-f',
      'labels[]=in-progress',
    ]);
  });

  it('makes no gh call when the PR URL is unparseable', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await addLabel(gh, '/repo', 'not-a-url', 'in-progress');
    expect(calls).toHaveLength(0);
  });

  it('swallows a rejecting runner without throwing', async () => {
    const { gh } = fakeGh([new Error('network error')]);
    await expect(addLabel(gh, '/repo', TEST_PR_URL, 'in-progress')).resolves.toBeUndefined();
  });
});

// ── removeLabel ───────────────────────────────────────────────────────────────

describe('removeLabel', () => {
  it('removes the label via the REST endpoint (gh api), NOT gh pr edit (Projects-classic safe)', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await removeLabel(gh, '/repo', TEST_PR_URL, 'in-progress');
    expect(calls[0]).toEqual([
      'api',
      '--method',
      'DELETE',
      'repos/foo/bar/issues/42/labels/in-progress',
    ]);
  });

  it('URL-encodes label names with special characters', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await removeLabel(gh, '/repo', TEST_PR_URL, 'engineer:handled');
    expect(calls[0]).toEqual([
      'api',
      '--method',
      'DELETE',
      'repos/foo/bar/issues/42/labels/engineer%3Ahandled',
    ]);
  });

  it('makes no gh call when the PR URL is unparseable', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await removeLabel(gh, '/repo', 'not-a-url', 'in-progress');
    expect(calls).toHaveLength(0);
  });

  it('swallows a rejecting runner without throwing', async () => {
    const { gh } = fakeGh([new Error('network error')]);
    await expect(removeLabel(gh, '/repo', TEST_PR_URL, 'in-progress')).resolves.toBeUndefined();
  });
});

// ── prMergeState + isMergeable ────────────────────────────────────────────────

describe('prMergeState + isMergeable', () => {
  it('OPEN + MERGEABLE + all-SUCCESS checks → hasFailingOrPendingChecks=false, isMergeable true', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
            { status: 'COMPLETED', conclusion: 'NEUTRAL' },
          ],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result).toMatchObject({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      hasFailingOrPendingChecks: false,
    });
    expect(isMergeable(result)).toBe(true);
  });

  it('zero checks → hasFailingOrPendingChecks false → isMergeable true', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(false);
    expect(isMergeable(result)).toBe(true);
  });

  it('null statusCheckRollup (field absent) → hasFailingOrPendingChecks false → isMergeable true', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: null,
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(false);
    expect(isMergeable(result)).toBe(true);
  });

  it('a PENDING check → hasFailingOrPendingChecks true → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ status: 'PENDING', conclusion: null }],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(true);
    expect(isMergeable(result)).toBe(false);
  });

  it('a FAILURE check → hasFailingOrPendingChecks true → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(true);
    expect(isMergeable(result)).toBe(false);
  });

  it('an in-progress check (null conclusion) → hasFailingOrPendingChecks true → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(true);
    expect(isMergeable(result)).toBe(false);
  });

  it('mergeable UNKNOWN → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'UNKNOWN',
          statusCheckRollup: [],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(isMergeable(result)).toBe(false);
  });

  it('mergeable CONFLICTING → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'CONFLICTING',
          statusCheckRollup: [],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(isMergeable(result)).toBe(false);
  });

  it('non-OPEN state (MERGED) → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'MERGED',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(isMergeable(result)).toBe(false);
  });

  it('non-OPEN state (CLOSED) → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'CLOSED',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(isMergeable(result)).toBe(false);
  });

  it('runner error (transient/generic) → UNKNOWN sentinel, does not throw, isMergeable false', async () => {
    const { gh } = fakeGh([new Error('rate limited')]);
    let threw = false;
    let result: Awaited<ReturnType<typeof prMergeState>> | undefined;
    try {
      result = await prMergeState(gh, '/repo', TEST_PR_URL);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toMatchObject({
      state: 'UNKNOWN',
      mergeable: 'UNKNOWN',
      hasFailingOrPendingChecks: true,
      labels: [],
    });
    expect(isMergeable(result!)).toBe(false);
  });

  it('not-found error → NOTFOUND sentinel, does not throw, isMergeable false', async () => {
    const { gh } = fakeGh([new Error('could not resolve to a PullRequest')]);
    let threw = false;
    let result: Awaited<ReturnType<typeof prMergeState>> | undefined;
    try {
      result = await prMergeState(gh, '/repo', TEST_PR_URL);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toMatchObject({
      state: 'NOTFOUND',
      mergeable: 'UNKNOWN',
      hasFailingOrPendingChecks: true,
      labels: [],
    });
    expect(isMergeable(result!)).toBe(false);
  });

  it('404 error text → NOTFOUND sentinel', async () => {
    const { gh } = fakeGh([new Error('HTTP 404: no such pull request')]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.state).toBe('NOTFOUND');
  });

  it('DNS transient error "could not resolve host" → UNKNOWN sentinel, NOT NOTFOUND (kept + retried)', async () => {
    // "could not resolve host: github.com" is a transient connectivity error.
    // It must NOT match the not-found patterns — the PR is still valid; keep it
    // and retry on the next sweep pass.
    const { gh } = fakeGh([new Error('could not resolve host: github.com')]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.state).toBe('UNKNOWN');
    expect(isMergeable(result)).toBe(false);
  });

  it('conclusion=TIMED_OUT → hasFailingOrPendingChecks true → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'TIMED_OUT' }],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(true);
    expect(isMergeable(result)).toBe(false);
  });

  it('conclusion=ERROR → hasFailingOrPendingChecks true → isMergeable false', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'ERROR' }],
          labels: [],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(true);
    expect(isMergeable(result)).toBe(false);
  });

  it('statusCheckRollup key absent from JSON entirely → hasFailingOrPendingChecks false → isMergeable true', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          labels: [],
          // statusCheckRollup intentionally omitted
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.hasFailingOrPendingChecks).toBe(false);
    expect(isMergeable(result)).toBe(true);
  });

  it('parses the labels array into a string[]', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: [{ name: 'in-progress' }, { name: 'tier:S' }],
        }),
      },
    ]);
    const result = await prMergeState(gh, '/repo', TEST_PR_URL);
    expect(result.labels).toEqual(['in-progress', 'tier:S']);
  });
});

// ── findOrCreatePr ────────────────────────────────────────────────────────────

describe('findOrCreatePr', () => {
  const existingUrl = 'https://github.com/foo/bar/pull/10';
  const newUrl = 'https://github.com/foo/bar/pull/99';

  it('reuses an existing OPEN PR without calling pr create', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ url: existingUrl, state: 'OPEN' }) },
    ]);
    const result = await findOrCreatePr(gh, '/repo', {
      branch: 'feat/abc',
      base: 'main',
      title: 'Test PR',
      body: 'body text',
    });
    expect(result).toEqual({ prUrl: existingUrl });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('create');
  });

  it('creates a new PR with --draft when draft=true and no existing PR found', async () => {
    const { gh, calls } = fakeGh([
      new Error('no pull requests found for branch "feat/new"'),
      { stdout: `Pull request created\n${newUrl}\n` },
    ]);
    const result = await findOrCreatePr(gh, '/repo', {
      branch: 'feat/new',
      base: 'main',
      draft: true,
      title: 'Draft PR',
      body: 'body',
    });
    expect(result).toEqual({ prUrl: newUrl });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('--draft');
    expect(calls[1]).toContain('--head');
    expect(calls[1]).toContain('feat/new');
    expect(calls[1]).toContain('--base');
    expect(calls[1]).toContain('main');
  });

  it('creates a new PR without --draft when draft is false/absent', async () => {
    const { gh, calls } = fakeGh([
      new Error('no pull requests found'),
      { stdout: newUrl + '\n' },
    ]);
    const result = await findOrCreatePr(gh, '/repo', {
      branch: 'feat/b',
      base: 'main',
      title: 'PR',
      body: 'body',
    });
    expect(result).toEqual({ prUrl: newUrl });
    expect(calls[1]).not.toContain('--draft');
  });

  it('does not resurrect a CLOSED PR — falls through to create a new one', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ url: existingUrl, state: 'CLOSED' }) },
      { stdout: newUrl + '\n' },
    ]);
    const result = await findOrCreatePr(gh, '/repo', {
      branch: 'feat/closed',
      base: 'main',
      title: 'New PR',
      body: 'body',
    });
    expect(result).toEqual({ prUrl: newUrl });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('create');
  });

  it('does not resurrect a MERGED PR — falls through to create a new one', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ url: existingUrl, state: 'MERGED' }) },
      { stdout: newUrl + '\n' },
    ]);
    const result = await findOrCreatePr(gh, '/repo', {
      branch: 'feat/merged',
      base: 'main',
      title: 'New PR',
      body: 'body',
    });
    expect(result).toEqual({ prUrl: newUrl });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('create');
  });

  it('swallows create error and returns {} when both view and create fail', async () => {
    const { gh } = fakeGh([
      new Error('view failed'),
      new Error('create failed'),
    ]);
    const result = await findOrCreatePr(gh, '/repo', {
      branch: 'feat/err',
      base: 'main',
      title: 'PR',
      body: 'body',
    });
    expect(result).toEqual({});
  });
});

// ── resolveSpecPrUrl ──────────────────────────────────────────────────────────

describe('resolveSpecPrUrl', () => {
  it('returns the URL of the found PR', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify([{ url: TEST_PR_URL, state: 'MERGED' }]) },
    ]);
    const result = await resolveSpecPrUrl(gh, '/repo', 'feat/spec-branch');
    expect(result).toBe(TEST_PR_URL);
    expect(calls[0]).toEqual([
      'pr',
      'list',
      '--state',
      'all',
      '--head',
      'feat/spec-branch',
      '--json',
      'url,state',
      '--limit',
      '1',
    ]);
  });

  it('returns undefined when no PR is found', async () => {
    const { gh } = fakeGh([{ stdout: JSON.stringify([]) }]);
    const result = await resolveSpecPrUrl(gh, '/repo', 'feat/no-pr');
    expect(result).toBeUndefined();
  });

  it('swallows runner errors and returns undefined', async () => {
    const { gh } = fakeGh([new Error('gh failed')]);
    const result = await resolveSpecPrUrl(gh, '/repo', 'feat/err');
    expect(result).toBeUndefined();
  });

  it('does not create a PR (no draft args in the call)', async () => {
    const { gh, calls } = fakeGh([{ stdout: JSON.stringify([]) }]);
    await resolveSpecPrUrl(gh, '/repo', 'feat/no-create');
    expect(calls[0]).not.toContain('create');
    expect(calls[0]).not.toContain('--draft');
  });
});

// ── comment ───────────────────────────────────────────────────────────────────

describe('comment', () => {
  it('calls gh pr comment with the URL and --body', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await comment(gh, '/repo', TEST_PR_URL, 'Hello world');
    expect(calls[0]).toEqual(['pr', 'comment', TEST_PR_URL, '--body', 'Hello world']);
  });

  it('swallows a rejecting runner without throwing', async () => {
    const { gh } = fakeGh([new Error('failed')]);
    await expect(comment(gh, '/repo', TEST_PR_URL, 'hi')).resolves.toBeUndefined();
  });
});

// ── upsertComment ─────────────────────────────────────────────────────────────

describe('upsertComment', () => {
  const MARKER = NEEDS_REMEDIATION_MARKER;
  const markedUrl = 'https://github.com/foo/bar/pull/42#issuecomment-99887766';

  it('creates a marked comment when the PR has no comments (S1 happy)', async () => {
    const { gh, calls } = fakeGh([{ stdout: JSON.stringify({ comments: [] }) }]);
    await upsertComment(gh, '/repo', TEST_PR_URL, MARKER, 'boom');

    // 1) look up comments, 2) create
    expect(calls[0]).toEqual(['pr', 'view', TEST_PR_URL, '--json', 'comments']);
    const createCall = calls.find((a) => a[0] === 'pr' && a[1] === 'comment');
    expect(createCall).toBeDefined();
    const body = createCall![createCall!.indexOf('--body') + 1];
    expect(body).toContain(MARKER);
    expect(body).toContain('boom');
    // No PATCH issued
    expect(calls.find((a) => a[0] === 'api')).toBeUndefined();
  });

  it('creates when comments exist but none carry the marker (S1 negative)', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ comments: [{ body: 'unrelated chatter', url: markedUrl }] }) },
    ]);
    await upsertComment(gh, '/repo', TEST_PR_URL, MARKER, 'boom');
    expect(calls.find((a) => a[0] === 'pr' && a[1] === 'comment')).toBeDefined();
    expect(calls.find((a) => a[0] === 'api')).toBeUndefined();
  });

  it('PATCHes the existing marked comment in place and creates nothing (S2 happy)', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          comments: [{ body: `${MARKER}\nold reason`, url: markedUrl }],
        }),
      },
      { stdout: '' }, // PATCH succeeds
    ]);
    await upsertComment(gh, '/repo', TEST_PR_URL, MARKER, 'new reason');

    const patchCall = calls.find((a) => a[0] === 'api');
    expect(patchCall).toEqual([
      'api',
      '--method',
      'PATCH',
      'repos/foo/bar/issues/comments/99887766',
      '-f',
      `body=${MARKER}\nnew reason`,
    ]);
    // Crucially, no new comment is created
    expect(calls.find((a) => a[0] === 'pr' && a[1] === 'comment')).toBeUndefined();
  });

  it('falls back to create when the marked comment url is unparseable (S2 negative)', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          comments: [{ body: `${MARKER}\nx`, url: 'https://example.com/not-a-pr' }],
        }),
      },
    ]);
    await upsertComment(gh, '/repo', TEST_PR_URL, MARKER, 'boom');
    expect(calls.find((a) => a[0] === 'api')).toBeUndefined();
    expect(calls.find((a) => a[0] === 'pr' && a[1] === 'comment')).toBeDefined();
  });

  it('falls back to create when the comments lookup throws (S3 negative)', async () => {
    const { gh, calls } = fakeGh([new Error('rate limited'), { stdout: '' }]);
    await expect(
      upsertComment(gh, '/repo', TEST_PR_URL, MARKER, 'boom'),
    ).resolves.toBeUndefined();
    expect(calls.find((a) => a[0] === 'pr' && a[1] === 'comment')).toBeDefined();
  });

  it('swallows a PATCH failure WITHOUT creating a duplicate (S3 negative)', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ comments: [{ body: `${MARKER}\nx`, url: markedUrl }] }) },
      new Error('PATCH 500'), // edit fails
    ]);
    await expect(
      upsertComment(gh, '/repo', TEST_PR_URL, MARKER, 'boom'),
    ).resolves.toBeUndefined();
    // Found-but-unpatchable comment is left as-is — no fallback create
    expect(calls.find((a) => a[0] === 'pr' && a[1] === 'comment')).toBeUndefined();
  });
});

// ── upsertIssueComment ────────────────────────────────────────────────────────

describe('upsertIssueComment', () => {
  const MARKER = NEEDS_REMEDIATION_MARKER;
  const TEST_ISSUE_URL = 'https://github.com/foo/bar/issues/42';
  const markedIssueUrl = 'https://github.com/foo/bar/issues/42#issuecomment-99887766';

  it('PATCHes the existing marked comment in place and creates nothing (marker found)', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          comments: [{ body: `${MARKER}\nold reason`, url: markedIssueUrl }],
        }),
      },
      { stdout: '' }, // PATCH succeeds
    ]);
    await upsertIssueComment(gh, '/repo', TEST_ISSUE_URL, MARKER, 'new reason');

    expect(calls[0]).toEqual(['issue', 'view', TEST_ISSUE_URL, '--json', 'comments']);
    const patchCall = calls.find((a) => a[0] === 'api');
    expect(patchCall).toEqual([
      'api',
      '--method',
      'PATCH',
      'repos/foo/bar/issues/comments/99887766',
      '-f',
      `body=${MARKER}\nnew reason`,
    ]);
    // Crucially, no new comment is created
    expect(calls.find((a) => a[0] === 'issue' && a[1] === 'comment')).toBeUndefined();
  });

  it('swallows a PATCH failure WITHOUT creating a duplicate (found-comment PATCH failure)', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ comments: [{ body: `${MARKER}\nx`, url: markedIssueUrl }] }) },
      new Error('PATCH 500'), // edit fails
    ]);
    await expect(
      upsertIssueComment(gh, '/repo', TEST_ISSUE_URL, MARKER, 'boom'),
    ).resolves.toBeUndefined();
    // Found-but-unpatchable comment is left as-is — no fallback create
    expect(calls.find((a) => a[0] === 'issue' && a[1] === 'comment')).toBeUndefined();
  });
});

// ── setReady ──────────────────────────────────────────────────────────────────

describe('setReady', () => {
  it('calls gh pr ready with the PR URL', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await setReady(gh, '/repo', TEST_PR_URL);
    expect(calls[0]).toEqual(['pr', 'ready', TEST_PR_URL]);
  });

  it('swallows a rejecting runner without throwing', async () => {
    const { gh } = fakeGh([new Error('failed')]);
    await expect(setReady(gh, '/repo', TEST_PR_URL)).resolves.toBeUndefined();
  });
});


// ── convertToDraft ────────────────────────────────────────────────────────────

describe('convertToDraft', () => {
  it('calls gh pr ready --undo with the PR URL', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    await convertToDraft(gh, '/repo', TEST_PR_URL);
    expect(calls[0]).toEqual(['pr', 'ready', '--undo', TEST_PR_URL]);
  });

  it('swallows a rejecting runner without throwing', async () => {
    const { gh } = fakeGh([new Error('failed')]);
    await expect(convertToDraft(gh, '/repo', TEST_PR_URL)).resolves.toBeUndefined();
  });
});

// ── readHaltPresentation ──────────────────────────────────────────────────────

describe('readHaltPresentation', () => {
  it('reads isDraft, labels, and body via gh pr view --json', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [{ name: 'tier:S' }, { name: 'in-progress' }],
          body: 'This is the PR body.',
        }),
      },
    ]);
    const result = await readHaltPresentation(gh, '/repo', TEST_PR_URL);
    expect(result).toEqual({
      isDraft: false,
      labels: ['tier:S', 'in-progress'],
      body: 'This is the PR body.',
    });
    expect(calls[0]).toEqual(['pr', 'view', TEST_PR_URL, '--json', 'isDraft,labels,body']);
  });

  it('returns a presentation with empty labels when labels are absent', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: 'Draft PR body',
        }),
      },
    ]);
    const result = await readHaltPresentation(gh, '/repo', TEST_PR_URL);
    expect(result).toEqual({
      isDraft: true,
      labels: [],
      body: 'Draft PR body',
    });
  });

  it('returns null and logs on runner error', async () => {
    const { gh } = fakeGh([new Error('network error')]);
    const logs: string[] = [];
    const result = await readHaltPresentation(gh, '/repo', TEST_PR_URL, (msg) => logs.push(msg));
    expect(result).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('readHaltPresentation');
    expect(logs[0]).toContain(TEST_PR_URL);
  });

  it('does not throw when gh runner rejects', async () => {
    const { gh } = fakeGh([new Error('auth failed')]);
    await expect(
      readHaltPresentation(gh, '/repo', TEST_PR_URL),
    ).resolves.toBeNull();
  });

  it('parses labels into a string array', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [{ name: 'label-1' }, { name: 'label-2' }, { name: 'label-3' }],
          body: 'Body text',
        }),
      },
    ]);
    const result = await readHaltPresentation(gh, '/repo', TEST_PR_URL);
    expect(result?.labels).toEqual(['label-1', 'label-2', 'label-3']);
  });
});

// ── ensureBodyMarker ──────────────────────────────────────────────────────────

describe('ensureBodyMarker', () => {
  it('appends the marker to a body that does not contain it (RED test case a)', async () => {
    const { gh, calls } = fakeGh([{ stdout: '' }]);
    const existingBody = 'This is the PR body.';
    await ensureBodyMarker(gh, '/repo', TEST_PR_URL, existingBody);

    // Should record a gh pr edit call
    const editCall = calls.find((a) => a[0] === 'pr' && a[1] === 'edit');
    expect(editCall).toBeDefined();

    const bodyArgIndex = editCall!.indexOf('--body');
    expect(bodyArgIndex).toBeGreaterThan(-1);
    const newBody = editCall![bodyArgIndex + 1];

    // New body should contain both original text and marker
    expect(newBody).toContain(existingBody);
    expect(newBody).toContain(NEEDS_REMEDIATION_BODY_MARKER);

    // Marker should appear exactly once
    const markerCount = (newBody.match(/conductor:needs-remediation/g) || []).length;
    expect(markerCount).toBe(1);
  });

  it('makes no edit call when the body already contains the marker (RED test case b)', async () => {
    const { gh, calls } = fakeGh([]);
    const existingBody = `Some PR body\n${NEEDS_REMEDIATION_BODY_MARKER}\nMore text`;
    await ensureBodyMarker(gh, '/repo', TEST_PR_URL, existingBody);

    // Should NOT record any gh pr edit call (idempotent)
    const editCall = calls.find((a) => a[0] === 'pr' && a[1] === 'edit');
    expect(editCall).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('swallows errors and never throws', async () => {
    const { gh } = fakeGh([new Error('network error')]);
    const body = 'test body';
    await expect(ensureBodyMarker(gh, '/repo', TEST_PR_URL, body)).resolves.toBeUndefined();
  });
});

// ── Marker constants ──────────────────────────────────────────────────────────────

describe('marker constants', () => {
  it('NEEDS_REMEDIATION_BODY_MARKER is defined and exported', () => {
    expect(NEEDS_REMEDIATION_BODY_MARKER).toBeDefined();
  });

  it('NEEDS_REMEDIATION_BODY_MARKER has the expected value', () => {
    expect(NEEDS_REMEDIATION_BODY_MARKER).toBe('<!-- conductor:needs-remediation -->');
  });

  it('NEEDS_REMEDIATION_BODY_MARKER and NEEDS_REMEDIATION_MARKER both exist', () => {
    expect(NEEDS_REMEDIATION_BODY_MARKER).toBeDefined();
    expect(NEEDS_REMEDIATION_MARKER).toBeDefined();
  });
});

// ── ensureHaltPresentation ───────────────────────────────────────────────────

describe('ensureHaltPresentation', () => {
  it('happy path: writes all three markers then reads back to confirm all present', async () => {
    const prBodyBefore = 'Some PR body';
    const { gh, calls } = fakeGh([
      // ensureBodyMarker: readHaltPresentation (to get body)
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: prBodyBefore,
        }),
      },
      { stdout: '' }, // ensureBodyMarker: pr edit (appends marker)
      // readHaltPresentation before convert (to check if already draft)
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: `${prBodyBefore}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
      { stdout: '' }, // convertToDraft: pr ready --undo
      { stdout: '' }, // addLabel: api
      // readHaltPresentation after writes (verification read)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBodyBefore}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
    ]);

    const result = await ensureHaltPresentation(gh, '/repo', TEST_PR_URL);

    expect(result).toBe('confirmed');

    // Verify the sequence of calls
    const editCall = calls.find((a) => a[0] === 'pr' && a[1] === 'edit');
    const undoCall = calls.find((a) => a[0] === 'pr' && a[1] === 'ready' && a[2] === '--undo');
    const apiCall = calls.find((a) => a[0] === 'api');

    expect(editCall).toBeDefined();
    expect(undoCall).toBeDefined();
    expect(apiCall).toBeDefined();

    // Verify the label API call uses REST
    expect(apiCall).toEqual([
      'api',
      '--method',
      'POST',
      'repos/foo/bar/issues/42/labels',
      '-f',
      'labels[]=needs-remediation',
    ]);
  });

  it('RED: idempotent — already-draft PR skips convertToDraft call entirely', async () => {
    const prBodyBefore = 'Some PR body';
    const { gh, calls } = fakeGh([
      // ensureBodyMarker: readHaltPresentation (to get body)
      {
        stdout: JSON.stringify({
          isDraft: true, // Already draft
          labels: [],
          body: prBodyBefore,
        }),
      },
      { stdout: '' }, // ensureBodyMarker: pr edit (appends marker)
      // readHaltPresentation before convert (to check if already draft)
      {
        stdout: JSON.stringify({
          isDraft: true, // Still draft
          labels: [],
          body: `${prBodyBefore}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
      // NO convertToDraft call because isDraft is true
      { stdout: '' }, // addLabel: api
      // readHaltPresentation after writes (verification read)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBodyBefore}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
    ]);

    const result = await ensureHaltPresentation(gh, '/repo', TEST_PR_URL);

    expect(result).toBe('confirmed');

    // Verify that convertToDraft was NOT called (no 'pr ready --undo' call)
    const undoCall = calls.find((a) => a[0] === 'pr' && a[1] === 'ready' && a[2] === '--undo');
    expect(undoCall).toBeUndefined();

    // But body marker edit and label add should still be called
    const editCall = calls.find((a) => a[0] === 'pr' && a[1] === 'edit');
    const apiCall = calls.find((a) => a[0] === 'api');
    expect(editCall).toBeDefined();
    expect(apiCall).toBeDefined();
  });

  it('swallows errors and never throws', async () => {
    const { gh } = fakeGh([new Error('network error')]);
    await expect(
      ensureHaltPresentation(gh, '/repo', TEST_PR_URL),
    ).resolves.toBeDefined();
  });

  it('returns unconfirmed when read-back does not show isDraft', async () => {
    const { gh } = fakeGh([
      { stdout: '' }, // ensureBodyMarker
      { stdout: '' }, // convertToDraft
      { stdout: '' }, // addLabel
      {
        // readHaltPresentation returns isDraft: false
        stdout: JSON.stringify({
          isDraft: false,
          labels: [{ name: 'needs-remediation' }],
          body: `Some PR body\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
    ]);

    const result = await ensureHaltPresentation(gh, '/repo', TEST_PR_URL);

    expect(result).toBe('unconfirmed');
  });

  it('returns unconfirmed when read-back does not show the label', async () => {
    const { gh } = fakeGh([
      { stdout: '' }, // ensureBodyMarker
      { stdout: '' }, // convertToDraft
      { stdout: '' }, // addLabel
      {
        // readHaltPresentation returns empty labels
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: `Some PR body\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
    ]);

    const result = await ensureHaltPresentation(gh, '/repo', TEST_PR_URL);

    expect(result).toBe('unconfirmed');
  });

  it('returns unconfirmed when read-back does not show the body marker', async () => {
    const { gh } = fakeGh([
      { stdout: '' }, // ensureBodyMarker
      { stdout: '' }, // convertToDraft
      { stdout: '' }, // addLabel
      {
        // readHaltPresentation returns body without marker
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: 'Some PR body without marker',
        }),
      },
    ]);

    const result = await ensureHaltPresentation(gh, '/repo', TEST_PR_URL);

    expect(result).toBe('unconfirmed');
  });

  it('D1 negative: preserves human-written body text when appending marker (reused PR)', async () => {
    // This is a negative-path test: verify that existing body text is NOT clobbered
    // when ensureHaltPresentation appends the remediation marker.
    const originalBody = 'This PR fixes the issue described in #123';
    const { gh, calls } = fakeGh([
      // ensureBodyMarker: readHaltPresentation (to get body)
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: originalBody,
        }),
      },
      { stdout: '' }, // ensureBodyMarker: pr edit (appends marker)
      // readHaltPresentation before convert (to check if already draft)
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: `${originalBody}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
      { stdout: '' }, // convertToDraft: pr ready --undo
      { stdout: '' }, // addLabel: api
      // readHaltPresentation after writes (verification read)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${originalBody}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
        }),
      },
    ]);

    const result = await ensureHaltPresentation(gh, '/repo', TEST_PR_URL);

    expect(result).toBe('confirmed');

    // Verify the body edit call preserves original text
    const editCall = calls.find((a) => a[0] === 'pr' && a[1] === 'edit');
    expect(editCall).toBeDefined();

    const bodyArgIndex = editCall!.indexOf('--body');
    expect(bodyArgIndex).toBeGreaterThan(-1);
    const newBody = editCall![bodyArgIndex + 1];

    // CRITICAL: Body must contain BOTH original text and marker
    expect(newBody).toContain(originalBody);
    expect(newBody).toContain(NEEDS_REMEDIATION_BODY_MARKER);

    // Marker must appear exactly once (not duplicated)
    const markerCount = (newBody.match(/conductor:needs-remediation/g) || []).length;
    expect(markerCount).toBe(1);
  });

  it('returns unconfirmed when readHaltPresentation fails with 404/network error (D2 negative — unreadable PR)', async () => {
    // D2 negative: verification read fails due to unreadable PR (404 or network error).
    // ensureHaltPresentation should return 'unconfirmed' and not throw.
    const { gh } = fakeGh([
      // ensureBodyMarker: readHaltPresentation succeeds
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: 'Some PR body',
        }),
      },
      // ensureBodyMarker: pr edit (appends marker)
      { stdout: '' },
      // readHaltPresentation before convert: succeeds
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: 'Some PR body\n<!-- conductor:needs-remediation -->',
        }),
      },
      // convertToDraft: succeeds
      { stdout: '' },
      // addLabel: succeeds
      { stdout: '' },
      // readHaltPresentation after writes: FAILS with 404 (PR not found/unreadable)
      new Error('HTTP 404: could not resolve to a PullRequest with the number 42'),
    ]);

    const logs: string[] = [];
    const result = await ensureHaltPresentation(gh, '/repo', TEST_PR_URL, (msg) =>
      logs.push(msg),
    );

    // Should return 'unconfirmed' when PR becomes unreadable
    expect(result).toBe('unconfirmed');
    // Should log the error
    expect(logs.some((msg) => msg.includes('could not re-read PR after writes'))).toBe(true);
  });
});

// ── Kill-switch: production runners refuse to exec under AI_CONDUCTOR_NO_REAL_EXEC ─
// The vitest global setup (test/setup.ts) sets AI_CONDUCTOR_NO_REAL_EXEC=1, so the
// real gh/git runners must throw instead of shelling out. This guarantees no test
// can mutate live GitHub via this seam (the bug that labeled+commented a live PR).
describe('production runner kill-switch', () => {
  it('AI_CONDUCTOR_NO_REAL_EXEC is set by the global test setup', () => {
    expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeTruthy();
  });

  it('makeProductionGh() refuses to exec real gh under the kill-switch', async () => {
    const gh = makeProductionGh();
    await expect(gh(['pr', 'view'], { cwd: '/repo' })).rejects.toThrow(
      /real 'gh' exec blocked under AI_CONDUCTOR_NO_REAL_EXEC/,
    );
  });

  it('makeProductionGit() refuses to exec real git under the kill-switch', async () => {
    const git = makeProductionGit();
    await expect(git(['rev-parse', 'HEAD'], { cwd: '/repo' })).rejects.toThrow(
      /real 'git' exec blocked under AI_CONDUCTOR_NO_REAL_EXEC/,
    );
  });
});

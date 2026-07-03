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
  setReady,
  makeProductionGh,
  makeProductionGit,
  pushBranch,
  isAheadOfBase,
  publishEarlyDraft,
  advisoryPublish,
} from '../../src/engine/pr-labels.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';

// ── Fake GitRunner factory ────────────────────────────────────────────────────

function fakeGit(
  responses: Array<{ stdout: string } | Error>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  let index = 0;
  const git: GitRunner = async (args, _opts) => {
    calls.push([...args]);
    const response = responses[index++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return response;
  };
  return { git, calls };
}

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

// ── pushBranch ────────────────────────────────────────────────────────────────

describe('pushBranch', () => {
  it('pushes with -u origin <branch> by default', async () => {
    const { git, calls } = fakeGit([{ stdout: '' }]);
    await pushBranch(git, '/repo', 'feat/abc');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['push', '-u', 'origin', 'feat/abc']);
  });

  it('pushes with --force-with-lease when forceWithLease=true', async () => {
    const { git, calls } = fakeGit([{ stdout: '' }]);
    await pushBranch(git, '/repo', 'feat/abc', { forceWithLease: true });
    expect(calls[0]).toEqual(['push', '--force-with-lease', 'origin', 'feat/abc']);
  });

  it('swallows a rejecting runner without throwing', async () => {
    const { git } = fakeGit([new Error('push failed')]);
    await expect(pushBranch(git, '/repo', 'feat/abc')).resolves.toBeUndefined();
  });
});

// ── isAheadOfBase ─────────────────────────────────────────────────────────────

describe('isAheadOfBase', () => {
  it('calls git rev-list --count base..HEAD', async () => {
    const { git, calls } = fakeGit([{ stdout: '3\n' }]);
    await isAheadOfBase(git, '/repo', 'main');
    expect(calls[0]).toEqual(['rev-list', '--count', 'main..HEAD']);
  });

  it('parses non-zero count when ahead of base', async () => {
    const { git } = fakeGit([{ stdout: '5\n' }]);
    const count = await isAheadOfBase(git, '/repo', 'main');
    expect(count).toBe(5);
  });

  it('returns 0 when HEAD == base', async () => {
    const { git } = fakeGit([{ stdout: '0\n' }]);
    const count = await isAheadOfBase(git, '/repo', 'main');
    expect(count).toBe(0);
  });

  it('returns 0 when the runner errors', async () => {
    const { git } = fakeGit([new Error('git failed')]);
    const count = await isAheadOfBase(git, '/repo', 'main');
    expect(count).toBe(0);
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

// ── publishEarlyDraft ─────────────────────────────────────────────────────────

describe('publishEarlyDraft', () => {
  it('not ahead of base → pushBranch called, zero pr-create calls, returns {pushed: true, drafted: false}', async () => {
    const { git, calls: gitCalls } = fakeGit([
      { stdout: '0\n' }, // isAheadOfBase returns 0 (called first)
      { stdout: '' }, // push response (called second)
    ]);
    const { gh, calls: ghCalls } = fakeGh([]);

    const result = await publishEarlyDraft(git, gh, '/repo', 'feat/abc', 'main');

    expect(ghCalls).toHaveLength(0); // No gh calls for pr-create
    expect(result).toEqual({ pushed: true, drafted: false });
  });

  it('ahead of base → pushBranch called, findOrCreatePr called once, returns {pushed: true, drafted: true, pr_url}', async () => {
    const prUrl = 'https://github.com/foo/bar/pull/99';
    const { git } = fakeGit([
      { stdout: '3\n' }, // isAheadOfBase returns 3 (called first)
      { stdout: '' }, // push response (called second)
    ]);
    const { gh, calls: ghCalls } = fakeGh([
      { stdout: `Pull request created\n${prUrl}\n` }, // findOrCreatePr: no existing PR, create
    ]);

    const result = await publishEarlyDraft(git, gh, '/repo', 'feat/xyz', 'main');

    expect(result).toEqual({ pushed: true, drafted: true, pr_url: prUrl });
    expect(ghCalls.length).toBeGreaterThan(0); // findOrCreatePr called
  });

  it('ahead of base, findOrCreatePr cached on second call → only one pr-create call total', async () => {
    const prUrl = 'https://github.com/foo/bar/pull/99';
    const { git } = fakeGit([
      { stdout: '3\n' }, // isAheadOfBase call 1 (first call)
      { stdout: '' }, // push call 1
      { stdout: '3\n' }, // isAheadOfBase call 2 (second call)
      { stdout: '' }, // push call 2
    ]);
    const { gh, calls: ghCalls } = fakeGh([
      { stdout: `Pull request created\n${prUrl}\n` }, // findOrCreatePr call 1 (create)
      // No second gh call because findOrCreatePr is cached by branch key
    ]);

    // First call — gh runner is the key for the WeakMap cache
    const result1 = await publishEarlyDraft(git, gh, '/repo', 'feat/xyz', 'main');
    expect(result1.pr_url).toBe(prUrl);

    // Second call should use cached PR (same gh runner)
    const result2 = await publishEarlyDraft(git, gh, '/repo', 'feat/xyz', 'main');
    expect(result2.pr_url).toBe(prUrl);

    // Only 1 gh call total for findOrCreatePr (cached on second call)
    expect(ghCalls).toHaveLength(1);
  });

  it('push failure → loud log, no throw, error captured in result', async () => {
    const { git } = fakeGit([
      { stdout: '3\n' }, // isAheadOfBase call (succeeds)
      new Error('push auth failed'), // push call (fails)
    ]);
    const { gh } = fakeGh([]);
    const logs: string[] = [];

    const result = await publishEarlyDraft(git, gh, '/repo', 'feat/abc', 'main', {}, (msg) =>
      logs.push(msg),
    );

    // Should not throw; error should be logged
    expect(result).toEqual({ pushed: false, drafted: false });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes('push'))).toBe(true);
  });

  it('gh unauth rejection on findOrCreatePr → one attempt, loud log, no retry, no throw', async () => {
    const { git } = fakeGit([
      { stdout: '' }, // pushBranch succeeds
      { stdout: '3\n' }, // isAheadOfBase returns 3
    ]);
    const { gh, calls: ghCalls } = fakeGh([
      new Error('gh: authentication failed'), // findOrCreatePr fails
    ]);
    const logs: string[] = [];

    const result = await publishEarlyDraft(git, gh, '/repo', 'feat/abc', 'main', {}, (msg) =>
      logs.push(msg),
    );

    // Should not throw; error should be logged
    expect(result).toEqual({ pushed: true, drafted: false });
    expect(ghCalls).toHaveLength(1); // Only one attempt at findOrCreatePr
    expect(logs.some((l) => l.includes('findOrCreatePr'))).toBe(true);
  });
});

// ── advisoryPublish ───────────────────────────────────────────────────────────

describe('advisoryPublish', () => {
  it('calls action successfully and returns its result', async () => {
    const action = async () => ({ success: true });
    const result = await advisoryPublish('feat/abc', 'draft', action);
    expect(result).toEqual({ success: true });
  });

  it('catches action errors, logs with branch+mode+error, never throws', async () => {
    const action = async () => {
      throw new Error('action failed');
    };
    const logs: string[] = [];

    let threw = false;
    let result: unknown;
    try {
      result = await advisoryPublish('feat/abc', 'draft', action, (msg) => logs.push(msg));
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes('feat/abc'))).toBe(true);
    expect(logs.some((l) => l.includes('draft'))).toBe(true);
    expect(logs.some((l) => l.includes('action failed'))).toBe(true);
  });

  it('returns undefined when action throws', async () => {
    const action = async () => {
      throw new Error('boom');
    };
    const result = await advisoryPublish('feat/abc', 'draft', action);
    expect(result).toBeUndefined();
  });
});

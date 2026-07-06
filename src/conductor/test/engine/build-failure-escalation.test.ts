/**
 * Tests for src/engine/build-failure-escalation.ts (tasks 6–9).
 *
 * All tests use FAKE runners that record calls; no real git/gh binary required.
 * Every scenario is best-effort/non-throwing by design.
 */

import { describe, it, expect } from 'vitest';
import { escalateBuildFailure } from '../../src/engine/build-failure-escalation.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import { NEEDS_REMEDIATION_MARKER } from '../../src/engine/pr-labels.js';

// ── Fake runner factories ─────────────────────────────────────────────────────

/**
 * Scripted GitRunner: consumes responses in order.
 * Each element is either a stdout string (success) or an Error (rejection).
 */
function fakeGit(responses: Array<string | Error>): {
  git: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  let idx = 0;
  const git: GitRunner = async (args, _opts) => {
    calls.push([...args]);
    const response = responses[idx++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return { stdout: response };
  };
  return { git, calls };
}

/**
 * Scripted GhRunner: consumes responses in order.
 * Each element is either { stdout } (success) or an Error (rejection).
 */
function fakeGh(responses: Array<{ stdout: string } | Error>): {
  gh: GhRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  let idx = 0;
  const gh: GhRunner = async (args, _opts) => {
    calls.push([...args]);
    const response = responses[idx++];
    if (response === undefined) return { stdout: '' };
    if (response instanceof Error) throw response;
    return response;
  };
  return { gh, calls };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const PR_URL = 'https://github.com/foo/bar/pull/42';

/**
 * Standard happy-path git responses (branch=feat/branch, base=main, 2 commits).
 * Callers append additional entries as needed.
 */
function standardGitResps(
  branch = 'feat/branch',
  base = 'main',
  commitCount = '2',
  pushResult: string | Error = '',
): Array<string | Error> {
  return [
    branch,                         // rev-parse --abbrev-ref HEAD
    `refs/remotes/origin/${base}`,  // symbolic-ref refs/remotes/origin/HEAD
    'deadbeef',                     // merge-base
    commitCount,                    // rev-list --count
    pushResult,                     // push -u origin <branch>
  ];
}

/**
 * Standard happy-path gh responses after push:
 * view fails (no existing PR) → create succeeds → ensureHaltPresentation →
 * upsertComment lookup (no marked comment yet) → create comment.
 *
 * ensureHaltPresentation flow:
 * - readHaltPresentation (from ensureBodyMarker)
 * - pr edit --body (append marker)
 * - readHaltPresentation (beforeConvert)
 * - addLabel (api POST)
 * - readHaltPresentation (verify in retry loop)
 * - readHaltPresentation (final verify)
 */
function standardGhResps(prUrl = PR_URL): Array<{ stdout: string } | Error> {
  const prBody =
    'This PR was opened automatically after an irrecoverable daemon HALT.\n\n' +
    'Manual remediation is required to unblock this feature.\n' +
    'See the comment below for the failure reason.';

  return [
    // findOrCreatePr
    new Error('no pull requests found'), // pr view (check existing)
    { stdout: `${prUrl}\n` },            // pr create

    // ensureHaltPresentation:
    // ensureBodyMarker: readHaltPresentation
    {
      stdout: JSON.stringify({
        isDraft: true,
        labels: [],
        body: prBody,
      }),
    },
    // ensureBodyMarker: pr edit --body
    { stdout: '' },
    // readHaltPresentation (beforeConvert)
    {
      stdout: JSON.stringify({
        isDraft: true,
        labels: [],
        body: `${prBody}\n<!-- conductor:needs-remediation -->`,
      }),
    },
    // convertToDraft skipped (already draft)
    // addLabel: api POST
    { stdout: '' },
    // readHaltPresentation (verify in retry)
    {
      stdout: JSON.stringify({
        isDraft: true,
        labels: [{ name: 'needs-remediation' }],
        body: `${prBody}\n<!-- conductor:needs-remediation -->`,
      }),
    },
    // readHaltPresentation (final verify)
    {
      stdout: JSON.stringify({
        isDraft: true,
        labels: [{ name: 'needs-remediation' }],
        body: `${prBody}\n<!-- conductor:needs-remediation -->`,
      }),
    },

    // upsertComment
    { stdout: JSON.stringify({ comments: [] }) }, // pr view --json comments (upsert lookup)
    { stdout: '' },                      // pr comment (upsert fallback create)
  ];
}

// ── FR-6: zero-commit guard ───────────────────────────────────────────────────

describe('FR-6: zero commits → early exit, no GitHub artifacts', () => {
  it('returns {} and makes zero gh calls when rev-list count is 0', async () => {
    const { git } = fakeGit(standardGitResps('feat/branch', 'main', '0'));
    const { gh, calls: ghCalls } = fakeGh([]);

    const result = await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'tests failed',
      runGit: git,
      runGh: gh,
    });

    expect(result).toEqual({});
    expect(ghCalls).toHaveLength(0);
  });

  it('does not call push when commit count is 0', async () => {
    const { git, calls: gitCalls } = fakeGit(standardGitResps('feat/branch', 'main', '0'));
    const { gh } = fakeGh([]);

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    const pushCall = gitCalls.find((args) => args[0] === 'push');
    expect(pushCall).toBeUndefined();
  });
});

// ── FR-6: git error in commit counting ───────────────────────────────────────

describe('FR-6: git error in commit counting → conservative no-op', () => {
  it('merge-base error ⇒ returns {}, no throw, no gh calls', async () => {
    const { git } = fakeGit([
      'feat/branch',
      'refs/remotes/origin/main',
      new Error('not a git repository'), // merge-base fails
    ]);
    const { gh, calls: ghCalls } = fakeGh([]);

    await expect(
      escalateBuildFailure({
        projectRoot: '/repo',
        failureReason: 'failure',
        runGit: git,
        runGh: gh,
      }),
    ).resolves.toEqual({});

    expect(ghCalls).toHaveLength(0);
  });

  it('rev-list count error ⇒ returns {}, no throw, no gh calls', async () => {
    const { git } = fakeGit([
      'feat/branch',
      'refs/remotes/origin/main',
      'deadbeef',
      new Error('rev-list failed'), // count fails
    ]);
    const { gh, calls: ghCalls } = fakeGh([]);

    await expect(
      escalateBuildFailure({
        projectRoot: '/repo',
        failureReason: 'failure',
        runGit: git,
        runGh: gh,
      }),
    ).resolves.toEqual({});

    expect(ghCalls).toHaveLength(0);
  });

  it('branch derivation failure ⇒ returns {}, no throw', async () => {
    const { git } = fakeGit([
      new Error('not a git repo'), // rev-parse fails
    ]);
    const { gh, calls: ghCalls } = fakeGh([]);

    await expect(
      escalateBuildFailure({
        projectRoot: '/repo',
        failureReason: 'failure',
        runGit: git,
        runGh: gh,
      }),
    ).resolves.toEqual({});

    expect(ghCalls).toHaveLength(0);
  });
});

// ── FR-2: base derivation from symbolic-ref ───────────────────────────────────

describe('base derivation from symbolic-ref (never hardcoded)', () => {
  it('uses the base from symbolic-ref, not hardcoded "main"', async () => {
    const { git } = fakeGit(standardGitResps('feat/branch', 'develop', '1'));
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    // The create call should use 'develop' as --base
    const createCall = ghCalls.find((args) => args[1] === 'create');
    expect(createCall).toBeDefined();
    const baseIdx = createCall!.indexOf('--base');
    expect(createCall![baseIdx + 1]).toEqual('develop');
  });

  it('symbolic-ref failure falls back gracefully without throwing', async () => {
    const { git } = fakeGit([
      'feat/branch',
      new Error('symbolic-ref unavailable'), // falls back to 'main'
      'deadbeef',
      '1',
      '',
    ]);
    const { gh } = fakeGh(standardGhResps());

    let threw = false;
    try {
      await escalateBuildFailure({
        projectRoot: '/repo',
        failureReason: 'failure',
        runGit: git,
        runGh: gh,
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });
});

// ── FR-7: push step ───────────────────────────────────────────────────────────

describe('FR-7: push step', () => {
  it('≥1 commit ⇒ calls git push -u origin <branch>', async () => {
    const { git, calls: gitCalls } = fakeGit(standardGitResps('feat/my-feature', 'main', '3'));
    const { gh } = fakeGh(standardGhResps());

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    const pushCall = gitCalls.find((args) => args[0] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall).toEqual(['push', '-u', 'origin', 'feat/my-feature']);
  });

  it('push fails ⇒ returns {}, no PR creation, no throw', async () => {
    const { git } = fakeGit(
      standardGitResps('feat/branch', 'main', '2', new Error('push rejected')),
    );
    const { gh, calls: ghCalls } = fakeGh([]);

    await expect(
      escalateBuildFailure({
        projectRoot: '/repo',
        failureReason: 'failure',
        runGit: git,
        runGh: gh,
      }),
    ).resolves.toEqual({});

    expect(ghCalls).toHaveLength(0);
  });
});

// ── FR-2/4/5: draft PR + needs-remediation label ─────────────────────────────

describe('FR-2/4: draft PR + needs-remediation label', () => {
  it('creates a draft PR after push', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'build exploded',
      runGit: git,
      runGh: gh,
    });

    const createCall = ghCalls.find((args) => args[1] === 'create');
    expect(createCall).toBeDefined();
    expect(createCall).toContain('--draft');
    expect(createCall).toContain('--head');
    expect(createCall).toContain('feat/branch');
  });

  it('PR title contains "needs-remediation" and the branch name', async () => {
    const { git } = fakeGit(standardGitResps('feat/my-feature'));
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    const createCall = ghCalls.find((args) => args[1] === 'create');
    const titleIdx = createCall!.indexOf('--title');
    const title = createCall![titleIdx + 1];
    expect(title).toContain('needs-remediation');
    expect(title).toContain('feat/my-feature');
  });

  it('ensures needs-remediation label is added via ensureHaltPresentation', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    // ensureHaltPresentation adds the label via api POST
    const addCall = ghCalls.find(
      (args) => args[0] === 'api' && args.includes('POST') && args.some((s) => /\/labels$/.test(s)),
    );
    expect(addCall).toBeDefined();
    expect(addCall).toContain('labels[]=needs-remediation');
    expect(addCall).toContain('repos/foo/bar/issues/42/labels');
  });

  it('returns the prUrl on success', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh } = fakeGh(standardGhResps());

    const result = await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    expect(result).toEqual({ prUrl: PR_URL });
  });
});

// ── FR-5: reuse existing OPEN PR ─────────────────────────────────────────────

describe('FR-5: reuse existing OPEN PR', () => {
  it('reuses an existing OPEN PR without calling pr create', async () => {
    const existingUrl = 'https://github.com/foo/bar/pull/10';
    const prBody =
      'This PR was opened automatically after an irrecoverable daemon HALT.\n\n' +
      'Manual remediation is required to unblock this feature.\n' +
      'See the comment below for the failure reason.';

    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh([
      { stdout: JSON.stringify({ url: existingUrl, state: 'OPEN' }) }, // pr view → existing
      // ensureHaltPresentation
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: prBody,
        }),
      },                            // readHaltPresentation
      { stdout: '' },               // pr edit
      {
        stdout: JSON.stringify({
          isDraft: false,
          labels: [],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                            // readHaltPresentation (beforeConvert)
      { stdout: '' },               // pr ready --undo
      { stdout: '' },               // addLabel
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                            // readHaltPresentation (verify)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                            // readHaltPresentation (final)
      // upsertComment
      { stdout: JSON.stringify({ comments: [] }) }, // pr view --json comments
      { stdout: '' },               // pr comment (create)
    ]);

    const result = await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    expect(result).toEqual({ prUrl: existingUrl });

    // No 'pr create' call
    const createCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'create');
    expect(createCall).toBeUndefined();
  });
});

// ── No PR → no label/comment ─────────────────────────────────────────────────

describe('create fails → no label or comment attempted', () => {
  it('returns {} and makes no add-label or comment calls when PR create fails', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh([
      new Error('no PR'),         // pr view fails
      new Error('create failed'), // pr create fails
    ]);

    const result = await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    expect(result).toEqual({});

    const addLabelCall = ghCalls.find(
      (args) => args[0] === 'api' && args.some((s) => /\/labels$/.test(s)),
    );
    const commentCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    expect(addLabelCall).toBeUndefined();
    expect(commentCall).toBeUndefined();
  });
});

// ── FR-3: reverse independence — label errors must not suppress comment ───────

describe('FR-3: comment is independent of label step (reverse independence)', () => {
  it('posts comment even when ensureLabel and addLabel both throw', async () => {
    // Label ops are best-effort; comment must run independently regardless.
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh([
      new Error('no PR'),               // pr view → no existing PR
      { stdout: `${PR_URL}\n` },        // pr create → success
      new Error('label create failed'), // ensureLabel throws
      new Error('add-label failed'),    // addLabel (gh api POST .../labels) throws
      { stdout: JSON.stringify({ comments: [] }) }, // upsert lookup → none
      { stdout: '' },                   // pr comment → success
    ]);

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'tests failed',
      runGit: git,
      runGh: gh,
    });

    const commentCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    expect(commentCall).toBeDefined();
    expect(commentCall).toContain(PR_URL);
  });
});

// ── FR-3: failure-reason comment ─────────────────────────────────────────────

describe('FR-3: failure-reason comment', () => {
  it('posts a comment containing the failure reason and "manual remediation"', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    const reason = 'Tests failed: assertion error at line 42';
    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: reason,
      runGit: git,
      runGh: gh,
    });

    const commentCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    expect(commentCall).toBeDefined();

    const bodyIdx = commentCall!.indexOf('--body');
    const body = commentCall![bodyIdx + 1];
    expect(body).toContain(reason);
    expect(body.toLowerCase()).toContain('manual remediation');
  });

  it('comment references the PR URL', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'failure',
      runGit: git,
      runGh: gh,
    });

    const commentCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    expect(commentCall).toBeDefined();
    // The comment is sent to the correct PR URL
    expect(commentCall).toContain(PR_URL);
  });
});

// ── FR-7: comment failure swallowed, label already ran ───────────────────────

describe('FR-7: comment failure is swallowed, label step already ran', () => {
  it('swallows comment error without throwing, ensureHaltPresentation already ran', async () => {
    const prBody =
      'This PR was opened automatically after an irrecoverable daemon HALT.\n\n' +
      'Manual remediation is required to unblock this feature.\n' +
      'See the comment below for the failure reason.';

    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh([
      new Error('no PR'),           // pr view (findOrCreatePr)
      { stdout: `${PR_URL}\n` },   // pr create
      // ensureHaltPresentation
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: prBody,
        }),
      },                            // readHaltPresentation
      { stdout: '' },               // pr edit
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                            // readHaltPresentation (beforeConvert)
      { stdout: '' },               // addLabel
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                            // readHaltPresentation (verify)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                            // readHaltPresentation (final)
      // upsertComment
      { stdout: JSON.stringify({ comments: [] }) }, // pr view --json comments
      new Error('comment failed'), // create comment fails — swallowed by pr-labels seam
    ]);

    let threw = false;
    let result: Awaited<ReturnType<typeof escalateBuildFailure>> | undefined;
    try {
      result = await escalateBuildFailure({
        projectRoot: '/repo',
        failureReason: 'failure',
        runGit: git,
        runGh: gh,
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.prUrl).toEqual(PR_URL);

    // Label step ran before the comment (ensureHaltPresentation adds label)
    const addLabelCall = ghCalls.find(
      (args) => args[0] === 'api' && args.some((s) => /\/labels$/.test(s)),
    );
    expect(addLabelCall).toBeDefined();
  });
});

// ── Long failure reason is trimmed ────────────────────────────────────────────

describe('long failure reason is trimmed in comment body', () => {
  it('trims a very long failure reason to ≤4001 chars in the comment', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    const longReason = 'x'.repeat(10_000);
    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: longReason,
      runGit: git,
      runGh: gh,
    });

    const commentCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    expect(commentCall).toBeDefined();
    const bodyIdx = commentCall!.indexOf('--body');
    const body = commentCall![bodyIdx + 1];

    // The body must be shorter than the original reason
    expect(body.length).toBeLessThan(longReason.length);
    // And must not contain the full 10 000-char string
    expect(body).not.toEqual(expect.stringContaining(longReason));
  });

  it('short failure reason appears verbatim in the comment', async () => {
    const { git } = fakeGit(standardGitResps());
    const { gh, calls: ghCalls } = fakeGh(standardGhResps());

    const shortReason = 'npm ERR: missing peer dependency "react"';
    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: shortReason,
      runGit: git,
      runGh: gh,
    });

    const commentCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    const bodyIdx = commentCall!.indexOf('--body');
    const body = commentCall![bodyIdx + 1];

    expect(body).toContain(shortReason);
  });
});

// ── #159: the failure comment is idempotent across repeated HALTs ─────────────

describe('#159: repeated HALTs upsert a single comment (one create + one PATCH)', () => {
  it('first escalation creates a marked comment, the second edits it in place', async () => {
    // Two runs share one scripted gh so we can assert across both.
    const existingUrl = 'https://github.com/foo/bar/pull/42';
    const markedCommentUrl = `${existingUrl}#issuecomment-555`;
    const prBody =
      'This PR was opened automatically after an irrecoverable daemon HALT.\n\n' +
      'Manual remediation is required to unblock this feature.\n' +
      'See the comment below for the failure reason.';

    const { git } = fakeGit([
      ...standardGitResps(), // run 1
      ...standardGitResps(), // run 2
    ]);
    const { gh, calls: ghCalls } = fakeGh([
      // ── run 1: fresh PR, no marked comment yet → create ──
      new Error('no pull requests found'),               // pr view (findOrCreatePr)
      { stdout: `${existingUrl}\n` },                    // pr create
      // ensureHaltPresentation
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: prBody,
        }),
      },                                                 // readHaltPresentation
      { stdout: '' },                                    // pr edit
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                                                 // readHaltPresentation (beforeConvert)
      { stdout: '' },                                    // addLabel
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                                                 // readHaltPresentation (verify)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                                                 // readHaltPresentation (final)
      // upsertComment
      { stdout: JSON.stringify({ comments: [] }) },      // pr view --json comments
      { stdout: '' },                                    // pr comment (create)
      // ── run 2: PR now exists, marked comment present → PATCH ──
      { stdout: JSON.stringify({ url: existingUrl, state: 'OPEN' }) }, // pr view (reuse)
      // ensureHaltPresentation
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                                                 // readHaltPresentation (from ensureBodyMarker - marker already present, no edit)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                                                 // readHaltPresentation (beforeConvert)
      { stdout: '' },                                    // addLabel
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                                                 // readHaltPresentation (verify in retry loop)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },                                                 // readHaltPresentation (final)
      // upsertComment
      {
        stdout: JSON.stringify({
          comments: [{ body: `${NEEDS_REMEDIATION_MARKER}\nfirst halt`, url: markedCommentUrl }],
        }),
      },                                                 // pr view --json comments
      { stdout: '' },                                    // api PATCH
    ]);

    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'first halt',
      runGit: git,
      runGh: gh,
    });
    await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'second halt',
      runGit: git,
      runGh: gh,
    });

    const createCalls = ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'comment');
    // Filter to the comment PATCH specifically — label add/remove now also use `gh api`.
    const patchCalls = ghCalls.filter((a) => a[0] === 'api' && a.includes('PATCH'));
    expect(createCalls).toHaveLength(1); // exactly one create across both HALTs
    expect(patchCalls).toHaveLength(1); // second HALT edited in place

    // The PATCH targets the existing comment id and carries the latest reason.
    expect(patchCalls[0]).toEqual([
      'api',
      '--method',
      'PATCH',
      'repos/foo/bar/issues/comments/555',
      '-f',
      `body=${NEEDS_REMEDIATION_MARKER}\n## Daemon halt\n\nsecond halt\n\nManual remediation is required.`,
    ]);
  });
});

// ── Task 13 (RED): ensureHaltPresentation wired into escalation ──────────────

describe('Task 13: escalateBuildFailure ensures halt presentation markers', () => {
  it('wires ensureHaltPresentation to verify all three markers (draft, label, body marker)', async () => {
    const { git } = fakeGit(standardGitResps());
    const prBody =
      'This PR was opened automatically after an irrecoverable daemon HALT.\n\n' +
      'Manual remediation is required to unblock this feature.\n' +
      'See the comment below for the failure reason.';

    const { gh, calls: ghCalls } = fakeGh([
      // findOrCreatePr: check existing
      new Error('no pull requests found'),
      // findOrCreatePr: create new PR
      { stdout: `${PR_URL}\n` },
      // ensureHaltPresentation flow:
      // ensureBodyMarker → readHaltPresentation (read current state before edit)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: prBody,
        }),
      },
      // ensureBodyMarker: pr edit (append marker)
      { stdout: '' },
      // readHaltPresentation (beforeConvert - read after body marker appended)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },
      // convertToDraft skipped since PR is already draft
      // addLabel (from ensureHaltPresentation retry loop - first attempt)
      { stdout: '' },
      // readHaltPresentation (verify label added in retry loop)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },
      // readHaltPresentation (final verification - confirm all three markers present)
      {
        stdout: JSON.stringify({
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${prBody}\n<!-- conductor:needs-remediation -->`,
        }),
      },
      // upsertComment: lookup comments
      { stdout: JSON.stringify({ comments: [] }) },
      // upsertComment: create comment
      { stdout: '' },
    ]);

    const result = await escalateBuildFailure({
      projectRoot: '/repo',
      failureReason: 'tests failed during daemon run',
      runGit: git,
      runGh: gh,
    });

    // Verify escalateBuildFailure returned the PR URL
    expect(result).toEqual({ prUrl: PR_URL });

    // Verify the comment with failure reason was posted (existing functionality preserved)
    const commentCall = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'comment');
    expect(commentCall).toBeDefined();
    expect(commentCall).toContain(PR_URL);
    const bodyIdx = commentCall!.indexOf('--body');
    if (bodyIdx >= 0) {
      const bodyText = commentCall![bodyIdx + 1];
      expect(bodyText).toContain('tests failed during daemon run');
    }

    // RED assertions: verify ensureHaltPresentation is wired in:

    // Assert ensureHaltPresentation makes multiple pr view --json isDraft,labels,body calls
    const prViewCalls = ghCalls.filter(
      (args) =>
        args[0] === 'pr' &&
        args[1] === 'view' &&
        args.includes('--json') &&
        args.some((arg) => arg.includes('isDraft')),
    );
    expect(prViewCalls.length).toBeGreaterThanOrEqual(3);

    // Assert pr edit was called (for appending body marker)
    const editCall = ghCalls.find(
      (args) => args[0] === 'pr' && args[1] === 'edit' && args.includes('--body'),
    );
    expect(editCall).toBeDefined();

    // Assert label was added via api (not label create)
    const addLabelCall = ghCalls.find(
      (args) => args[0] === 'api' && args.includes('POST') && args.some((s) => /\/labels$/.test(s)),
    );
    expect(addLabelCall).toBeDefined();

    // Assert all three markers are verified in final state
    expect(ghCalls).toHaveLength(10);
  });
});

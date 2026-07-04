// Test: shared issue-reference helpers (issue-ref.ts)
//
// Covers parseSourceRef / formatIssueRef / injectIssueRef:
//   - parse table (valid + adversarial garbled inputs)
//   - format produces `Closes`/`Refs` lines; null on garbage
//   - injectIssueRef: happy edit, idempotency, no-op on absent/garbled ref,
//     never injects a closing keyword for `Refs`, gh failure is non-fatal.

import { describe, it, expect } from 'vitest';
import {
  parseSourceRef,
  formatIssueRef,
  bodyReferencesIssue,
  injectIssueRef,
  closeIssueOnImplementationMerge,
} from '../../../src/engine/engineer/issue-ref.js';
import type { GhRunner } from '../../../src/engine/engineer/issue-ref.js';

interface Call {
  args: string[];
  cwd: string;
}

/** A fake gh that returns `body` from `pr view` and records `pr edit` calls. */
function makeGh(body: string | null): { gh: GhRunner; calls: Call[] } {
  const calls: Call[] = [];
  const gh: GhRunner = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    if (args[0] === 'pr' && args[1] === 'view') {
      return { stdout: body === null ? '' : JSON.stringify({ body }) };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

describe('parseSourceRef', () => {
  it('parses owner/repo#N', () => {
    expect(parseSourceRef('acme/app#49')).toEqual({ repo: 'acme/app', number: '49' });
  });
  it.each([
    ['', null],
    [undefined, null],
    [null, null],
    ['no-hash', null],
    ['#49', null], // empty repo
    ['acme/app#', null], // empty number
    ['acme/app#4a', null], // non-numeric
    ['acme/app#-1', null], // sign not allowed
  ])('rejects garbled input %p', (input, expected) => {
    expect(parseSourceRef(input as string)).toEqual(expected);
  });
});

describe('formatIssueRef', () => {
  it('formats Closes / Refs lines', () => {
    expect(formatIssueRef('Closes', 'acme/app#49')).toBe('Closes acme/app#49');
    expect(formatIssueRef('Refs', 'acme/app#49')).toBe('Refs acme/app#49');
  });
  it('returns null for unparseable refs', () => {
    expect(formatIssueRef('Closes', 'garbage')).toBeNull();
    expect(formatIssueRef('Refs', undefined)).toBeNull();
  });
});

describe('bodyReferencesIssue', () => {
  const parsed = { repo: 'acme/app', number: '49' };
  it('detects an existing Closes for the issue', () => {
    expect(bodyReferencesIssue('Closes acme/app#49', 'Closes', parsed)).toBe(true);
    expect(bodyReferencesIssue('fixes #49', 'Closes', parsed)).toBe(true);
  });
  it('detects an existing Refs for the issue', () => {
    expect(bodyReferencesIssue('Refs acme/app#49', 'Refs', parsed)).toBe(true);
  });
  it('does not match a different issue number (#4 vs #49)', () => {
    expect(bodyReferencesIssue('Closes #4', 'Closes', parsed)).toBe(false);
  });
  it('Refs check ignores an unrelated Closes', () => {
    expect(bodyReferencesIssue('Closes #49', 'Refs', parsed)).toBe(false);
  });
});

describe('injectIssueRef', () => {
  const cwd = '/repo';

  it('appends the keyword line to an existing body (happy path)', async () => {
    const { gh, calls } = makeGh('## Why\nstuff');
    const changed = await injectIssueRef({ gh, prUrl: 'URL', keyword: 'Closes', sourceRef: 'acme/app#49', cwd });
    expect(changed).toBe(true);
    const edit = calls.find((c) => c.args[1] === 'edit');
    expect(edit).toBeTruthy();
    const body = edit!.args[edit!.args.indexOf('--body') + 1];
    expect(body).toBe('## Why\nstuff\n\nCloses acme/app#49');
    expect(edit!.cwd).toBe(cwd);
  });

  it('sets the body to just the line when the PR body is empty', async () => {
    const { gh, calls } = makeGh('');
    await injectIssueRef({ gh, prUrl: 'URL', keyword: 'Refs', sourceRef: 'acme/app#49', cwd });
    const edit = calls.find((c) => c.args[1] === 'edit')!;
    expect(edit.args[edit.args.indexOf('--body') + 1]).toBe('Refs acme/app#49');
  });

  it('is idempotent — does not duplicate an existing reference', async () => {
    const { gh, calls } = makeGh('## Why\nstuff\n\nCloses acme/app#49');
    const changed = await injectIssueRef({ gh, prUrl: 'URL', keyword: 'Closes', sourceRef: 'acme/app#49', cwd });
    expect(changed).toBe(false);
    expect(calls.some((c) => c.args[1] === 'edit')).toBe(false);
  });

  it('no-ops on an absent/garbled sourceRef (never edits)', async () => {
    const { gh, calls } = makeGh('body');
    expect(await injectIssueRef({ gh, prUrl: 'URL', keyword: 'Closes', sourceRef: undefined, cwd })).toBe(false);
    expect(await injectIssueRef({ gh, prUrl: 'URL', keyword: 'Closes', sourceRef: 'garbage', cwd })).toBe(false);
    expect(calls.some((c) => c.args[1] === 'edit')).toBe(false);
  });

  it('Refs never writes a closing keyword', async () => {
    const { gh, calls } = makeGh('body');
    await injectIssueRef({ gh, prUrl: 'URL', keyword: 'Refs', sourceRef: 'acme/app#49', cwd });
    const edit = calls.find((c) => c.args[1] === 'edit')!;
    const body = edit.args[edit.args.indexOf('--body') + 1];
    expect(body).not.toMatch(/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b/i);
    expect(body).toContain('Refs acme/app#49');
  });

  it('is non-fatal when gh throws (returns false, no throw)', async () => {
    const gh: GhRunner = async () => {
      throw new Error('gh: API rate limit exceeded');
    };
    const changed = await injectIssueRef({ gh, prUrl: 'URL', keyword: 'Closes', sourceRef: 'acme/app#49', cwd });
    expect(changed).toBe(false);
  });
});

describe('closeIssueOnImplementationMerge (FR-4, FR-5, FR-7)', () => {
  const cwd = '/repo';

  it('injects Closes when both sourceRef and prUrl are present', async () => {
    const { gh, calls } = makeGh('## What changed');
    const outcome = await closeIssueOnImplementationMerge({
      gh,
      sourceRef: 'acme/app#49',
      prUrl: 'https://github.com/acme/app/pull/59',
      cwd,
    });
    expect(outcome).toBe('attempted');
    const edit = calls.find((c) => c.args[1] === 'edit')!;
    expect(edit.args[edit.args.indexOf('--body') + 1]).toContain('Closes acme/app#49');
  });

  it('no-ops for a hand-authored spec (no sourceRef) — never calls gh', async () => {
    const { gh, calls } = makeGh('body');
    const outcome = await closeIssueOnImplementationMerge({
      gh,
      sourceRef: undefined,
      prUrl: 'https://github.com/acme/app/pull/59',
      cwd,
    });
    expect(outcome).toBe('no-source-ref');
    expect(calls).toHaveLength(0);
  });

  it('no-ops when no implementation PR was recorded (build halted) — never calls gh', async () => {
    const { gh, calls } = makeGh('body');
    const outcome = await closeIssueOnImplementationMerge({
      gh,
      sourceRef: 'acme/app#49',
      prUrl: undefined,
      cwd,
    });
    expect(outcome).toBe('no-pr-url');
    expect(calls).toHaveLength(0);
  });

  it('is non-fatal when gh fails (returns attempted, does not throw)', async () => {
    const gh: GhRunner = async () => {
      throw new Error('gh: network down');
    };
    const outcome = await closeIssueOnImplementationMerge({
      gh,
      sourceRef: 'acme/app#49',
      prUrl: 'https://github.com/acme/app/pull/59',
      cwd,
    });
    expect(outcome).toBe('attempted');
  });

  // Task 15: Closes-ref parity — injectIssueRef/closeIssueOnImplementationMerge
  // take `prUrl` as a plain parameter with no awareness of pr_timing mode. The
  // SAME auto-close path fires whether that URL was freshly created at finish
  // (pr_timing: 'finish', today's default) or is a draft PR reused across the
  // whole build (pr_timing: 'early-draft', T7/T14) — the daemon's mark-ready
  // hook (T14) and this Closes-ref injection are fully independent seams that
  // both simply operate on whatever `state.pr_url` holds at finish time.
  it('injects Closes against a reused early-draft PR URL exactly the same as a freshly-created one (mode-independent)', async () => {
    // A PR URL that was opened early by the build-start hook (T7) and has
    // been transitioned ready-for-review by the finish-step mark-ready hook
    // (T14) by the time `finish` reaches the Closes-ref injection step — from
    // this function's point of view it is indistinguishable from a PR
    // `gh pr create`'d fresh at finish under pr_timing: 'finish'.
    const reusedDraftUrl = 'https://github.com/acme/app/pull/91';
    const { gh, calls } = makeGh('## What changed\n\nEarly-draft checkpoint body.');

    const outcome = await closeIssueOnImplementationMerge({
      gh,
      sourceRef: 'acme/app#49',
      prUrl: reusedDraftUrl,
      cwd,
    });

    expect(outcome).toBe('attempted');
    const edit = calls.find((c) => c.args[1] === 'edit');
    expect(edit).toBeTruthy();
    // The injection targets the reused draft's URL directly — no branching
    // on how the PR came to exist.
    expect(edit!.args).toContain(reusedDraftUrl);
    expect(edit!.args[edit!.args.indexOf('--body') + 1]).toContain('Closes acme/app#49');
  });
});

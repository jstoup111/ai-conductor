/**
 * Acceptance specs for Story "Ship-time trailer is conditional on the
 * declaration" (.docs/stories/issues-close-on-first-production-observation-of-th.md).
 *
 * Drives `closeIssueOnImplementationMerge` — the SAME shared entry point
 * daemon-cli.ts's post-run step calls after `conductor.run()` — across all
 * three declaration shapes (watched / close-on-merge / legacy-undefined),
 * asserting the OBSERVABLE outcome (the PR body text, and whether an
 * observation-watch entry was enrolled) rather than the keyword-resolution
 * helper in isolation. This is the multi-step flow the story's Done When
 * calls out: "Both injection call sites ... resolve the keyword through one
 * shared helper" — this file covers the daemon-cli post-run call site; the
 * halt-PR-rehabilitation call site is covered in
 * test/acceptance/halt-pr-rehabilitation.acceptance.test.ts.
 *
 * Per-call-site failure branches that predate this feature (no sourceRef, no
 * prUrl, gh outage during the body edit) are already covered by existing
 * unit tests on `closeIssueOnImplementationMerge` / `injectIssueRef` and are
 * unchanged by this feature — not duplicated here.
 *
 * Pre-implementation: `closeIssueOnImplementationMerge` does not yet accept
 * `declaration`/`enroll` deps, so every watched/close-on-merge assertion
 * below fails (either the body never carries "Refs", or `enroll` is never
 * called) — RED for the right reason until the declaration-aware keyword
 * injection + enrollment lands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ISSUE_REF_MOD = '../../src/engine/engineer/issue-ref.js';

const SOURCE_REF = 'owner/repo#42';
const PR_URL = 'https://github.com/owner/repo/pull/99';

/** Fake gh runner: answers `pr view ... body` and records `pr edit --body` writes. */
function makeGhFake(initialBody = ''): {
  gh: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
  getBody: () => string;
} {
  let body = initialBody;
  const gh = async (args: string[]) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return { stdout: JSON.stringify({ body }) };
    }
    if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
      body = args[args.indexOf('--body') + 1];
      return { stdout: '' };
    }
    return { stdout: '' };
  };
  return { gh, getBody: () => body };
}

async function loadCloseIssueOnImplementationMerge() {
  const mod = await import(ISSUE_REF_MOD);
  if (typeof mod.closeIssueOnImplementationMerge !== 'function') {
    throw new Error('expected export "closeIssueOnImplementationMerge" to be a function');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mod.closeIssueOnImplementationMerge as (deps: any) => Promise<string>;
}

describe('acceptance: ship-time trailer conditional on the observation declaration', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'observed-close-ship-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('watched declaration: PR body gains "Refs" (never "Closes"), and enroll is called with the full entry', async () => {
    const closeIssueOnImplementationMerge = await loadCloseIssueOnImplementationMerge();
    const { gh, getBody } = makeGhFake();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enrolled: any[] = [];

    await closeIssueOnImplementationMerge({
      gh,
      sourceRef: SOURCE_REF,
      prUrl: PR_URL,
      cwd: projectRoot,
      slug: 'feat-x',
      declaration: {
        kind: 'watched',
        signature: '▶ build 0/',
        isRegex: false,
        windowDays: 14,
        surface: 'daemon-log',
      },
      enroll: async (entry: unknown) => {
        enrolled.push(entry);
      },
    });

    expect(getBody()).toMatch(/Refs\s+owner\/repo#42/i);
    expect(getBody()).not.toMatch(/Closes\s+owner\/repo#42/i);
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0]).toMatchObject({
      sourceRef: SOURCE_REF,
      prUrl: PR_URL,
      slug: 'feat-x',
      signature: '▶ build 0/',
      windowDays: 14,
    });
    expect(enrolled[0].enrolledAt).toBeTruthy();
  });

  it('close-on-merge declaration: PR body gains "Closes" exactly as today, enroll is never called', async () => {
    const closeIssueOnImplementationMerge = await loadCloseIssueOnImplementationMerge();
    const { gh, getBody } = makeGhFake();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enrolled: any[] = [];

    await closeIssueOnImplementationMerge({
      gh,
      sourceRef: SOURCE_REF,
      prUrl: PR_URL,
      cwd: projectRoot,
      slug: 'feat-x',
      declaration: { kind: 'close-on-merge', rationale: 'no observable log signature for this fix' },
      enroll: async (entry: unknown) => {
        enrolled.push(entry);
      },
    });

    expect(getBody()).toMatch(/Closes\s+owner\/repo#42/i);
    expect(enrolled).toHaveLength(0);
  });

  it('no declaration (legacy spec, pre-feature worktree): behavior is byte-identical to today — Closes injected, enroll never called even when provided', async () => {
    const closeIssueOnImplementationMerge = await loadCloseIssueOnImplementationMerge();
    const { gh, getBody } = makeGhFake();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enrolled: any[] = [];

    await closeIssueOnImplementationMerge({
      gh,
      sourceRef: SOURCE_REF,
      prUrl: PR_URL,
      cwd: projectRoot,
      slug: 'feat-x',
      enroll: async (entry: unknown) => {
        enrolled.push(entry);
      },
      // declaration intentionally omitted — this is the legacy/no-marker path.
    });

    expect(getBody()).toBe('Closes owner/repo#42');
    expect(enrolled).toHaveLength(0);
  });

  it('watched declaration but the registry append fails: the failure is logged and the ship outcome (Refs already injected) is unaffected', async () => {
    const closeIssueOnImplementationMerge = await loadCloseIssueOnImplementationMerge();
    const { gh, getBody } = makeGhFake();
    const logs: string[] = [];

    const outcome = await closeIssueOnImplementationMerge({
      gh,
      sourceRef: SOURCE_REF,
      prUrl: PR_URL,
      cwd: projectRoot,
      slug: 'feat-x',
      log: (m: string) => logs.push(m),
      declaration: {
        kind: 'watched',
        signature: 'done',
        isRegex: false,
        windowDays: 14,
        surface: 'daemon-log',
      },
      enroll: async () => {
        throw new Error('.daemon unwritable');
      },
    });

    expect(getBody()).toMatch(/Refs\s+owner\/repo#42/i);
    expect(outcome).toBe('attempted');
    expect(logs.some((l) => /enroll/i.test(l) && /unwritable/i.test(l))).toBe(true);
  });
});

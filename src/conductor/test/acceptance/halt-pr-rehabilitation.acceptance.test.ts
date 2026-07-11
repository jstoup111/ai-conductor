/**
 * Acceptance specs for Story 3 (.docs/stories/finish-should-rewrite-stale-needs-remediation-titl.md):
 * "engine step deterministically flips ready, clears the label, and injects Closes."
 *
 * Drives the multi-step halt -> remediate -> (mergeable-sweep) flow through the
 * not-yet-implemented `rehabilitateHaltPr` engine module, asserting the final
 * observable PR state (ready, unlabeled, Closes exactly once) rather than any
 * single call site in isolation. Per-call-site failure branches (gh-ready 403,
 * REST label-removal failure, missing sourceRef, gh outage) are unit-level and
 * belong to test/engine/*.test.ts written during /pipeline — this file only
 * covers the cross-module flow explicitly called out in the story's Done When.
 *
 * Pre-implementation: `rehabilitateHaltPr` does not exist yet. Importing it
 * fails with a clear "not yet implemented" assertion (RED for the right
 * reason) until the module is authored.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';

const REHAB_MOD = '../../src/engine/halt-pr-rehabilitation.js';

const PR_URL = 'https://github.com/owner/repo/pull/249';
const SOURCE_REF = 'owner/repo#42';
const HALT_TITLE = 'needs-remediation: feat/x — manual remediation required';
const CLEAN_TITLE = 'Add retry ladder for model availability';

async function loadRehabilitateHaltPr() {
  const mod = await import(REHAB_MOD);
  if (typeof mod.rehabilitateHaltPr !== 'function') {
    throw new Error(
      'expected export "rehabilitateHaltPr" to be a function (not yet implemented)',
    );
  }
  return mod.rehabilitateHaltPr as (deps: {
    gh: GhRunner;
    cwd: string;
    prUrl: string;
    sourceRef: string | undefined | null;
    log?: (msg: string) => void;
  }) => Promise<'not-halt-pr' | 'rehabilitated' | 'partial' | 'gh-unavailable'>;
}

/**
 * Fake gh runner that answers `pr view` with the given title/labels/isDraft,
 * `pr view ... body` with the given body, and records every call's argv.
 */
function makeGhFake(state: {
  title: string;
  labels: string[];
  isDraft: boolean;
  body?: string;
}): { gh: GhRunner; calls: string[][]; getBody: () => string } {
  let body = state.body ?? '';
  let labels = state.labels;
  let isDraft = state.isDraft;
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    if (args[0] === 'pr' && args[1] === 'view' && args.includes('body')) {
      // readHaltPresentation calls: pr view <url> --json isDraft,labels,body
      return {
        stdout: JSON.stringify({
          isDraft,
          labels: labels.map((name) => ({ name })),
          body,
        }),
      };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        stdout: JSON.stringify({
          title: state.title,
          isDraft,
          labels: labels.map((name) => ({ name })),
        }),
      };
    }
    if (args[0] === 'pr' && args[1] === 'ready' && args.includes('--undo')) {
      isDraft = true;
      return { stdout: '' };
    }
    if (args[0] === 'pr' && args[1] === 'ready') {
      isDraft = false;
      return { stdout: '' };
    }
    if (args[0] === 'api' && args.includes('DELETE')) {
      labels = labels.filter((l) => l !== 'needs-remediation');
      return { stdout: '' };
    }
    if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
      body = args[args.indexOf('--body') + 1];
      return { stdout: '' };
    }
    return { stdout: '' };
  };
  return { gh, calls, getBody: () => body };
}

describe('acceptance: halt -> remediate PR flow (Story 3)', () => {
  it('halt-born draft PR: ready-flip + label clear + Closes exactly once, outcome rehabilitated', async () => {
    const rehabilitateHaltPr = await loadRehabilitateHaltPr();
    const { gh, calls, getBody } = makeGhFake({
      title: HALT_TITLE,
      labels: ['needs-remediation'],
      isDraft: true,
      body: 'This PR was opened automatically after an irrecoverable daemon HALT.',
    });

    const outcome = await rehabilitateHaltPr({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: SOURCE_REF,
    });

    expect(outcome).toBe('rehabilitated');
    expect(calls).toContainEqual(['pr', 'ready', PR_URL]);
    expect(
      calls.some(
        (c) =>
          c[0] === 'api' &&
          c.includes('DELETE') &&
          c.some((a) => a.includes('needs-remediation')),
      ),
    ).toBe(true);

    const closesMatches = getBody().match(/Closes\s+owner\/repo#42/gi) ?? [];
    expect(closesMatches).toHaveLength(1);
  });

  it('mergeable-sweep no longer suppresses the mergeable label once needs-remediation is cleared (FR-12)', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'mergeable-sweep-'));
    try {
      const rehabilitateHaltPr = await loadRehabilitateHaltPr();
      const { gh } = makeGhFake({
        title: HALT_TITLE,
        labels: ['needs-remediation'],
        isDraft: true,
      });
      await rehabilitateHaltPr({ gh, cwd: projectRoot, prUrl: PR_URL, sourceRef: SOURCE_REF });

      await enrollWatch(projectRoot, { prUrl: PR_URL, slug: 'feat-x', repoCwd: projectRoot });

      // Post-rehab: needs-remediation gone, PR is open/mergeable/no failing checks.
      const sweepCalls: string[][] = [];
      const postRehabGh: GhRunner = async (args) => {
        sweepCalls.push([...args]);
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'MERGEABLE',
              statusCheckRollup: [],
              labels: [],
            }),
          };
        }
        return { stdout: '' };
      };

      await sweepMergeableLabels({ projectRoot, runGh: postRehabGh });

      expect(
        sweepCalls.some(
          (c) => c[0] === 'api' && c.includes('POST') && c.some((a) => a.includes('/labels')),
        ),
      ).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('PR with no halt signal (clean title, no label, not draft): no-op, zero mutating calls', async () => {
    const rehabilitateHaltPr = await loadRehabilitateHaltPr();
    const { gh, calls } = makeGhFake({ title: CLEAN_TITLE, labels: [], isDraft: false });

    const outcome = await rehabilitateHaltPr({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: SOURCE_REF,
    });

    expect(outcome).toBe('not-halt-pr');
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'ready')).toBe(false);
    expect(calls.some((c) => c[0] === 'api')).toBe(false);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
  });

  it('draft PR with no halt signal (early pr_timing: early-draft build PR, #199 case): draft alone never triggers rehab', async () => {
    const rehabilitateHaltPr = await loadRehabilitateHaltPr();
    const { gh, calls } = makeGhFake({ title: CLEAN_TITLE, labels: [], isDraft: true });

    const outcome = await rehabilitateHaltPr({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: SOURCE_REF,
    });

    expect(outcome).toBe('not-halt-pr');
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'ready')).toBe(false);
    expect(calls.some((c) => c[0] === 'api')).toBe(false);
  });

  it('re-run after a prior rehabilitation (title still stale, but ready/unlabeled/Closes already applied): idempotent, no duplicate mutations', async () => {
    const rehabilitateHaltPr = await loadRehabilitateHaltPr();
    // Skill hasn't rewritten the title yet, but the engine step already ran
    // once: PR is no longer draft, label already gone, Closes already present.
    const { gh, calls, getBody } = makeGhFake({
      title: HALT_TITLE,
      labels: [],
      isDraft: false,
      body: 'Some PR body.\n\nCloses owner/repo#42',
    });

    const outcome = await rehabilitateHaltPr({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: SOURCE_REF,
    });

    expect(outcome).toBe('rehabilitated');
    // isDraft is already false — no redundant ready-flip call.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'ready')).toBe(false);
    // Closes is already present — injectIssueRef must not issue a body edit.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
    const closesMatches = getBody().match(/Closes\s+owner\/repo#42/gi) ?? [];
    expect(closesMatches).toHaveLength(1);
  });

  it('human partially rehabilitated the PR by hand (title fixed, needs-remediation label still present): remaining facet fixed, hand-written title untouched', async () => {
    const rehabilitateHaltPr = await loadRehabilitateHaltPr();
    const { gh, calls } = makeGhFake({
      title: CLEAN_TITLE, // a human already rewrote the title
      labels: ['needs-remediation'], // but the label was never cleared
      isDraft: true,
    });

    const outcome = await rehabilitateHaltPr({
      gh,
      cwd: '/repo',
      prUrl: PR_URL,
      sourceRef: SOURCE_REF,
    });

    expect(outcome).toBe('rehabilitated');
    expect(calls).toContainEqual(['pr', 'ready', PR_URL]);
    expect(
      calls.some(
        (c) =>
          c[0] === 'api' &&
          c.includes('DELETE') &&
          c.some((a) => a.includes('needs-remediation')),
      ),
    ).toBe(true);
    // rehabilitateHaltPr never edits the title — that is the skill's job, not
    // the engine step's (ADR Decision 1 vs Decision 2 split).
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit' && c.includes('--title'))).toBe(
      false,
    );
  });
});

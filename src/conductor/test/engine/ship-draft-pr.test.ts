/**
 * Tests for the SHIP-phase-entry draft PR publisher (`openShipDraftPr`).
 *
 * All tests use FAKE `gh` / `git` runners that record calls — no real binary
 * is ever invoked (this repo forbids third-party calls outside opt-in smoke
 * tests). The publisher is advisory: every failure path logs and returns an
 * outcome, and NOTHING it does may throw into the conductor loop.
 */

import { describe, it, expect } from 'vitest';
import {
  openShipDraftPr,
  SHIP_DRAFT_PR_NOTE,
} from '../../src/engine/ship-draft-pr.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import { PR_BODY_FLOOR_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';

const CWD = '/repo';
const BRANCH = 'feat/widget-import';
const BASE = 'main';
const PR_URL = 'https://github.com/acme/repo/pull/7';

function fakeGit(
  handler: (args: string[]) => { stdout: string } | Error,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    const result = handler(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { git, calls };
}

/** Default git fake: branch is 2 commits ahead of base and pushes cleanly. */
function aheadGit(): { git: GitRunner; calls: string[][] } {
  return fakeGit((args) => {
    if (args[0] === 'rev-list') return { stdout: '2\n' };
    if (args[0] === 'push') return { stdout: '' };
    return { stdout: '' };
  });
}

function fakeGh(
  handler: (args: string[]) => { stdout: string } | Error,
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    const result = handler(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { gh, calls };
}

/** Default gh fake: no PR exists yet; `pr create` prints the new URL. */
function createsGh(): { gh: GhRunner; calls: string[][] } {
  return fakeGh((args) => {
    if (args[1] === 'view') return new Error('no pull requests found');
    if (args[1] === 'create') return { stdout: `${PR_URL}\n` };
    return { stdout: '' };
  });
}

describe('openShipDraftPr', () => {
  it('pushes the branch and opens a DRAFT PR against the base branch', async () => {
    const { git, calls: gitCalls } = aheadGit();
    const { gh, calls: ghCalls } = createsGh();

    const result = await openShipDraftPr({
      gh,
      git,
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE,
      featureDesc: 'widget import flow',
    });

    expect(result).toEqual({ outcome: 'published', prUrl: PR_URL });

    // Plain, non-force push of the feature branch.
    const push = gitCalls.find((c) => c[0] === 'push');
    expect(push).toEqual(['push', '-u', 'origin', BRANCH]);
    expect(gitCalls.flat()).not.toContain('--force');
    expect(gitCalls.flat()).not.toContain('--force-with-lease');

    const create = ghCalls.find((c) => c[1] === 'create');
    expect(create).toBeDefined();
    expect(create).toContain('--draft');
    expect(create).toContain('--base');
    expect(create![create!.indexOf('--base') + 1]).toBe(BASE);
    expect(create![create!.indexOf('--head') + 1]).toBe(BRANCH);
    expect(create![create!.indexOf('--title') + 1]).toBe('feat: widget import flow');
  });

  it('leaves release disposition selection to the pre-finish custom step', async () => {
    const { git } = aheadGit();
    const { gh, calls: ghCalls } = createsGh();

    await openShipDraftPr({ gh, git, cwd: CWD, branch: BRANCH, baseBranch: BASE, featureDesc: 'x' });

    const create = ghCalls.find((c) => c[1] === 'create')!;
    const body = create[create.indexOf('--body') + 1];
    expect(body).toContain(PR_BODY_FLOOR_MARKER);
    expect(body).toContain(SHIP_DRAFT_PR_NOTE);
    expect(body).not.toMatch(/^Release-Disposition:/m);
    // Never a halt PR: no halt banner, no needs-remediation title prefix.
    expect(body).not.toContain('irrecoverable daemon HALT');
    expect(create[create.indexOf('--title') + 1]).not.toContain('needs-remediation');
  });

  it('reuses an already-open PR without preserving or choosing a release disposition', async () => {
    const { git } = aheadGit();
    const { gh, calls: ghCalls } = fakeGh((args) => {
      if (args[1] === 'view' && args.includes('url,state')) {
        return { stdout: JSON.stringify({ url: PR_URL, state: 'OPEN' }) };
      }
      if (args[1] === 'view' && args.includes('body')) return { stdout: JSON.stringify({ body: 'old draft' }) };
      return { stdout: '' };
    });

    const result = await openShipDraftPr({
      gh,
      git,
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE,
      featureDesc: 'x',
    });

    expect(result).toEqual({ outcome: 'published', prUrl: PR_URL });
    expect(ghCalls.filter((c) => c[1] === 'create')).toHaveLength(0);
    expect(ghCalls.filter((c) => c[1] === 'edit')).toHaveLength(0);
  });

  it('does not push or open a PR when the branch has no commits over base', async () => {
    const { git, calls: gitCalls } = fakeGit((args) => {
      if (args[0] === 'rev-list') return { stdout: '0\n' };
      return { stdout: '' };
    });
    const { gh, calls: ghCalls } = createsGh();

    const result = await openShipDraftPr({
      gh,
      git,
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE,
      featureDesc: 'x',
    });

    expect(result.outcome).toBe('no-commits');
    expect(gitCalls.filter((c) => c[0] === 'push')).toHaveLength(0);
    expect(ghCalls).toHaveLength(0);
  });

  it('is advisory: a push failure logs loudly, opens no PR, and never throws', async () => {
    const logs: string[] = [];
    const { git } = fakeGit((args) => {
      if (args[0] === 'rev-list') return { stdout: '3\n' };
      if (args[0] === 'push') return new Error('! [rejected] non-fast-forward');
      return { stdout: '' };
    });
    const { gh, calls: ghCalls } = createsGh();

    const result = await openShipDraftPr({
      gh,
      git,
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE,
      featureDesc: 'x',
      log: (m) => logs.push(m),
    });

    expect(result.outcome).toBe('push-failed');
    expect(ghCalls).toHaveLength(0);
    expect(logs.join('\n')).toContain('non-fast-forward');
  });

  it('is advisory: a gh failure logs loudly and never throws', async () => {
    const logs: string[] = [];
    const { git } = aheadGit();
    const gh: GhRunner = async () => {
      throw new Error('gh: not authenticated');
    };

    const result = await openShipDraftPr({
      gh,
      git,
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE,
      featureDesc: 'x',
      log: (m) => logs.push(m),
    });

    expect(result.outcome).toBe('failed');
    expect(logs.length).toBeGreaterThan(0);
  });

  it('skips entirely when the branch or base cannot be resolved', async () => {
    const { git, calls: gitCalls } = aheadGit();
    const { gh, calls: ghCalls } = createsGh();

    const noBase = await openShipDraftPr({ gh, git, cwd: CWD, branch: BRANCH, baseBranch: undefined });
    expect(noBase.outcome).toBe('skipped');

    const noBranch = await openShipDraftPr({ gh, git, cwd: CWD, branch: undefined, baseBranch: BASE });
    expect(noBranch.outcome).toBe('skipped');

    const detached = await openShipDraftPr({ gh, git, cwd: CWD, branch: 'HEAD', baseBranch: BASE });
    expect(detached.outcome).toBe('skipped');

    expect(gitCalls.filter((c) => c[0] === 'push')).toHaveLength(0);
    expect(ghCalls).toHaveLength(0);
  });

  it('falls back to origin/<base> when the base ref is not present locally', async () => {
    const { git, calls: gitCalls } = fakeGit((args) => {
      if (args[0] === 'rev-list' && args[2] === `${BASE}..HEAD`) {
        return new Error(`unknown revision ${BASE}`);
      }
      if (args[0] === 'rev-list') return { stdout: '4\n' };
      return { stdout: '' };
    });
    const { gh } = createsGh();

    const result = await openShipDraftPr({
      gh,
      git,
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE,
      featureDesc: 'x',
    });

    expect(result.outcome).toBe('published');
    expect(gitCalls.some((c) => c.includes(`origin/${BASE}..HEAD`))).toBe(true);
  });

  it('derives a title from the branch name when no featureDesc is available', async () => {
    const { git } = aheadGit();
    const { gh, calls: ghCalls } = createsGh();

    await openShipDraftPr({ gh, git, cwd: CWD, branch: 'feat/widget-import', baseBranch: BASE });

    const create = ghCalls.find((c) => c[1] === 'create')!;
    expect(create[create.indexOf('--title') + 1]).toBe('feat: widget import');
  });
});

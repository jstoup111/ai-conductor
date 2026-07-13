/**
 * Tests for the prefix-gated retitle-floor primitive (Task 6,
 * adr-2026-07-03-halt-pr-rehabilitation-at-finish).
 *
 * All tests use FAKE gh runners that record calls; no real gh binary
 * required. The floor is deterministic: it only ever touches a title that
 * literally starts with `needs-remediation:` — prose titles are left
 * untouched, and the body is never edited.
 */

import { describe, it, expect } from 'vitest';
import { retitleFloor, ensureShipReady, rehabilitateHaltPr } from '../../src/engine/halt-pr-rehabilitation.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { HALT_PR_BANNER_SENTINEL } from '../../src/engine/pr-labels.js';

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
const CWD = '/repo';

describe('retitleFloor (Task 6)', () => {
  it('retitles a needs-remediation title to feat: <featureDesc> when featureDesc is given', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
      { stdout: '' },
    ]);

    const result = await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow' });

    const editCall = calls.find((c) => c[0] === 'pr' && c[1] === 'edit');
    expect(editCall).toBeDefined();
    expect(editCall).toEqual(['pr', 'edit', PR_URL, '--title', 'feat: widget import flow']);
    expect(result.title).toBe('feat: widget import flow');
    expect(result.title).not.toContain('needs-remediation:');
  });

  it('falls back to the branch name when no featureDesc is provided', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
      { stdout: '' },
    ]);

    const result = await retitleFloor(gh, CWD, PR_URL, { branch: 'feat/widget-import-flow' });

    const editCall = calls.find((c) => c[0] === 'pr' && c[1] === 'edit');
    expect(editCall).toBeDefined();
    expect(editCall![3]).toBe('--title');
    expect(editCall![4]).toContain('widget import flow');
    expect(result.title).not.toContain('needs-remediation:');
  });

  it('issues zero edit calls for a clean prose title', async () => {
    const { gh, calls } = fakeGh([{ stdout: JSON.stringify({ title: 'feat: already clean' }) }]);

    const result = await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow' });

    const editCall = calls.find((c) => c[0] === 'pr' && c[1] === 'edit');
    expect(editCall).toBeUndefined();
    expect(result.title).toBe('feat: already clean');
    expect(result.outcome).toBe('not-halt-pr');
  });

  it('warns and resolves when gh pr edit fails', async () => {
    const logs: string[] = [];
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
      new Error('gh: rate limited'),
    ]);

    const result = await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow' }, (msg) =>
      logs.push(msg),
    );

    expect(result.outcome).toBe('resolved');
    expect(logs.length).toBeGreaterThan(0);
  });

  it('never edits the PR body', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
      { stdout: '' },
    ]);

    await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow' });

    const bodyCall = calls.find((c) => c.includes('--body'));
    expect(bodyCall).toBeUndefined();
  });

  it('never returns a result title containing needs-remediation:', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
      { stdout: '' },
    ]);

    const result = await retitleFloor(gh, CWD, PR_URL, { branch: 'feat/x' });

    expect(result.title).not.toContain('needs-remediation:');
  });
});

describe('ensureShipReady (Task 7)', () => {
  const noopSleep = async () => {};

  it('flips a clean-titled unlabeled draft PR to ready, verified by re-read', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // read before
      { stdout: '' }, // gh pr ready
      { stdout: JSON.stringify({ isDraft: false, labels: [], body: '' }) }, // verify re-read
    ]);

    const result = await ensureShipReady(gh, CWD, PR_URL, undefined, noopSleep);

    expect(result).toBe('flipped-ready');
    const readyCall = calls.find((c) => c[0] === 'pr' && c[1] === 'ready');
    expect(readyCall).toEqual(['pr', 'ready', PR_URL]);

    // No unlabel/retitle/body mutation attempted — distinct from rehabilitateHaltPr.
    expect(calls.some((c) => c.includes('--add-label') || c.includes('--remove-label'))).toBe(false);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
    expect(calls.some((c) => c.includes('--body'))).toBe(false);
    expect(calls.some((c) => c[0] === 'api')).toBe(false);
  });

  it('is a no-op for an already-ready PR — zero gh pr ready calls', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ isDraft: false, labels: [], body: '' }) }, // read before
    ]);

    const result = await ensureShipReady(gh, CWD, PR_URL, undefined, noopSleep);

    expect(result).toBe('no-op');
    const readyCall = calls.find((c) => c[0] === 'pr' && c[1] === 'ready');
    expect(readyCall).toBeUndefined();
    expect(calls.length).toBe(1);
  });

  it('returns a non-fatal partial outcome when still draft after bounded retries', async () => {
    const logs: string[] = [];
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // read before
      { stdout: '' }, // attempt 1: gh pr ready
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // attempt 1: still draft
      { stdout: '' }, // attempt 2: gh pr ready
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // attempt 2: still draft
      { stdout: '' }, // attempt 3: gh pr ready
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // attempt 3: still draft
    ]);

    const result = await ensureShipReady(gh, CWD, PR_URL, (msg) => logs.push(msg), noopSleep);

    expect(result).toBe('partial');
    const readyCalls = calls.filter((c) => c[0] === 'pr' && c[1] === 'ready');
    expect(readyCalls.length).toBe(3);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('returns partial and never throws when the initial read fails', async () => {
    const { gh } = fakeGh([new Error('gh: network error')]);

    const result = await ensureShipReady(gh, CWD, PR_URL, undefined, noopSleep);

    expect(result).toBe('partial');
  });
});

describe('rehabilitateHaltPr — banner is a third stateless halt signal (Task 1)', () => {
  it('treats a clean-titled, unlabeled PR whose body carries the halt banner as a halt PR (#610 shape)', async () => {
    const bannerBody = [
      'This PR was opened automatically after an irrecoverable daemon HALT.',
      '',
      'Manual remediation is required to unblock this feature.',
      'See the comment below for the failure reason.',
    ].join('\n');
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'feat: widget import flow', isDraft: false, labels: [], body: bannerBody }) },
      { stdout: '' }, // cleanupHaltPresentation reads/edits
      { stdout: JSON.stringify({ title: 'feat: widget import flow', isDraft: false, labels: [], body: bannerBody }) },
      { stdout: '' },
    ]);

    const result = await rehabilitateHaltPr({ gh, cwd: CWD, prUrl: PR_URL, sourceRef: null });

    expect(result).not.toBe('not-halt-pr');
    expect(bannerBody).toContain(HALT_PR_BANNER_SENTINEL);
  });

  it('returns not-halt-pr with zero mutation calls when there is no halt signal at all', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          title: 'feat: widget import flow',
          isDraft: false,
          labels: [],
          body: '## Summary\n\nSome clean implementation PR body.\n\nCloses #7',
        }),
      },
    ]);

    const result = await rehabilitateHaltPr({ gh, cwd: CWD, prUrl: PR_URL, sourceRef: null });

    expect(result).toBe('not-halt-pr');
    // Only the initial gh pr view read — no label/title/body/comment mutation calls.
    expect(calls.length).toBe(1);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
    expect(calls.some((c) => c.includes('--add-label') || c.includes('--remove-label'))).toBe(false);
    expect(calls.some((c) => c[0] === 'api')).toBe(false);
  });
});

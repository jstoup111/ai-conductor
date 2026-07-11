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
import { retitleFloor } from '../../src/engine/halt-pr-rehabilitation.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

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

// Acceptance anchor for condition C3 (Story 16, cross-repo safety) at the adapter layer.
// Capture (poll) and write-back (report) talk ONLY to gh — they must never write files
// into any registered repo's working tree. The full route-to-target integration is T26.
// RED until intake/github-issues.ts exists.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFakeGh, fakeRegistry, type FakeGhState } from './_acceptance-helpers.js';

async function loadAdapter() {
  return import('../../../../src/engine/engineer/intake/github-issues.js') as Promise<any>;
}
async function loadLedger() {
  return import('../../../../src/engine/engineer/intake/ledger.js') as Promise<any>;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xrepo-acc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('C3 adapter never mutates registered repo working trees', () => {
  it('poll() and report() leave every registered repo dir empty', async () => {
    const repoA = join(dir, 'a');
    const repoB = join(dir, 'b');
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });

    const state: FakeGhState = {
      issuesByRepo: { 'o/a': [{ repo: 'o/a', number: 1, title: 'A', body: 'a' }] },
      prs: {},
      comments: [],
      appliedLabels: [],
      createdLabels: [],
      failRepos: new Set(),
    };
    const { gh } = makeFakeGh(state);
    const { createGithubIssuesAdapter } = await loadAdapter();
    const { createLedger } = await loadLedger();
    const adapter = createGithubIssuesAdapter({
      gh,
      registry: fakeRegistry([
        { name: 'o/a', path: repoA },
        { name: 'o/b', path: repoB },
      ]),
      ledger: createLedger(join(dir, 'ledger.json')),
    });

    await adapter.poll();
    await adapter.report('o/a#1', 'routed', { repo: 'o/b' });
    await adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/1' });

    // Neither repo's working tree was written to by the adapter.
    expect(await readdir(repoA)).toEqual([]);
    expect(await readdir(repoB)).toEqual([]);
  });
});

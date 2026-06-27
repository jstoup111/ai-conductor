// Acceptance: github-issues adapter — capture + write-back + re-eligibility
// (FR-26/27/28/34/35/36/37/38/39/40; Stories 2,3,4,9,10,11,12,14,15).
// RED until intake/github-issues.ts exists. All gh access via injected fake (no network).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFakeGh, fakeRegistry, fixedClock, type FakeGhState } from './_acceptance-helpers.js';

async function loadAdapter() {
  return import('../../../../src/engine/engineer/intake/github-issues.js') as Promise<any>;
}
async function loadLedger() {
  return import('../../../../src/engine/engineer/intake/ledger.js') as Promise<any>;
}

let dir: string;
function baseState(): FakeGhState {
  return {
    issuesByRepo: {},
    prs: {},
    comments: [],
    appliedLabels: [],
    createdLabels: [],
    failRepos: new Set(),
  };
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gh-acc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function makeAdapter(state: FakeGhState, repos: Array<{ name: string; path: string }>) {
  const { createGithubIssuesAdapter } = await loadAdapter();
  const { createLedger } = await loadLedger();
  const { gh } = makeFakeGh(state);
  const clock = fixedClock();
  const ledger = createLedger(join(dir, 'ledger.json'));
  const adapter = createGithubIssuesAdapter({
    gh,
    registry: fakeRegistry(repos),
    ledger,
    now: clock.now,
    newId: clock.id,
  });
  return { adapter, ledger };
}

describe('FR-26 poll assigned issues across registered repos', () => {
  it('produces one Envelope per open assigned issue with correct fields', async () => {
    const state = baseState();
    state.issuesByRepo = {
      'o/a': [{ repo: 'o/a', number: 1, title: 'Idea A', body: 'body A' }],
      'o/b': [{ repo: 'o/b', number: 7, title: 'Idea B', body: 'body B' }],
    };
    const { adapter } = await makeAdapter(state, [
      { name: 'o/a', path: join(dir, 'a') },
      { name: 'o/b', path: join(dir, 'b') },
    ]);
    const envs = await adapter.poll();
    const refs = envs.map((e: any) => e.sourceRef).sort();
    expect(refs).toEqual(['o/a#1', 'o/b#7']);
    const a = envs.find((e: any) => e.sourceRef === 'o/a#1');
    expect(a.source).toBe('github-issues');
    expect(a.text).toContain('Idea A');
    expect(a.text).toContain('body A');
    expect(a.hintRepo).toBe('o/a');
    expect(a.status).toBe('pending');
  });

  it('returns [] and calls gh zero times for an empty registry', async () => {
    const state = baseState();
    const { gh, calls } = makeFakeGh(state);
    const { createGithubIssuesAdapter } = await loadAdapter();
    const { createLedger } = await loadLedger();
    const adapter = createGithubIssuesAdapter({
      gh,
      registry: fakeRegistry([]),
      ledger: createLedger(join(dir, 'ledger.json')),
    });
    expect(await adapter.poll()).toEqual([]);
    expect(calls.length).toBe(0);
  });
});

describe('FR-28 empty issue rejected at capture', () => {
  it('skips an issue with empty title and body', async () => {
    const state = baseState();
    state.issuesByRepo = { 'o/a': [{ repo: 'o/a', number: 1, title: '  ', body: '' }] };
    const { adapter } = await makeAdapter(state, [{ name: 'o/a', path: join(dir, 'a') }]);
    expect(await adapter.poll()).toEqual([]);
  });

  it('keeps a title-only issue', async () => {
    const state = baseState();
    state.issuesByRepo = { 'o/a': [{ repo: 'o/a', number: 1, title: 'Just a title', body: '' }] };
    const { adapter } = await makeAdapter(state, [{ name: 'o/a', path: join(dir, 'a') }]);
    const envs = await adapter.poll();
    expect(envs.length).toBe(1);
    expect(envs[0].text).toContain('Just a title');
  });
});

describe('FR-27 degrade on auth/availability failure', () => {
  it('isolates a failing repo and still returns others', async () => {
    const state = baseState();
    state.issuesByRepo = { 'o/a': [{ repo: 'o/a', number: 1, title: 'A', body: 'a' }] };
    state.failRepos = new Set(['o/b']);
    const { adapter } = await makeAdapter(state, [
      { name: 'o/a', path: join(dir, 'a') },
      { name: 'o/b', path: join(dir, 'b') },
    ]);
    const envs = await adapter.poll();
    expect(envs.map((e: any) => e.sourceRef)).toEqual(['o/a#1']);
  });

  it('returns [] without throwing when all repos fail', async () => {
    const state = baseState();
    state.failRepos = new Set(['o/a']);
    const { adapter } = await makeAdapter(state, [{ name: 'o/a', path: join(dir, 'a') }]);
    await expect(adapter.poll()).resolves.toEqual([]);
  });
});

describe('FR-34/35 idempotent pull (ledger + label skip)', () => {
  it('does not re-capture an issue already in the ledger', async () => {
    const state = baseState();
    state.issuesByRepo = { 'o/a': [{ repo: 'o/a', number: 1, title: 'A', body: 'a' }] };
    const { adapter } = await makeAdapter(state, [{ name: 'o/a', path: join(dir, 'a') }]);
    expect((await adapter.poll()).length).toBe(1);
    expect((await adapter.poll()).length).toBe(0); // second poll: already ledgered
  });

  it('skips an issue bearing the engineer:handled label', async () => {
    const state = baseState();
    state.issuesByRepo = {
      'o/a': [{ repo: 'o/a', number: 1, title: 'A', body: 'a', labels: ['engineer:handled'] }],
    };
    const { adapter } = await makeAdapter(state, [{ name: 'o/a', path: join(dir, 'a') }]);
    expect(await adapter.poll()).toEqual([]);
  });
});

describe('FR-36/38 write-back comments + label, idempotent', () => {
  it('posts routed and done comments and applies engineer:handled on done', async () => {
    const state = baseState();
    const { createGithubIssuesAdapter } = await loadAdapter();
    const { createLedger } = await loadLedger();
    const { gh } = makeFakeGh(state);
    const adapter = createGithubIssuesAdapter({
      gh,
      registry: fakeRegistry([{ name: 'o/a', path: join(dir, 'a') }]),
      ledger: createLedger(join(dir, 'ledger.json')),
    });
    await adapter.report('o/a#1', 'routed', { repo: 'o/target' });
    await adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/9' });
    expect(state.comments.some((c) => /Routed to/.test(c.body))).toBe(true);
    expect(state.comments.some((c) => /Spec PR opened/.test(c.body))).toBe(true);
    expect(state.appliedLabels.some((l) => l.label === 'engineer:handled')).toBe(true);
  });

  it('does not post a duplicate comment for the same (sourceRef,status)', async () => {
    const state = baseState();
    const { createGithubIssuesAdapter } = await loadAdapter();
    const { createLedger } = await loadLedger();
    const { gh } = makeFakeGh(state);
    const adapter = createGithubIssuesAdapter({
      gh,
      registry: fakeRegistry([{ name: 'o/a', path: join(dir, 'a') }]),
      ledger: createLedger(join(dir, 'ledger.json')),
    });
    await adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/9' });
    await adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/9' });
    const doneComments = state.comments.filter((c) => /Spec PR opened/.test(c.body));
    expect(doneComments.length).toBe(1);
  });
});

describe('FR-37 write-back is non-fatal', () => {
  it('does not throw when the gh comment call fails', async () => {
    const { createGithubIssuesAdapter } = await loadAdapter();
    const { createLedger } = await loadLedger();
    const failingGh = async () => {
      throw new Error('network');
    };
    const adapter = createGithubIssuesAdapter({
      gh: failingGh,
      registry: fakeRegistry([{ name: 'o/a', path: join(dir, 'a') }]),
      ledger: createLedger(join(dir, 'ledger.json')),
    });
    await expect(adapter.report('o/a#1', 'done', { prUrl: 'https://x/pr/9' })).resolves.not.toThrow();
  });
});

describe('FR-39/40 re-eligibility + churn guard', () => {
  it('reopens a done entry whose spec PR is closed-unmerged', async () => {
    const state = baseState();
    state.issuesByRepo = {
      'o/a': [{ repo: 'o/a', number: 1, title: 'A', body: 'a', labels: ['engineer:handled'] }],
    };
    state.prs = { 'https://x/pr/9': { url: 'https://x/pr/9', state: 'CLOSED', mergedAt: null } };
    const { adapter, ledger } = await makeAdapter(state, [{ name: 'o/a', path: join(dir, 'a') }]);
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await ledger.transition('github-issues', 'o/a#1', 'done', { prUrl: 'https://x/pr/9' });
    const envs = await adapter.poll();
    expect(envs.map((e: any) => e.sourceRef)).toContain('o/a#1');
  });

  it('never reopens a merged spec PR', async () => {
    const state = baseState();
    state.issuesByRepo = {
      'o/a': [{ repo: 'o/a', number: 1, title: 'A', body: 'a', labels: ['engineer:handled'] }],
    };
    state.prs = {
      'https://x/pr/9': { url: 'https://x/pr/9', state: 'MERGED', mergedAt: '2026-06-27T01:00:00Z' },
    };
    const { adapter, ledger } = await makeAdapter(state, [{ name: 'o/a', path: join(dir, 'a') }]);
    await ledger.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await ledger.transition('github-issues', 'o/a#1', 'done', { prUrl: 'https://x/pr/9' });
    expect(await adapter.poll()).toEqual([]);
  });
});

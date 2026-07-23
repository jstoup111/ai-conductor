// Unit tests for `fileIntakeIssue` (engine/engineer/intake/file-issue.ts).
//
// Task 8 (canonical tracker-client seam): `fileIntakeIssue` must delegate
// issue creation to an injected `TrackerClient.createIssue`, not a local
// `FileIssueGhRunner`/ad-hoc gh-invocation abstraction. This file drives that
// migration and asserts cross-repo `--repo` targeting parity — a specified
// `repo` must reach `createIssue`'s `repo` field.
//
// Seams faked: a `TrackerClient` fake (drives `createIssue`) and a `GhRunner`
// fake (drives the remaining label-apply / depends-on-link gh calls that
// `TrackerClient` does not yet cover).

import { describe, it, expect } from 'vitest';
import { fileIntakeIssue } from '../src/engine/engineer/intake/file-issue.js';
import type { TrackerClient } from '../src/engine/tracker-client.js';

/** Fake TrackerClient recording createIssue calls; everything else throws if
 * called (this test suite drives createIssue only). */
function makeFakeTracker(opts: { failIssueCreate?: boolean } = {}) {
  const createIssueCalls: { input: { title: string; body: string; repo?: string }; cwd: string }[] =
    [];

  const tracker: TrackerClient = {
    async getIssueLabels() {
      throw new Error('not used in this test');
    },
    async viewIssue() {
      throw new Error('not used in this test');
    },
    async getIssueState() {
      throw new Error('not used in this test');
    },
    async viewerIdentity() {
      throw new Error('not used in this test');
    },
    async getBlockedBy() {
      throw new Error('not used in this test');
    },
    async listAssignedIssues() {
      throw new Error('not used in this test');
    },
    async commentOnIssue() {
      throw new Error('not used in this test');
    },
    async createIssue(input, cwd) {
      createIssueCalls.push({ input, cwd });
      if (opts.failIssueCreate) throw new Error('simulated issue-create failure');
      return 'https://github.com/acme/app/issues/300';
    },
    async addIssueLabel() {
      throw new Error('not used in this test');
    },
    async closeIssue() {
      throw new Error('not used in this test');
    },
    async upsertIssueBody() {
      throw new Error('not used in this test');
    },
    async upsertIssueComment() {
      throw new Error('not used in this test');
    },
  };

  return { tracker, createIssueCalls };
}

/** Fake `gh` runner covering the remaining label-apply / depends-on-link
 * traffic `fileIntakeIssue` still drives directly. */
function makeFakeGh(opts: { failLabelApply?: boolean } = {}) {
  const calls: { args: string[] }[] = [];
  const appliedLabels: string[] = [];

  const run = async (args: string[], _opts: { cwd: string }) => {
    calls.push({ args });

    if (args.some((a) => a.endsWith('/labels')) && args.some((a) => a.startsWith('labels[]='))) {
      if (opts.failLabelApply) throw new Error('simulated label-apply outage');
      const labelArg = args.find((a) => a.startsWith('labels[]='))!;
      appliedLabels.push(labelArg.replace('labels[]=', ''));
      return { stdout: '{}' };
    }
    const blockedByTarget = args.find((a) => a.includes('/dependencies/blocked_by'));
    if (blockedByTarget) {
      return { stdout: '[]' };
    }
    const issuePath = args.find((a) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(a));
    if (issuePath) {
      return { stdout: JSON.stringify({ id: 1_000_300, number: 300 }) };
    }
    return { stdout: '{}' };
  };

  return { run, calls, appliedLabels };
}

describe('fileIntakeIssue — TrackerClient.createIssue seam', () => {
  it('creates the issue via the injected TrackerClient.createIssue, not a local gh runner', async () => {
    const { tracker, createIssueCalls } = makeFakeTracker();
    const gh = makeFakeGh();

    const result = await fileIntakeIssue(
      {
        title: 'Something broke',
        body: 'Observed X, expected Y',
        size: 'L',
        priority: 'critical',
        interactive: false,
      },
      { tracker, gh: gh.run, cwd: '.' },
    );

    expect(createIssueCalls).toHaveLength(1);
    expect(createIssueCalls[0].input).toMatchObject({
      title: 'Something broke',
      body: 'Observed X, expected Y',
    });
    expect(createIssueCalls[0].cwd).toBe('.');
    expect(result.issueUrl).toContain('acme/app/issues/300');
  });

  it('forwards a specified --repo to createIssue\'s repo field (cross-repo targeting parity)', async () => {
    const { tracker, createIssueCalls } = makeFakeTracker();
    const gh = makeFakeGh();

    await fileIntakeIssue(
      {
        title: 'Cross-repo report',
        body: 'body',
        size: 'S',
        priority: 'low',
        repo: 'acme/other-repo',
        interactive: false,
      },
      { tracker, gh: gh.run, cwd: '.' },
    );

    expect(createIssueCalls).toHaveLength(1);
    expect(createIssueCalls[0].input.repo).toBe('acme/other-repo');
  });

  it('omitting --repo leaves createIssue\'s repo field undefined', async () => {
    const { tracker, createIssueCalls } = makeFakeTracker();
    const gh = makeFakeGh();

    await fileIntakeIssue(
      { title: 'Same-repo report', body: 'body', size: 'S', priority: 'low', interactive: false },
      { tracker, gh: gh.run, cwd: '.' },
    );

    expect(createIssueCalls[0].input.repo).toBeUndefined();
  });

  it('applies priority/size labels after a successful TrackerClient.createIssue', async () => {
    const { tracker } = makeFakeTracker();
    const gh = makeFakeGh();

    const result = await fileIntakeIssue(
      { title: 'Has labels', body: 'body', size: 'M', priority: 'medium', interactive: false },
      { tracker, gh: gh.run, cwd: '.' },
    );

    expect(result.issueUrl).toBeDefined();
    expect(gh.appliedLabels).toEqual(expect.arrayContaining(['priority: medium', 'size: M']));
  });

  it('a TrackerClient.createIssue rejection propagates as a hard failure', async () => {
    const { tracker } = makeFakeTracker({ failIssueCreate: true });
    const gh = makeFakeGh();

    await expect(
      fileIntakeIssue(
        { title: 'Fails', body: 'body', size: 'S', priority: 'low', interactive: false },
        { tracker, gh: gh.run, cwd: '.' },
      ),
    ).rejects.toThrow(/simulated issue-create failure/);
  });
});

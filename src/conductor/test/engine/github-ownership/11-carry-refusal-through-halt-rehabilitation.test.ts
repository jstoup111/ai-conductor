// Covers: task:11

import { describe, expect, it, vi } from 'vitest';
import {
  bodyFloor,
  clearHaltStateForResume,
  ensureShipReady,
  rehabilitateHaltPr,
  retitleFloor,
} from '../../../src/engine/halt-pr-rehabilitation.js';
import {
  HALT_PR_BANNER_SENTINEL,
  NEEDS_REMEDIATION_BODY_MARKER,
} from '../../../src/engine/pr-labels.js';
import type {
  GithubOperationRequest,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
} from '../../../src/engine/github-operations.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';

const CWD = '/fake/worktree';
const PR_URL = 'https://github.com/acme/widgets/pull/47';

function fakePresentation(options: { refuse?: boolean } = {}): {
  readonly gh: GhRunner;
  readonly operations: GithubOperationRunner;
  readonly writes: GithubOperationRequest[];
  readonly state: { title: string; isDraft: boolean; labels: string[]; body: string };
} {
  const state = {
    title: 'needs-remediation: widget import',
    isDraft: true,
    labels: ['needs-remediation'],
    body: `${HALT_PR_BANNER_SENTINEL}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
  };
  const writes: GithubOperationRequest[] = [];
  const gh: GhRunner = async () => ({ stdout: JSON.stringify(state) });
  const operations: GithubOperationRunner = {
    run: vi.fn(async (request) => {
      writes.push(request);
      const result: GithubOperationRunnerResponse | GithubOperationRunnerRefusal = options.refuse
        ? { kind: 'refused', reason: 'other-owner' }
        : {};
      if (options.refuse) return result;
      if (request.operation === 'pull-request.label.remove') state.labels = [];
      if (request.operation === 'pull-request.ready') state.isDraft = false;
      if (request.operation === 'pull-request.edit' && request.payload) {
        if ('title' in request.payload && request.payload.title) state.title = request.payload.title;
        if ('body' in request.payload && request.payload.body) state.body = request.payload.body;
      }
      return result;
    }),
  };
  return { gh, operations, writes, state };
}

describe('halt rehabilitation ownership outcomes', () => {
  it('repairs an authorized halted PR while retaining the resume draft until finish makes it ready', async () => {
    const fixture = fakePresentation();

    await expect(clearHaltStateForResume(
      fixture.gh, CWD, PR_URL, undefined, async () => {}, fixture.operations,
    )).resolves.toBe('cleared');
    expect(fixture.state.isDraft).toBe(true);

    fixture.state.labels = ['needs-remediation'];
    fixture.state.body = `${HALT_PR_BANNER_SENTINEL}\n${NEEDS_REMEDIATION_BODY_MARKER}`;
    await expect(rehabilitateHaltPr({
      gh: fixture.gh,
      operations: fixture.operations,
      cwd: CWD,
      prUrl: PR_URL,
      sourceRef: '#12',
      preserveDraft: true,
    })).resolves.toBe('rehabilitated');
    await expect(retitleFloor(
      fixture.gh, CWD, PR_URL, { featureDesc: 'widget import', operations: fixture.operations },
    )).resolves.toMatchObject({ outcome: 'resolved' });
    await expect(bodyFloor(
      fixture.gh, CWD, PR_URL, { operations: fixture.operations }, undefined, async () => {},
    )).resolves.toBe('floored');
    expect(fixture.state.isDraft).toBe(true);

    await expect(ensureShipReady(
      fixture.gh, CWD, PR_URL, undefined, async () => {}, fixture.operations,
    )).resolves.toBe('flipped-ready');
    expect(fixture.state.isDraft).toBe(false);
  });

  it('keeps a foreign refusal through clear, repair, retry, and presentation paths without an escalation comment', async () => {
    const fixture = fakePresentation({ refuse: true });

    await expect(clearHaltStateForResume(
      fixture.gh, CWD, PR_URL, undefined, async () => {}, fixture.operations,
    )).resolves.toBe('refused');
    await expect(rehabilitateHaltPr({
      gh: fixture.gh, operations: fixture.operations, cwd: CWD, prUrl: PR_URL, sourceRef: '#12',
    })).resolves.toBe('refused');
    await expect(retitleFloor(
      fixture.gh, CWD, PR_URL, { featureDesc: 'widget import', operations: fixture.operations },
    )).resolves.toMatchObject({ outcome: 'refused' });
    await expect(bodyFloor(
      fixture.gh, CWD, PR_URL, { operations: fixture.operations }, undefined, async () => {},
    )).resolves.toBe('refused');
    await expect(ensureShipReady(
      fixture.gh, CWD, PR_URL, undefined, async () => {}, fixture.operations,
    )).resolves.toBe('refused');

    expect(fixture.writes.some((request) => request.operation === 'pull-request.comment.create')).toBe(false);
    expect(fixture.state).toEqual(expect.objectContaining({
      title: 'needs-remediation: widget import',
      isDraft: true,
      labels: ['needs-remediation'],
    }));
  });
});

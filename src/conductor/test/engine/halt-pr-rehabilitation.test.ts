/**
 * Tests for the prefix-gated retitle-floor primitive (Task 6,
 * adr-2026-07-03-halt-pr-rehabilitation-at-finish).
 *
 * All tests use FAKE gh readers and guarded operation boundaries; no real gh
 * binary is required. The floor is deterministic: it only ever touches a title that
 * literally starts with `needs-remediation:` — prose titles are left
 * untouched, and the body is never edited.
 */

import { describe, it, expect } from 'vitest';
import {
  retitleFloor,
  ensureShipReady,
  clearHaltStateForResume,
  rehabilitateHaltPr,
  bodyFloor,
  readStaleHaltBanner,
  readFlooredBody,
  postHaltHistoryComment,
  isEngineFlooredBody,
  PR_BODY_FLOOR_MARKER,
  HALT_HISTORY_COMMENT_MARKER,
} from '../../src/engine/halt-pr-rehabilitation.js';
import { shipDraftPrBody } from '../../src/engine/ship-draft-pr.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { HALT_PR_BANNER_SENTINEL, NEEDS_REMEDIATION_MARKER } from '../../src/engine/pr-labels.js';
import type {
  GithubOperationRequest,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
} from '../../src/engine/github-operations.js';

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

function fakeOperations(
  options: { mode?: 'execute' | 'refuse' | 'fail'; onOperation?: (request: GithubOperationRequest) => void } = {},
): { operations: GithubOperationRunner; writes: GithubOperationRequest[] } {
  const writes: GithubOperationRequest[] = [];
  const operations: GithubOperationRunner = {
    run: async (request): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal> => {
      writes.push(request);
      options.onOperation?.(request);
      if (options.mode === 'refuse') {
        return { kind: 'refused', reason: 'other-owner' } satisfies GithubOperationRunnerRefusal;
      }
      if (options.mode === 'fail') throw new Error('guarded transport failed');
      return {} satisfies GithubOperationRunnerResponse;
    },
  };
  return { operations, writes };
}

const PR_URL = 'https://github.com/acme/repo/pull/7';
const CWD = '/repo';

describe('retitleFloor (Task 6)', () => {
  it('retitles a needs-remediation title to feat: <featureDesc> when featureDesc is given', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
    ]);
    const { operations, writes } = fakeOperations();

    const result = await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow', operations });

    expect(writes).toEqual([expect.objectContaining({
      operation: 'pull-request.edit',
      payload: { title: 'feat: widget import flow' },
    })]);
    expect(result.title).toBe('feat: widget import flow');
    expect(result.title).not.toContain('needs-remediation:');
  });

  it('falls back to the branch name when no featureDesc is provided', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
    ]);
    const { operations, writes } = fakeOperations();

    const result = await retitleFloor(gh, CWD, PR_URL, { branch: 'feat/widget-import-flow', operations });

    expect(writes).toEqual([expect.objectContaining({
      operation: 'pull-request.edit',
      payload: expect.objectContaining({ title: expect.stringContaining('widget import flow') }),
    })]);
    expect(result.title).not.toContain('needs-remediation:');
  });

  it('issues zero edit calls for a clean prose title', async () => {
    const { gh } = fakeGh([{ stdout: JSON.stringify({ title: 'feat: already clean' }) }]);
    const { operations, writes } = fakeOperations();

    const result = await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow', operations });

    expect(writes).toHaveLength(0);
    expect(result.title).toBe('feat: already clean');
    expect(result.outcome).toBe('not-halt-pr');
  });

  it('refuses rather than falling back when no guarded operation boundary is available', async () => {
    const logs: string[] = [];
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
    ]);

    const result = await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow' }, (msg) =>
      logs.push(msg),
    );

    expect(result.outcome).toBe('refused');
    expect(logs.length).toBeGreaterThan(0);
  });

  it('never edits the PR body', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
    ]);
    const { operations, writes } = fakeOperations();

    await retitleFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow', operations });

    expect(writes).toEqual([expect.objectContaining({ payload: { title: 'feat: widget import flow' } })]);
  });

  it('never returns a result title containing needs-remediation:', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ title: 'needs-remediation: x' }) },
    ]);
    const { operations } = fakeOperations();

    const result = await retitleFloor(gh, CWD, PR_URL, { branch: 'feat/x', operations });

    expect(result.title).not.toContain('needs-remediation:');
  });
});

describe('ensureShipReady (Task 7)', () => {
  const noopSleep = async () => {};

  it('flips a clean-titled unlabeled draft PR to ready, verified by re-read', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // read before
      { stdout: JSON.stringify({ isDraft: false, labels: [], body: '' }) }, // verify re-read
    ]);
    const { operations, writes } = fakeOperations();

    const result = await ensureShipReady(gh, CWD, PR_URL, undefined, noopSleep, operations);

    expect(result).toBe('flipped-ready');
    expect(writes).toEqual([expect.objectContaining({ operation: 'pull-request.ready' })]);

    // No unlabel/retitle/body mutation attempted — distinct from rehabilitateHaltPr.
    expect(writes.some((write) => write.operation !== 'pull-request.ready')).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('is a no-op for an already-ready PR — zero gh pr ready calls', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ isDraft: false, labels: [], body: '' }) }, // read before
    ]);

    const result = await ensureShipReady(gh, CWD, PR_URL, undefined, noopSleep);

    expect(result).toBe('no-op');
    expect(calls.length).toBe(1);
  });

  it('returns a non-fatal partial outcome when still draft after bounded retries', async () => {
    const logs: string[] = [];
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // read before
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // attempt 1: still draft
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // attempt 2: still draft
      { stdout: JSON.stringify({ isDraft: true, labels: [], body: '' }) }, // attempt 3: still draft
    ]);
    const { operations, writes } = fakeOperations();

    const result = await ensureShipReady(gh, CWD, PR_URL, (msg) => logs.push(msg), noopSleep, operations);

    expect(result).toBe('partial');
    expect(writes.filter((write) => write.operation === 'pull-request.ready')).toHaveLength(3);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('returns partial and never throws when the initial read fails', async () => {
    const { gh } = fakeGh([new Error('gh: network error')]);

    const result = await ensureShipReady(gh, CWD, PR_URL, undefined, noopSleep);

    expect(result).toBe('partial');
  });
});

describe('clearHaltStateForResume (Tasks 1, 4)', () => {
  it('writes the authorized resolution note through the guarded operation boundary', async () => {
    const state = {
      labelPresent: true,
      bodyMarkerPresent: true,
    };
    const gh: GhRunner = async (args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            isDraft: true,
            labels: state.labelPresent ? [{ name: 'needs-remediation' }] : [],
            body: state.bodyMarkerPresent ? '<!-- conductor:needs-remediation -->' : '',
          }),
        };
      }
      return { stdout: '' };
    };
    const { operations, writes } = fakeOperations({
      onOperation: (request) => {
        if (request.operation === 'pull-request.label.remove') state.labelPresent = false;
        if (request.operation === 'pull-request.edit') state.bodyMarkerPresent = false;
      },
    });

    await expect(clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {}, operations)).resolves.toBe('cleared');

    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'pull-request.label.remove' }),
      expect.objectContaining({ operation: 'pull-request.edit', payload: { body: '' } }),
      expect.objectContaining({
        operation: 'pull-request.comment.create',
        payload: expect.objectContaining({ body: expect.stringContaining('Halt resolved') }),
      }),
    ]));
  });

  it('returns gh-unavailable without throwing when the initial read rejects', async () => {
    const { gh } = fakeGh([new Error('gh: network error')]);

    await expect(clearHaltStateForResume(gh, CWD, PR_URL)).resolves.toBe('gh-unavailable');
  });

  it('preserves a halted draft PR while clearing halt state', async () => {
    const halted = {
      title: 'feat: widget import flow',
      isDraft: true,
      labels: [{ name: 'needs-remediation' }],
      body: `## Summary\n\nWidget import flow.\n\n<!-- conductor:needs-remediation -->`,
    };
    const cleared = {
      ...halted,
      labels: [],
      body: '## Summary\n\nWidget import flow.',
    };
    const { gh } = fakeGh([
      { stdout: JSON.stringify(halted) }, // resume-clear state read
    ]);
    const { operations } = fakeOperations();

    await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {}, operations);

    expect({
      readyCalls: 0,
      finalIsDraft: cleared.isDraft,
    }).toEqual({ readyCalls: 0, finalIsDraft: true });
  });

  it('clears the remediation label and body marker from a halted PR', async () => {
    const halted = {
      title: 'feat: widget import flow',
      isDraft: true,
      labels: [{ name: 'needs-remediation' }],
      body: `## Summary\n\nWidget import flow.\n\n<!-- conductor:needs-remediation -->`,
    };
    const cleared = {
      ...halted,
      labels: [],
      body: '## Summary\n\nWidget import flow.',
    };
    const { gh } = fakeGh([
      { stdout: JSON.stringify(halted) }, // resume-clear state read
    ]);
    const { operations, writes } = fakeOperations();

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {}, operations);

    expect(outcome).toBe('cleared');
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'pull-request.label.remove', payload: { label: 'needs-remediation' } }),
      expect.objectContaining({ operation: 'pull-request.edit', payload: { body: cleared.body } }),
      expect.objectContaining({ operation: 'pull-request.comment.create' }),
    ]));
  });

  it('clears a remediation label even when the body has no marker', async () => {
    const labeledWithoutMarker = {
      title: 'feat: widget import flow',
      isDraft: true,
      labels: [{ name: 'needs-remediation' }],
      body: '## Summary\n\nWidget import flow.',
    };
    const { gh } = fakeGh([
      { stdout: JSON.stringify(labeledWithoutMarker) }, // resume-clear state read
    ]);
    const { operations, writes } = fakeOperations();

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {}, operations);

    expect(outcome).toBe('cleared');
    expect(writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'pull-request.label.remove', payload: { label: 'needs-remediation' } }),
      expect.objectContaining({ operation: 'pull-request.comment.create' }),
    ]));
    expect(writes.some((write) => write.operation === 'pull-request.edit')).toBe(false);
  });

  it('returns partial when the guarded label removal fails', async () => {
    const halted = {
      title: 'feat: widget import flow',
      isDraft: true,
      labels: [{ name: 'needs-remediation' }],
      body: `## Summary\n\nWidget import flow.\n\n<!-- conductor:needs-remediation -->`,
    };
    const { gh } = fakeGh([
      { stdout: JSON.stringify(halted) }, // resume-clear state read
    ]);
    const { operations, writes } = fakeOperations({ mode: 'fail' });

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {}, operations);

    expect(outcome).toBe('partial');
    expect(writes).toEqual([expect.objectContaining({ operation: 'pull-request.label.remove' })]);
  });

  it('returns partial when the final re-read retains the remediation body marker', async () => {
    const halted = {
      title: 'feat: widget import flow',
      isDraft: true,
      labels: [],
      body: `## Summary\n\nWidget import flow.\n\n<!-- conductor:needs-remediation -->`,
    };
    const { gh } = fakeGh([
      { stdout: JSON.stringify(halted) }, // resume-clear state read
    ]);
    const { operations } = fakeOperations({ mode: 'fail' });

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {}, operations);

    expect(outcome).toBe('partial');
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
    ]);
    const { operations } = fakeOperations();

    const result = await rehabilitateHaltPr({ gh, operations, cwd: CWD, prUrl: PR_URL, sourceRef: null });

    expect(result).toBe('rehabilitated');
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

describe('bodyFloor (Task 2)', () => {
  const BANNER_BODY = [
    'This PR was opened automatically after an irrecoverable daemon HALT.',
    '',
    'Manual remediation is required to unblock this feature.',
    'See the comment below for the failure reason.',
  ].join('\n');

  it('floors a banner-only body: adds Summary + feature desc + test evidence, removes sentinel', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) }, // initial read
      { stdout: JSON.stringify({ body: '## Summary\n\nwidget import flow\n\n## Test evidence\n\n- [x] 3/3 plan tasks completed with evidence-gated commits' }) }, // verify re-read
    ]);
    const { operations, writes } = fakeOperations();

    const result = await bodyFloor(gh, CWD, PR_URL, {
      featureDesc: 'widget import flow',
      testEvidenceLine: '3/3 plan tasks completed with evidence-gated commits',
      operations,
    });

    expect(result).toBe('floored');
    const write = writes.find((entry) => entry.operation === 'pull-request.edit');
    expect(write).toBeDefined();
    const newBody = (write!.payload as { body: string }).body;
    expect(newBody).toContain('## Summary');
    expect(newBody).toContain('widget import flow');
    expect(newBody).toContain('## Test evidence');
    expect(newBody).toContain('3/3 plan tasks completed with evidence-gated commits');
    expect(newBody).not.toContain('This PR was opened automatically after an irrecoverable daemon HALT.');
    // The floored body carries NO remediation narrative — that lives in a PR
    // comment. Only the invisible provenance marker distinguishes it.
    expect(newBody).not.toMatch(/Rehabilitated from a reused/i);
    expect(newBody).not.toMatch(/halt history/i);
    expect(newBody).toContain(PR_BODY_FLOOR_MARKER);
  });

  it('removes only banner lines from a residue body, preserving skill-authored Summary and Closes', async () => {
    const residueBody = [
      '## Summary',
      '',
      'Existing skill-authored summary text.',
      '',
      BANNER_BODY,
      '',
      'Closes #7',
    ].join('\n');
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: residueBody }) }, // initial read
      { stdout: JSON.stringify({ body: 'placeholder-without-sentinel' }) }, // verify re-read
    ]);
    const { operations, writes } = fakeOperations();

    const result = await bodyFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow', operations });

    expect(result).toBe('floored');
    const write = writes.find((entry) => entry.operation === 'pull-request.edit');
    const newBody = (write!.payload as { body: string }).body;
    expect(newBody).toContain('Existing skill-authored summary text.');
    expect(newBody).toContain('Closes #7');
    expect(newBody).not.toContain('This PR was opened automatically after an irrecoverable daemon HALT.');
    expect(newBody).not.toContain('Manual remediation is required to unblock this feature.');
    expect(newBody).not.toContain('See the comment below for the failure reason.');
    // Only one Summary heading — the pre-existing one, not a duplicate.
    const summaryOccurrences = (newBody.match(/## Summary/g) || []).length;
    expect(summaryOccurrences).toBe(1);
  });

  it('returns not-halt-body and issues zero pr edit calls for a fresh (non-halt) body', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ body: '## Summary\n\nClean implementation body.\n\nCloses #7' }) },
    ]);

    const result = await bodyFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow' });

    expect(result).toBe('not-halt-body');
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
    expect(calls.length).toBe(1);
  });

  it('returns partial when the guarded body edit fails, and never falls back to raw gh', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) }, // initial read
    ]);
    const { operations, writes } = fakeOperations({ mode: 'fail' });

    const result = await bodyFloor(
      gh,
      CWD,
      PR_URL,
      { featureDesc: 'widget import flow', operations },
      undefined,
      async () => {},
    );

    expect(result).toBe('partial');
    expect(writes).toEqual([expect.objectContaining({ operation: 'pull-request.edit' })]);
  });
});

describe('bodyFloor: honest test-evidence checkbox (false-completion regression)', () => {
  const BANNER_BODY = [
    'This PR was opened automatically after an irrecoverable daemon HALT.',
    '',
    'Manual remediation is required to unblock this feature.',
    'See the comment below for the failure reason.',
  ].join('\n');

  it('never emits a CHECKED box for a zero-completion evidence line (PRs #1067/#1056/#1031 shipped "- [x] 0/16")', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) },
      { stdout: JSON.stringify({ body: 'floored' }) },
    ]);
    const { operations, writes } = fakeOperations();

    await bodyFloor(gh, CWD, PR_URL, {
      featureDesc: 'widget import flow',
      testEvidenceLine: '0/16 plan tasks completed with evidence-gated commits',
      operations,
    });

    const write = writes.find((entry) => entry.operation === 'pull-request.edit')!;
    const newBody = (write.payload as { body: string }).body;
    expect(newBody).not.toContain('- [x] 0/16');
    expect(newBody).toContain('- [ ] 0/16 plan tasks completed with evidence-gated commits');
  });

  it('still checks the box for a genuine completion line', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) },
      { stdout: JSON.stringify({ body: 'floored' }) },
    ]);
    const { operations, writes } = fakeOperations();

    await bodyFloor(gh, CWD, PR_URL, {
      featureDesc: 'widget import flow',
      testEvidenceLine: '16/16 plan tasks completed with evidence-gated commits',
      operations,
    });

    const write = writes.find((entry) => entry.operation === 'pull-request.edit')!;
    const newBody = (write.payload as { body: string }).body;
    expect(newBody).toContain('- [x] 16/16 plan tasks completed with evidence-gated commits');
  });
});

/**
 * The floor marker is provenance, not a verdict. An authoring pass that
 * rewrote the body but left the invisible marker line behind used to keep the
 * body classified as an unauthored floor forever (#1703), so FINISH halted on
 * genuine prose. Classification is therefore content-derived: the marker is
 * necessary, never sufficient.
 */
const AUTHORED_BODY = [
  '## Why',
  '',
  'The FINISH publication coordinator classified an authored body as a placeholder because the',
  'invisible body-floor marker survived the authoring pass, so the non-advancing-transition guard',
  'halted the feature with all of its work green.',
  '',
  '## What Changed',
  '',
  'Floor classification now reads the body content instead of trusting marker presence alone, and',
  'both the publication observer and the presentation reader share one predicate so they can never',
  'disagree about whether a body was authored.',
  '',
  '## Testing',
  '',
  'Unit coverage for the predicate plus a coordinator-level regression that drives the authoring',
  'transition with a body whose marker survived the rewrite.',
].join('\n');

describe('isEngineFlooredBody', () => {
  it('classifies a body with no marker as authored', () => {
    expect(isEngineFlooredBody(AUTHORED_BODY)).toBe(false);
  });

  it('classifies the rehabilitation floor block as a floor', () => {
    const floor = [
      PR_BODY_FLOOR_MARKER,
      '',
      '## Summary',
      '',
      'widget import flow',
      '',
      '## Test evidence',
      '',
      '- [x] 16/16 plan tasks completed with evidence-gated commits',
    ].join('\n');
    expect(isEngineFlooredBody(floor)).toBe(true);
  });

  it('classifies the SHIP-entry draft body as a floor', () => {
    expect(isEngineFlooredBody(shipDraftPrBody('widget import flow'))).toBe(true);
  });

  it('classifies authored prose as authored even when the marker survived the rewrite', () => {
    expect(isEngineFlooredBody(`${PR_BODY_FLOOR_MARKER}\n\n${AUTHORED_BODY}`)).toBe(false);
  });

  // #1703 recurring one layer down. The floor TEXTS are provenance exactly
  // like the marker: an authoring pass writes real prose around the
  // SHIP-entry draft note and leaves the note in place. Returning true on
  // their mere presence classified 5,720 characters of authored prose on
  // PR #1845 as a placeholder, and FINISH halted on finished work with
  // "The author_pr_prose transition left pr.prose unchanged at placeholder."
  it('classifies authored prose as authored even when the SHIP-entry draft note survived', () => {
    const body = `${shipDraftPrBody('widget import flow')}\n\n${AUTHORED_BODY}`;
    expect(body).toMatch(/draft opened automatically/i);
    expect(isEngineFlooredBody(body)).toBe(false);
  });

  it('classifies authored prose as authored even when a "not yet authored" section survived', () => {
    const body = [
      PR_BODY_FLOOR_MARKER,
      '',
      '## Test evidence',
      '',
      'Not yet authored.',
      '',
      AUTHORED_BODY,
    ].join('\n');
    expect(isEngineFlooredBody(body)).toBe(false);
  });

  it('keeps a floor a floor under every structured block the engine appends to it', () => {
    const floor = [
      PR_BODY_FLOOR_MARKER,
      '',
      '## Summary',
      '',
      'widget import flow',
      '',
      'Closes acme/repo#7',
      '',
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: A reader-facing summary of the delivered change, restored from the pre-finish snapshot.',
      '',
      '<!-- build-review-accepted-risk:start -->',
      '## Accepted build-review risk',
      '',
      'Accepted findings: 2',
      '',
      '- Finding: `scope:v1:out-of-plan-change:src/a.ts` — rubric: scope',
      '- Finding: `scope:v1:out-of-plan-change:src/b.ts` — rubric: scope',
      '',
      "Details are retained in the feature's local build-review disposition store.",
      '<!-- build-review-accepted-risk:end -->',
    ].join('\n');
    expect(isEngineFlooredBody(floor)).toBe(true);
  });
});

describe('readFlooredBody', () => {
  it('returns the floor marker for an engine-generated placeholder body', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: `${PR_BODY_FLOOR_MARKER}\n\n## Summary\n\nslug` }) },
    ]);
    expect(await readFlooredBody(gh, CWD, PR_URL)).toBe(PR_BODY_FLOOR_MARKER);
  });

  it('returns null for a /pr-authored body', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: '## Why\n\nreal prose\n\n## What Changed\n\n## Testing' }) },
    ]);
    expect(await readFlooredBody(gh, CWD, PR_URL)).toBeNull();
  });

  it('returns null (fail-open) when gh errors', async () => {
    const { gh } = fakeGh([new Error('gh: network error')]);
    expect(await readFlooredBody(gh, CWD, PR_URL)).toBeNull();
  });

  it('returns null for authored prose whose floor marker survived the authoring pass', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: `${PR_BODY_FLOOR_MARKER}\n\n${AUTHORED_BODY}` }) },
    ]);
    expect(await readFlooredBody(gh, CWD, PR_URL)).toBeNull();
  });
});

describe('postHaltHistoryComment: halt narrative lands in a COMMENT, never the body', () => {
  it('posts a halt-history comment carrying the halt title, banner and halt reason — and issues zero body edits', async () => {
    const { gh } = fakeGh([
      {
        stdout: JSON.stringify({
          title: 'needs-remediation: widget import flow',
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${HALT_PR_BANNER_SENTINEL}\n\nManual remediation is required to unblock this feature.`,
          comments: [],
        }),
      },
    ]);
    const { operations, writes } = fakeOperations();

    const outcome = await postHaltHistoryComment({
      gh,
      cwd: CWD,
      prUrl: PR_URL,
      haltReason: 'build stalled: no task progress for 3 rounds',
      operations,
    });

    expect(outcome).toBe('posted');
    const write = writes.find((entry) => entry.operation === 'pull-request.comment.create')!;
    expect(write).toBeDefined();
    const commentBody = (write.payload as { body: string }).body;
    expect(commentBody).toContain(HALT_HISTORY_COMMENT_MARKER);
    expect(commentBody).toContain('Halt history');
    expect(commentBody).toContain('needs-remediation: widget import flow');
    expect(commentBody).toContain(HALT_PR_BANNER_SENTINEL);
    expect(commentBody).toContain('build stalled: no task progress for 3 rounds');
    // Narrative goes ONLY to the comment.
    expect(writes.some((entry) => entry.operation === 'pull-request.edit')).toBe(false);
  });

  it('is idempotent — a PR that already carries the marker gets no second comment', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          title: 'needs-remediation: widget import flow',
          isDraft: false,
          labels: [],
          body: HALT_PR_BANNER_SENTINEL,
          comments: [{ body: `${HALT_HISTORY_COMMENT_MARKER}\n## Halt history` }],
        }),
      },
    ]);

    expect(await postHaltHistoryComment({ gh, cwd: CWD, prUrl: PR_URL })).toBe('already-posted');
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'comment')).toBe(false);
  });

  it('no-ops on a clean (non-halt) PR', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          title: 'feat: widget import flow',
          isDraft: false,
          labels: [],
          body: '## Why\n\nreal prose',
          comments: [],
        }),
      },
    ]);

    expect(await postHaltHistoryComment({ gh, cwd: CWD, prUrl: PR_URL })).toBe('not-halt-pr');
    expect(calls).toHaveLength(1);
  });

  it('returns gh-unavailable and never throws when the read fails', async () => {
    const { gh } = fakeGh([new Error('gh: network error')]);
    expect(await postHaltHistoryComment({ gh, cwd: CWD, prUrl: PR_URL })).toBe('gh-unavailable');
  });
});

describe('readStaleHaltBanner (Task 2)', () => {
  it('returns the sentinel when the body contains the halt banner', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: 'This PR was opened automatically after an irrecoverable daemon HALT.\n\nMore text.' }) },
    ]);

    const result = await readStaleHaltBanner(gh, CWD, PR_URL);

    expect(result).toBe(HALT_PR_BANNER_SENTINEL);
  });

  it('returns null for a clean body', async () => {
    const { gh } = fakeGh([
      { stdout: JSON.stringify({ body: '## Summary\n\nClean body.' }) },
    ]);

    const result = await readStaleHaltBanner(gh, CWD, PR_URL);

    expect(result).toBeNull();
  });

  it('returns null (fail-open) when gh errors', async () => {
    const { gh } = fakeGh([new Error('gh: network error')]);

    const result = await readStaleHaltBanner(gh, CWD, PR_URL);

    expect(result).toBeNull();
  });
});

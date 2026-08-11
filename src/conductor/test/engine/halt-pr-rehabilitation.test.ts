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
import {
  retitleFloor,
  ensureShipReady,
  clearHaltStateForResume,
  rehabilitateHaltPr,
  bodyFloor,
  readStaleHaltBanner,
  readFlooredBody,
  postHaltHistoryComment,
  PR_BODY_FLOOR_MARKER,
  HALT_HISTORY_COMMENT_MARKER,
} from '../../src/engine/halt-pr-rehabilitation.js';
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

describe('clearHaltStateForResume (Tasks 1, 4)', () => {
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
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify(halted) }, // resume-clear state read
      { stdout: JSON.stringify(halted) }, // cleanupHaltPresentation state read
      { stdout: '' }, // REST label removal
      { stdout: JSON.stringify({ ...halted, labels: [] }) }, // label verification
      { stdout: '' }, // marker-removing body edit
      { stdout: JSON.stringify(cleared) }, // final verification
    ]);

    await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {});

    expect({
      readyCalls: calls.filter((call) => call[0] === 'pr' && call[1] === 'ready').length,
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
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify(halted) }, // resume-clear state read
      { stdout: JSON.stringify(halted) }, // cleanupHaltPresentation state read
      { stdout: '' }, // REST label removal
      { stdout: JSON.stringify({ ...halted, labels: [] }) }, // label verification
      { stdout: '' }, // marker-removing body edit
      { stdout: JSON.stringify(cleared) }, // final verification
    ]);

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {});
    const labelRemoval = calls.find((call) => call[0] === 'api' && call.includes('DELETE'));
    const bodyEdit = calls.find((call) => call[0] === 'pr' && call[1] === 'edit');

    expect({ outcome, labelRemoval, bodyEdit }).toEqual({
      outcome: 'cleared',
      labelRemoval: [
        'api',
        '--method',
        'DELETE',
        'repos/acme/repo/issues/7/labels/needs-remediation',
      ],
      bodyEdit: ['pr', 'edit', PR_URL, '--body', cleared.body],
    });
  });

  it('clears a remediation label even when the body has no marker', async () => {
    const labeledWithoutMarker = {
      title: 'feat: widget import flow',
      isDraft: true,
      labels: [{ name: 'needs-remediation' }],
      body: '## Summary\n\nWidget import flow.',
    };
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify(labeledWithoutMarker) }, // resume-clear state read
      { stdout: JSON.stringify(labeledWithoutMarker) }, // cleanup state read
      { stdout: '' }, // REST label removal
      { stdout: JSON.stringify({ ...labeledWithoutMarker, labels: [] }) }, // label verification
      { stdout: JSON.stringify({ ...labeledWithoutMarker, labels: [] }) }, // final verification
    ]);

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {});

    expect({
      outcome,
      labelRemoval: calls.find((call) => call[0] === 'api' && call.includes('DELETE')),
      bodyEdit: calls.find((call) => call[0] === 'pr' && call[1] === 'edit'),
    }).toEqual({
      outcome: 'cleared',
      labelRemoval: [
        'api',
        '--method',
        'DELETE',
        'repos/acme/repo/issues/7/labels/needs-remediation',
      ],
      bodyEdit: undefined,
    });
  });

  it('returns partial after bounded retries when the remediation label remains', async () => {
    const halted = {
      title: 'feat: widget import flow',
      isDraft: true,
      labels: [{ name: 'needs-remediation' }],
      body: `## Summary\n\nWidget import flow.\n\n<!-- conductor:needs-remediation -->`,
    };
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify(halted) }, // resume-clear state read
      { stdout: JSON.stringify(halted) }, // cleanup state read
      { stdout: '' }, // label removal attempt 1
      { stdout: JSON.stringify(halted) }, // label remains
      { stdout: '' }, // label removal attempt 2
      { stdout: JSON.stringify(halted) }, // label remains
      { stdout: '' }, // label removal attempt 3
      { stdout: JSON.stringify(halted) }, // label remains
      { stdout: '' }, // marker-removing body edit
      { stdout: JSON.stringify({ ...halted, body: '## Summary\n\nWidget import flow.' }) }, // final re-read
    ]);

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {});

    expect({
      outcome,
      labelRemovals: calls.filter((call) => call[0] === 'api' && call.includes('DELETE')).length,
    }).toEqual({ outcome: 'partial', labelRemovals: 3 });
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
      { stdout: JSON.stringify(halted) }, // cleanup state read
      { stdout: '' }, // marker-removing body edit
      { stdout: JSON.stringify(halted) }, // marker remains on final re-read
    ]);

    const outcome = await clearHaltStateForResume(gh, CWD, PR_URL, undefined, async () => {});

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

describe('bodyFloor (Task 2)', () => {
  const BANNER_BODY = [
    'This PR was opened automatically after an irrecoverable daemon HALT.',
    '',
    'Manual remediation is required to unblock this feature.',
    'See the comment below for the failure reason.',
  ].join('\n');

  it('floors a banner-only body: adds Summary + feature desc + test evidence, removes sentinel', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) }, // initial read
      { stdout: '' }, // pr edit
      { stdout: JSON.stringify({ body: '## Summary\n\nwidget import flow\n\n## Test evidence\n\n- [x] 3/3 plan tasks completed with evidence-gated commits' }) }, // verify re-read
    ]);

    const result = await bodyFloor(gh, CWD, PR_URL, {
      featureDesc: 'widget import flow',
      testEvidenceLine: '3/3 plan tasks completed with evidence-gated commits',
    });

    expect(result).toBe('floored');
    const editCall = calls.find((c) => c[0] === 'pr' && c[1] === 'edit');
    expect(editCall).toBeDefined();
    const bodyArgIdx = editCall!.indexOf('--body');
    expect(bodyArgIdx).toBeGreaterThanOrEqual(0);
    const newBody = editCall![bodyArgIdx + 1];
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
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ body: residueBody }) }, // initial read
      { stdout: '' }, // pr edit
      { stdout: JSON.stringify({ body: 'placeholder-without-sentinel' }) }, // verify re-read
    ]);

    const result = await bodyFloor(gh, CWD, PR_URL, { featureDesc: 'widget import flow' });

    expect(result).toBe('floored');
    const editCall = calls.find((c) => c[0] === 'pr' && c[1] === 'edit');
    const bodyArgIdx = editCall!.indexOf('--body');
    const newBody = editCall![bodyArgIdx + 1];
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

  it('returns partial after bounded retries when gh pr edit always fails, and never throws', async () => {
    const logs: string[] = [];
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) }, // initial read
      { stdout: '' }, // attempt 1: edit
      { stdout: JSON.stringify({ body: BANNER_BODY }) }, // attempt 1: verify (still has sentinel)
      { stdout: '' }, // attempt 2: edit
      { stdout: JSON.stringify({ body: BANNER_BODY }) }, // attempt 2: verify (still has sentinel)
      { stdout: '' }, // attempt 3: edit
      { stdout: JSON.stringify({ body: BANNER_BODY }) }, // attempt 3: verify (still has sentinel)
    ]);

    const result = await bodyFloor(
      gh,
      CWD,
      PR_URL,
      { featureDesc: 'widget import flow' },
      (msg) => logs.push(msg),
      async () => {},
    );

    expect(result).toBe('partial');
    const editCalls = calls.filter((c) => c[0] === 'pr' && c[1] === 'edit');
    expect(editCalls.length).toBe(3);
    expect(logs.length).toBeGreaterThan(0);
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
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) },
      { stdout: '' },
      { stdout: JSON.stringify({ body: 'floored' }) },
    ]);

    await bodyFloor(gh, CWD, PR_URL, {
      featureDesc: 'widget import flow',
      testEvidenceLine: '0/16 plan tasks completed with evidence-gated commits',
    });

    const editCall = calls.find((c) => c[0] === 'pr' && c[1] === 'edit')!;
    const newBody = editCall[editCall.indexOf('--body') + 1];
    expect(newBody).not.toContain('- [x] 0/16');
    expect(newBody).toContain('- [ ] 0/16 plan tasks completed with evidence-gated commits');
  });

  it('still checks the box for a genuine completion line', async () => {
    const { gh, calls } = fakeGh([
      { stdout: JSON.stringify({ body: BANNER_BODY }) },
      { stdout: '' },
      { stdout: JSON.stringify({ body: 'floored' }) },
    ]);

    await bodyFloor(gh, CWD, PR_URL, {
      featureDesc: 'widget import flow',
      testEvidenceLine: '16/16 plan tasks completed with evidence-gated commits',
    });

    const editCall = calls.find((c) => c[0] === 'pr' && c[1] === 'edit')!;
    const newBody = editCall[editCall.indexOf('--body') + 1];
    expect(newBody).toContain('- [x] 16/16 plan tasks completed with evidence-gated commits');
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
});

describe('postHaltHistoryComment: halt narrative lands in a COMMENT, never the body', () => {
  it('posts a halt-history comment carrying the halt title, banner and halt reason — and issues zero body edits', async () => {
    const { gh, calls } = fakeGh([
      {
        stdout: JSON.stringify({
          title: 'needs-remediation: widget import flow',
          isDraft: true,
          labels: [{ name: 'needs-remediation' }],
          body: `${HALT_PR_BANNER_SENTINEL}\n\nManual remediation is required to unblock this feature.`,
          comments: [],
        }),
      },
      { stdout: '' }, // pr comment
    ]);

    const outcome = await postHaltHistoryComment({
      gh,
      cwd: CWD,
      prUrl: PR_URL,
      haltReason: 'build stalled: no task progress for 3 rounds',
    });

    expect(outcome).toBe('posted');
    const commentCall = calls.find((c) => c[0] === 'pr' && c[1] === 'comment')!;
    expect(commentCall).toBeDefined();
    const commentBody = commentCall[commentCall.indexOf('--body') + 1];
    expect(commentBody).toContain(HALT_HISTORY_COMMENT_MARKER);
    expect(commentBody).toContain('Halt history');
    expect(commentBody).toContain('needs-remediation: widget import flow');
    expect(commentBody).toContain(HALT_PR_BANNER_SENTINEL);
    expect(commentBody).toContain('build stalled: no task progress for 3 rounds');
    // Narrative goes ONLY to the comment.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'edit')).toBe(false);
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

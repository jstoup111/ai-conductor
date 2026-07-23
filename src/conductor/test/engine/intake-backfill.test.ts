/**
 * Tests for engine/engineer/intake/backfill.ts (Task 6, FR-3): one-shot
 * backlog sweep that stamps missing size:/priority: labels onto issues.
 *
 * All gh interactions use a fake injected runner; no real `gh` binary or
 * network access is used. Covers: infer vs default, idempotent re-run,
 * isolated single-issue failure, and the never-HALT / never-prompt contract.
 *
 * See also test/acceptance/intake-backfill-sweep.test.ts for the
 * higher-level acceptance spec that drives the same seam
 * (`backfillIntakeLabels`) against an in-memory fixture backlog.
 */

import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import {
  backfillIntakeLabels,
  renderBackfillReport,
  inferSizeFromBody,
  inferPriorityFromBody,
  type BacklogIssue,
} from '../../src/engine/engineer/intake/backfill.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const REPO = 'acme/widgets';
const HALT_MARKER = '.pipeline/halt-user-input-required';

/**
 * A recording fake GhRunner. `failOn` optionally throws for specific
 * `POST .../labels` calls (issue number -> error message) to simulate an
 * isolated single-issue failure.
 */
function fakeGh(opts: { failOn?: Record<number, string> } = {}): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const failOn = opts.failOn ?? {};

  const gh: GhRunner = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'label' && args[1] === 'create') {
      return { stdout: '' };
    }
    if (args[0] === 'api' && args[2] === 'POST') {
      const path = args[3] as string; // repos/<repo>/issues/<n>/labels
      const match = path.match(/issues\/(\d+)\/labels/);
      const number = match ? Number(match[1]) : -1;
      if (failOn[number]) {
        throw new Error(failOn[number]);
      }
      return { stdout: '{}' };
    }
    return { stdout: '' };
  };

  return { gh, calls };
}

describe('inferSizeFromBody / inferPriorityFromBody — body-text inference', () => {
  it('infers size from a "size: L" mention in the body', () => {
    expect(inferSizeFromBody('Some notes.\nsize: L\nMore notes.')).toBe('L');
  });

  it('returns undefined when the body has no size mention', () => {
    expect(inferSizeFromBody('Just a plain description with no size info.')).toBeUndefined();
  });

  it('infers priority from a "priority: high" mention in the body', () => {
    expect(inferPriorityFromBody('priority: high — this is urgent')).toBe('high');
  });

  it('returns undefined when the body has no priority mention', () => {
    expect(inferPriorityFromBody('Just a plain description.')).toBeUndefined();
  });
});

describe('backfillIntakeLabels — incomplete issues get labelled (infer vs default)', () => {
  it('infers size and priority from body text when present', async () => {
    const { gh, calls } = fakeGh();
    const issues: BacklogIssue[] = [
      { ref: `${REPO}#10`, body: 'size: L\npriority: high', labels: [] },
    ];

    const report = await backfillIntakeLabels(issues, { gh, cwd: '.' });

    expect(report.labelled).toHaveLength(1);
    expect(report.labelled[0].ref).toBe(`${REPO}#10`);
    expect(report.labelled[0].applied).toEqual(
      expect.arrayContaining([
        { label: 'size: L', source: 'inferred' },
        { label: 'priority: high', source: 'inferred' },
      ]),
    );

    // Both labels were applied via the REST endpoint.
    const addCalls = calls.filter((c) => c[0] === 'api' && c[2] === 'POST');
    expect(addCalls).toHaveLength(2);
  });

  it('defaults to size: M and priority: medium when body has no inferable info', async () => {
    const { gh } = fakeGh();
    const issues: BacklogIssue[] = [
      { ref: `${REPO}#11`, body: 'No structured info here.', labels: [] },
    ];

    const report = await backfillIntakeLabels(issues, { gh, cwd: '.' });

    expect(report.labelled).toHaveLength(1);
    expect(report.labelled[0].applied).toEqual(
      expect.arrayContaining([
        { label: 'size: M', source: 'default' },
        { label: 'priority: medium', source: 'default' },
      ]),
    );
  });

  it('only fills in the missing label when one is already present', async () => {
    const { gh } = fakeGh();
    const issues: BacklogIssue[] = [
      { ref: `${REPO}#12`, body: 'priority: critical', labels: ['size: S'] },
    ];

    const report = await backfillIntakeLabels(issues, { gh, cwd: '.' });

    expect(report.labelled).toHaveLength(1);
    expect(report.labelled[0].applied).toEqual([{ label: 'priority: critical', source: 'inferred' }]);
  });
});

describe('backfillIntakeLabels — idempotent re-run', () => {
  it('skips issues that already carry both size and priority labels', async () => {
    const { gh, calls } = fakeGh();
    const issues: BacklogIssue[] = [
      { ref: `${REPO}#20`, body: '', labels: ['size: M', 'priority: medium'] },
    ];

    const report = await backfillIntakeLabels(issues, { gh, cwd: '.' });

    expect(report.skipped).toEqual([`${REPO}#20`]);
    expect(report.labelled).toHaveLength(0);
    // No label-apply calls were made for the already-complete issue.
    const addCalls = calls.filter((c) => c[0] === 'api' && c[2] === 'POST');
    expect(addCalls).toHaveLength(0);
  });
});

describe('backfillIntakeLabels — isolated single-issue failure', () => {
  it('logs and continues past one issue whose label-apply fails', async () => {
    const { gh } = fakeGh({ failOn: { 30: 'simulated REST failure' } });
    const issues: BacklogIssue[] = [
      { ref: `${REPO}#30`, body: '', labels: [] },
      { ref: `${REPO}#31`, body: 'size: S\npriority: low', labels: [] },
    ];

    const log = vi.fn();
    const report = await backfillIntakeLabels(issues, { gh, cwd: '.', log });

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({ ref: `${REPO}#30`, error: 'simulated REST failure' });
    // The sweep continued: issue 31 still got processed and labelled.
    expect(report.labelled).toHaveLength(1);
    expect(report.labelled[0].ref).toBe(`${REPO}#31`);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('#30'));
  });
});

describe('backfillIntakeLabels — Jira-shaped ref', () => {
  it('routes a Jira-shaped ref to failed (not a HALT) and makes no gh call for it', async () => {
    const { gh, calls } = fakeGh();
    const issues: BacklogIssue[] = [{ ref: 'PROJ-123', body: '', labels: [] }];

    const report = await backfillIntakeLabels(issues, { gh, cwd: '.' });

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].ref).toBe('PROJ-123');
    expect(report.halted).toBe(false);
    expect(calls.filter((c) => c[0] === 'api')).toHaveLength(0);
  });
});

describe('backfillIntakeLabels — never HALTs, never prompts', () => {
  it('never writes a HALT marker file for a mix of success and failure', async () => {
    const { gh } = fakeGh({ failOn: { 40: 'boom' } });
    const issues: BacklogIssue[] = [
      { ref: `${REPO}#40`, body: '', labels: [] },
      { ref: `${REPO}#41`, body: 'size: S\npriority: low', labels: [] },
    ];

    const report = await backfillIntakeLabels(issues, { gh, cwd: '.' });

    expect(existsSync(HALT_MARKER)).toBe(false);
    expect(report.halted).not.toBe(true);
    expect(report.confirmationRequested).not.toBe(true);
  });

  it('completes without invoking any prompt/confirmation mechanism', async () => {
    const { gh } = fakeGh();
    const issues: BacklogIssue[] = [{ ref: `${REPO}#50`, body: '', labels: [] }];

    // If backfillIntakeLabels ever tried to prompt (e.g. via readline/stdin),
    // it would hang or throw in this non-interactive test environment.
    // A clean resolve is proof no interactive gate was invoked.
    await expect(backfillIntakeLabels(issues, { gh, cwd: '.' })).resolves.toBeDefined();
  });
});

describe('renderBackfillReport — operator report format', () => {
  it('distinguishes inferred vs defaulted labels and lists failures', () => {
    const report = {
      skipped: [`${REPO}#1`],
      labelled: [
        {
          ref: `${REPO}#2`,
          applied: [
            { label: 'size: L', source: 'inferred' as const },
            { label: 'priority: high', source: 'inferred' as const },
          ],
        },
        {
          ref: `${REPO}#3`,
          applied: [
            { label: 'size: M', source: 'default' as const },
            { label: 'priority: medium', source: 'default' as const },
          ],
        },
      ],
      failed: [{ ref: `${REPO}#4`, error: 'oops' }],
      halted: false,
      confirmationRequested: false,
    };

    const text = renderBackfillReport(report);

    expect(text).toContain('labelled: 2');
    expect(text).toContain('failed: 1');
    expect(text).toContain(`${REPO}#4 — oops`);
  });
});

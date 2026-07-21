/**
 * Tests for intake-backfill.ts (Task 6, FR-3): one-shot backlog sweep that
 * stamps missing size:/priority: labels onto open, assigned issues.
 *
 * All gh interactions use a fake injected runner; no real `gh` binary or
 * network access is used. Covers: infer vs default, idempotent re-run,
 * isolated single-issue failure, and the never-HALT / never-prompt contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import {
  runIntakeBackfill,
  renderBackfillReport,
  inferSizeFromBody,
  inferPriorityFromBody,
  type IntakeBackfillDeps,
} from '../../src/engine/intake-backfill.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const REPO = 'acme/widgets';
const HALT_MARKER = '.pipeline/halt-user-input-required';

function issueListResponse(issues: unknown[]): { stdout: string } {
  return { stdout: JSON.stringify(issues) };
}

/**
 * A recording fake GhRunner. `onIssueList` supplies the payload for the
 * initial `gh issue list` call; `failOn` optionally throws for specific
 * `POST .../labels` calls (issue number -> error message) to simulate an
 * isolated single-issue failure.
 */
function fakeGh(opts: {
  issues: unknown[];
  failOn?: Record<number, string>;
}): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const failOn = opts.failOn ?? {};

  const gh: GhRunner = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return issueListResponse(opts.issues);
    }
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

describe('runIntakeBackfill — incomplete issues get labelled (infer vs default)', () => {
  it('infers size and priority from body text when present', async () => {
    const { gh, calls } = fakeGh({
      issues: [
        { number: 10, title: 'Fix thing', body: 'size: L\npriority: high', labels: [] },
      ],
    });

    const report = await runIntakeBackfill({ gh, repo: REPO });

    expect(report.inferred).toHaveLength(1);
    expect(report.inferred[0]).toMatchObject({
      number: 10,
      size: 'L',
      priority: 'high',
      sizeSource: 'inferred',
      prioritySource: 'inferred',
    });
    expect(report.defaulted).toHaveLength(0);

    // Both labels were applied via the REST endpoint.
    const addCalls = calls.filter((c) => c[0] === 'api' && c[2] === 'POST');
    expect(addCalls).toHaveLength(2);
  });

  it('defaults to size: M and priority: medium when body has no inferable info', async () => {
    const { gh } = fakeGh({
      issues: [
        { number: 11, title: 'Vague issue', body: 'No structured info here.', labels: [] },
      ],
    });

    const report = await runIntakeBackfill({ gh, repo: REPO });

    expect(report.defaulted).toHaveLength(1);
    expect(report.defaulted[0]).toMatchObject({
      number: 11,
      size: 'M',
      priority: 'medium',
      sizeSource: 'defaulted',
      prioritySource: 'defaulted',
    });
    expect(report.inferred).toHaveLength(0);
  });

  it('only fills in the missing label when one is already present', async () => {
    const { gh } = fakeGh({
      issues: [
        { number: 12, title: 'Partial', body: 'priority: critical', labels: ['size: S'] },
      ],
    });

    const report = await runIntakeBackfill({ gh, repo: REPO });

    expect(report.inferred).toHaveLength(1);
    expect(report.inferred[0].applied).toEqual(['priority']);
    expect(report.inferred[0].size).toBeUndefined();
    expect(report.inferred[0].priority).toBe('critical');
  });
});

describe('runIntakeBackfill — idempotent re-run', () => {
  it('skips issues that already carry both size and priority labels', async () => {
    const { gh, calls } = fakeGh({
      issues: [
        {
          number: 20,
          title: 'Already complete',
          body: '',
          labels: ['size: M', 'priority: medium'],
        },
      ],
    });

    const report = await runIntakeBackfill({ gh, repo: REPO });

    expect(report.skipped).toEqual([20]);
    expect(report.inferred).toHaveLength(0);
    expect(report.defaulted).toHaveLength(0);
    // No label-apply calls were made for the already-complete issue.
    const addCalls = calls.filter((c) => c[0] === 'api' && c[2] === 'POST');
    expect(addCalls).toHaveLength(0);
  });
});

describe('runIntakeBackfill — isolated single-issue failure', () => {
  it('logs and continues past one issue whose label-apply fails', async () => {
    const { gh } = fakeGh({
      issues: [
        { number: 30, title: 'Will fail', body: '', labels: [] },
        { number: 31, title: 'Will succeed', body: 'size: S\npriority: low', labels: [] },
      ],
      failOn: { 30: 'simulated REST failure' },
    });

    const log = vi.fn();
    const report = await runIntakeBackfill({ gh, repo: REPO, log });

    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({ number: 30, error: 'simulated REST failure' });
    // The sweep continued: issue 31 still got processed and labelled.
    expect(report.inferred).toHaveLength(1);
    expect(report.inferred[0].number).toBe(31);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('#30'));
  });
});

describe('runIntakeBackfill — never HALTs, never prompts', () => {
  it('never writes a HALT marker file for a mix of success and failure', async () => {
    const { gh } = fakeGh({
      issues: [
        { number: 40, title: 'Will fail', body: '', labels: [] },
        { number: 41, title: 'Fine', body: 'size: S\npriority: low', labels: [] },
      ],
      failOn: { 40: 'boom' },
    });

    await runIntakeBackfill({ gh, repo: REPO });

    expect(existsSync(HALT_MARKER)).toBe(false);
  });

  it('completes without invoking any prompt/confirmation mechanism', async () => {
    const { gh } = fakeGh({
      issues: [{ number: 50, title: 'x', body: '', labels: [] }],
    });

    // If runIntakeBackfill ever tried to prompt (e.g. via readline/stdin),
    // it would hang or throw in this non-interactive test environment.
    // A clean resolve is proof no interactive gate was invoked.
    await expect(runIntakeBackfill({ gh, repo: REPO })).resolves.toBeDefined();
  });
});

describe('renderBackfillReport — operator report format', () => {
  it('distinguishes inferred vs defaulted counts and lists failures', () => {
    const report = {
      skipped: [1],
      inferred: [
        {
          number: 2,
          applied: ['size', 'priority'] as Array<'size' | 'priority'>,
          size: 'L' as const,
          priority: 'high' as const,
          sizeSource: 'inferred' as const,
          prioritySource: 'inferred' as const,
        },
      ],
      defaulted: [
        {
          number: 3,
          applied: ['size', 'priority'] as Array<'size' | 'priority'>,
          size: 'M' as const,
          priority: 'medium' as const,
          sizeSource: 'defaulted' as const,
          prioritySource: 'defaulted' as const,
        },
      ],
      failed: [{ number: 4, error: 'oops' }],
    };

    const text = renderBackfillReport(report);

    expect(text).toContain('inferred: 1');
    expect(text).toContain('defaulted: 1');
    expect(text).toContain('failed: 1');
    expect(text).toContain('#4 — oops');
  });
});

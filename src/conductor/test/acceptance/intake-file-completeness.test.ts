// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Agent/operator gh issue create files are born
// complete" (Story 2, FR-2; #695 intake-only-enforcement).
//
// Stories: .docs/stories/intake-only-enforcement.md (Story 2, plus Story 4's
//          negative-path criteria — explicit "no dependencies" acknowledgement
//          and bad-ref capture — folded in here per the writing-system-tests
//          plan, since Story 4 overlaps Story 2's filing flow and a separate
//          file would duplicate coverage).
// Plan:    .docs/plans/intake-only-enforcement.md (Task 4 — `bin/intake-file`).
//
// NONE of this feature's production code exists yet: `bin/intake-file` does
// not exist, nor does the shared label-sync seam it is expected to call.
//
// ASSUMED SEAM (not settled fact — the implementation task must fill this in):
// per the plan, `bin/intake-file` is expected to compose:
//   1. `gh issue create` (via an injected GhRunner) to create the issue,
//   2. the SAME `src/engine/engineer/intake/label-sync.ts#syncIssueLabels`
//      seam assumed in intake-form-label-sync.test.ts, reused rather than
//      reinvented, to apply priority:/size: labels + record blocked_by,
//   3. prompt/infer/default logic for missing size/priority when invoked
//      interactively vs non-interactively.
//
// This spec does NOT invent bin/intake-file's CLI contract beyond what the
// stories/plan already fix: `--depends-on`, prompt vs infer vs default, and
// "exit success even on partial (label) failure". It drives the assumed
// underlying function this binary should delegate to — call it
// `fileIntakeIssue(opts, deps)` — rather than shelling out to a not-yet-built
// binary, exactly as `dependency-ordered-intake-and-dispatch.test.ts`'s Flow D
// drives `runMigration` directly rather than a CLI wrapper. A later pass can
// add a thin process-spawn smoke test once `bin/intake-file` itself exists.
//
// Seams faked vs real:
//   - FAKED: the `gh` CLI runner (GhRunner-shaped fake) — the system boundary
//     (external GitHub API). No internal infrastructure is mocked.
//   - REAL: `fileIntakeIssue` itself (once it exists) and, transitively, the
//     real `restAddLabelArgs`/`ensureLabel` REST idiom it is expected to reuse.
//
// Every test below is expected to FAIL with "Cannot find module
// '.../intake/file-issue.js'" until Task 4 lands. That is correct
// pre-implementation RED.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

const FILE_ISSUE_MOD = '../../src/engine/engineer/intake/file-issue.js';

async function loadFileIssueModule(): Promise<Record<string, unknown>> {
  return (await import(FILE_ISSUE_MOD)) as Record<string, unknown>;
}

function requireFileIssueFn(mod: Record<string, unknown>): (...a: any[]) => any {
  const fn = mod.fileIntakeIssue;
  if (typeof fn !== 'function') {
    throw new Error('expected export "fileIntakeIssue" to be a function (not yet implemented)');
  }
  return fn as (...a: any[]) => any;
}

/** Fake `gh` runner: models `issue create`, label create/apply, and
 * dependencies/blocked_by traffic, recording every call. */
function makeFakeGh(opts: { failLabelApply?: boolean; failIssueCreate?: boolean } = {}) {
  const calls: { args: string[] }[] = [];
  const appliedLabels: string[] = [];
  const createdIssues: string[] = [];

  const run = async (args: string[], _opts: { cwd: string }) => {
    calls.push({ args });

    if (args[0] === 'issue' && args[1] === 'create') {
      if (opts.failIssueCreate) throw new Error('simulated issue-create failure');
      createdIssues.push('acme/app#300');
      return { stdout: 'https://github.com/acme/app/issues/300\n' };
    }
    if (args[0] === 'label' && args[1] === 'create') {
      return { stdout: '' };
    }
    if (args.includes('labels') && args.some((a) => a.startsWith('labels[]='))) {
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

  return { run, calls, appliedLabels, createdIssues };
}

describe('Story 2 — bin/intake-file files criteria-complete issues', () => {
  describe('Happy path', () => {
    it('given size and priority, files the issue AND applies labels + records blocked_by in one filing', async () => {
      const fileIntakeIssue = requireFileIssueFn(await loadFileIssueModule());
      const gh = makeFakeGh();

      const result = await fileIntakeIssue(
        {
          title: 'Something broke',
          body: 'Observed X, expected Y',
          size: 'L',
          priority: 'critical',
          dependsOn: ['acme/app#99'],
          interactive: false,
        },
        { gh: gh.run, cwd: '.' },
      );

      expect(result.issueUrl).toContain('acme/app/issues/300');
      expect(gh.appliedLabels).toEqual(expect.arrayContaining(['priority: critical', 'size: L']));
    });

    it('non-interactive filing with no size/priority infers from the body, else defaults — never aborts', async () => {
      const fileIntakeIssue = requireFileIssueFn(await loadFileIssueModule());
      const gh = makeFakeGh();

      const result = await fileIntakeIssue(
        {
          title: 'Vague report',
          body: 'no clear signal about size or priority here',
          interactive: false,
        },
        { gh: gh.run, cwd: '.' },
      );

      expect(result.issueUrl).toBeDefined();
      expect(gh.appliedLabels.some((l) => l.startsWith('size:'))).toBe(true);
      expect(gh.appliedLabels.some((l) => l.startsWith('priority:'))).toBe(true);
      // Falling back to defaults is acceptable when no confident signal exists.
      expect(result.sizeSource).toMatch(/^(inferred|default)$/);
      expect(result.prioritySource).toMatch(/^(inferred|default)$/);
    });

    it('interactive filing with missing size/priority prompts via the injected prompt function', async () => {
      const fileIntakeIssue = requireFileIssueFn(await loadFileIssueModule());
      const gh = makeFakeGh();
      const prompted: string[] = [];
      const prompt = async (question: string) => {
        prompted.push(question);
        if (/size/i.test(question)) return 'S';
        if (/priority/i.test(question)) return 'high';
        return '';
      };

      const result = await fileIntakeIssue(
        { title: 'Interactive report', body: 'body text', interactive: true },
        { gh: gh.run, cwd: '.', prompt },
      );

      expect(prompted.length).toBeGreaterThan(0);
      expect(result.sizeSource).toBe('prompted');
      expect(result.prioritySource).toBe('prompted');
    });

    it('omitting --depends-on records an explicit "no dependencies" acknowledgement, not left undecided', async () => {
      const fileIntakeIssue = requireFileIssueFn(await loadFileIssueModule());
      const gh = makeFakeGh();

      const result = await fileIntakeIssue(
        { title: 'No deps', body: 'body', size: 'S', priority: 'low', interactive: false },
        { gh: gh.run, cwd: '.' },
      );

      expect(result.dependsOnDecision).toBe('none');
    });

    it('a stated --depends-on ref is recorded as a blocked_by link at file time', async () => {
      const fileIntakeIssue = requireFileIssueFn(await loadFileIssueModule());
      const gh = makeFakeGh();

      const result = await fileIntakeIssue(
        {
          title: 'Has deps',
          body: 'body',
          size: 'S',
          priority: 'low',
          dependsOn: ['acme/app#42'],
          interactive: false,
        },
        { gh: gh.run, cwd: '.' },
      );

      expect(result.dependsOnDecision).toBe('linked');
      expect(result.linked).toContain('acme/app#42');
    });
  });

  describe('Negative paths', () => {
    it('label-apply REST failure after issue create reports the issue URL + warning and exits success', async () => {
      const fileIntakeIssue = requireFileIssueFn(await loadFileIssueModule());
      const gh = makeFakeGh({ failLabelApply: true });

      const result = await fileIntakeIssue(
        { title: 'Label fails', body: 'body', size: 'M', priority: 'medium', interactive: false },
        { gh: gh.run, cwd: '.' },
      );

      expect(result.issueUrl).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.ok).toBe(true);
    });

    it('a --depends-on reference to a non-existent issue is captured and reported, filing still succeeds', async () => {
      const fileIntakeIssue = requireFileIssueFn(await loadFileIssueModule());
      const gh = makeFakeGh();

      const result = await fileIntakeIssue(
        {
          title: 'Bad ref',
          body: 'body',
          size: 'S',
          priority: 'low',
          dependsOn: ['not-a-valid-ref'],
          interactive: false,
        },
        { gh: gh.run, cwd: '.' },
      );

      expect(result.badRefs).toContain('not-a-valid-ref');
      expect(result.ok).toBe(true);
      expect(result.issueUrl).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "The ~100-issue backlog is made complete in one
// pass — no HALT" (Story 3, FR-3; #695 intake-only-enforcement).
//
// Stories: .docs/stories/intake-only-enforcement.md (Story 3).
// Plan:    .docs/plans/intake-only-enforcement.md (Task 6 — `bin/intake-backfill`).
//
// NONE of this feature's production code exists yet: `bin/intake-backfill`
// does not exist.
//
// ASSUMED SEAM (not settled fact — the implementation task must fill this in):
// per the plan, `bin/intake-backfill` is expected to (1) enumerate open
// assigned issues, (2) use `parseSizeLabel`/`parsePriorityLabels` from
// backlog-priority.ts to detect gaps, (3) apply REST labels via the same
// idiom named for Tasks 3/4, (4) emit a report, all without a confirmation
// gate or HALT. This spec drives the assumed underlying function the binary
// should delegate to — `backfillIntakeLabels(issues, deps)` — over an
// in-memory fixture backlog, rather than shelling out to a not-yet-built
// binary or the live GitHub API, mirroring how
// `dependency-ordered-intake-and-dispatch.test.ts`'s Flow D drives
// `runMigration` directly against a fake platform.
//
// Seams faked vs real:
//   - FAKED: the `gh` CLI runner (GhRunner-shaped fake) — the system boundary
//     (external GitHub API). No internal infrastructure is mocked.
//   - REAL: `backfillIntakeLabels` itself (once it exists).
//
// Every test below is expected to FAIL with "Cannot find module
// '.../intake/backfill.js'" until Task 6 lands. That is correct
// pre-implementation RED.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

const BACKFILL_MOD = '../../src/engine/engineer/intake/backfill.js';

async function loadBackfillModule(): Promise<Record<string, unknown>> {
  return (await import(BACKFILL_MOD)) as Record<string, unknown>;
}

function requireBackfillFn(mod: Record<string, unknown>): (...a: any[]) => any {
  const fn = mod.backfillIntakeLabels;
  if (typeof fn !== 'function') {
    throw new Error('expected export "backfillIntakeLabels" to be a function (not yet implemented)');
  }
  return fn as (...a: any[]) => any;
}

/** Fixture backlog modeled on the real skew (100/107 open issues missing size). */
const FIXTURE_BACKLOG = [
  { ref: 'acme/app#1', body: 'small typo fix, S-sized effort', labels: [] as string[] }, // no labels at all
  { ref: 'acme/app#2', body: 'large multi-week rewrite effort', labels: ['priority: high'] }, // missing size only
  { ref: 'acme/app#3', body: 'vague, no signal', labels: ['size: M'] }, // missing priority only
  { ref: 'acme/app#4', body: 'already complete', labels: ['priority: low', 'size: S'] }, // complete already
  { ref: 'acme/app#5', body: 'will fail to label', labels: [] as string[] }, // simulate a per-issue failure
];

/** Fake `gh` runner: models label-create + REST label-apply, with an
 * injectable per-ref failure set. */
function makeFakeGh(opts: { failFor?: Set<string> } = {}) {
  const calls: { args: string[] }[] = [];
  const appliedByRef = new Map<string, string[]>();
  const failFor = opts.failFor ?? new Set<string>();

  const run = async (args: string[], _opts: { cwd: string }) => {
    calls.push({ args });
    if (args[0] === 'label' && args[1] === 'create') return { stdout: '' };
    if (args.includes('labels') && args.some((a) => a.startsWith('labels[]='))) {
      const target = args.find((a) => /^repos\/[^/]+\/[^/]+\/issues\/\d+\/labels$/.test(a));
      const m = target?.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/labels$/);
      const ref = m ? `${m[1]}#${m[2]}` : '';
      if (failFor.has(ref)) throw new Error(`simulated failure for ${ref}`);
      const labelArg = args.find((a) => a.startsWith('labels[]='))!;
      const list = appliedByRef.get(ref) ?? [];
      list.push(labelArg.replace('labels[]=', ''));
      appliedByRef.set(ref, list);
      return { stdout: '{}' };
    }
    return { stdout: '{}' };
  };

  return { run, calls, appliedByRef };
}

describe('Story 3 — one-shot backfill completes the backlog, no HALT', () => {
  describe('Happy path', () => {
    it('labels every incomplete issue (infer where confident, else default) and skips the already-complete one', async () => {
      const backfillIntakeLabels = requireBackfillFn(await loadBackfillModule());
      const gh = makeFakeGh();

      const report = await backfillIntakeLabels(FIXTURE_BACKLOG, { gh: gh.run, cwd: '.' });

      // #4 was already complete — never touched.
      expect(gh.appliedByRef.has('acme/app#4')).toBe(false);
      // #1, #2, #3, #5 each got at least one missing label applied.
      for (const ref of ['acme/app#1', 'acme/app#2', 'acme/app#3']) {
        expect(gh.appliedByRef.has(ref), `${ref} should have been labelled`).toBe(true);
      }
      expect(report.labelled.length).toBeGreaterThanOrEqual(3);
    });

    it('emits a report distinguishing defaulted vs inferred values per issue', async () => {
      const backfillIntakeLabels = requireBackfillFn(await loadBackfillModule());
      const gh = makeFakeGh();

      const report = await backfillIntakeLabels(FIXTURE_BACKLOG, { gh: gh.run, cwd: '.' });

      for (const entry of report.labelled) {
        expect(entry.ref).toBeDefined();
        expect(Array.isArray(entry.applied)).toBe(true);
        for (const applied of entry.applied) {
          expect(['inferred', 'default']).toContain(applied.source);
        }
      }
    });

    it('a re-run is idempotent — already-complete issues (including ones just completed) are skipped, no duplicate labels', async () => {
      const backfillIntakeLabels = requireBackfillFn(await loadBackfillModule());
      const gh = makeFakeGh();

      await backfillIntakeLabels(FIXTURE_BACKLOG, { gh: gh.run, cwd: '.' });
      const afterFirstRun = new Map(gh.appliedByRef);

      // Simulate the backlog now reflecting the applied labels for the re-run.
      const updatedBacklog = FIXTURE_BACKLOG.map((issue) => ({
        ...issue,
        labels: [...issue.labels, ...(afterFirstRun.get(issue.ref) ?? [])],
      }));
      const secondReport = await backfillIntakeLabels(updatedBacklog, { gh: gh.run, cwd: '.' });

      expect(secondReport.labelled.length).toBe(0);
    });
  });

  describe('Negative paths', () => {
    it('a single issue label-apply failure is isolated — reported as skipped, rest of the sweep still completes, no HALT', async () => {
      const backfillIntakeLabels = requireBackfillFn(await loadBackfillModule());
      const gh = makeFakeGh({ failFor: new Set(['acme/app#5']) });

      const report = await backfillIntakeLabels(FIXTURE_BACKLOG, { gh: gh.run, cwd: '.' });

      const failedEntry = report.failed.find((f: any) => f.ref === 'acme/app#5');
      expect(failedEntry, 'the failing issue must be reported as skipped, not thrown').toBeDefined();
      // The rest of the backlog still completed despite the one failure.
      expect(gh.appliedByRef.has('acme/app#1')).toBe(true);
      expect(gh.appliedByRef.has('acme/app#2')).toBe(true);
      expect(report.halted).not.toBe(true);
    });

    it('when a size cannot be inferred, the default is applied and recorded in the report — no confirmation prompt, no stop', async () => {
      const backfillIntakeLabels = requireBackfillFn(await loadBackfillModule());
      const gh = makeFakeGh();
      const noSignalIssue = [{ ref: 'acme/app#6', body: 'totally ambiguous text', labels: [] }];

      const report = await backfillIntakeLabels(noSignalIssue, { gh: gh.run, cwd: '.' });

      const entry = report.labelled.find((e: any) => e.ref === 'acme/app#6');
      expect(entry).toBeDefined();
      const sizeApplied = entry.applied.find((a: any) => a.label.startsWith('size:'));
      expect(sizeApplied?.source).toBe('default');
      expect(sizeApplied?.label).toBe('size: M');
      expect(report.halted).not.toBe(true);
      expect(report.confirmationRequested).not.toBe(true);
    });
  });
});

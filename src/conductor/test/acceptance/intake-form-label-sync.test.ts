// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Issue-form captures are born with priority + size +
// linking" (Story 1, FR-1; #695 intake-only-enforcement).
//
// Stories: .docs/stories/intake-only-enforcement.md (Story 1, Story 4 negative
//          paths folded in per the writing-system-tests plan — bad-ref capture
//          is a Story 4 criterion but belongs with the form/sync flow, not a
//          separate file).
// Plan:    .docs/plans/intake-only-enforcement.md (Task 2 — intake.yml fields;
//          Task 3 — intake-label-sync.yml Action).
//
// NONE of this feature's production code exists yet:
//   - `.github/ISSUE_TEMPLATE/intake.yml` has no Priority/Size/Depends-on
//     fields (Task 2).
//   - `.github/workflows/intake-label-sync.yml` does not exist (Task 3).
//   - There is no shared label-sync module the workflow's inline script,
//     `bin/intake-file`, and `bin/intake-backfill` can all call.
//
// ASSUMED SEAM (not settled fact — the implementation task must fill this in):
// the plan (Task 3) leaves the Action's implementation shape open ("reuse the
// closed-vocab from Task 1 where it runs JS, else inline the same regex").
// For this Action to be testable as anything other than opaque YAML, we assume
// it will be authored as a thin GH Actions wrapper around a new TS module:
//
//     src/conductor/src/engine/engineer/intake/label-sync.ts
//       export function syncIssueLabels(
//         fields: { priority?: string; size?: string; dependsOn?: string[] },
//         ref: string,
//         deps: { gh: GhRunner; cwd: string; log?: (msg: string) => void },
//       ): Promise<{
//         priorityLabel: string; sizeLabel: string;
//         priorityDefaulted: boolean; sizeDefaulted: boolean;
//         linked: string[]; badRefs: string[];
//       }>
//
// syncIssueLabels is expected to reuse `ensureLabel`/`addLabel` from
// pr-labels.ts (label auto-create + REST apply) and `createDependencyLinks`
// from issue-dep-migration.ts (GET-before-POST additive blocked_by writes) —
// exactly the existing idioms named in the plan — rather than reinventing
// label/link REST calls. This spec drives that assumed module directly (the
// Action itself is untestable YAML); a later acceptance pass may add a
// workflow-fixture test once the Action's trigger wiring exists.
//
// Seams faked vs real:
//   - FAKED: the `gh` CLI runner (GhRunner-shaped fake, exactly like the
//     existing pr-labels.ts / issue-dep-migration.ts tests) — the system
//     boundary (external GitHub API). No internal infrastructure is mocked.
//   - REAL: `syncIssueLabels` itself (once it exists), and — via its expected
//     implementation — the real `ensureLabel`/`addLabel`/`createDependencyLinks`
//     REST-argv builders it should be composed from.
//
// Every test below is expected to FAIL with "Cannot find module
// '.../intake/label-sync.js'" (or an import-time collection failure wrapped
// per-test, see the `describe`/dynamic-import pattern borrowed from
// dependency-ordered-intake-and-dispatch.test.ts's Flow C/D) until Task 3
// lands. That is correct pre-implementation RED.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

const LABEL_SYNC_MOD = '../../src/engine/engineer/intake/label-sync.js';

async function loadLabelSyncModule(): Promise<Record<string, unknown>> {
  return (await import(LABEL_SYNC_MOD)) as Record<string, unknown>;
}

function requireSyncFn(mod: Record<string, unknown>): (...a: any[]) => any {
  const fn = mod.syncIssueLabels;
  if (typeof fn !== 'function') {
    throw new Error('expected export "syncIssueLabels" to be a function (not yet implemented)');
  }
  return fn as (...a: any[]) => any;
}

/** Fake `gh` runner: models label-create, label-apply (REST), and
 * dependencies/blocked_by GET+POST traffic, recording every call. */
function makeFakeGh(opts: { failLabelApply?: boolean } = {}) {
  const calls: { args: string[] }[] = [];
  const createdLabels = new Set<string>();
  const appliedLabels: string[] = [];
  const blockedByLinks = new Map<string, Set<string>>();
  const failLabelApply = opts.failLabelApply ?? false;

  const run = async (args: string[], _opts: { cwd: string }) => {
    calls.push({ args });

    // `gh label create <name> --color <c> --force`
    if (args[0] === 'label' && args[1] === 'create') {
      createdLabels.add(args[2]);
      return { stdout: '' };
    }

    // `gh api --method POST repos/<repo>/issues/<n>/labels -f labels[]=<name>`
    if (args.some((a) => a.endsWith('/labels')) && args.some((a) => a.startsWith('labels[]='))) {
      if (failLabelApply) throw new Error('simulated label-apply outage');
      const labelArg = args.find((a) => a.startsWith('labels[]='))!;
      appliedLabels.push(labelArg.replace('labels[]=', ''));
      return { stdout: '{}' };
    }

    // `gh api repos/<repo>/issues/<n>/dependencies/blocked_by` (GET)
    const blockedByTarget = args.find((a) => a.includes('/dependencies/blocked_by'));
    if (blockedByTarget && !args.includes('POST') && !args.includes('-X')) {
      const m = blockedByTarget.match(/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by/);
      const key = m ? `${m[1]}#${m[2]}` : '';
      const set = blockedByLinks.get(key) ?? new Set();
      return {
        stdout: JSON.stringify(
          [...set].map((ref) => {
            const [repo, number] = ref.split('#');
            return { number: Number(number), repository_url: `https://api.github.com/repos/${repo}` };
          }),
        ),
      };
    }

    // Plain-issue GET for database-id resolution (id needed for blocked_by POST).
    const issuePath = args.find((a) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(a));
    if (issuePath) {
      const im = issuePath.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/)!;
      return { stdout: JSON.stringify({ id: Number(im[2]) + 1_000_000, number: Number(im[2]) }) };
    }

    // POST to dependencies/blocked_by
    if (blockedByTarget) {
      const m = blockedByTarget.match(/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/dependencies\/blocked_by/);
      const key = m ? `${m[1]}#${m[2]}` : '';
      const set = blockedByLinks.get(key) ?? new Set();
      set.add('acme/app#linked'); // marker; individual tests only assert call shape
      blockedByLinks.set(key, set);
      return { stdout: '{}' };
    }

    return { stdout: '{}' };
  };

  return { run, calls, createdLabels, appliedLabels, blockedByLinks };
}

describe('Story 1 — intake form is born with priority + size + linking (label-sync)', () => {
  describe('Happy path', () => {
    it('a submitted form with valid Priority/Size/Depends-on applies both labels and records blocked_by', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh();

      const result = await syncIssueLabels(
        { priority: 'critical', size: 'L', dependsOn: ['acme/app#100'] },
        'acme/app#200',
        { gh: gh.run, cwd: '.' },
      );

      expect(result.priorityLabel).toBe('priority: critical');
      expect(result.sizeLabel).toBe('size: L');
      expect(gh.appliedLabels).toEqual(expect.arrayContaining(['priority: critical', 'size: L']));
      expect(result.linked).toContain('acme/app#100');
    });

    it('auto-creates a missing priority: / size: label before applying it (mirrors engineer:handled auto-create)', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh();

      await syncIssueLabels({ priority: 'high', size: 'S', dependsOn: [] }, 'acme/app#201', {
        gh: gh.run,
        cwd: '.',
      });

      expect(gh.createdLabels.has('priority: high')).toBe(true);
      expect(gh.createdLabels.has('size: S')).toBe(true);
    });

    it('an unparsable priority/size value defaults to priority: medium / size: M — issue is still born complete', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh();

      const result = await syncIssueLabels(
        { priority: 'urgent!!', size: 'XL', dependsOn: [] },
        'acme/app#202',
        { gh: gh.run, cwd: '.' },
      );

      expect(result.priorityLabel).toBe('priority: medium');
      expect(result.sizeLabel).toBe('size: M');
      expect(result.priorityDefaulted).toBe(true);
      expect(result.sizeDefaulted).toBe(true);
    });

    it('re-edit with identical values is idempotent — no duplicate labels, no error', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh();
      const fields = { priority: 'low', size: 'M', dependsOn: [] as string[] };

      await syncIssueLabels(fields, 'acme/app#203', { gh: gh.run, cwd: '.' });
      const secondApplyCount = gh.appliedLabels.length;
      await syncIssueLabels(fields, 'acme/app#203', { gh: gh.run, cwd: '.' });

      // Idempotent: the second run applies the SAME labels again (REST label-apply
      // is itself idempotent server-side) but must not throw and must not diverge
      // from the first run's resolved label set.
      expect(gh.appliedLabels.slice(secondApplyCount)).toEqual(
        gh.appliedLabels.slice(0, secondApplyCount),
      );
    });
  });

  describe('Negative paths', () => {
    it('label-apply failure (outage/quota) never throws — the sync logs and completes, no failing check', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh({ failLabelApply: true });

      await expect(
        syncIssueLabels({ priority: 'medium', size: 'S', dependsOn: [] }, 'acme/app#204', {
          gh: gh.run,
          cwd: '.',
          log: () => {},
        }),
      ).resolves.toBeDefined();
    });

    it('a Depends-on reference to a non-existent/malformed issue is captured and surfaced, never fatal', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh();

      const result = await syncIssueLabels(
        { priority: 'high', size: 'L', dependsOn: ['not-a-valid-ref', 'acme/app#9999999'] },
        'acme/app#205',
        { gh: gh.run, cwd: '.' },
      );

      expect(result.badRefs).toEqual(expect.arrayContaining(['not-a-valid-ref']));
      // Filing/sync must still complete and still apply the priority/size labels.
      expect(result.priorityLabel).toBe('priority: high');
      expect(result.sizeLabel).toBe('size: L');
    });

    it('a Jira ref in the Depends-on list is skipped non-fatally — no gh call is made for it', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh();

      const result = await syncIssueLabels(
        { priority: 'medium', size: 'S', dependsOn: ['PROJ-123'] },
        'acme/app#206',
        { gh: gh.run, cwd: '.' },
      );

      expect(result.linked).not.toContain('PROJ-123');
      expect(result.badRefs).not.toContain('PROJ-123');
      // Non-fatal: sync still completes and applies priority/size labels.
      expect(result.priorityLabel).toBe('priority: medium');
      expect(result.sizeLabel).toBe('size: S');
      // No blocked_by-dependency traffic was issued for the Jira ref.
      expect(gh.calls.some((c) => c.args.some((a) => a.includes('dependencies/blocked_by')))).toBe(false);
    });

    it('a ref the strict regex rejects (contains a space) is still rejected — strict-set is unchanged/no wider than before', async () => {
      const syncIssueLabels = requireSyncFn(await loadLabelSyncModule());
      const gh = makeFakeGh();

      const result = await syncIssueLabels(
        { priority: 'medium', size: 'S', dependsOn: ['a b/c#1'] },
        'acme/app#207',
        { gh: gh.run, cwd: '.' },
      );

      expect(result.badRefs).toEqual(expect.arrayContaining(['a b/c#1']));
      expect(result.linked).not.toContain('a b/c#1');
    });
  });
});

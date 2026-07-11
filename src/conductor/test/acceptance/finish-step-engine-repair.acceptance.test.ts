/**
 * Acceptance spec for Story 1 / Task 14 (RED phase):
 * "Engine repairs a reused halt PR inside the finish step, before the gate
 * reads it" (.docs/stories/finish-step-completion-becomes-engine-machinery-re.md).
 *
 * Drives the REAL production entry point — `checkStepCompletion(dir, 'finish',
 * ctx)` from `src/engine/artifacts.ts` — with a fake `GhRunner` seeded with a
 * reused halt PR (draft + `needs-remediation` label + `needs-remediation:`
 * title + body marker) and a recorded `finish-choice`/`pr_url` with push
 * evidence true.
 *
 * Per ADR D1 (Story 1) the finish predicate is supposed to invoke an
 * order-gated repair callback BETWEEN its two phases — after the
 * non-presentation conditions (finish-choice, pr_url, push evidence) pass and
 * strictly before the presentation checks (stale title / draft) — so that a
 * reused halt PR ships on the very same finish attempt.
 *
 * None of the following exist yet on `CompletionContext` / `CompletionResult`:
 *   - `ctx.gh` (injectable GhRunner for the presentation branch — Task 3)
 *   - `ctx.repairFinishPr` (order-gated repair callback — Task 8)
 *   - `result.missing` (machine-readable facet code — Task 1)
 *
 * So this test is expected to fail for the RIGHT reason: the injected
 * `repairFinishPr` fake is never invoked (the field is ignored by today's
 * predicate) and the fake gh's recorded mutations stay empty — not a syntax
 * error, not a trivially-true assertion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStepCompletion, FINISH_CHOICE_MARKER } from '../../src/engine/artifacts.js';
import { rehabilitateHaltPr } from '../../src/engine/halt-pr-rehabilitation.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const PR_URL = 'https://github.com/owner/repo/pull/499';
const SOURCE_REF = 'owner/repo#499';
const HALT_TITLE = 'needs-remediation: feat/x — manual remediation required';
const BODY_MARKER = 'This PR was opened automatically after an irrecoverable daemon HALT.';
const FLOOR_TITLE = 'feat: finish step completion becomes engine machinery';

/**
 * Fake gh runner mirroring the pattern used in
 * halt-pr-rehabilitation.acceptance.test.ts / pr-labels.test.ts: answers
 * `pr view` reads with the current in-memory state and records every call.
 */
function makeGhFake(state: {
  title: string;
  labels: string[];
  isDraft: boolean;
  body?: string;
}): { gh: GhRunner; calls: string[][]; getState: () => typeof state } {
  let title = state.title;
  let labels = [...state.labels];
  let isDraft = state.isDraft;
  let body = state.body ?? '';
  const calls: string[][] = [];

  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    if (args[0] === 'pr' && args[1] === 'view' && args.includes('body')) {
      return {
        stdout: JSON.stringify({
          title,
          isDraft,
          labels: labels.map((name) => ({ name })),
          body,
        }),
      };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        stdout: JSON.stringify({
          title,
          isDraft,
          labels: labels.map((name) => ({ name })),
        }),
      };
    }
    if (args[0] === 'pr' && args[1] === 'ready' && args.includes('--undo')) {
      isDraft = true;
      return { stdout: '' };
    }
    if (args[0] === 'pr' && args[1] === 'ready') {
      isDraft = false;
      return { stdout: '' };
    }
    if (args[0] === 'api' && args.includes('DELETE')) {
      labels = labels.filter((l) => l !== 'needs-remediation');
      return { stdout: '' };
    }
    if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--title')) {
      title = args[args.indexOf('--title') + 1];
      return { stdout: '' };
    }
    if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
      body = args[args.indexOf('--body') + 1];
      return { stdout: '' };
    }
    return { stdout: '' };
  };

  return { gh, calls, getState: () => ({ title, labels, isDraft, body }) };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'finish-engine-repair-'));
  await mkdir(join(dir, '.pipeline'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('acceptance: reused halt PR ships on the first finish attempt (Story 1 / Task 14)', () => {
  it('repairs the reused halt PR (ready, unlabeled, title clean, Closes once, body marker gone) and completes done:true on the same attempt', async () => {
    // Recorded finish-choice + pr_url, written fresh so the predicate's phase-1
    // conditions are all satisfiable.
    await writeFile(join(dir, FINISH_CHOICE_MARKER), 'pr\n', 'utf-8');
    await writeFile(
      join(dir, '.pipeline/conduct-state.json'),
      JSON.stringify({ pr_url: PR_URL, feature_desc: 'finish step completion becomes engine machinery' }),
      'utf-8',
    );

    const { gh, calls, getState } = makeGhFake({
      title: HALT_TITLE,
      labels: ['needs-remediation'],
      isDraft: true,
      body: BODY_MARKER,
    });

    // The NOT-YET-EXISTING repair seam: `ctx.repairFinishPr`. Composes exactly
    // what Task 9 will compose in conductor.ts (rehabilitateHaltPr +
    // retitleFloor + ensureShipReady) against the SAME fake gh the predicate
    // is given — proving the order-gate invokes it before phase 2 reads.
    let repairCallCount = 0;
    const repairFinishPr = async (prUrl: string): Promise<void> => {
      repairCallCount++;
      await rehabilitateHaltPr({ gh, cwd: dir, prUrl, sourceRef: SOURCE_REF });
      // Stand-in for the not-yet-existing `retitleFloor`: today's
      // rehabilitateHaltPr deliberately never edits the title (Decision 1 vs
      // Decision 2 split), so the floor must be applied here to prove the
      // composed repair path clears the stale prefix.
      const current = getState();
      if (current.title.startsWith('needs-remediation:')) {
        await gh(['pr', 'edit', prUrl, '--title', FLOOR_TITLE], { cwd: dir });
      }
    };

    const result = await checkStepCompletion(dir, 'finish', {
      sessionStartedAt: Date.now() - 60_000,
      daemon: true,
      isHeadPushed: async () => true,
      // Not on `CompletionContext` yet (Task 3 / Task 8) — cast through `any`
      // so the test still compiles against today's narrower interface while
      // exercising the seam the implementation will add.
      ...({ gh, repairFinishPr } as any),
    });

    // ── The repair ran, strictly before/instead of a stale gate failure ──
    expect(repairCallCount).toBe(1);

    const finalState = getState();
    expect(finalState.isDraft).toBe(false);
    expect(finalState.labels).not.toContain('needs-remediation');
    expect(finalState.title).not.toMatch(/^needs-remediation:/);
    expect(finalState.title).toBe(FLOOR_TITLE);
    const closesMatches = finalState.body.match(/Closes\s+owner\/repo#499/gi) ?? [];
    expect(closesMatches).toHaveLength(1);
    expect(finalState.body).not.toContain(BODY_MARKER);

    // ── First-try ship: the SAME completion evaluation returns done:true ──
    expect(result.done).toBe(true);

    // Sanity: the fake gh was actually exercised (not a vacuous 0-call pass).
    expect(calls.length).toBeGreaterThan(0);
  });
});

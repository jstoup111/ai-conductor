**Status:** Accepted

# Stories: No-diff task earns completion currency deterministically — #733

**Track:** technical (no PRD — acceptance criteria live here)
**Feature area:** the completion-evidence gate. Two functions in
`src/conductor/src/engine/autoheal.ts` — `deriveCompletionInternal`'s `Evidence: skipped`
branch and `parsePlanTaskVerifyOnly` — plus the gate that reads their output
(`src/conductor/src/engine/artifacts.ts` build predicate) and the lane that consumes the
verify-only predicate (`src/conductor/src/engine/conductor.ts`,
`src/conductor/src/engine/attribution-lane.ts`). The own-diff trailer/path corroboration
path (#707) and `countResolvedTasks` are **out of scope** and stories guard that they are
unchanged.

## Context

The build gate accepts only an `evidenceStamps` entry as "resolved" (#463). A no-diff task
(a "GREEN + full-suite check" verification, or an already-satisfied contract closed as
skipped) has no deterministic route to that stamp, so it stalls `no_task_progress (N→N)`
and auto-parks. Observed on 5 of 6 builds in the 2026-07-21 batch (#733).

---

## Story 1: An `Evidence: skipped` commit resolves its task

**Requirement:** FR-1

As the daemon deriving completion, when a task is closed by a real
`Evidence: skipped <reason>` commit on the branch, I want that task recorded in
`evidenceStamps` so the build gate counts it resolved — because the gate's only currency
is a stamp, and a legitimately-skipped no-diff task otherwise blocks the build forever.

**Acceptance criteria:**
- `deriveCompletion` over a branch containing an `Evidence: skipped` commit for task T
  produces an `evidenceStamps` entry for T with `form: 'evidence:skipped'` and `sha` = the
  skip commit's sha.
- The task's derived `status` stays `skipped` and `completed` stays `false` (the stamp
  changes gate resolution, not the task's terminal kind).
- The build completion predicate (`artifacts.ts`) returns `done: true` for a plan whose
  only otherwise-unresolved task is that skipped task.

## Story 2: A `**Type:** verification` task arms the judged-closure lane

**Requirement:** FR-2

As the daemon handling build residue, I want a no-diff task authored `**Type:**
verification` to be treated as verify-only-eligible — in union with the existing
`**Verify-only:** yes` marker — so the judged-closure lane arms for it and the verifier's
`satisfied` verdict becomes a `semantic-verified` stamp.

**Acceptance criteria:**
- `parsePlanTaskVerifyOnly` returns `true` for a task block whose `**Type:**` line contains
  the `verification` token, and `true` for a task with `**Verify-only:** yes` (unchanged).
- For a residue task marked only via `**Type:** verification`, the lane arms
  (`verifyOnlyResidue` is non-empty in `conductor.ts`) and, given a valid verdict, a
  `semantic-verified` stamp is written for it.
- End result: a plan whose only residue is a `Type: verification` task with a valid verdict
  reaches gate-pass instead of `no_task_progress`.

## Story 3 (negative): A self-reported `skipped` row with no commit resolves nothing

**Requirement:** FR-3 (derive-from-git invariant)

As the operator relying on #463's git-derived evidence, I want a task-status.json row that
merely *says* `status: 'skipped'` — with no `Evidence: skipped` commit on the branch — to
receive **no** stamp, so a forged or wiped row can never resolve a task.

**Acceptance criteria:**
- `deriveCompletion` over a branch with **no** `Evidence: skipped` commit for T leaves T
  **absent** from `evidenceStamps`, regardless of what task-status.json claims.
- The gate reports T as `pending/not completed`.

## Story 4 (negative): A verification task with a forged/non-ancestor citation is still refused

**Requirement:** FR-4 (whitewash guard preserved)

As the operator, I want a `Type: verification` residue task whose verdict cites a
non-existent, non-ancestor, empty, or bookkeeping-only commit to be **refused** — no
`semantic-verified` stamp — so widening lane eligibility never launders unverified work.

**Acceptance criteria:**
- A `satisfied` verdict for a verification task with a forged/non-ancestor citation yields
  **no** stamp (task remains unresolved; build stalls loudly rather than shipping).
- A `satisfied` verdict with empty citations or missing/failing `testEvidence` is coerced
  to `no-verdict` and produces no stamp (existing whitewash guard, re-asserted under the
  widened eligibility).

## Story 5 (negative): Non-"verification" Type stays fail-closed; own-diff tasks unaffected

**Requirement:** FR-5

As the operator, I want the eligibility widening to be tight: a task typed `happy-path`,
`negative-path`, `refactor`, `feature`, `integration`, `infrastructure`, or `review` stays
`false` in `parsePlanTaskVerifyOnly`, and a code-bearing task is resolved by its own diff
before the lane runs — so mislabeling cannot route real work through the verifier.

**Acceptance criteria:**
- `parsePlanTaskVerifyOnly` returns `false` for every `**Type:**` value that does not
  contain the `verification` token (fail-closed, matching the existing marker's exact-match
  discipline).
- A task with a real Task-trailered commit overlapping its declared paths is stamped via
  the trailer path and is **not** present in the residue the lane judges (guards
  own-diff-before-lane ordering).

## Story 6 (end-to-end): The #733 stall shape builds to gate-pass

**Requirement:** FR-6

As the operator, I want a fixture reproducing the #733 stall — a plan whose final task is a
no-diff `Type: verification` "GREEN + full-suite check", plus a mid-plan `Verify-only`
task closed via `Evidence: skipped` — to reach gate-pass after the fix, so the parked batch
unparks without plan edits or re-dispatch.

**Acceptance criteria:**
- Before the fix (baseline): the fixture's completion predicate reports
  `1/N tasks pending/not completed` naming the no-diff task.
- After the fix: with the skip commit present and a valid verdict for the verification
  task, the predicate returns `done: true`.
- No change to `countResolvedTasks`, task-status seeding, or the own-diff corroboration
  path is required for the fixture to pass.

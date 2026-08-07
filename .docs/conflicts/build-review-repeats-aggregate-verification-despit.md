# Conflict Check: Scoped invocation cannot expand to the aggregate suite

**Date:** 2026-08-01
**Feature:** intake jstoup111/ai-conductor#1173, stories `build-review-repeats-aggregate-verification-despit.md` (Stories 1–8 / TR-1–TR-8)
**Result:** **PASS — 0 blocking conflicts.** 4 degrading/amendment items accepted, all actionable in this feature's own diff.

## Scope of the scan

- All 8 new stories checked pairwise (28 pairs) for contradiction, behavioral overlap, state
  conflict, resource contention, and sequencing. Working notes in
  `.pipeline/conflict-intra-pairs.md`.
- Committed `.docs/stories/` and `.docs/plans/` touching test execution, the `test_suite` gate,
  scoped tests, or `build_review` — read, not merely grepped. Full inventory below.
- Condition C5: explicit overlap check against open issues **#1176** and **#1205**.

## Blocking conflicts

**None.**

## Intra-feature findings (examined, not conflicts)

| Pair | Interaction | Verdict |
|---|---|---|
| Story 2 × Story 5 | Config with the key absent is *valid* (Story 2) yet a scoped run *fails* (Story 5) | Intentional seam. Config validity ≠ runtime availability. Making absence a validation error breaks every existing consumer config (ADR-1 D3 forbids); making it a silent aggregate run is the defect (ADR-1 D6). `/plan` must not collapse these into one check. **95%** |
| Story 6 × Story 7 | Story 7 edits `src/conductor/package.json` `test`, which *is* this repo's `test_suite.command` that Story 6 freezes | Compatible: Story 6 freezes the *engine's treatment* of the key; Story 7 changes the script's internal shape and preserves zero-argument behavior. Story 7's zero-arg regression assertions are load-bearing for Story 6. **90%** |
| Story 1 × Story 3 | Selector-count boundary | Disjoint input spaces; both forbid widening. **97%** |
| Story 3 × Story 8 | Empty-selection routing vs "fallback triggers unchanged" | Story 3 *uses* existing trigger 3 rather than adding one. **95%** |
| Story 6 × Story 8 | Grader prompt edit vs grader input isolation | Changing instruction *text* does not widen the *input set*. **95%** |

## Cross-spec findings

### F1 — #245's empty-scope rule vs Story 3's empty-selection refusal (overlap, non-blocking)

`pipeline-scope-per-task-verify-to-affected-tests-f.md:36-38` requires that a task whose scoped set
comes back empty "runs the aggregate operation through the shared full-suite verifier instead of
skipping verification." Story 3 requires that an empty selector list is refused with nothing
executed.

**Not a contradiction — different layers.** #245's rule is a *skill-level* routing decision (empty
scope ⇒ trigger 3 fires ⇒ FullSuiteVerifier). Story 3's refusal is a *verb-level input guard*: the
verb refuses and points the caller at the verifier, which is exactly how the caller reaches #245's
outcome. **Resolution:** Story 3's negative path already requires the refusal message to name the
aggregate verifier. `/plan` must state that Story 3 does not remove or weaken trigger 3.

### F2 — Anchor drift on the fallback triggers (degrading, must fix)

This feature's artifacts cite `HARNESS.md:325-338` for the four broad-fallback triggers. In this
worktree they are at **`HARNESS.md:333-339`**, with the governing sentence at `:341-343`:

> "use the host's repository-configured aggregate verifier interface. **Do not call the project's
> aggregate command directly.**"

That sentence is the strongest compatibility anchor for this whole feature — the contract *already*
forbids direct aggregate invocation, and this feature supplies the missing mechanism for the
non-fallback path. **Resolution:** re-anchor citations in the stories, ADR, and architecture review
before `/plan` freezes them. Applied 2026-08-01.

### F3 — `AGGREGATE_TEST_SUITE_PASS` has no production consumer; the doc says it does (overlap, must fix)

Story 7 repairs the scripts that emit the sentinel, so its consumers matter. Repo-wide, **nothing in
`src/`, `bin/`, `hooks/`, `skills/`, or `.github/` parses stdout for it.** PASS is classified purely
by exit code (`full-suite-verifier.ts:646` → `reason: 'exit_zero'`).

Therefore this claim is **false as written**:

> `docs/contributing/testing.md:40` — "The `AGGREGATE_TEST_SUITE_PASS` sentinel is load-bearing: it
> is the success token the pre-SHIP `test_suite` gate reads."

**Resolution:** in-scope for this feature. Two consequences for `/plan`:
- `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts:241` pins the exact
  script string and **will break** on Story 7 — it must be updated in the same diff.
- `docs/contributing/testing.md:37,40` must be corrected to describe exit-code classification.
  `deterministic-build-verification-flow.acceptance.test.ts:34` is a fake runner's canned stdout, not
  a parser, and needs no change.

This materially *de-risks* Story 7: repairing the script cannot break the gate as long as exit codes
are preserved.

### F4 — Stale ownership claim in the grader prompt (degrading, sweep in the same PR)

`build-review-prompt.ts:59-60` still says the full suite "runs at CI and at finish, not here." #940
moved that ownership from finish to the `test_suite` gate. Story 8 already edits this exact
paragraph, so the correction lands with no extra surface. `/plan` must fix the sentence rather than
preserve the stale half.

### F5 — Verb namespace (advisory)

`.docs/plans/2026-07-29-deterministic-test-suite-step.md:95-97` keeps `conduct-ts test-suite` as the
aggregate adapter. The new verb must be **differently named** and must never overload or alias
`test-suite`. No committed spec adds any new `conduct-ts` verb, so the namespace is otherwise free.

### F6 — Test-isolation constraint inherited (advisory)

`.docs/plans/2026-07-29-deterministic-test-suite-step.md:104-105`: no ordinary test may invoke "the
repository aggregate suite." The new verb's tests must inject a fake runner and must never shell out
to the real suite.

## Condition C5 — overlap with #1176 and #1205

**No overlap.** Verified story by story:

| Excluded concern | Owner | Present in Stories 1–8? |
|---|---|---|
| Reusing one aggregate result across gates on an unchanged tree | #1176 | No — Story 1 requires a scoped run to write *no* evidence; Story 6 requires a scoped pass to *not* satisfy the `test_suite` gate |
| BUILD post-task tail latency, fixed cooldowns | #1176 | No — no story touches step timing or cooldowns |
| Review output size/duration targets | #1176 | No — no story asserts a size or duration target |
| Model-tier / reasoning-effort shadow calibration | #1176 | No — no story touches model or effort selection |
| Partial sibling BUILD-verification capability after rebase | #1205 | No — no story touches rebase or group membership |

The stories' own "Scope exclusions" table records this boundary durably.

## Compatibility confirmations

- **#245** (`pipeline-scope-per-task-verify-to-affected-tests-f.md:28-30`) already requires running
  "with **explicit file arguments**" — Story 7's repair is what makes that achievable here. Supportive.
- **#588** (`reduce-redundant-full-test-suite-runs-in-build-shi.md:19-22`) states that scoping the
  grader's own test run "does NOT touch the verdict." Story 8 stays inside the same instruction
  paragraph its plan scoped (`:35-41`), leaving rubric, verdict schema, and diff/plan sections alone.
- **#940** (`full-suite-verification-gate-940.md:226-238`) reserves reusable evidence to the
  *aggregate* path and forbids later steps calling the project command directly — both reinforced,
  not contradicted, by Stories 1 and 6.
- **Grader isolation** is guarded by two committed specs
  (`add-a-judgement-gate-at-the-build-manual-test-seam.md:76` structural test;
  `2026-07-27-protected-artifact-seal-self-amendment-1047.md:40` "No new grader input"). Story 8's
  negative path asserts the same invariant.
- **No collisions**: existing `test_suite` sub-keys are exactly `command`, `working_directory`,
  `timeout_seconds`, `inputs`, `environment` (`docs/reference/configuration.md:527-531`); no
  committed spec proposes a sixth, and none adds a `conduct-ts` verb.

## Accepted degrading items carried into `/plan`

1. F2 — re-anchor `HARNESS.md` trigger citations (applied).
2. F3 — update `full-suite-verification-gate.acceptance.test.ts:241` and correct
   `docs/contributing/testing.md:37,40`.
3. F4 — correct the stale "at finish" clause in `build-review-prompt.ts:59-60`.
4. F5/F6 — distinct verb name; fake runner in tests.

## Verdict

**Conflict check PASSED.** Zero blocking conflicts. Proceed to `/plan`.

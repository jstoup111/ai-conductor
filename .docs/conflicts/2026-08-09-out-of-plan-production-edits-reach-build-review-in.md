# Conflict Check: Non-blocking plan-scope containment recorder

**Date:** 2026-08-09
**Feature:** `out-of-plan-production-edits-reach-build-review-in` (Tier M)
**Stories checked:** 6 new, against all files in `.docs/stories/`
**Result:** 3 conflicts found — 2 blocking (both resolved by additive amendment), 1 non-blocking
**Re-check:** PASSED CLEAN — zero blocking conflicts remain

## Scan scope

Every story file in `.docs/stories/` was inventoried. Pair-wise scanning was concentrated on files
touching the same behavior, entity, field, or gate — identified by grep for `scope-check`,
`scopeContainment`, `Scope:`, `containment`, `events.jsonl`, and `ConductorEvent`. The dominant
counterpart is `.docs/stories/pipeline-commits-files-outside-the-active-plan-bef.md` (stories
TI-1…TI-7), which specified the merged predecessor, PR #1349.

All six conflict types were checked. Every candidate pair was tested in **both** directions.

---

## Conflict CF-1: Refusal versus non-refusal at the commit boundary

**Stories involved:** new Story 3 ("The containment check never blocks a commit") versus TI-2, TI-4,
and TI-6
**Files:** `.docs/stories/out-of-plan-production-edits-reach-build-review-in.md` versus
`.docs/stories/pipeline-commits-files-outside-the-active-plan-bef.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 98% — grounded in verbatim text: TI-2 "the hook exits non-zero and the commit is
refused" (line 68) against new Story 3 "the commit **lands**".

**Description.** TI-2's happy path *is* the refusal. TI-4 asserts refusal for a trailer that names
an unstaged path, a malformed trailer, and an untrailered path. TI-6 requires the `8b9f753e5`
reproduction to be "deterministically refused". New Story 3 asserts the commit lands in every one of
those cases. A test suite written to either spec fails against the other.

Bidirectional test: satisfy Story 3 fully → TI-2 does not hold. Satisfy TI-2 fully → Story 3 does not
hold. Two failures, so this pair also meets the oscillation heuristic; it is recorded as an ordinary
contradiction because the *cause* is a superseding decision rather than two live requirements pulling
against each other. The genuine oscillation is CF-2.

**Resolution options considered.**
1. Amend TI-2/TI-4/TI-6 additively, marking the refusal consequence superseded and preserving the
   matching and parsing assertions that remain in force.
2. Rewrite the TI-* stories to the new behavior — rejected: destroys the record of a shipped
   decision, and the accepted-artifact protocol is explicitly additive.
3. Reverse the new design and keep refusal — rejected: contradicts an operator direction and an
   APPROVED ADR.

**Resolution applied: option 1.** Amendment notes added beside TI-2, TI-4, and TI-6, citing
`adr-2026-08-09-non-blocking-plan-scope-containment` D1/D2/D3. Each note names precisely what is
withdrawn (the refusal consequence) and what survives (the `/`-boundary matching rules, the trailer
parsing rules, the regression fixture's discriminating power).

A consequence worth recording: TI-6's fixture is scoped to `src/conductor/src/engine/config.ts`, and
the widened floor now admits same-directory neighbours. The reproduction's out-of-floor path must
therefore be moved outside the declared directory or the regression test silently stops
discriminating. This is called out in TI-6's amendment and must reach the plan.

---

## Conflict CF-2: The staged progression to enforcement (the real oscillation)

**Stories involved:** new Story 3 versus TI-7 ("The hook ships report-only before it blocks")
**Type:** oscillating
**Severity:** blocking
**Confidence:** 95% — TI-7's title, its "So that the real refusal rate is measured on live builds
rather than assumed", and its "**Given** enforcing mode is enabled … **Then** the commit is refused
per TI-2" together license exactly the future change that breaks Story 3.

**Description.** This is the costly one, and it is invisible if only the current behavior is
compared. TI-7 does not merely describe report-only mode — it frames report-only as **phase one of a
plan whose phase two is blocking**. Both stories are individually satisfiable and each re-breaks the
other:

- Satisfy Story 3 fully (never refuse) → TI-7's enforcing-mode criterion cannot hold.
- Satisfy TI-7 fully (flip enforcement once measured) → Story 3's core assertion is destroyed.

Two "no" answers: an oscillation by the detection heuristic. The damage would not surface as a failed
build. It would surface, quarters later, as a feature that dutifully "completes TI-7" by enabling
enforcement, a subsequent kickback storm from adjacent test files, and a fix that re-disables it —
each lap a full agent session, with nobody reading either story.

The `scope-check-cli.ts` source carries the same latent instruction in a comment: *"Flip this single
value only after live containment-floor evidence supports enforcing scope refusals."* That comment is
now wrong and must be corrected in the implementation diff, or it will license the same oscillation
from the code side.

**Resolution options considered.**
1. Amend TI-7 to cancel the progression outright and require a superseding ADR to reopen it.
2. Amend TI-7 to say enforcement is "deferred" — rejected: deferral is precisely what licenses the
   oscillation. The progression must be cancelled, not postponed.
3. Kick back to `architecture` — unnecessary: the root does live in the design, but the design
   decision that resolves it (`adr-2026-08-09-non-blocking-plan-scope-containment` D3/D4) was
   authored and APPROVED in this same DECIDE pass.

**Resolution applied: option 1.** TI-7 carries an amendment stating the progression is **cancelled,
not deferred**, that no code path returns `exit 2`, and that reopening enforcement requires a new ADR
superseding `adr-2026-08-09-non-blocking-plan-scope-containment` rather than an implementation
decision. TI-7's measurement intent is preserved and noted as strengthened — `.pipeline/containment-floor.json`
still records out-of-floor paths, and every one now carries a rationale.

**Carried to the plan:** the stale "enforcement flip" comments in `scope-check-cli.ts` (lines 17-20
and 48-51) and in the generated `COMMIT_MSG_HOOK` must be corrected in the same diff. A comment that
contradicts an APPROVED ADR is an oscillation vector.

---

## Conflict CF-3: Exit-code contract

**Stories involved:** new Story 4 versus TI-3 ("The check abstains whenever evidence is absent")
**Type:** contradiction
**Severity:** blocking on the letter, non-behavioral in effect
**Confidence:** 97% — TI-3 states "**Given** `.pipeline/task-status.json` is present but malformed
JSON … **Then** the hook exits 0", against new Story 4's exit 3.

**Description.** TI-3 pins an explicit exit-code contract: `0` allowed, `2` violation, anything else
abstain. New Story 4 retires `2`, adds `3` for an unresolvable check, and moves two of TI-3's rows —
malformed `task-status.json`, and an engine entry point that throws — from `0` to `3`.

The *intent* both specs protect is identical and is preserved: TI-3 exists so a live build is never
wedged by missing or malformed data, and exit 3 is non-blocking, so no build is wedged. Bidirectional
test: satisfy Story 4 → TI-3's stated behavior holds (commit proceeds) but its stated exit code does
not. Satisfy TI-3 → Story 4's recording requirement fails. One-directional failure on behavior, so
this is a contradiction rather than an oscillation.

It is nonetheless blocking at the test level: a test written to TI-3 asserts `exit 0` on malformed
JSON and fails against Story 4.

**Resolution applied: additive amendment** to TI-3's Exit-code contract section, naming the two
superseded rows, retiring `2` as reserved, introducing `3`, and recording that the commit still
proceeds in every case — including for a consumer on the previously generated hook, whose existing
non-0/non-2 branch treats `3` as an abstain. Cites
`adr-2026-08-09-hook-owned-containment-event-ledger` E1.

---

## Conflict CF-4: Concurrent additions to the `ConductorEvent` union

**Stories involved:** new Story 5 versus `.docs/stories/build-post-task-tail-telemetry.md`
**Type:** resource contention
**Severity:** non-blocking
**Confidence:** 90% — verified that PR #1395 (OPEN, needs-remediation) adds a `pipeline_closeout`
variant to `src/conductor/src/types/events.ts`.

**Description.** Both features add a variant to the same discriminated union and both introduce a
sibling ledger. There is no semantic conflict: the `type` discriminants differ, additive variants are
backward-compatible because consumers read named fields, and under
`adr-2026-08-08-pipeline-owned-closeout-timestamps` D2 the two writers **must** own separate files.
The contention is textual — both edit the same region of `events.ts` — and resolves by rebase.

Accepted as non-blocking. Whichever lands second rebases. Recorded so the second lands deliberately
rather than discovering it in a conflict.

---

## Checked and found clean

- **Story 1 (widened floor) versus TI-3's machinery allowlist.** TI-3 asserts `.pipeline/` and
  `.docs/shipped/` exit 0. The widened floor only *adds* to that set, so every TI-3 allowlist
  assertion remains true. Not a conflict — the list becomes non-exhaustive, not wrong.
- **Story 2 (widening records) versus TI-5 (engine backstop).** TI-5's containment floor re-derives
  violations and widenings from git at `build_review`. Story 2 enriches the same derivation with a
  `derived` flag and a fallback rationale. Same producer, same consumer, no second channel. This
  also independently confirms the `event-spine` exception-C verdict: widenings are durable state
  already read by name from `.pipeline/containment-floor.json`, and the new ledger deliberately does
  **not** carry them.
- **Story 4/5 (hook-authored events) versus every other telemetry story.** `emit-intra-step-build-progress-and-stall-as-events`,
  `staleness-decisions-invisible-in-daemon-log`, `otel-observability`, and
  `wave-c-json-stdout-subscriber` all consume the `ConductorEvent` union and read named fields; an
  additive variant on a separate single-writer file is invisible to them until they opt in. No
  contention on `.pipeline/events.jsonl`, which Story 5 explicitly asserts is left byte-unchanged.
- **Story 6 (config default) versus TI-7's report-only default.** Both hold the shipped default at
  `false`. Agreement, not conflict — only the key's *meaning* changes, which CF-2's amendment records.
- **Sequencing.** No story assumes it runs first, and no circular dependency exists. Stories 1–3 are
  independently implementable; 4 and 5 share the ledger and are ordered by it; 6 is independent.

---

## Re-check

After the five amendments (TI-2, TI-3, TI-4, TI-6, TI-7), the pair-wise scan was repeated over the
same set. **Zero blocking conflicts remain.** CF-4 stands as an accepted non-blocking rebase item.

## Carried into the plan

1. TI-6's regression fixture must place its out-of-floor path outside the declared directory, or the
   widened floor makes the test stop discriminating (from CF-1).
2. The "enforcement flip" comments in `scope-check-cli.ts` (lines 17-20, 48-51) and in the generated
   `COMMIT_MSG_HOOK` must be corrected in the same diff (from CF-2).
3. Whichever of this feature and PR #1395 lands second rebases `src/conductor/src/types/events.ts`
   (from CF-4).

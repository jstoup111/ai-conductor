# Conflict Check: Clean rubric judgements rejected as invalid-provider-result

**Date:** 2026-08-19
**Issue:** #1683
**Stories scanned:** all 12 in `.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md`,
plus the 13 in `.docs/stories/review-infrastructure-failures-are-operator-unreco.md` (the in-flight
merged-but-unbuilt sibling touching the same seam)
**ADR corpus:** `repo_wide` (per `.ai-conductor/config.yml:101`)
**Result:** PASSED — 3 blocking conflicts found and resolved, 1 degrading conflict accepted

## ADR corpus: examined and narrowed out

All 500 files under `.docs/decisions/` were enumerated and searched for subject overlap with these
stories. **Examined in full** (subject overlaps build_review rubric contracts, provider result
validation, lap/snapshot identity, finding identity, infrastructure-failure classification, retry
routing, or the event spine):

`adr-2026-08-13-engine-managed-build-review-rubric-branches` (partially amended — retained),
`adr-2026-08-13-stable-build-review-finding-dispositions`,
`adr-2026-08-16-closed-build-review-finding-vocabularies`,
`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`,
`adr-2026-08-18-content-anchored-finding-reference-schema`,
`adr-2026-08-17-build-review-rubric-repetition-short-circuit`,
`adr-2026-08-17-framework-agnostic-tautology-scoped-run`,
`adr-2026-08-19-unretryable-step-runner-failures-route-by-kind`,
`adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`,
`adr-2026-07-13-retry-classify-rerun-vs-route`,
`adr-2026-07-23-build-review-fresh-base-disposition`,
`adr-2026-08-12-cumulative-build-review-convergence-bound`,
`adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`,
`adr-2026-07-26-event-sink-registry-exhaustiveness`,
`adr-2026-08-11-halt-events-ride-the-persisted-spine`,
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`,
`adr-2026-08-15-verify-only-anchored-tautology-exemption`,
`adr-2026-08-16-preservation-anchored-completeness-exemption`,
`adr-2026-08-12-removal-anchored-tautology-exemption`,
`adr-2026-08-14-retire-build-review-wiring-rubric`,
`adr-2026-08-03-build-repair-member-reuse-validity`,
`adr-2026-07-28-total-halt-classification-legacy-boundary`,
`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`,
`adr-2026-07-21-demote-task-stamping-to-telemetry`,
`adr-2026-07-03-dependency-fail-closed-and-cache`,
and the new `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope`.

**Retained despite partial supersession** (their remaining decisions can still conflict):
`adr-2026-07-21-completeness-as-build-review-rubric`,
`adr-2026-08-11-wiring-judged-in-build-review`,
`adr-2026-07-25-content-addressed-full-suite-proof`.

**Excluded as unambiguously fully superseded:** `adr-2026-07-07-build-review-judgement-gate`
(superseded in full by `adr-2026-08-13-engine-managed-build-review-rubric-branches`).

**Narrowed out — no subject overlap** (clusters, enumerated rather than listed individually):
the numbered legacy `001`–`005` and `adr-001`–`adr-015` harness-architecture set; the
`adr-2026-06-*` and early `adr-2026-07-0[1-6]-*` engineer-loop, daemon-liveness, park, OTel, owner-gate
and PR-labelling set; the intake/claim/dedup/priority cluster; the Codex/provider-readiness and
auth-park cluster; the commit-attribution and evidence-stamp cluster; the finish/publication/release
cluster; the protected-artifact seal/reseal cluster; the live-smoke and e2e-tier cluster; the
migration and version-gate cluster; the worktree-lifecycle cluster; the docs-site, model-table and
config-scaffolder cluster; and the ~150 `architecture-review-*` reports other than the six covering
the build_review rubric work.

---

## Conflict 1: Two stories disagree about the same plan-task reference

**Stories involved:** Story 8 (non-canonical anchor named) vs Story 9 (titled reference normalizes)
**Files:** both in `.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md`
**Type:** contradiction
**Severity:** blocking

**Description:** Story 9 requires `Task 7: The resolved channel and its source are confirmed in the
output` to be normalized to plan task `7` and accepted. Story 8, as originally written, required
that same string to produce a rejection diagnosis. Fully satisfying Story 9 makes Story 8's Done
When test fail, and fully satisfying Story 8 makes Story 9's happy path unreachable — both
directions fail, so this was not merely an overlap.

**Resolution Options:**
1. Story 8 uses an example that stays non-canonical after normalization; Story 9 keeps the titled form.
2. Story 9 normalizes only in the diagnosis, not in the parser — reference stays rejected.
3. Introduce a configuration flag selecting strict or lenient reference parsing.

**Recommendation and applied resolution:** Option 1. Option 2 abandons the parser-authoritative
decision the operator selected and leaves every other caller that hand-writes an anchor broken.
Option 3 adds a switch nobody asked for and doubles the tested surface. Story 8's happy path and
Done When now cite free prose with no recoverable task id, and Story 8's Done When states
explicitly that the `Task N: <title>` form is Story 9's case and must not reject.

---

## Conflict 2: A new failure reason would collide with a closed vocabulary another feature owns

**Stories involved:** Story 1 vs `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
**Files:** `.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md` vs
`.docs/decisions/adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md`
**Type:** resource-contention
**Severity:** blocking
**ADR filename stem:** adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane
**Story ID:** 1
**ADR opposing sentence (verbatim):** "The mapping is total and closed at the type level; an unmapped branch reason is a contract defect caught at authoring time, never silently coerced."
**Story opposing sentence (verbatim):** "Given a provider response containing no parseable JSON object at all, when validation runs, then the branch settles as an infrastructure failure whose recorded reason names the parse failure, and the engine does not fabricate an empty findings array."

**Description:** The story's phrasing requires the *reason* to name the parse failure. The reason is
a member of a closed vocabulary whose total mapping is owned by the in-flight
`review-infrastructure-failures-are-operator-unreco` feature. Two features adding members to the
same closed union, each believing its mapping is total, produces exactly the authoring-time contract
defect that ADR is designed to catch — and whichever lands second fails.

**Resolution Options:**
1. Deliver the outcome through the diagnostic detail; add no vocabulary member here.
2. Add the members here and require the other feature to rebase onto them.
3. Block this feature until the other one ships.

**Recommendation and applied resolution:** Option 1. It satisfies the issue's outcome — the operator
learns which requirement failed — without touching the union, and it matches
`adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` D8, which already states that this
feature reduces that mapping's inputs rather than implementing it. Option 2 forces rework on an
approved in-flight plan. Option 3 leaves a terminal halt unfixed for no gain, since the vocabulary
is not what makes the halt terminal. Story 1's negative path and Done When now state that the
detail carries the failed requirement and that no member is added to the closed vocabulary.

---

## Conflict 3: "Allowance" names a mechanism that does not exist yet

**Stories involved:** Story 11 vs `review-infrastructure-failures-are-operator-unreco`
**Files:** `.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md` vs
`.docs/plans/review-infrastructure-failures-are-operator-unreco.md`
**Type:** resource-contention
**Severity:** blocking

**Description:** Story 11 originally said a byte-identical repair "does not consume the remaining
allowance". The mechanical allowance is a ledger field that feature introduces and that does not
exist at this merge base, so the story could only be implemented by building that feature's seam.
What actually drained on 2026-08-19 was the ordinary step retry counter, which reported `step
'build_review' failed in auto mode (retries exhausted)` after three attempts.

**Resolution Options:**
1. Story 11 names the existing step retry budget and stays out of the other feature's vocabulary.
2. Story 11 declares a hard dependency and waits for the allowance to exist.
3. This feature builds the allowance.

**Recommendation and applied resolution:** Option 1. The recorded failure is a step-retry
exhaustion, so naming that counter is also the more accurate story. Options 2 and 3 both couple two
independently shippable features for no behavioral gain. Story 11's title, narrative, criteria and
Done When now name the step retry budget and state explicitly that the mechanical allowance belongs
to the other feature.

---

## Conflict 4: Version override and version preservation must not share code (accepted)

**Stories involved:** Story 3 vs Story 5
**Files:** both in `.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md`
**Type:** overlap
**Severity:** degrading — accepted

**Description:** Story 3 requires a provider-supplied `contractVersion: "v1"` to be ignored and the
engine's `v3` stamped instead. Story 5 requires a persisted `v1` record to keep parsing as `v1`.
Both hold, and neither needs changing — but only if the stamp is applied on the live dispatch path.
Applying it inside the shared parse function used for stored artifacts and cache entries would
satisfy Story 3 while silently rewriting the version of every record read from disk, corrupting
Story 5. The stories do not conflict; their implementations can.

**Resolution Options:**
1. Record the placement as an implementation constraint carried into the plan.
2. Split the parse function into two named entry points during this feature.
3. Change Story 3 to leave a provider-supplied version alone.

**Recommendation and applied resolution:** Option 1, accepted as a degrading conflict. Option 2 is a
plausible implementation of Option 1 and is left to `/plan` rather than mandated here. Option 3
reintroduces a provider-supplied field as load-bearing, which is the defect this feature removes.

**Constraint carried into the plan:** the engine's `contractVersion` stamp is applied on the live
dispatch path only. The at-rest parse for stored branch artifacts and cache entries continues to
honour the version each record declares, and no task may place the stamp in code shared by both.

---

## Adjacent work assessed, no conflict

- **#1688 — zero-token opus rubric results burn the kickback budget.** Complementary. Story 11's
  guard triggers on a byte-identical repair; a zero-token result produces no output at all and falls
  to Story 11's third negative path, which preserves the existing behaviour unchanged. Neither story
  changes kickback accounting, which is #1688's and the mechanical-fault lane's territory.
- **#1657 — rubric judgments re-bought each remediation lap.** Complementary and mildly helpful.
  Story 5 requires cache identity to be unchanged and pre-change entries to remain servable, so this
  feature spends no re-judge lap and does not enlarge the problem #1657 addresses.
- **`adr-2026-08-17-build-review-rubric-repetition-short-circuit` D3.** Every failure these stories
  produce settles on the infrastructure side, so the semantic-churn tally is not ticked. Checked in
  both directions: satisfying D3 leaves every story intact, and satisfying the stories leaves D3's
  exclusion intact.
- **`adr-2026-08-18-content-anchored-finding-reference-schema`.** Story 9 normalizes into the
  existing plan-task reference kind and produces a byte-identical identity, so the closed three-kind
  schema is unchanged and no supersession is owed. Grounded in
  `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` D9.
- **`adr-2026-08-13-stable-build-review-finding-dispositions` §1.** Story 9's third negative path
  explicitly preserves the duplicate-identity rejection rule rather than relaxing it under
  normalization.
- **The `adr-2026-08-13` §2 echo requirement** was a genuine contradiction with Stories 1–3. It was
  resolved before this check, by the operator-approved amendment recorded in that ADR and in
  `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope`. It is noted here for completeness,
  not re-litigated.

## Re-check

Re-run after applying the three story edits: **zero blocking conflicts remain.** One degrading
conflict (Conflict 4) is accepted with its constraint recorded for `/plan`.

# Conflict Check: Stale manual_test discovered at FINISH is unroutable

**Date:** 2026-08-16
**Feature:** ai-conductor#1613 — technical track, Tier M
**Stories scanned:** `.docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md` (Stories 1–5)
**ADR corpus scope:** `repo_wide` (`.ai-conductor/config.yml:93`)
**Result:** 4 blocking conflicts found against the first design, all resolved by redesigning to the
mechanism an APPROVED ADR already mandates; 1 degrading conflict accepted. Re-check clean.

---

## How this check changed the feature

The first design routed invalid SHIP evidence back to BUILD via `implementation_invalid`, on the
strength of `adr-2026-08-01-engine-owned-resumable-finish-publication` D5. The repo-wide sweep found
that four APPROVED decisions oppose that design and that a fifth already mandates a different
mechanism which exists in the tree, disabled. The design was replaced rather than patched. Conflicts
1–4 are recorded against the withdrawn design because they are the reason the current one exists.

---

## Conflict 1: An APPROVED ADR already mandates a fence the design ignored

**Stories involved:** withdrawn Story 5 ("retire the predecessor fence") vs the governing ADR
**Files:** `.docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md` vs
`.docs/decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-26-rebase-tail-current-branch-before-publication
**Story ID:** Story 5
**ADR opposing sentence (verbatim):** "Immediately before any `finish` dispatch or publication side
effect, the engine resolves validation membership with the existing tier, track, upstream-skip,
bootstrap-mode, and configuration predicates. […] A `failed`, `stale`, pending, or objectively
incomplete member is non-green even when an older artifact remains on disk."
**Story opposing sentence (verbatim):** "Given the repository after this change, when a reader looks
for what re-runs SHIP validators, then the disabled predecessor fence is either removed or carries
an explicit note that it is superseded and must not be re-enabled."

**Description:** The withdrawn story proposed retiring `nonGreenFinishValidators`. That method *is*
this ADR's implementation, and the ADR is APPROVED. Retiring it would have converted an accidental
regression into a deliberate, documented violation — and removed the mechanism that prevents both
observed occurrences of the defect being fixed.

**Resolution Options:**
1. Restore the fence by removing the `this.finishPublication ||` disjunct at `conductor.ts:1609`.
2. Supersede `adr-2026-07-26` with a new decision that the coordinator replaces the fence.
3. Leave the fence disabled and compensate inside the coordinator (the withdrawn design).

**Recommendation:** Option 1 — it is the smallest change, it restores conformance, and the
mechanism is already written and tested.

**Resolution applied:** Option 1. The feature was redesigned around restoring the fence.

---

## Conflict 2: Routing to BUILD is a guaranteed no-op the engine is forbidden to take

**Stories involved:** withdrawn Story 1 ("invalid SHIP evidence routes to BUILD") vs the no-op guard
**Files:** `.docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md` vs
`.docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-13-kickback-build-no-op-escalation
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "If build is **already satisfied** […] the engine must not
route into a guaranteed no-op. Return a HALT outcome carrying the gap ledger […]"
**Story opposing sentence (verbatim):** "Given a run whose `manual_test` status is `stale` and whose
every other gate is green, when FINISH observes ship evidence and reports it invalid, then the run
routes back to BUILD carrying that evidence and does not write a HALT."

**Description:** A stale SHIP validator over a complete BUILD is exactly the "already satisfied"
shape. The withdrawn design would have routed into a BUILD with no dispatchable work every time.

**Resolution Options:**
1. Redirect to the earliest non-green validator, as `adr-2026-07-26` decision 5 specifies.
2. Add a no-op detection carve-out for this route.

**Recommendation:** Option 1 — the correct target was already decided; Option 2 adds machinery to
work around taking the wrong one.

**Resolution applied:** Option 1, via the redesign. ADR D2 records that
`adr-2026-08-01` D5's SHIP clause is deliberately left unimplemented, and why.

---

## Conflict 3: Unconditional verdict invalidation contradicts preserve-when-unchanged

**Stories involved:** withdrawn Story 2 ("invalidate the gate verdict") vs two invalidation ADRs
**Files:** `.docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md` vs
`.docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-22-gate-evidence-code-validity-on-redispatch
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "**Preserve a judged-gate verdict across re-dispatch when, and
only when, the code under that gate's declared surface is unchanged since the verdict was recorded**"
**Story opposing sentence (verbatim):** "Given a validator targeted by the route, when the route
completes its state changes, then that validator's persisted gate verdict no longer records
satisfied."

**Description:** The withdrawn design invalidated verdicts unconditionally.
`adr-2026-07-20-post-rebase-delta-aware-invalidation` says the same thing from the rebase side:
"**Preservation** = leave the gate's state `done`; do **not** write a `satisfied:false` kickback".
Unconditional invalidation is also what would have made the loop oscillate on every tail commit.

**Resolution Options:**
1. Recompute each verdict and stale only what comes back non-green — what the fence already does.
2. Carve this route out of both ADRs' preservation rules.

**Recommendation:** Option 1.

**Resolution applied:** Option 1. ADR D3 records that the fence's `computeAndWriteVerdict` per
member is the required behavior, and Story 3 pins it.

---

## Conflict 4: Deleting the test_suite evidence artifact would not have forced a re-run

**Stories involved:** withdrawn Story 2 vs the content-addressed proof
**Files:** `.docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md` vs
`.docs/decisions/adr-2026-07-25-content-addressed-full-suite-proof.md`
**Type:** state-conflict
**Severity:** blocking
**ADR filename stem:** adr-2026-07-25-content-addressed-full-suite-proof
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "The verifier may immediately preserve it when content is
identical; a changed fingerprint causes execution before the validation group is allowed to run
again."
**Story opposing sentence (verbatim):** "Given `test_suite` targeted by the route, when the route
completes its state changes, then its evidence artifact is no longer present to satisfy the next
completion check."

**Description:** `test_suite` reuse identity is the content fingerprint, not the artifact's
presence. Deleting the file would have been an ineffective no-op dressed as a fix — the withdrawn
design's central mechanism for its second observed occurrence.

**Resolution Options:**
1. Drop artifact deletion entirely and let the fingerprint decide, as the ADR intends.
2. Change the reuse identity to include artifact presence.

**Recommendation:** Option 1 — Option 2 would break the ADR's whole point.

**Resolution applied:** Option 1. The redesign deletes no evidence artifact; Story 3 asserts that
explicitly.

---

## Conflict 5: Restoring the fence redirects runs that previously dispatched FINISH

**Stories involved:** Story 1 vs the existing SHIP-tail behavior
**Files:** `.docs/stories/stale-manual-test-discovered-at-finish-is-unroutab.md` vs
`.docs/decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md`
**Type:** behavioral overlap
**Severity:** degrading

**Description:** With the fence live, a run whose validator is quietly non-green is redirected
rather than dispatched into FINISH. That is the ADR's intent, but it is a behavior change for every
in-flight feature, and some will surface latent non-green validators as new kickbacks the operator
has not seen since 2026-08-04.

**Resolution Options:**
1. Accept it — this is the decision's intent, and the per-gate cap bounds any run that cannot go
   green.
2. Gate the restoration behind a config key.

**Recommendation:** Option 1 — Option 2 reintroduces the "fence optionally on" state that caused
the defect.

**Resolution applied:** Option 1, accepted as a degrading compromise and recorded as a review risk
to watch on the first live features through the tail.

---

## Pairs examined and found clean

All ten current story pairs were tested in both directions ("if A is fully satisfied, does B still
hold?").

| Pair | Both-direction result |
|---|---|
| S1 × S2 | Clean — S1 redirects, S2 requires the redirect to complete unattended; complementary |
| S1 × S3 | Clean — S3 constrains *how* S1's fence judges a member, and both are satisfied by recomputation |
| S1 × S4 | Clean — S4 governs the router, which S1 makes unreachable for the routine case but does not alter |
| S1 × S5 | Clean — S5 pins the condition S1 depends on |
| S2 × S3 | Clean — S3's preservation is what stops S2's unattended resume from looping |
| S2 × S4 | Clean — no shared behavior, entity, field, or gate |
| S2 × S5 | Clean — no shared surface |
| S3 × S4 | Clean — disjoint code |
| S3 × S5 | Clean — S5 pins the fence active, S3 pins how it judges |
| S4 × S5 | Clean — both are anti-regression requirements over disjoint code |

## ADR corpus — examined and narrowed out

`.docs/decisions/` holds **278** `adr-*.md` (plus this feature's own): **253** declare APPROVED, **25**
SUPERSEDED. Per the `repo_wide` rules, supersession was parsed at this scope: **22** were excluded as
unambiguously fully superseded, and **5** were retained because their status declares partial or
amended supersession — `adr-001-rebase-insertion-mechanism` (explicit retention clause),
`adr-2026-07-12-wiring-check-gate` and `adr-2026-07-25-content-addressed-full-suite-proof` ("in
part"), `adr-2026-07-21-completeness-as-build-review-rubric` (still APPROVED), and
`adr-2026-07-11-verdict-aware-resume-entry` (amended, not superseded). In-scope corpus: **256**.

**51** were narrowed in as subject-overlapping — FINISH and publication dispositions; kickback
routing, caps and budgets; gate verdicts and gate invalidation; evidence staleness and fingerprints;
the SHIP validators; rebase-driven invalidation; step-status semantics; resume entry; HALT classes
and re-kick. The remaining **205** were narrowed out as subject-disjoint, grouped as: engineer /
registry / memory / intake / platform (39); daemon lifecycle, park, ownership and scheduling (36);
park and worktree lifecycle (9); attribution and evidence stamping (14); BUILD-side floors,
contracts and plan scope (14); build_review rubrics and tautology exemptions (6); provider, auth,
cost and model policy (23); release, versioning, PR sweeps and CI-fix plumbing (16); protected
artifacts, seals and reseal (8); smoke, live tier, examples and docs site (11); ADR, coherence,
config and telemetry infrastructure (24); remaining infrastructure (5).

Two borderline calls are recorded rather than hidden: `adr-2026-07-25-fail-closed-durable-shipment-evidence`
was narrowed out (it governs shipped-record durability, not evidence routing) despite being named as
preserved by `adr-2026-08-01`; and `adr-2026-08-13-markdown-default-inversion` was narrowed out
despite amending the rebase delta classifier, because it governs which paths count as code rather
than gate-invalidation semantics.

Among the 51 narrowed in, the load-bearing results are Conflicts 1-4 above, plus:

| ADR stem | Result |
|---|---|
| `adr-2026-08-01-engine-owned-resumable-finish-publication` | Partially unimplemented **by decision**. Its D5 says invalid BUILD *or SHIP* evidence routes to BUILD; Conflict 2 shows that is unsafe for the SHIP half. Recorded in the new ADR's D2 rather than silently skipped. |
| `adr-2026-08-03-build-repair-member-reuse-validity` | Clean, and reinforcing: it cites this fence as live precedent for its own decision, so leaving the fence disabled erodes a second APPROVED ADR's stated basis. |
| `adr-2026-07-06-manual-test-fail-routing` | Clean — its deterministic manual_test→build route is for FAIL rows, a different trigger from a stale verdict, and the fence preserves its whitewash guard. |
| `adr-2026-07-10-validation-group-join` | Clean — the fence redirects into the group, which reruns concurrently exactly as the join specifies. |
| `adr-2026-07-11-verdict-aware-resume-entry` | Clean, and explanatory: it already anticipates this fence, noting "the later #922 finish publication fence may redirect an explicitly targeted finish". |
| `adr-2026-07-28-total-halt-classification-legacy-boundary` | Clean — the cap-exhaustion halt stays `needs-human`, the required default. |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` | Clean under the new design. The redirect is an ordinary `finish` kickback under the existing cap, and because verdicts are preserved when surfaces are unchanged the loop converges without relying on it. Under the *withdrawn* design this was blocking, since the ledger resets on tree movement and the tail moves the tree every lap. |
| Remaining 40 narrowed-in stems | No opposing sentence found against any story. |

# Conflict Check: Equivalent re-worded findings escape their accepted dispositions

**Date:** 2026-08-16
**Feature:** ai-conductor#1611 — technical track, Tier M
**Stories scanned:** `.docs/stories/equivalent-re-worded-findings-escape-their-accepte.md` (Stories 1–6)
**ADR corpus scope:** `repo_wide` (`.ai-conductor/config.yml`) — all 479 files in `.docs/decisions/`
swept across eight bands
**Result:** 3 blocking conflicts found against the first design, all resolved by redesigning to the
mechanism an APPROVED ADR already mandates; 2 blocking conflicts found against the second design and
resolved by changing its mechanism; 2 constraints accepted into the design; 1 raised conflict
dismissed on evidence. Re-check clean.

---

## How this check changed the feature

The first design kept the exact canonical id as a fast path and added a bounded LLM equivalence
judgement with persisted alias records. The repo-wide sweep found that
`adr-2026-08-13-stable-build-review-finding-dispositions` (APPROVED) had already decided this exact
question the other way, and that the tolerant matcher was its **rejected Option B**. The design was
replaced rather than patched. A second sweep against the replacement found two further blocking
conflicts, which changed the version-migration story and the shape of the routing fix. Conflicts 1–5
are recorded against withdrawn designs because they are the reason the current one exists.

---

## Conflict 1: An APPROVED ADR already decided that matching is deterministic

**Stories involved:** withdrawn Story ("bind an accepted disposition to a re-worded finding by
bounded LLM judgement") vs the governing ADR
**Files:** `.docs/stories/equivalent-re-worded-findings-escape-their-accepte.md` vs
`.docs/decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-13-stable-build-review-finding-dispositions
**Story ID:** withdrawn tolerant-matching story
**ADR opposing sentence (verbatim):** "The LLM judges what concern and anchors apply as part of
rubric evaluation. Everything after that judgement — schema validation, canonicalization, ID
creation, collision handling, and matching — is deterministic."
**Story opposing sentence (verbatim):** "when a current finding has no exact match, a bounded
schema-constrained equivalence judgement decides whether it is the same substance as an accepted
disposition."

**Description:** The withdrawn story placed an LLM exactly where the ADR reserves determinism. Worse,
the ADR's own Option B — "Hash normalized finding prose" — was rejected for the failure the withdrawn
design would have reintroduced: "aggressive normalization risks collapsing materially different
concerns; cannot satisfy both persistence and narrowness." The tolerant matcher was not an unexplored
branch of the design space; it was the branch this repository already declined.

**Resolution Options:**
1. Implement the enumeration the same ADR already mandates, making drift impossible mechanically.
2. Supersede the ADR's determinism clause with a new ADR.
3. Abandon the feature.

**Resolution:** Option 1, operator-confirmed 2026-08-16. Option 2 was put to the operator explicitly
and declined. It was the weaker case anyway:
`adr-2026-07-21-demote-task-stamping-to-telemetry` (APPROVED) records that this repository already
built and then removed a bounded engine-embedded LLM judge for the same brittle-id-matching problem —
"the durable fix for a machinery class that keeps failing is removal of the failing machinery, not
another guard."

---

## Conflict 2: The unimplemented half of the same ADR is the actual defect

**Stories involved:** Story 1 vs the shipped rubric contracts
**Files:** `.docs/decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md` vs
`skills/build-review-{scope,tautology,root-cause,completeness}/SKILL.md` and
`src/conductor/src/engine/build-review-domain.ts`
**Type:** contradiction (contract vs implementation)
**Severity:** blocking
**ADR filename stem:** adr-2026-08-13-stable-build-review-finding-dispositions
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "an enumerated concern kind owned by that rubric contract"
**Implementation opposing sentence (verbatim):** `renderBuildReviewJudgedResultShape` emits
`"findings": [{"concernKind": "<string>", ...`

**Description:** All four rubric contracts promise "an enumerated concern kind in a `concernKind`
field" and enumerate nothing; the engine types it `string`, validates it as "a non-empty string", and
tells the grader to send `<string>`. The shipped contract contradicts itself in four places. This is
not a conflict between stories — it is the conflict between an approved decision and its
implementation that produced #1611.

**Resolution:** Close the vocabularies (Story 1) and bind the four contracts to one engine source
with an integrity check (Story 6). Per
`architecture-review-2026-07-10-stale-engine-residuals-369` (APPROVED), closing a gap between an
approved decision and its implementation is drift repair and needs "no new ADR and no supersession" —
the new ADR here records the vocabulary design and the declined alternatives, not a supersession.

---

## Conflict 3: A strict engine bar on an unrendered vocabulary auto-parks daemon builds

**Stories involved:** Story 3 vs the arming precedent
**Files:** `.docs/stories/equivalent-re-worded-findings-escape-their-accepte.md` vs
`.docs/decisions/adr-2026-07-07-task-trailer-id-alias.md` and
`.docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-07-task-trailer-id-alias
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "The evidence bar exists to prevent *false* attribution, not to
reject *unambiguous* attribution over a spelling prefix."
**Story opposing sentence (verbatim, withdrawn form):** "a value outside the closed set is rejected
and the rubric settles as an infrastructure failure."

**Description:** Both ADRs record the same production failure: an engine exact-match bar applied to a
vocabulary declared only in skill prose auto-parked every daemon build (#417), and five of six builds
parked because an agent wrote `**Type:** verification` instead of the literal `**Verify-only:** yes`.
The approved remedy in both cases was to widen or normalize, never to tighten the bar.

**Resolution:** Accepted into the design as three changes rather than one, operator-confirmed
2026-08-16:
1. The vocabulary is **rendered into the dispatch schema** the engine already sends every grader — the
   specific difference from the auto-park precedent, where the model was never shown the vocabulary.
2. **Ambiguity-guarded normalization** ahead of validation. Measured over `.daemon/evals-raw`: 82 raw
   distinct `concernKind` values reduce to 70 under lowercase + `_`→`-`, so 12 spelling pairs become
   hits rather than rejections.
3. A surviving rejection classifies **`absent` → rerun**, not a FAIL verdict, per
   `adr-2026-07-13-retry-classify-rerun-vs-route`'s existing build_review mapping. No lap is burned.

Staged arming (report-only first, per `adr-2026-08-02-plan-scope-containment-at-commit-boundary`) was
offered to the operator as the alternative and declined, on the grounds that it leaves the filed
drift live through the observation window and splits the fix in two.

---

## Conflict 4: The version bump's shape contradicted the invalidation precedents

**Stories involved:** withdrawn Story ("existing dispositions are invalidated by the bump") vs the
lifecycle ADRs
**Files:** `.docs/decisions/adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md` and
`.docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md`
**Type:** contradiction
**Severity:** blocking (against the withdrawn form)
**ADR filename stem:** adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance
**Story ID:** withdrawn invalidation story
**ADR opposing sentence (verbatim):** "Backward compatibility is re-run, never grandfathering and
never a hard fail."
**Story opposing sentence (verbatim, withdrawn form):** "existing accepted dispositions stop binding
and are discarded."

**Description:** The withdrawn form silently voided operator decisions that were correct under their
own contract, which both ADRs forbid — `adr-2026-07-12-rebase-evidence-stamp-translation` requires
stale anchors be translated or written to a residue ledger and emitted as a structured event, "never
a silent dangle". A stricter reading also surfaced a cascade: an accepted finding returning as a raw
FAIL kicks back to `build`, `build` has nothing to fix, and
`adr-2026-07-13-kickback-build-no-op-escalation` then HALTs fail-closed on the unchanged verdict.

**Resolution:** The conflict is **not engaged**, on evidence gathered after it was raised. Contract
`v1` never went live (operator, 2026-08-16), and no live disposition store exists: every
`build-review-dispositions.json` on disk is a snapshot under `.daemon/evals-raw/`, the research
corpus. There is no correct-under-its-contract operator decision to preserve, so translation
machinery would guard nothing and the no-op HALT cascade has no feature to strand. Two guards were
kept anyway because they cost almost nothing and the reasoning is what a future reader needs: the
version parser accepts both contract versions so a stale local store never reads as malformed
(Story 5), and any superseded-version record encountered is reported on the event spine rather than
silently discarded (Story 5, D7).

---

## Conflict 5: The routing fix hoisted in the direction two ADRs moved away from

**Stories involved:** Story 4 vs the read-adjacency precedents
**Files:** `.docs/decisions/adr-2026-07-12-judged-attribution-verdict-persistence.md` and
`.docs/decisions/adr-2026-07-13-park-all-dispatch-paths.md`
**Type:** contradiction
**Severity:** blocking (against the withdrawn form)
**ADR filename stem:** adr-2026-07-13-park-all-dispatch-paths
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "The **store** is not the hole. … The hole is WHERE the
predicate is consulted (selection, not dispatch)."
**Story opposing sentence (verbatim, withdrawn form):** "one effective resolution is computed at the
top of the FAIL block and every exit below reads it."

**Description:** Both ADRs fixed this defect class by moving a read *later, adjacent to the decision*,
and `adr-2026-07-13-park-all-dispatch-paths` explicitly demoted its early check to "a cheap early
filter … no longer the last word." A single top-of-block resolution makes the early read the only
read, across exits that mutate in between — `consumeKickbackBudget` mutates, and the `/remediate`
planner takes minutes. That is the very window #1605's guard was written to close, reopened one level
up.

**Resolution:** One pure predicate consulted **at each exit**, not one early resolution shared by all
of them (ADR D6). Coverage is unchanged — all seven exits, which is what the operator selected — and
the exit set is derived by grep at implementation time rather than from the six enumerated by hand.

---

## Constraint 1 (accepted, not a conflict): ordering and HALT-reason distinctness

`adr-2026-07-27-daemon-decide-kickback-halt` (APPROVED) fixes "Ordering: cap first, phase second …
so a daemon run that trips the cap still reports the *ping-pong* reason rather than being masked by
the phase reason", and `adr-2026-06-30-halt-based-release-gates` requires each gate to emit "a
**distinct** HALT reason". Story 4 supplies each existing exit with better input in place and
reorders nothing; its acceptance criteria assert cap-first ordering and reason distinctness directly.

`adr-2026-08-12-cumulative-build-review-convergence-bound`'s "no LLM is in the bound's decision path"
and its unconditional increment "on every kickback consumed" are satisfied by construction: no LLM
exists anywhere in this design, and a lap resolved to effective PASS consumes no kickback at all.

---

## Constraint 2 (accepted, not a conflict): one vocabulary source

`adr-2026-07-03-generated-model-table-single-source` (APPROVED) holds that "the standing rule 'when
you change one, change all three' is a drift hazard." Five hand-maintained copies of a vocabulary —
the engine plus four SKILL.md files — is that shape exactly. Story 6 makes the engine the single
source and binds the four contracts to it with an integrity check, following check 5b's precedent for
the model-selection table.

---

## Dismissed on evidence: "the classification anchors are not classifications"

The sweep argued that `anchor.relation` (160 uses, 50 distinct) and `anchor.violationKind` (102 uses,
40 distinct) are prose rather than classifications, and recommended excluding them from the closure.
Inspecting the values rather than the counts overturns it: `violationKind`'s 40 spellings collapse to
roughly four concepts (`assertion-cannot-fail`, `assertion-holds-on-merge-base`,
`assertion-over-test-local-construct`, `assertion-passes-against-reverted-production`), and
`relation`'s 50 to roughly three — including eight spellings of a single idea, "not authorized by the
approved plan, repair context, accepted widenings, or operator reseals". Low reuse measures how
freely graders invent wording for a fixed concept set; it is the argument for closing the vocabulary,
not against it. What the data does establish is that out-of-vocabulary emissions will be common at
first, which is why Conflict 3's three-part resolution is load-bearing rather than defensive.

---

## Same-layer story-vs-story sweep

All 15 story pairs were checked for contradiction, overlap, state conflict, resource contention, and
oscillation. Two pairs are worth recording:

- **Story 1 ↔ Story 2** is the feature's central tension: Story 1 wants re-wordings to bind, Story 2
  wants different concerns to stay distinct. They are jointly satisfiable only because the
  classification member survives in the identity while the prose subjects leave it. Under the
  rejected structural-only hypothesis they would be mutually exclusive, and under Conflict 1's
  withdrawn design they would trade off probabilistically. Not a conflict; the resolution is the
  design.
- **Story 3 ↔ Story 4** could contend over kickback accounting — Story 3 requires a contract
  violation to consume no budget, Story 4 requires a lap resolved to effective PASS to consume none
  either. Both reach the same ledger and neither increments it, so they compose. Story 4's criteria
  pin that an unresolved finding still consumes budget exactly as today, which is what keeps the two
  exemptions from widening into a general one.

No oscillating pair found: no story requires a state another story forbids across laps.

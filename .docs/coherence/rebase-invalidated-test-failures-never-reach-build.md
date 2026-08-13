# Coherence: Durable base-advance attribution for build_review repair context (#1535)

**Date:** 2026-08-13
**Tier:** M (`.docs/complexity/rebase-invalidated-test-failures-never-reach-build.md`) — session
default model, no opus pin.
**Track:** technical — the `fr` row class is omitted as not applicable (no PRD, no enumerated
`FR-N`; acceptance criteria live in the stories).
**Outcome source:** `.pipeline/intake-outcomes.md`, 5 bullets, verbatim from
jstoup111/ai-conductor#1535's Desired-outcome section. Staged by hand because
`engineer worktree --source-ref` had no claim record to resolve — this feature entered by issue
number rather than through `engineer claim`, and `stageIntakeOutcomes` no-ops without a claim body.
**ADR row pool:** the three non-deleted `.docs/decisions/adr-*.md` files in the current change set —
the two authored here plus `adr-2026-07-20-post-rebase-delta-aware-invalidation.md`, whose Context
section this change set amends. An earlier draft of this artifact excluded the amended ADR on the
reasoning that amending a pre-existing decision is not "authoring" one. That reasoning was wrong and
the land-time gate rejected it: the pool is every non-deleted `adr-*` path **in the change set**,
and an amendment puts the file in the diff exactly as authoring it would. The rule is mechanical,
not intent-based — which is correct, since an amended ADR is precisely the case where a reader most
needs to see which stories the changed text now binds.
**Consistency pass (§4d):** run over every covered row across the outcome↔task, outcome↔story,
ADR↔story, and story↔task layer pairs. No contradiction and no oscillation found. The three
cross-layer tensions that existed were resolved during conflict-check and are noted on the affected
rows.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-4, story-7 | covered | "build_review can tell that repair apart from unplanned change." story-4 creates a repair record only on a real advance/failure overlap; story-7 requires that record be rendered to the grader as evidence it weighs. Both confirmed in the stories file. |
| outcome | outcome-2 | story-2, story-3, story-4, story-5 | covered | "Attributed regardless of which gate observes the failure first." story-5 is the direct answer (gate-agnostic recorder, observing gate named on the record). story-4 supplies the join, story-2 the complete path set the join reads, story-3 the classifier fix without which the originating incident's own path is invisible to it. |
| outcome | outcome-3 | story-1, story-5, story-8 | covered | "Reflects every recorded repair; empty means no base advance invalidated anything." story-5 removes the one-record-per-advance cap so several repairs accrue; story-1 makes the records durable across gate re-runs; story-8 forbids fabricating a record from a legacy ledger. See the residual note below the table — the "empty means nothing was invalidated" reading is delivered to the limit of a deterministic join, and story-6 makes the remaining case observable rather than silent. |
| outcome | outcome-4 | story-4, story-7 | covered | "A genuinely unplanned deletion is still flagged." story-4's negative paths require no record when the diagnostic names an unrelated path, names no path, or precedes the advance; story-7 keeps a record from acting as an exemption and keeps an uncovered deletion gradeable. This is the anti-goal guard and it is carried by explicit negative-path criteria, not by prose. |
| outcome | outcome-5 | story-6 | covered | "An operator can tell whether a finding was graded with or without repair context." story-6 requires the three cases — context available, none warranted, none because nothing joined — be separately distinguishable from run artifacts alone. |
| story | story-1 | task-5, task-6, task-7, task-8 | covered | task-6 flips the sink declarations, task-7 adds the history reader, task-8 its absent/malformed negative paths, task-5 the documentation-only emission criterion added when conflict-check C2 was resolved. |
| story | story-2 | task-1, task-2, task-3, task-4 | covered | task-1 the event field, task-2 carrying the unfiltered delta, task-3 the regression lock proving gate invalidation is unchanged, task-4 the uncomputable-delta fail-closed path. |
| story | story-3 | task-9, task-10, task-11 | covered | task-9 the inversion, task-10 the exclusion coverage including the three tracked non-markdown paths, task-11 the runtime-source/test-path composition. |
| story | story-4 | task-12, task-13, task-14, task-15, task-16 | covered | task-12 path overlap, task-13 the ordering conjunct, task-14 history-wide search, task-15 the three no-match negative paths, task-16 deletion of the superseded predicate. |
| story | story-5 | task-17, task-18, task-19, task-22 | covered | task-17 the gate-agnostic recorder, task-18 the (advance, failure) keying that replaces the cap, task-19 concurrency, task-22 the conductor call sites that make it reachable in production. |
| story | story-6 | task-23, task-24 | covered | task-23 the provenance event and its sink, task-24 the three distinguishable cases. story-6's write-failure negative path is carried by task-25. |
| story | story-7 | task-25 | covered | task-25 covers all three of story-7's Done-When items: provenance isolation, the repair block's empty state, and name-anchored assertions that do not depend on how many evidence blocks exist. |
| story | story-8 | task-20, task-21 | covered | task-20 the legacy/unparseable/missing-field reads and the no-fabrication criterion, task-21 the write path producing the new shape. |
| task | task-1 | story-2 | covered | Event field for the complete delta. |
| task | task-2 | story-2 | covered | Populates the field on the changed outcome. |
| task | task-3 | story-2 | covered | Regression lock for story-2's "gate invalidation byte-identical" criterion. |
| task | task-4 | story-2 | covered | story-2's uncomputable-delta negative path. |
| task | task-5 | story-1 | covered | story-1's documentation-only emission criterion (conflict-check C2 resolution). |
| task | task-6 | story-1 | covered | Sink declarations — the wiring story-1's durability depends on. |
| task | task-7 | story-1 | covered | The history reader. |
| task | task-8 | story-1 | covered | story-1's absent-file and malformed-line negative paths. |
| task | task-9 | story-3 | covered | The classifier inversion. |
| task | task-10 | story-3 | covered | story-3's exclusion negative paths. |
| task | task-11 | story-3 | covered | story-3's test-path composition negative path. |
| task | task-12 | story-4 | covered | Path-overlap predicate. |
| task | task-13 | story-4 | covered | story-4's "failure preceding an advance" negative path. |
| task | task-14 | story-4 | covered | story-4's cross-lap happy path — the criterion that makes the finish-time step order survivable. |
| task | task-15 | story-4 | covered | story-4's three no-match negative paths. |
| task | task-16 | story-4 | covered | Removal of `wasInvalidatedByRebase`; story-4's Done-When requires the predicate no longer exist. |
| task | task-17 | story-5 | covered | Gate-agnostic recorder. |
| task | task-18 | story-5 | covered | story-5's multi-record and idempotency criteria. |
| task | task-19 | story-5 | covered | story-5's concurrency negative paths. |
| task | task-20 | story-8 | covered | story-8's legacy, unparseable, missing-field and no-fabrication criteria. |
| task | task-21 | story-8 | covered | story-8's write-forward happy path. |
| task | task-22 | story-5 | covered | Production wiring at both conductor call sites — without it story-5's recorder is unreachable. |
| task | task-23 | story-6 | covered | Provenance event type and sink. |
| task | task-24 | story-6 | covered | story-6's three distinguishable grading cases. |
| task | task-25 | story-7 | covered | story-7's block-count-agnostic and empty-state criteria, plus story-6's provenance-write-failure negative path. |
| adr | adr-2026-08-13-durable-base-advance-attribution | story-1, story-2, story-4, story-5, story-6, story-7, story-8 | covered | D1 → story-1 and story-2 (persisted record, complete delta, emission condition). D2 → story-4 (join requiring overlap, history-wide). D3 → story-5 (gate-agnostic, N per advance). D4 → story-6 (grading provenance). D5 → story-7 (evidence, not exemption). The forward-compatibility clause behind D3's cap removal → story-8. |
| adr | adr-2026-08-13-markdown-default-inversion | story-3 | covered | MD-D1's exclusion list maps one-to-one onto story-3's happy and negative paths, including the three tracked non-markdown paths the directory rules alone were already excluding. |
| adr | adr-2026-07-20-post-rebase-delta-aware-invalidation | story-2, story-3 | covered | In the change set because this spec amends its Context section. Its **Decision** is unchanged and is honored by story-2, whose criteria require the gate-invalidation path stay byte-identical (locked by task-3) and whose uncomputable-delta negative path preserves its fail-closed rule. Its amended **Context** assertion — that the path classifier excludes all markdown — is what story-3 replaces. Its binding soundness invariant ("Under-declaration is a correctness bug... when in doubt, widen the surface toward re-run") is satisfied in the same direction by story-3, which widens the classified surface rather than narrowing it. |

## Residual noted on outcome-3

`outcome-3` reads: "the grader's repair-context block reflects every recorded base-advance repair
for the feature; when it is empty, that is because no base advance invalidated anything."

The first clause is delivered unconditionally — story-5 removes the one-record-per-advance cap and
story-1 makes the records survive gate re-runs. The second clause is delivered to the limit of a
deterministic join. An empty block can arise in two ways: no advance was recorded, or an advance was
recorded and no failure joined to it. The second is correct whenever nothing actually broke, and
incorrect only if something broke whose diagnostic named no path the advance touched — the 75%
assumption recorded in `.pipeline/verify-claims-architecture-review-1535.md` and in the ADR's
assumption table.

This is recorded as `covered` rather than `fail` because the two artifacts do not contradict: the
design cannot make the residual impossible without an LLM in the attribution path, which the
repository's deterministic-where-possible principle forbids, and it fails only toward
under-attribution — never toward a fabricated record, so `outcome-4` is unaffected. story-6 exists
precisely so the residual case is *visible* rather than indistinguishable from "nothing was
invalidated". An operator reading the run artifacts can tell the two apart, which is the strongest
guarantee available without judgement in the derivation.

Flagged here rather than resolved silently, per the verify-claims protocol: if the operator wants
the literal second clause guaranteed, that is a different design (attribution would have to be
conservative in the opposite direction) and belongs in a superseding ADR, not in this artifact.

## Cross-layer pairs tested for oscillation (§4d)

Each pair was tested in both directions — "if A is fully satisfied, does B still hold?" — and none
returned two "no" answers.

- **outcome-4 ↔ task-18.** Accruing several records per advance could in principle widen what a
  base advance excuses. It does not: task-18 keys on `(advance, failure)`, and each record still
  requires its own overlap via task-12. Satisfying task-18 leaves outcome-4 intact; satisfying
  outcome-4 does not cap the record count.
- **outcome-2 ↔ story-3's no-op assertion.** Attribution regardless of observing gate versus
  documentation-only advances remaining no-ops. Resolved during conflict-check as C2 by separating
  recording from invalidation, so both now hold simultaneously — task-5 records, and no gate
  invalidates.
- **outcome-3 ↔ story-8.** Reflecting every recorded repair versus a legacy ledger reading as
  empty. Compatible, and story-8's no-fabrication criterion is what keeps them so: an upgrade that
  invented records from the old field would satisfy outcome-3's letter and violate its intent.
- **adr-durable-base-advance-attribution D1 ↔ adr-2026-07-20.** The complete-delta field versus
  that ADR's ownership of `changedCodePaths`. Non-overlapping by construction; task-3 is the
  regression lock that proves it, and the ADR's context assertion was amended rather than
  contradicted.
- **story-7 ↔ the unmerged `repeated-build-review-semantic-failures-can-churn-`.** Both add to the
  same render site. Not an oscillation — each spec forbids depending on the other's block count, so
  either merge order converges. Recorded as conflict-check C3, accepted.

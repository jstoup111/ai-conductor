# Conflict Check: coverage_binding conflict claims (#2750)

**Date:** 2026-10-03
**Stories:** `.docs/stories/plans-that-contradict-sealed-story-criteria-or-app.md`
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml`). All 328 ADRs were examined in four
delegated quarters, with no keyword narrowing. Excluded only as fully superseded:
adr-2026-07-04-operator-park-marker, adr-2026-07-03-gated-writeback-announcements,
adr-2026-07-21-completeness-as-build-review-rubric, adr-2026-07-30-finish-only-mergeability-gate,
adr-2026-08-12-removal-anchored-tautology-exemption, and four 2026-08-15/16/29 superseded ADRs
(verify-only, preservation, build-review-remediate-case, operator-authorized). Partially superseded
ADRs (adr-2026-07-12-wiring-check-gate, adr-2026-07-25-content-addressed-full-suite-proof) were
retained.
**Stories examined:** all 536 files in `.docs/stories/`, grep-scanned across several vocabularies;
13 were read in depth, including all 9 that mention coverage_binding.
**Result:** 2 blocking conflicts found and resolved (operator-selected), 2 blocking-rated
candidates resolved by clarification, degrading items folded in. Re-check is clean.

## Conflict 1: D19 reopen vs D23 refuse in one post-reseal run

**Stories involved:** #1700 Story 4 (D19 restage) vs Story 1 negative path (no reopen on a conflict)
**Files:** `.docs/stories/post-plan-decide-amendments-never-reconcile-with-t.md` vs this stories file
**Type:** state-conflict
**Severity:** blocking
**ADR filename stem:** adr-2026-08-31-coverage-binding-judge-step
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "Only a run following a D16 void reopens. Then, (a) a criterion claim whose digest is absent from the previous envelope's recorded digests and that cites a completed task [...] are reopened"
**Story opposing sentence (verbatim):** "when the step completes, then it refuses `needs-human`, no completed task is reopened, no plan task is appended, and no step is routed to `plan`"

**Description:** A reseal that changes a criterion can satisfy both D19's reopen rule and a
conflict refusal in the same run. On the first void, conflict entries with new digests could also
match D19's digest-absent rule and reopen every completed task.

**Resolution Options:**
1. A conflict refuses first, with no D19 reopen that run. Conflict entries are never D19 inputs.
2. Apply the D19 reopens, then refuse.

**Recommendation and selection:** Option 1 (operator-selected). Folded into D23. Story 1 now has
an explicit precedence criterion and a criterion that conflict entries never reopen.

## Conflict 2: an amended ADR decision with two owners

**Stories involved:** #1700 Story 3 (amendment claims, `contradictsCompleted`) vs Story 2 (conflict claims on subject ADR decisions)
**Type:** overlap / oscillating
**Severity:** blocking
**ADR filename stem:** adr-2026-08-31-coverage-binding-judge-step
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "on a run following a D16 void it may also return `contradictsCompleted` (D19)"
**Story opposing sentence (verbatim):** "Given an ADR that the branch adds or modifies and the plan does not cite, when conflict claims are assembled, then that ADR's decisions are judged as subject decisions"

**Description:** A decision introduced by a branch amendment would be judged both by D18 (outcome:
reopen) and by D21 (outcome: refuse).

**Resolution Options:**
1. D18 owns it. Decisions introduced by a D18-claimed amendment block are excluded from conflict claims.
2. Conflict claims own it, and D18's reopen is narrowed.

**Recommendation and selection:** Option 1 (operator-selected). Folded into D21, with a new Story 2 negative path.

## Resolved by clarification (blocking-rated candidates)

- **#2088 Story 7, "zero criterion claims ... completes `done`".** D22 now states that "claims" in
  D1–D14 means criterion coverage claims. Story 3 adds the zero-coverage-claim `done` criterion.
  The #2088 story still holds as written.
- **D21 "no second parser" vs `parseAdrDecisions` returning ids only.** D21 now extends
  `parseAdrDecisions` to return decision text, so it stays the single interpreter
  (adr-2026-09-02-adr-decision-citability-contract item 1).

## Degrading items folded into D21–D24 and the stories

- **Supersession:** only full supersession excludes an ADR; partial supersession is retained
  (adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag, constraint 2).
- **Status detection:** status is read through `adrApprovalStatus` parsing, accepting mixed-case and
  bold forms; its `.approved` flag, which also counts SUPERSEDED, is not trusted alone
  (single-adr-approval-parser).
- **Reused ids:** a decision id that labels several passages yields one claim carrying all of them.
- **Uncitable ADRs:** no `## Decision` section, or a parser diagnostic, is recorded
  `not-applicable` and never fails the step (citability contract item 4).
- **Rebase and finish inputs:** subject-ADR paths join coverage_binding's declared post-rebase and
  finish-mergeability inputs (adr-2026-07-20-post-rebase-delta-aware-invalidation D1;
  adr-2026-09-11-finish-mergeability-respects-active-review-inputs D3).
- **Prompt size:** batches are bounded by bytes as well as by `batch_size`; an oversize claim is
  dispatched alone and never truncated.
- **Excluded from the table:** slice membership (adr-2026-09-29-plan-slice-manifest D6).
- **Validation and schema:** task ids go through the shared resolver; the result shape is
  prompt-requested and strictly parsed like D18, with no second schema option.
- **Sink row:** `coverage_binding_conflict_judged` gets an explicit sink row with persist on,
  audit off and otel off.
- **Halt:** the class is `needs-human` via `writeHaltMarker`, with no new class. The rationale
  versus BUILD's `plan-gap` is stated in D23.
- **Cross-references:** criterion-layer-is-structural-at-land (#2088 note) and
  adr-contradiction-detection-in-two-halves are cross-referenced inside D22. Neither ADR file is
  edited.

## Accepted degrading residue

- The judge-disabled path emits `unjudged` conflict events in addition to `coverage_binding_disabled`.
  #2088 Story 8's "exactly one `coverage_binding_disabled` event" still holds, because it is a
  different event type. #1700 set the precedent for `unjudged` amendment entries.
- #2493 fixtures that pin session or entry counts hold with the judge on, because conflict claims
  form their own batch class; dispatch-count fixtures may need a judge-off or no-criteria setup.
- An engine-appended remediation task re-judges every conflict claim and can itself be refused as a
  conflict. This is accepted as desired.
- On the kickback-cap raise resume path, a conflict is caught after build rather than before it.
- prd_audit D7 ships unmet negative criteria by default, while a contradiction now halts before
  BUILD. These are different questions and the asymmetry is accepted.
- In interactive runs a conflict halts instead of routing to DECIDE
  (adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts §5). Daemon behavior is identical.
- Plan-cited ADRs beyond the change set can now block in consumer repos with the judge on. This is
  bounded by explicit plan citation (overlap with adr-2026-08-09 repo-wide staging, 35%).

## Re-check

The amended D21–D24 and the updated stories were re-read against every candidate above. No
blocking conflict remains.

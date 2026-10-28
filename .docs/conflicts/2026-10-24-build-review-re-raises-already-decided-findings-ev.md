# Conflict Check: build_review re-raises already-decided findings every lap and never converges

**Date:** 2026-10-24
**New stories:** `.docs/stories/build-review-re-raises-already-decided-findings-ev.md`, Stories 1 to 7
**Result:** passed after resolution. 7 blocking and 21 degrading conflicts were found, and the
operator resolved all of them on 2026-10-24. No degrading compromise remains open.

## ADR corpus

**Examined:** every APPROVED ADR whose subject overlaps build_review. That covers:
- rubric branches and the judged-result envelope;
- finding identity, vocabularies and references;
- dispositions;
- case adjudication and the mixed-lap successor;
- operator acceptance;
- severity;
- recurrence notes;
- the cumulative bound, rebase refund and mechanical-fault lane;
- review-bound and one-owner;
- portable policy, custom coverage identity and the engine-identity cache key;
- testQuality scope;
- routed repair, restack replay, per-child region and stacked-child identity;
- remediation closure;
- the fresh base and post-rebase invalidation;
- finish mergeability;
- the opt-in rubric container;
- declared replication;
- the kickback livelock, recovery and read-fail ADRs.

**Narrowed out as fully superseded:**
- `adr-2026-07-21-completeness-as-build-review-rubric`
- `adr-2026-08-12-removal-anchored-tautology-exemption`
- `adr-2026-08-15-verify-only-anchored-tautology-exemption`
- `adr-2026-08-16-preservation-anchored-completeness-exemption`
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery`

`adr-2026-08-29-build-review-remediate-case-adjudication` is partially superseded and was kept.

**Narrowed out as off-subject:** every other APPROVED ADR. These include the rebase dispatch and
seal, halt rendering and clearing, stale-engine, BUILD floor, as-built, prd_audit, coverage,
coherence, provider, telemetry and plan-scope ADRs.

## Blocking conflicts (resolved)

### Conflict: A missed defect on settled code would stop blocking
**Stories involved:** Story 4 vs ADR: one owner per review question
**Files:** [.docs/stories/build-review-re-raises-already-decided-findings-ev.md] vs [.docs/decisions/adr-2026-08-22-one-owner-per-review-question.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-22-one-owner-per-review-question
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "an off-plan security defect must fail build_review before the SHIP tail"
**Story opposing sentence (verbatim):** "a finding is anchored on a settled hunk without a cause hunk, […] then the finding is classified `outOfDelta`, […] and does not block."

**Resolution (operator):** a finding the reviewer rates `critical`, in any rubric, is never out of
delta. The new ADR's D5 says so, and notes record it on the one-owner D1 and review-bound D3. A
Story 4 negative covers it.

### Conflict: Provenance recurrence contradicts the #3124 no-owner rule
**Stories involved:** Story 5 vs `a-recurring-concern-at-a-resolved-anchor-escapes-i` Stories 1 and 2
**Type:** contradiction
**Severity:** blocking

**Description:**
- **#3124 Story 2:** no `recurrenceOf` is stamped without an owner.
- **#3124 Story 1:** `distinctFrom` entries count only when they name resolved owners.

Story 5 contradicts both.

**Resolution:** both #3124 criteria now include the provenance candidate. Notes record it on
mixed-laps D5.8 and on case-adjudication D5.

### Conflict: The reducer order is superseded
**Stories involved:** Story 4 vs `build-review-findings-carry-a-severity-with-a-per-` Story 5
**Type:** contradiction
**Severity:** blocking

**Resolution:** that order now includes `outOfDelta` after settled or carried. The severity D4 note
records it.

### Conflict: Drifted ids are always live
**Stories involved:** Stories 4 and 7 vs `operator-configurable-confidence-floor-for-acting-`
Story 6, `refuted-build-review-finding-cycles-to-a-needs-hum` Story 4, and
`build-review-findings-carry-a-severity-with-a-per-` Story 9
**Type:** contradiction
**Severity:** blocking

**Resolution:** all three now qualify drifted-id liveness with "in a full lap, or when the finding
maps to a delta hunk or names a delta cause hunk".

### Conflict: Nothing broader than exact identity may stop a finding blocking
**Stories involved:** Story 7 vs `build-review-rubric-dispositions-and-fan-out` Story 13,
`equivalent-re-worded-findings-escape-their-accepte` Story 2, and
`operator-acceptance-survives-a-build-review-re-rai` Story 4
**Type:** contradiction
**Severity:** blocking

**Resolution:** each one names out-of-delta classification as scope bookkeeping that is never
accepted risk. The dispositions §2 note records it.

### Conflict: Retirement by absence on a hunk that is settled but owned by an open case
**Stories involved:** Stories 2 and 3 vs `operator-acceptance-survives-a-build-review-re-rai` Story 9
(and the equivalent severity and adjudicator criteria)
**Type:** state-conflict
**Severity:** blocking

**Resolution:**
- **ADR D2:** settledness now considers every eligible lap's findings, and no hunk an open,
  `failed` or `reserved` act case owns is ever settled.
- **ADR D3:** `scope-empty` is never evidence for absence.
- **Note:** recorded on the operator-acceptance ADR's decision 5.
- **Stories:** Story 2 and Story 3 negatives.

### Conflict: The threshold direction in Story 2 was reversed
**Stories involved:** Story 2 vs severity D7 and `build-review-findings-carry-a-severity-with-a-per-` Story 9
**Type:** contradiction
**Severity:** blocking

**Resolution:** Story 2 now says "lowers or removes that threshold".

## Degrading conflicts (resolved)

- **A same-head re-lap overwrites its scope record.** Raised against mechanical-fault D3,
  lap-identity stories and fan-out Story 25. Resolved: ADR D3's same-head rule reuses the recorded
  scope, with a Story 1 negative. Fan-out Story 25 is limited to a rejoin at the same head, and the
  rubric-branches §7 note records it.
- **A policy or skill change does not re-review settled code.** Raised against portable policy
  D11, the engine-identity cache D3 and custom-policy stories. Resolved: D1 gains
  `policyIdentity`, and a change forces `version-changed`. Engine identity is excluded (A10).
  Story 1 negatives cover it.
- **testQuality indeterminate scope can settle.** Raised against engine-owned test-quality scope D7
  and D8. Resolved: ADR D2 excludes such hunks, test-scope identity is in `policyIdentity`, and a
  Story 2 negative covers it.
- **`scope-empty` can be read as a judged PASS or as a skip.** Raised against rubric-branches §6,
  §8 and §9, and the render story. Resolved: it is its own outcome, excluded from judged-rate
  metrics and announced via `build_review_rubric_skipped`. The §6 and §8 notes and a Story 3 line
  cover it.
- **The digest budget against the hard context ceiling.** Raised against case-adjudication D3,
  portable policy D8, adjudicator Story 2 and remediate-context Story 1. Resolved: ADR D8 bounds
  the budget by headroom, so digests never cause overflow. Story 6 is re-sized to the maximum case
  history, and remediate-context Story 1 excludes digests from the byte-identity check.
- **The cache and rejoin wording.** Raised against rubric-branches §7, severity Story 4, cache
  identity Story 1 and security-grading Story 2. Resolved: the §7 note, plus scope-qualified
  wording in each story. Story 3 now asserts equality of the v5 digest.
- **Thresholds now act before judgement.** Raised against severity D3 and mixed-laps D4.3.
  Resolved: notes on both.
- **Every reader must agree on `outOfDelta`.** Raised against the parity stories. Resolved: an ADR
  D6 parity rule and a Story 4 criterion.
- **The `scope-empty` preflight.** Raised against the empty-scope stories. Resolved: ADR D3 says a
  `scope-empty` rubric runs no preflight.
- **The projection field-set pin.** Resolved: security-grading Story 2 now includes `reviewScope`.
  The two pre-existing `v3` pins were already stale before this change and are left as they are.
- **`causeHunk` as a fourth reference kind.** Resolved: it reuses the content-region shape.

## Examined and judged compatible

- **Stories:**
  - `repeated-build-review-semantic-failures-can-churn-`
  - `one-build-review-pass-clears-the-convergence-cap-s`
  - `a-change-to-one-stacked-child-cannot-be-carried-in`
  - `a-routed-fix-is-never-carried-up-the-stack-or-foll`, whose revalidation laps change the merge
    base and so are full
  - `build-loop-cannot-complete-a-feature-child-by-chil`
  - `build-review-halts-when-a-judgement-re-raises-a-so`
  - `kickback-cap-raise-replays-the-halted-lap-s-remedi`
  - `remediation-tasks-close-on-a-reported-commit-that-`
  - `tautology-rubric-grades-diff-required-fixture-relo`
  - `exclude-patch-equivalent-upstream-commits-from-the`
  - the post-rebase invalidation stories
  - `clean-rubric-judgements-rejected-as-invalid-provid`
  - `build-review-testquality-rubric-prompt-embeds-full`
  - the other `projects-cannot-add-portable-non-competing-build-r` and
    `build-review-rubrics-need-a-post-join-adjudicator-` stories
- **ADRs:**
  - the cumulative bound;
  - rebase refund;
  - routed whole-feature repair;
  - restack replay;
  - remediation closure;
  - the judged-result envelope;
  - closed vocabularies;
  - fresh base;
  - post-rebase invalidation and selective verification;
  - finish mergeability;
  - the opt-in container;
  - declared replication;
  - the custom coverage identity;
  - the kickback livelock, recovery and read-fail ADRs;
  - the per-child region and stacked-child identity.

## Re-check

- **Round 1.** It confirmed the 7 blocking conflicts were removed. It found 2 partial resolutions and
  9 non-blocking issues that the resolutions introduced, and all were fixed:
  - out-of-delta exceptions in two more criteria of the equivalent-re-worded and refuted stories;
  - provenance candidates now have one definition, with no timing condition;
  - a resolved act case with an applied effect counts as non-blocking for settledness;
  - an open case's unmapped source keeps its path in scope;
  - `scope-empty` counts as a skip with that reason;
  - "critical" now means never out of delta, not always blocking;
  - an "only" was dropped from the #3271 Story 4;
  - "exact-source owner" is defined;
  - full-lap reason precedence is stated;
  - the digest-budget note matches D8.
- **Round 2.** It found 5 residual consistency issues, all fixed:
  - the Story 2 Done When route list;
  - the Story 5 provenance negative;
  - a new full reason, `open-source-unmapped`;
  - non-critical qualifiers in Story 4;
  - a record `sequence`, because no durable lap order exists.
- **Result:** zero blocking conflicts remain, and no degrading compromise is open.

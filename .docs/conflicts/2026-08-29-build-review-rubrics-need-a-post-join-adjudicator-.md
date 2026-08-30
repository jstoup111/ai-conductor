# Conflict Check: build_review rubric outcomes need one post-join adjudication

**Date:** 2026-08-29
**Feature:** `build-review-rubrics-need-a-post-join-adjudicator-`
(`jstoup111/ai-conductor#2033`)
**Stories scanned:** all 382 files under `.docs/stories/`, including the 11 accepted stories for
this feature.
**Specs scanned:** all 52 files under `.docs/specs/`; explicit supersession/status and subject
overlap were applied before design-level comparison.
**Previous reports scanned:** all 236 files under `.docs/conflicts/`, with the overlapping
build-review, infrastructure-fault, convergence, validation-group, and remediation reports compared
against the new stories.
**ADR corpus:** `repo_wide`, from `.ai-conductor/config.yml`. All 298 `adr-*` files were inventoried.
Twenty-six current applicable ADRs were examined against the stories, the superseded #2033
predecessor was retained as resolution evidence, and 271 ADR files were narrowed out after approval,
supersession, and subject-overlap checks. Partial or ambiguous supersessions were retained rather than
excluded.
**Result:** PASS — **0 blocking**, 3 blocking conflicts resolved by operator selection, 0 degrading
conflicts accepted.

**Landing split:** The successor ADR and this feature's corrected stories remain in the #2033 spec
PR. The required in-place corrections to three older feature-scoped artifacts are isolated in
companion PR [#2066](https://github.com/jstoup111/ai-conductor/pull/2066), because the composer land
gate rejects foreign-stem story/spec edits on a feature spec branch. The companion contains only
those accepted-artifact corrections and must land before #2033 is handed to BUILD.

## Conflict 1: Mechanical exhaustion hid valid sibling content from adjudication

**Stories involved:** Story 1: Settle every rubric before one content adjudication vs Story 3: A
mechanical lap costs nothing from the semantic allowance
**Files:** `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md` and
`.docs/decisions/adr-2026-08-29-build-review-remediate-case-adjudication.md` vs
`.docs/stories/review-infrastructure-failures-are-operator-unreco.md`
**Type:** sequencing (with contradictory mixed-lap behavior)
**Severity:** blocking as originally approved — resolved
**Confidence:** 99% — both contracts name the same mixed lap and opposite route precedence.

**ADR filename stem:** adr-2026-08-29-build-review-remediate-case-adjudication
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "Per `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`, any infrastructure-failure member with mechanical allowance remaining keeps the lap on the non-publishing mechanical lane. Valid sibling artifacts remain inspectable, but no semantic adjudication or external effect runs."
**Story opposing sentence (verbatim):** "Given a lap in which one rubric faulted mechanically and another produced an unresolved finding, when the lap is routed, then the lap is treated as a judged failure and the semantic allowance IS charged — a mechanical fault alongside a real finding does not buy a free lap."

### Description

The first approved #2033 amendment made infrastructure authority a prerequisite for content
adjudication. The existing accepted story makes a mixed lap a judged semantic failure and explicitly
forbids a mechanical fault from buying a free lap. The accepted rejected-contract story independently
requires the current-lap aggregate to retain both a judged finding and an infrastructure failure and
to route using the finding. Both directions fail: satisfying reduced-coverage-first suppresses the
mixed-lap route, while satisfying the existing mixed-lap route violates the predecessor ADR's ban on
adjudication/effects.

### Resolution options presented

1. Preserve the established mixed-lap contract: pure mechanical laps remain non-publishing; mixed
   laps adjudicate valid content while infrastructure stays independently blocking.
2. Keep reduced-coverage-first and amend the older stories so an operator must clear infrastructure
   before any sibling repair can be judged.

**Recommendation:** Option 1. It preserves fan-out/fan-in, prevents sibling loss, keeps exact
operator authority over reduced coverage, and changes no pure-mechanical accounting.

**Operator selection:** Option 1, approved 2026-08-29.

### Resolution applied

- Created approved successor ADR
  `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` and marked the predecessor
  superseded.
- Re-derived Story 1, Story 2's entry condition, and Story 9's effective-verdict cases.
- Updated the component and sequence diagrams and added amendment notes beside the originally
  approved architecture assertions.
- Transition precedence is now explicit: a new content action takes one BUILD route; otherwise the
  uncovered infrastructure result takes its existing retry/exhaustion path; PASS requires content
  settlement and healthy or exactly covered infrastructure.

## Conflict 2: Legacy stories required every raw FAIL to route directly to BUILD

**Stories involved:** Story 3: A validation-group halt records refused for the judging step and
FAIL kicks back to build with evidence vs Story 6: Publish one bounded BUILD work order
**Files:** `.docs/stories/a-gate-halt-marks-a-completed-build-failed-and-the.md` and
`.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md` vs
`.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md`
**Type:** behavioral overlap and sequencing
**Severity:** blocking as written — resolved
**Confidence:** 99% — the legacy assertions required a direct route for the same raw FAIL that the
new stories route through `remediate` first.

**Opposing legacy assertion before resolution:** "Given a build_review verdict is FAIL, when the gate routes kickback-to-build, then the routing, kickback counting, and lap accounting behave exactly as on current main with no refusal recorded"

**Opposing new assertion:** "Given an adjudication contains only deferred, rejected, and merged outcomes, when their required effects settle, then no build_review kickback is consumed and no BUILD work order is dispatched."

### Description

The original judging-gate stories predate post-join case outcomes. They treated raw FAIL as the route
decision, seeded raw grader reasons directly into BUILD, and incremented the gate counter for every
FAIL under the cap. The new design intentionally makes raw FAIL evidence rather than the outer route:
only a valid new `act` case publishes a work order and consumes the kickback. Satisfying both would
either bypass adjudication or double-route handled defer/reject/merge outcomes.

### Resolution options presented

1. Preserve the legacy mechanics on an actual actionable route while changing raw FAIL to reach
   post-join adjudication first; handled non-action outcomes do not route.
2. Retain direct raw-FAIL routing and make adjudication advisory only.

**Recommendation:** Option 1. It retains routing, stale cascade, refusal classification, and counter
semantics where a BUILD route exists without defeating #2033.

**Operator selection:** Option 1, approved 2026-08-29.

### Resolution applied

- Companion PR #2066 replaces the direct-FAIL assertion in the refusal story with actionable-route
  and handled-non-action cases; no amendment-history block is left in the story artifact.
- Companion PR #2066 scopes the original FAIL-to-BUILD story to a validated `act` work order or
  compatibility flag-off route and scopes the retry counter to actual admitted BUILD routes.
- Preserved the original stale cascade, task-status re-derivation, evidence requirement, cap, and
  refusal distinction for each actual route.

## Conflict 3: The fan-out PRD prohibited model judgement after rubric evaluation

**Stories involved:** 2026-08-13 fan-out PRD NFR vs Story 2: Judge current findings against complete
prior case history and Story 3: Account for every current finding exactly once
**Files:** `.docs/specs/2026-08-13-build-review-rubric-dispositions-and-fan-out.md` vs
`.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md`
**Type:** contradiction
**Severity:** blocking as written — resolved
**Confidence:** 99% — semantic merge, existing-case binding, disposition, and priority are model
judgements outside independent rubric evaluation.

**Spec opposing sentence (verbatim):** "Authorization, finding identity, disposition application, concurrency limits, result joining, and metric calculation must be deterministic; model judgement is limited to rubric evaluation."

**Story opposing sentence (verbatim):** "Given several rubric findings describe one repair, when the judge merges them, then every raw finding remains traceable to the one canonical case and its single priority/route."

### Description

The prior PRD correctly made raw identity, authorization, joining, and application deterministic, but
its final clause prohibited the schema-constrained semantic judgement #2033 requires. Mechanical
matching would move the hard equivalence decision into string rules and recreate finding-id drift and
cycling. Conversely, leaving the NFR unchanged would make the accepted stories impossible to
implement. FR-7 also needed clarification so effective autonomous resolution is not mistaken for a
fabricated raw PASS.

### Resolution options presented

1. Amend the PRD additively: model judgement is allowed for independent rubrics and exactly one
   post-join `remediate` case judgement; all bookkeeping/application remains deterministic.
2. Mechanically match cases and reserve model judgement for rubrics only.
3. Remove autonomous post-join adjudication.

**Recommendation:** Option 1. Semantic equivalence and disposition are judgement calls; the engine
can still constrain their schema and own identity, completeness, authority, effects, and budgets.

**Operator selection:** Option 1, approved 2026-08-29.

### Resolution applied

- Companion PR #2066 adds an amendment beside the original NFR preserving deterministic raw
  identity, validation, joining, authorization, durable ids, effects, accounting, and effective
  reduction while admitting one schema-constrained post-join judgement.
- Companion PR #2066 adds an amendment beside FR-7: raw verdicts remain unchanged; effective
  autonomous outcomes can resolve content, but infrastructure still requires healing or exact
  operator reduced coverage.

## Re-check: clean interactions

The resolved artifacts were re-compared in both directions for every shared behavior, entity, state,
resource, sequence, and gate. The six required conflict classes were all checked. No oscillating pair
remains.

- **Pure mechanical vs mixed:** infrastructure-only laps publish no aggregate or semantic charge;
  mixed laps preserve and adjudicate content without granting infrastructure PASS.
- **Operator vs autonomous authority:** exact operator accepted-risk and reduced-coverage records run
  first and remain in their existing store. Autonomous reject/defer/merge cannot create operator
  acceptance.
- **Raw vs effective evidence:** raw rubric results and stable finding identities are immutable
  evidence; case outcomes derive an effective route without rewriting raw PASS/FAIL.
- **Convergence:** each first actionable work order consumes the existing route/lap budget exactly
  once. Crash resume is idempotent; an already-attempted equivalent case halts rather than receiving a
  second charge or free route.
- **Plan ownership:** build_review publishes retry work only and never appends approved plan tasks.
  PRD-audit and as-built append authority remains unchanged.
- **SHIP validation group (#2060):** the case contract may be reused, but SHIP owns its one shared
  allowance, append transaction, and terminal split. No second judge is introduced here.
- **Rubric catalog (#2020):** #2033 changes neither membership nor blocking authority.
- **Legacy remediation:** the new case mode is discriminated; prd_audit, as-built, finish, and stall
  artifacts retain their existing parse and route.
- **Deferred intake:** a reserved stable effect marker plus open-and-closed lookup makes filing
  exactly-once across retry/crash without turning issue prose into identity.
- **Event spine:** lifecycle occurrences extend `ConductorEvent` and declared sinks; case/outbox state
  remains durable control state rather than a parallel telemetry channel.
- **Prior history:** every feature-local case is included within hard bounds or the gate halts; no
  truncation or mechanical prose matching can silently restart a decided case.

## Corpus record

### Applicable current ADRs examined

1. `adr-2026-07-10-concurrent-group-core`
2. `adr-2026-07-10-validation-group-join`
3. `adr-2026-07-12-judged-attribution-verdict-persistence`
4. `adr-2026-07-13-kickback-build-no-op-escalation`
5. `adr-2026-07-13-retry-classify-rerun-vs-route`
6. `adr-2026-07-13-session-fresh-verdict-artifacts`
7. `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
8. `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`
9. `adr-2026-07-27-daemon-decide-kickback-halt`
10. `adr-2026-08-11-halt-events-ride-the-persisted-spine`
11. `adr-2026-08-12-cumulative-build-review-convergence-bound`
12. `adr-2026-08-13-engine-managed-build-review-rubric-branches`
13. `adr-2026-08-13-stable-build-review-finding-dispositions`
14. `adr-2026-08-16-closed-build-review-finding-vocabularies`
15. `adr-2026-08-18-content-anchored-finding-reference-schema`
16. `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
17. `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`
18. `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope`
19. `adr-2026-08-21-engine-identity-in-build-review-cache-key`
20. `adr-2026-08-21-review-bound-by-plan-done-when-criteria`
21. `adr-2026-08-22-build-review-opt-in-rubric-container`
22. `adr-2026-08-22-one-owner-per-review-question`
23. `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`
24. `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`
25. `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
26. `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`

The superseded `adr-2026-08-29-build-review-remediate-case-adjudication` was also examined and is
retained in Conflict 1 because it contains the exact assertion that caused the resolution. It is not
part of the post-resolution governing corpus.

### ADRs narrowed out

The remaining 271 `adr-*` files were narrowed out only after the repo-wide status and subject scan:
they were not approved decisions, were unambiguously fully superseded, or addressed domains without a
shared behavior/entity/state/resource/gate (release automation, authentication, CLI migration,
documentation, generic daemon operations, unrelated provider plumbing, task attribution, manual-test
presentation, or other non-build-review surfaces). Partially superseded decisions with live
build-review, validation-group, remediation, retry, event, provider-dispatch, or operator-authority
clauses were retained in the applicable list rather than excluded.

### Story/spec and prior-report focus set

All story/spec/report files were indexed and pair-scanned. The files read most closely because they
shared the affected gate, state, route, or authority were:

- `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md`
- `.docs/stories/review-infrastructure-failures-are-operator-unreco.md`
- `.docs/stories/one-rubric-s-rejected-contract-discards-the-whole-.md`
- `.docs/stories/build-review-rubric-dispositions-and-fan-out.md`
- `.docs/stories/a-gate-halt-marks-a-completed-build-failed-and-the.md`
- `.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md`
- `.docs/stories/equivalent-re-worded-findings-escape-their-accepte.md`
- `.docs/stories/repeated-build-review-semantic-failures-can-churn-.md`
- `.docs/stories/one-build-review-pass-clears-the-convergence-cap-s.md`
- `.docs/stories/kickback-to-build-no-op-when-target-evidence-stamped.md`
- `.docs/stories/retry-classify-rerun-vs-route.md`
- `.docs/stories/remediate-routes-buildable-review-gaps-to-plan-hal.md`
- `.docs/stories/remediation-repairs-are-blind-to-the-plan-contract.md`
- `.docs/stories/parallel-validation-phase-fan-out-manual-test-prd-.md`
- `.docs/stories/every-as-built-blocked-verdict-halts-needs-human-i.md`
- `.docs/specs/2026-08-13-build-review-rubric-dispositions-and-fan-out.md`
- `.docs/specs/2026-08-18-review-infrastructure-failures-are-operator-unreco.md`
- `.docs/specs/build-review-re-judges-what-the-plan-architecture-.md`
- `.docs/conflicts/2026-08-13-build-review-rubric-dispositions-and-fan-out.md`
- `.docs/conflicts/2026-08-16-equivalent-re-worded-findings-escape-their-accepte.md`
- `.docs/conflicts/2026-08-17-the-engine-cannot-detect-its-own-spinning-operator.md`
- `.docs/conflicts/2026-08-18-review-infrastructure-failures-are-operator-unreco.md`
- `.docs/conflicts/2026-08-19-clean-rubric-judgements-rejected-as-invalid-provid.md`
- `.docs/conflicts/one-rubric-s-rejected-contract-discards-the-whole-.md`
- `.docs/conflicts/repeated-build-review-semantic-failures-can-churn-.md`

## Gate result

Conflict check passed with zero blocking conflicts and no accepted degrading compromise. Because
blocking conflicts were found and resolved and a superseding ADR was created, operator review is
required before the plan step.

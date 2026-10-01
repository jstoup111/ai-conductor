# Conflict review: PRD and as-built finding history (#2440)

**Status:** CLEAN — operator-selected corrections applied; zero unresolved blocking or degrading conflicts.
**Resolution approval:** Operator approved option 1 for all three groups in chat on 2026-09-30.
**Date:** 2026-09-30
**Stories:** .docs/stories/prd-and-as-built-review-retain-finding-history-acr.md
**Track:** technical. **Tier:** L.
**ADR corpus:** repo_wide, explicitly configured in .ai-conductor/config.yml:173–174.

The operator accepted the twelve new stories. Their intended behavior follows approved
adr-2026-09-30-gate-local-review-finding-continuity D1–D12. This review found older contracts
that still require incompatible behavior at the same boundaries. The recommended resolution
keeps the newly approved behavior and narrowly qualifies the older contracts during DECIDE.
The corrections below were approved and applied during DECIDE. They introduce no new approval power or routing/budget policy. Quoted opposing sentences record the pre-resolution evidence; the current accepted artifacts contain the corrections.

## Resolved conflict 1: Raw review alone versus effective current review

**Stories involved:** New Story 10 versus typed-as-built Stories 5–7 and stale-preservation Story 1.
**Files:** .docs/stories/prd-and-as-built-review-retain-finding-history-acr.md;
.docs/stories/as-built-review-receives-bounded-inputs-and-return.md;
.docs/stories/skip-prd-audit-as-built-re-dispatch-after-a-kickba.md.
**Type:** contradiction (with incompatible behavioral overlap).
**Severity:** blocking before correction; resolved.
**Confidence:** 100%, verified against the quoted normative text; this is a contract conflict,
not a claim that the proposed feature already exists in code.

Existing typed-as-built Story 6 says:

> Given a typed `APPROVED` or `APPROVED WITH DRIFT NOTES` verdict, when the completion predicate runs, then the gate is satisfied and the as-built code stamp is written.

New Story 10 says:

> Given raw reviewer success coexists with pending, corrupt, missing, stale, or uncertain required history, when any completion boundary runs, then the gate cannot pass and the specific history condition is returned.

Existing typed-as-built Story 6 also says:

> Given a typed `BLOCKED` verdict whose findings are all `REMEDIABLE` and no `manual_test` FAIL in the same validation round, when the gate settles, then `planRemediation` receives each finding with its typed governing reference, admits it under gate key `architecture_review_as_built`, and navigates back to BUILD within the gate's remediation lap cap.

New Story 10 says:

> Given raw review and current validated reconciliation jointly establish satisfaction, when serial routing, group completion, retained-sibling reuse, or final publication is evaluated, then each uses the same effective classification and source trace.

**Why:** A raw clean result with missing enrolled history cannot both pass and remain blocked.
A repeated raw blocking finding resolved by validated current evidence cannot both disappear
from effective routing and unconditionally require a repair. Rendering the raw result remains
valid; treating it as the complete final authority does not.

**Two-direction check:** Satisfying the older unconditional pass fails the new missing-history
negative. Satisfying the new resolution rule fails the older unconditional repair predicate.
This is resolved by defining the input to each rule, not by alternating review/repair laps.

**Related governing text:** The as-built bounded-route ADR D3 and D6.1 and the PRD grades,
FIXABLE, and PLAN_GAP rules (prd-audit-stories-authority-and-bounded-kickback D3/D5/D7) require
explicit qualification. The as-built PLAN_GAP ADR D2 must retain actual-delivery authority.
Their budgets, ownership, grade vocabularies, raw-output validity, and unapproved-DESIGN
boundaries remain intact.

**Resolution options:**
1. Apply approved #2440 D6/D9 at these boundaries: raw contracts validate and retain reviewer evidence; one current effective reader supplies final completion/routing/reuse/fence decisions. Recommended.
2. Remove current-evidence resolution and mandatory-history completion from the new stories, reopening approved #2440 D2/D6/D9 and reducing the requested outcome.
3. Introduce a separate override authority. Rejected recommendation: adds a competing owner and changes scope.

**Approved amendment applied beside the older routing clauses:**

> **Amended 2026-09-30 by #2440:** For prd_audit and architecture_review_as_built, these routing and satisfaction rules consume the current effective classification defined by adr-2026-09-30-gate-local-review-finding-continuity D6/D9. Raw reviewer evidence remains separately validated and attributable. A repeated assertion may clear only through validated current evidence of its exact criterion/clause or delivered outcome; unrelated failures, malformed evidence, refusal authority, and unapproved architectural choices remain blocking. Required history that is pending, missing, corrupt, stale, or uncertain prevents completion. Existing routing owners, dispositions, and budgets are unchanged.

**Approved story corrections applied:** Replace the quoted unconditional clean-pass Given
with “Given a typed APPROVED or APPROVED WITH DRIFT NOTES verdict and current validated history
whose effective result is satisfied …”. Replace raw-BLOCKED routing Givens with current effective
BLOCKED results, retaining unresolved findings only as routing inputs and preserving raw findings
in the report. Apply the same distinction in old #1874, #2195, #2424, and #1805 routing criteria
and their Done When assertions. Preserve raw schema/reference validation criteria. Stale reuse
requires both existing code validity and current history eligibility; neither raw report text nor
code stamps alone can bypass required history. Do not broaden this to manual_test/build_review.

## Resolved conflict 2: A branch cannot await a result owned by its join

**Stories involved:** New Story 10 versus concurrent group core D5.
**Files:** .docs/stories/prd-and-as-built-review-retain-finding-history-acr.md;
.docs/decisions/adr-2026-07-10-concurrent-group-core.md.
**Type:** sequencing.
**Severity:** blocking before correction; resolved.
**Confidence:** 100%, verified normative contradiction when the old “completion checks” clause
is implemented as the new final history-dependent completion predicate.
**ADR filename stem:** adr-2026-07-10-concurrent-group-core
**Story ID:** Story 10
**ADR opposing sentence (verbatim):**

> **Per-branch retry ladder.** Branch retries reuse the step's resolved `max_retries`,
>    completion checks, and per-step stale sweep (`STALE_SWEEP_STEPS`) — semantics
>    equivalent to the serial loop, scoped per branch.

**Story opposing sentence (verbatim):**

> Given a concurrent branch has valid reviewer output but awaits join-owned reconciliation, when branch validation finishes, then it reaches the join without retrying solely because final history publication has not yet occurred.

**Why:** The new final predicate requires the history receipt published at the join. If D5's
branch completion check requires that same receipt, the valid branch retries before it can
reach the receipt's owner. D9 already chooses the two-stage validation boundary; D5 lacks the
necessary exception. The raw validation is not a competing satisfaction authority: only the
join can mark final objective satisfaction.

**Two-direction check:** Requiring final satisfaction in a branch prevents its join from
publishing history. Allowing the valid branch through without the explicit exception violates
the old instruction to use equivalent completion checks. Making the boundary explicit removes
the cycle without extending any retry allowance.

**Resolution options:**
1. Qualify D5 for these two gates exactly as approved #2440 D7/D9 requires. Recommended.
2. Move publication into branches, reopening the approved single-writer architecture and introducing shared-state contention.
3. Drop final-history checks from completion, violating new Stories 2/8/10.

**Approved amendment applied beside D5:**

> **Amended 2026-09-30 by #2440:** For prd_audit and architecture_review_as_built, branch retry validation establishes a valid current raw review artifact, not final history-dependent satisfaction. The single-writer join performs gate-local reconciliation/publication before computing final objective satisfaction, under adr-2026-09-30-gate-local-review-finding-continuity D7/D9. A history receipt not yet published by that join is not a malformed provider result and does not consume a branch retry. Provider/schema failures retain their existing branch handling; other members, allowances, and single-writer ownership are unchanged.

## Resolved conflict 3: Projection/clear and absent-state rules omit required history

**Stories involved:** New Stories 2/9 versus typed-as-built Stories 1/7.
**Files:** .docs/stories/prd-and-as-built-review-retain-finding-history-acr.md;
.docs/stories/as-built-review-receives-bounded-inputs-and-return.md.
**Type:** state-conflict.
**Severity:** blocking before correction; resolved.
**Confidence:** 100%, verified against the normative text below.

Existing Story 7 says:

> Given a typed verdict with pending remediation findings that the rebuilt gate has now passed, when the recorded-findings projection runs, then the findings with their remediation outcomes are written into the typed verdict, the report is re-rendered showing them, and the kickback ledger's pending entries are cleared in the same step.

New Story 9 says:

> Given history cannot retain pending finding/outcome evidence, when clearing or replacement would occur, then the required pending evidence is kept and the persistence failure blocks that transition.

Existing Story 1 says:

> Given a kickback ledger that does not exist, when the projection is built, then the prior-findings section is empty and the projection is produced.

**Why:** Known durable history can exist without pending kickback entries, and an enrolled store
can be lost while the kickback ledger is absent. Empty pending findings therefore cannot imply
empty total history or successful projection. A projection whose durable-history write failed
cannot also promise an unconditional clear. The #2440 amendment already added beside bounded-route
D7 resolves that ADR's retention obligation, but the older accepted stories still need correction.

**Two-direction check:** Following the old unconditional clear erases evidence the new negative
requires retaining. Following required retention leaves the old unconditional clear unmet.
An absent pending ledger can satisfy both stories only when pending findings are distinguished
from complete gate history and required-history validation has passed.

**Resolution options:**
1. Preserve the pending ledger as a compatibility projection, require attributable durable retention before clear, and qualify successful projection on valid required history. Recommended.
2. Remove new retention/lost-history guarantees, reducing approved D2/D8 and the requested outcome.
3. Add another archive/store, contrary to the approved shared-store design.

**Approved story replacements applied:**

> Given a typed verdict with pending remediation findings that the rebuilt gate has now passed and whose attributable finding/attempt/outcome facts have been durably retained, when the recorded-findings projection runs, then the typed verdict and rendered report retain their existing projection and the pending entries are cleared; if required retention fails, the entries remain and the transition stops with the persistence fault.

> Given no kickback ledger and valid complete gate history or verified fresh enrollment, when the projection is built, then pending findings are empty and complete retained gate history is still supplied; absent required enrolled history stops projection rather than becoming empty history.

Update their Done When assertions to prove both sides. Rewind/rebase may invalidate current
verdict eligibility but retain history. Shipped-record rendering with no raw artifact must not
promise publication when an applicable required gate/history is unsatisfied; rendering and the
publication fence remain separate responsibilities.

## Resolution and re-check

Operator selected option 1 for all three groups. Architecture amendment mode recorded the
approved qualifications beside the original ADR clauses; old stories were corrected in place.
The new 89 accepted criteria remain unchanged. PRD/as-built effective-classification qualifications
also apply at the older retry-classifier D1 and product-spec FR-9–14/FR-16 clauses; these are the
same approved resolution at additional callers, not a new behavior decision.

Re-check: zero blocking conflicts remain; zero degrading compromises. No plan task will mutate
another feature's accepted artifacts. The review marker records the resolved findings and the
operator's approval, rather than requesting approval of the same resolution again.

| Shared behavior | A fully satisfied → B still holds | B fully satisfied → A still holds | Six-type result |
| --- | --- | --- | --- |
| Raw schema/freshness and effective completion | Raw success remains necessary evidence; history may independently block final use | Effective resolution preserves raw shape/reference faults and unrelated failures | No contradiction or oscillation after qualification |
| Branch validation and join publication | Valid raw branch reaches join without requiring join-owned receipt | Join still owns final satisfaction; invalid raw branch retains its existing retries | Sequencing cycle removed; no second state writer |
| Pending projection and complete history | Pending clear follows durable attributable retention | Retained history is not a second repair appender and cannot invent an outcome | State conflict removed; no resource contention |
| NC decisions and general PRD history | NC relationships enter through existing sole owner | General history cannot override or broaden a validated NC binding | Compatible authority partitions |
| Shared case envelope and build_review | v3 preserves all old records/fields and filters by domain | Existing build_review effects/suppressions do not operate on PRD/as-built domains | Compatible shared storage; no behavioral overlap |
| Repair admission and budget settlement | Actual admitted/started/completed facts retain their existing owner/receipt | History replay imports facts without another append, restage, or charge | Compatible ordering; no budget oscillation |
| Required enrollment and code-valid reuse | Code-valid raw verdict is retained while required-history eligibility is checked | Lost/malformed history stops before success; restoration does not delete raw evidence | No stale-result bypass or lost-state reset |
| Rebase/rewind and history retention | Existing invalidation removes current eligibility while retaining facts | Historic facts never reactivate invalid raw verdicts or supersede fresh authority | Compatible invalidation boundaries |
| Legacy recovery and refusal/evidence defects | Only a valid known legacy gap can receive a bound acknowledgement | Acknowledgement neither fixes corruption nor accepts a finding/refusal | No authority laundering |
| Provider dispatch and retry categories | Both hosts use native schema and original failure precedence | Durable history-attempt bookkeeping cannot turn a rate-limit wait into a repair charge | Compatible provider boundary |
| Existing event/lifecycle and history occurrences | Events follow owned state transitions with execution context | History does not derive authority from time or invent missing terminals | No parallel telemetry channel |

The six types checked are contradiction, behavioral overlap, state conflict, resource contention,
sequencing, and oscillation. Pairs sharing a behavior/authority above were assessed in both
directions; disjoint gate domains do not gain cross-gate matching merely because they share the
store. Compatibility is a design judgment (95%, inferred from the verified normative clauses),
not an execution-test claim. No unresolved load-bearing assumption remains for planning.

## Compatibility basis

The verified compatibility constraints below were retained when applying and re-checking the approved corrections.

- NC widening: #2429 remains sole relationship/decision authority; the general judge cannot
  reverse refusal or broaden criterion scope. Separate authority partitions prevent two writers
  from interpreting the same NC source independently.
- Store coexistence: #2440 D1/D2 explicitly preserves build_review and prd_widening through all
  v3 writers; the approved adjacent #2429 D2 amendment covers the schema extension.
- Repair budgets: pending admission is not execution, and #2753's BUILD-dispatch settlement
  remains authoritative. History imports do not append, restage, or charge a second repair.
- Group ownership: immutable per-member inputs and join-only publication preserve the existing
  single writer; unrelated gate histories are preserved. Failed sibling verdicts cannot inherit
  another member's satisfaction.
- Freshness and rewind: retaining facts is compatible with invalidating current use. History does
  not resurrect an invalid raw review, relax current-HEAD checks, or authorize an operator rewind.
- Recovery: the legacy coverage boundary accepts a known gap in valid evidence, not corrupt or
  foreign state and not a gate finding. The evidentiary-defect prohibition remains intact.
- Provider/event boundaries: native output schemas and original provider-failure categories are
  retained; occurrences use the existing exhaustive sink registry and durable state keeps its
  existing owners.
- Prior conflict reports are historical evidence, not current tooling authority. In particular,
  the #2188 report's foreign-story land refusal is obsolete for existing-path amendments:
  src/conductor/src/engine/engineer/land-spec.ts:691–721 now distinguishes those amendments from
  new feature-owned files. This is verified source evidence, not permission to bypass land.

## Repo-wide corpus inventory

Initial inventory: 522 stories, 60 specs, 307 prior conflict reports, 328 ADRs. All files were
included in the text/subject scan. Active specs exclude explicitly SUPERSEDED files. The broad
lexical scan yielded 108 story, 8 active-spec, 89 prior-report, and 119 ADR candidates; matching a
word was not treated as a conflict. Subject narrowing then retained the shared authority, state,
retry, recovery, and publication clauses listed below for comparison against the new stories.
Other subjects (intake/discovery, installation, unrelated authoring gates, UI, release, worktree
operations, unrelated BUILD rubric judgments) impose no new conflicting behavior on this slice.
Prior reports supplied recurring raw-authority, freshness, single-writer, and protected-artifact
patterns; their historical tool limitations were revalidated against current source.

The four initially unclassified ADR headers used list-prefixed Status fields. They were inspected
and corrected in this inventory: committed-halt-record, park/unpark verbs, and judged-attribution
are approved; operator-park-marker is partially carried forward, so it is narrowed by subject,
not excluded as unambiguously fully superseded. The mixed-build-review successor expressly adopts
its predecessor's non-conflicting state/effect contracts; those inherited constraints remain
covered by the successor comparison. Fully superseded status never discards surviving imported
obligations.

Examined means the overlapping normative clauses and amendments were compared, not that every
historical context paragraph was an implementation requirement. Narrowed out means the subject is
outside this change; the explicit subject appears in each stem. No candidate remains pending.

| ADR | Disposition / reason |
| --- | --- |
| adr-002-engineer-store-and-retro-redirect | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-003-registry-write-and-integration | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-005-non-autonomy-and-read-only-governor | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-006-flywheel-lesson-selection-and-provenance | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-008-agent-hosted-loop-and-in-chat-authoring | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-009-intake-adapter-port | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-010-pidfile-lock-daemon-liveness | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-011-async-intake-queue-and-github-source | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-012-durable-intake-ledger-sole-dedup-authority | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-014-otel-observability-exporter | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-015-daemon-pr-labeling-sweep | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-architecture-before-stories-convergent-kickback | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-brainstorm-rename-migration | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-explore-prd-split-track-in-explore | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-memory-resilience-write-fallback-and-reconcile | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-per-project-memory-provider-selection | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-per-provider-retrieval-guidance-location | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-platform-adoption-and-removal-surface | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-rebase-conflict-resolution-dispatch | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-safe-reversible-memory-migration | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-shared-memory-store-placement-and-durability | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-29-track-marker-location | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-background-intake-brain-loop | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-engineer-worktree-authoring-isolation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-grandfather-cutover-merge-time | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-halt-based-release-gates | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-origin-seeded-intake-routing | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-owner-gate-identity-resolution | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-owner-provenance-recording | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-sandbox-build-isolation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-06-30-self-host-detection-seam | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-01-machine-scoped-operator-identity | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-daemon-auto-restart-stale-engine | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-dependency-fail-closed-and-cache | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-dependency-gate-backlog-waiting-channel | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-engineer-checkpoint-commits-idempotent-land | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-gated-snapshot-status-read-model | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-gated-writeback-announcements | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-07-03-generated-model-table-single-source | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-halt-pr-rehabilitation-at-finish | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-harness-daemon-profile | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-issue-dependencies-api-surface | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-owner-gate-gated-channel | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-post-rebase-force-with-lease | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-pr-timing-config-key | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-pr-timing-self-host-precedence | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-priority-fetch-fail-soft | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-priority-from-linked-issue-labels | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-prose-to-link-migration | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-reactive-model-fallback-ladder | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-03-version-gate-semver-escalation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-auth-failure-park-and-poll | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-autoresolve-state-and-config | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-claim-time-delivery-evidence-guard | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-durable-pause-marker | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-event-driven-halt-clear-wake | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-kickback-event-emission-and-log-prominence | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-operator-park-marker | Narrowed out: partially carried-forward park scheduling, unchanged |
| adr-2026-07-04-park-unpark-cli-verbs | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-pending-restart-queue | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-resolution-worktree-lifecycle | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-respawn-in-place-restart | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-versioned-engine-store-atomic-flip | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-05-daemon-rate-limit-episode-coordinator | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-05-engine-owned-task-status | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-05-halt-pr-presentation-reliability | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-05-retry-as-escalation-ladder | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-05-standalone-bin-update | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-06-daemon-false-ship-guard | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-06-installed-root-resolution-for-global-writes | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-06-manual-test-fail-routing | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-06-migration-gate-waiver | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-06-stale-engine-respawn-in-place | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-07-audit-trail-event-sink | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-07-daemon-owned-build-credential | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-07-finish-record-primitive | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-07-ship-ci-feedback-loop | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-07-single-generation-stale-respawn | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-07-task-trailer-id-alias | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-08-halt-issue-closure-sweep | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-08-main-checkout-leak-triage-and-write-fence | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-08-post-rebase-gate-first-mechanical-reverify | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-09-deterministic-evidence-attribution-enforcement | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-09-setup-failure-triage | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-concurrent-group-core | Examined: shared contract; compatible after approved corrections above |
| adr-2026-07-10-daemon-stall-remediation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-evidence-range-anchor-resolution | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-inline-work-attribution-enforcement | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-intake-claim-priority-banding | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-intra-step-build-progress-events | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-observed-close-watch-registry | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-park-marker-main-root-resolution | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-retire-migration-grandfather | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-session-hook-task-stamping | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-10-validation-group-join | Examined: shared contract; compatible after approved corrections above |
| adr-2026-07-11-attribution-abstain-or-loud | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-11-attribution-spot-audit-measurement | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-11-attribution-verdict-interface | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-11-evidence-judge-cli-and-cutover | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-11-finish-step-engine-completion-machinery | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-11-pipeline-state-durability | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-11-semantic-attribution-verification-lane | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-11-verdict-aware-resume-entry | Examined: shared contract; compatible after approved corrections above |
| adr-2026-07-12-judged-attribution-verdict-persistence | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-12-progress-aware-build-halt | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-12-rebase-evidence-stamp-translation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-12-wired-into-contract | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-12-wiring-check-gate | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-13-kickback-build-no-op-escalation | Examined: shared contract; compatible after approved corrections above |
| adr-2026-07-13-park-all-dispatch-paths | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-13-retry-classify-rerun-vs-route | Examined: shared contract; compatible after approved corrections above |
| adr-2026-07-13-session-fresh-verdict-artifacts | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-17-verify-only-judged-closure | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-20-bounded-dirname-path-corroboration | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-20-ci-fix-dispatch-via-steprunner | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-20-ci-fix-startup-preflight-and-error-classification | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-20-post-rebase-delta-aware-invalidation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-completeness-as-build-review-rubric | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-07-21-decide-time-unmerged-overlap-scan | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-demote-task-stamping-to-telemetry | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-engine-owned-acceptance-red-execution | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-intake-only-enforcement | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-no-diff-task-evidence-stamp | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-owner-stamped-at-authoring | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-s-tier-pipeline-knobs | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-21-serena-removal-path | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-attempts-counter-on-crash-recovery | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-auth-failure-classification-observed-401-patterns | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-build-dispatch-json-usage-capture | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-canonical-tagged-source-ref | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-canonical-tracker-client-seam | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-coherence-gate-placement-and-validation-split | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-coherence-waiver-and-duplicate-claim | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-daemon-level-missing-credential-gate | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-examples-state-isolation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch | Examined: shared contract; compatible after approved corrections above |
| adr-2026-07-22-headless-vs-guided-examples | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-heartbeat-lease-deferred | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-intake-closed-issue-reconciliation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-origin-refresh-before-engine-rebuild | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-per-feature-cost-rollup-in-shipped-record | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-per-task-work-happened-floor | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-phase-scoped-docs-write-guard | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-requeue-claimed-distinct-from-reopen | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-stale-claim-staleness-window-default | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-22-token-liveness-probe-via-cli-invocation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-23-build-review-fresh-base-disposition | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-23-commit-movement-liveness-floor | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-23-intake-label-authority-scoped-replace | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-23-session-hook-repair-before-halt | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-23-trailer-union-build-step-routing | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-24-provider-aware-step-execution-fresh-session-scope | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-25-content-addressed-full-suite-proof | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-25-custom-step-completion-artifacts | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-25-fail-closed-durable-shipment-evidence | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-26-daemon-decide-preseed-ownership | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-26-event-sink-registry-exhaustiveness | Examined: shared contract; compatible after approved corrections above |
| adr-2026-07-26-protected-artifact-seal-rebaseline | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-26-rebase-tail-current-branch-before-publication | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-ancestry-proven-park-reconciliation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-codex-never-resumes-a-harness-minted-session | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-cold-start-within-step-retries | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-cost-unmetered-is-a-first-class-state | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-daemon-decide-kickback-halt | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-project-config-scaffolder | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-27-protected-artifact-seal-self-amendment-visibility | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-28-feature-aware-artifact-resolution | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-28-total-halt-classification-legacy-boundary | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-29-codex-readiness-probe-failure-disposition | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-29-deterministic-build-verification-fanout | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-29-engine-observed-provider-time-partition | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-29-operator-park-scheduling-unit-boundary | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-29-ship-start-draft-pr | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-30-contract-aware-same-file-wiring | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-30-finish-only-mergeability-gate | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-07-30-pinned-remote-theme-for-pages-navigation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-07-30-provider-preparation-lifecycle-supervision | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-01-bot-owned-release-pr | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-01-conduct-state-mutation-port | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-01-engine-owned-resumable-finish-publication | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-01-engine-owned-scoped-test-invocation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-01-multi-proof-park-deletion-authority | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-01-rebase-full-replay-intent-validation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-01-scoped-run-verb-release-surface | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-02-live-tier-asserts-outcomes-not-scripts | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-02-plan-scope-containment-at-commit-boundary | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-03-build-repair-member-reuse-validity | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-03-fail-closed-decide-entry | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-03-ledgered-per-block-migration-execution | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-04-classify-before-spend-release-smoke-gate | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-04-live-tier-provisions-its-own-provider-home | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-04-unresolved-step-command-fails-by-name | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-05-blocked-classification-after-dedup | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-05-blocked-is-a-distinct-state-from-halted | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-05-build-settle-outcome-stamp | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-05-provenance-based-protected-artifact-inheritance | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-05-token-first-stories-reference-normalization | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-05-worktree-classification-evidence-derived-reasons | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-06-bounded-progress-allowance-for-finish-publication | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-06-honest-park-termination-boundary | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-06-publication-progress-is-its-own-disposition | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-07-project-teardown-hook-contract-and-containment | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-07-smoke-gate-goes-live-without-precharacterization | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-07-worktree-removal-coverage-guard | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-08-finish-human-required-halt-rendering | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-08-pipeline-owned-closeout-timestamps | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-08-single-adr-approval-parser-three-rungs | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-adr-contradiction-detection-in-two-halves | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-adr-layer-gated-by-committed-adr-signal | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-bash-yaml-access-via-conduct-ts-config | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-checkout-is-sole-version-identity-authority | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-conductor-block-single-source-of-truth | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-declared-pattern-replication-in-build | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-hook-owned-containment-event-ledger | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-legacy-json-seed-migration-rule | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-non-blocking-plan-scope-containment | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-one-pr-per-branch-halt-is-a-state | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-operator-only-scoped-artifact-reseal | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-recorded-red-exception-for-remediation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-reseal-audit-rides-the-existing-event-spine | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-seal-rotation-authorship-predicate | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-09-worktree-local-provider-scratch | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-11-deprecated-no-op-step-retirement | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-11-halt-events-ride-the-persisted-spine | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-12-cumulative-build-review-convergence-bound | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-12-execution-lifecycle-completeness-for-timing | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-12-fail-closed-intake-ledger-durability | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-12-live-provider-coverage-from-plugin-registry | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-12-operator-reseal-as-second-scope-justification | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-12-per-provider-live-smoke-legs | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-12-removal-anchored-tautology-exemption | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-13-durable-base-advance-attribution | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-13-engine-managed-build-review-rubric-branches | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-13-markdown-default-inversion | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-13-stable-build-review-finding-dispositions | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-14-retire-build-review-wiring-rubric | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-15-verify-only-anchored-tautology-exemption | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-08-16-closed-build-review-finding-vocabularies | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-16-preservation-anchored-completeness-exemption | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-08-16-restore-the-current-head-publication-fence | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-17-framework-agnostic-tautology-scoped-run | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-17-structural-live-checkout-containment | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-18-content-anchored-finding-reference-schema | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-19-live-provider-stream-observation | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-21-engine-identity-in-build-review-cache-key | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-21-review-bound-by-plan-done-when-criteria | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-22-as-built-review-runs-always-with-plan-gap | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-22-build-review-opt-in-rubric-container | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-22-done-when-evidence-at-task-close | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-22-one-owner-per-review-question | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-23-committed-halt-record | Narrowed out: existing halt-record publication is reused unchanged |
| adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-23-criterion-layer-is-structural-at-land | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-23-diff-locality-is-an-authored-disposition | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-24-evidentiary-defects-are-not-waivable | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-24-one-dispatch-member-on-the-provider-contract | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-24-refused-step-status | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-26-music-vocabulary-player-composer-rename | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-26-remove-retrospectives-one-shot | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-26-setup-once-per-worktree-marker | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-26-shared-coherence-parser-at-discovery | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-27-daemon-dispatcher-executor-seam | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-29-build-review-remediate-case-adjudication | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery | Excluded as independent authority: explicitly fully superseded; surviving imported obligations follow successor |
| adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-30-shared-plan-task-reference-resolver | Examined: shared contract; compatible after approved corrections above |
| adr-2026-08-31-coverage-binding-judge-step | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-08-31-kickback-ledger-read-fails-closed | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-02-adr-decision-citability-contract | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-05-gh-cli-version-floor-and-environment-gate | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-06-engine-owned-test-quality-scope | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-06-inbound-intake-trust-boundary | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-06-reopened-task-resolution | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-10-portable-build-review-policy | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-10-separate-custom-review-coverage-identity | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-10-shared-step-lifecycle-telemetry | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-11-github-operation-ownership | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-11-immutable-state-lease-recovery-succession | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-11-selective-post-rebase-verification | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-20-halt-resolution-queue-derived-from-markers | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-23-engine-git-guard-on-agent-path | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-23-one-owner-for-accepted-story-readability | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability | Examined: shared contract; compatible after approved corrections above |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-24-project-owned-pr-body-regions | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-28-skills-may-bundle-executable-helpers | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-29-plan-slice-manifest | Narrowed out by subject: no change to this contract; shared gate names are references only |
| adr-2026-09-30-gate-local-review-finding-continuity | Examined: shared contract; compatible after approved corrections above |

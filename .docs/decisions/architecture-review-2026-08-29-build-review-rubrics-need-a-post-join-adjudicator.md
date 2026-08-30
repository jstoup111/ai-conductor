# Architecture Review: one remediate fan-in for build_review rubric outcomes

**Date:** 2026-08-29
**Feature:** `build-review-rubrics-need-a-post-join-adjudicator-`
(intake `jstoup111/ai-conductor#2033`)
**Tier:** L — full review
**Inputs reviewed:**
`.docs/track/build-review-rubrics-need-a-post-join-adjudicator-.md`,
`.docs/complexity/build-review-rubrics-need-a-post-join-adjudicator-.md`,
`.docs/architecture/build-review-rubrics-need-a-post-join-adjudicator-.md`, and
`.docs/architecture/sequences/build-review-rubrics-need-a-post-join-adjudicator-.md`.
Stories and plan do not exist yet.

> **Amended 2026-08-30 by #2033:** the accepted 11-story artifact and 20-task implementation plan
> now exist and were checked in the post-plan compliance review below. They preserve this review's
> approved boundaries and the successor ADR's mixed-lap correction.
**Operator-selected approach:** B — independent rubric fan-out, shared case machinery/contract, and
the existing `remediate` capability as the single judge; domain-owned effects.
**Verdict:** APPROVED WITH CONDITIONS — original design and mechanical-exhaustion composition
operator-approved 2026-08-29

> **Amended 2026-08-29 by #2033:** conflict-check approved the successor ADR's mixed-lap correction;
> the review remains approved with corrected condition 11 below.

## Executive assessment

The design is feasible and aligns with the repository’s architecture if four boundaries remain
binding: the raw rubric join stays mechanical; operator accepted-risk authority stays separate;
`build_review` emits a durable retry work order but never appends plan tasks; and a previously
attempted semantic case halts instead of receiving a free repeat route. With those boundaries, the
design preserves every existing convergence cap while adding judgement only where semantic
equivalence and prioritization require it.

The material trade-off is explicit: a schema-constrained model judgement may merge or reject a raw
finding, so a bad judgement can remove it from the effective blocking set. That risk cannot be
eliminated mechanically without reintroducing string-match cycling. It is mitigated by source-
complete validation, retained raw evidence, current-lap re-judgement, separate operator authority,
and fail-closed handling of every malformed or incomplete state.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new service, provider API, lifecycle step, or third-party dependency. The design extends the existing rubric coordinator, `remediate` dispatch, kickback ledger, intake adapter, and event spine. |
| Prerequisites | No external prerequisite. Internal prerequisite: the currently documented-but-unwired build_review `remediate` path must become real before case effects can be applied. Current code routes a raw aggregate FAIL directly to BUILD. |
| Integration surface | Broad but coherent: raw/effective build-review reducers, remediation artifact parser and skill contract, conductor failure route, durable case/outbox store, kickback idempotency, BUILD context, intake issue filing, events/sinks, config, and canonical docs. |
| Data implications | One new versioned fail-closed store plus an additive charged-effect field on the existing kickback ledger. No branch-tracked schema migration: both live under `.pipeline/`. Legacy remediation artifacts and ledgers remain readable. |
| Performance | Adds one provider dispatch only when a mechanically complete content FAIL remains after operator dispositions. PASS, empty-registry, accepted-risk-only, and mechanical-fault laps add no dispatch. All prior cases are compact but never silently truncated. |
| Worktree isolation | Case, work-order, kickback, and event state are feature-worktree local. GitHub intake is the only shared external effect and is guarded by a reserved marker/outbox protocol. |
| Rollback | `build_review.adjudication.enabled: false` returns to the current direct raw-FAIL route and stops reading/writing the new case state. Existing raw artifacts and operator dispositions remain valid. |

> **Amended 2026-08-29 by #2033:** mixed laps with valid unresolved content also add one dispatch;
> “mechanical-fault laps add no dispatch” now means infrastructure-only laps.

## Alignment

**Repo-wide ADR sweep performed.** All decision files were enumerated; the applicable fan-out,
finding-identity, operator-disposition, remediation, retry, convergence, state, provider-session, and
event-spine decisions were inspected in full. Governing findings:

| ADR | Bearing | Resolution |
|---|---|---|
| `adr-2026-07-10-concurrent-group-core` | Group core owns capped fan-out, write-disjoint branches, and one join writer. | D1 preserves it exactly; semantic work starts after group settlement. |
| `adr-2026-08-13-engine-managed-build-review-rubric-branches` | The aggregate is mechanical and raw evidence is engine-owned; it reserved a typed post-judgement seam. | New ADR amends only the post-join routing statement, not the raw join. |
| `adr-2026-08-13-stable-build-review-finding-dispositions` | Operator accepted risk is exact, durable, operator-only, and re-read at exits. | D2 keeps a separate store and runs this authority first. Autonomous rejection never impersonates acceptance. |
| `adr-2026-08-16-closed-build-review-finding-vocabularies` and `adr-2026-08-18-content-anchored-finding-reference-schema` | Free text cannot be mechanical identity; LLM equivalence was rejected for auto-matching operator acceptance because false equivalence silently grants risk. | Semantic case binding is a current-lap `remediate` judgement, not an operator-risk matcher. Raw evidence remains, every current source is explicitly mapped, and the result fails closed. The distinct authority is load-bearing. |
| `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` | A mechanical member prevents aggregate publication while allowance remains; exhaustion publishes an aggregate so exact operator reduced coverage can act. | D1 admits no adjudication/effect below the cap. At exhaustion it waits for matching operator reduced coverage before content siblings may enter the semantic fan-in. |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` | Every consumed BUILD kickback increments cumulative; tree movement cannot reset it. | D7 consumes once for each first-time actionable work order. No repeat action route exists, so no exemption weakens the counter. |
| `adr-2026-07-13-kickback-build-no-op-escalation` | A no-work + unchanged verdict halts. | D7 strengthens this: equivalent attempted case is semantic no-progress even if incidental tree movement occurred. |
| `adr-2026-08-22-one-owner-per-review-question` | `build_review` owns test realness; only the approved remediation append seam with prd_audit/as-built authority may grow plans. | The work order is retry context only. No plan append, catalog growth, or new review question. |
| `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` and `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` | SHIP gates own criterion/clause-bound plan growth and its allowances. | #2060 retains domain ownership. Shared case machinery does not share budgets or append authority. |
| `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` and `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` | Auxiliary dispatches are fresh and reach providers through one member. | D3 uses the existing `stepRunner.run('remediate', ...)`; no provider seam is added. |
| `adr-2026-07-13-retry-classify-rerun-vs-route` and `adr-2026-07-13-session-fresh-verdict-artifacts` | Fresh adverse verdicts route; absent/malformed artifacts do not masquerade as content. | The additive case mode has an engine-stamped source/run context and strict freshness; invalid output cannot route or PASS. |
| `adr-2026-07-27-daemon-decide-kickback-halt` | Daemon routing cannot silently re-enter DECIDE and cap checks retain primacy. | Build-review action is BUILD-only; design/product ambiguity is rejected/deferred or halts, never unattended DECIDE. |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine` and event-sink exhaustiveness | Occurrences use `ConductorEvent`; durable control state may remain state. | D9 extends the union/sinks and treats case/outbox state as exception C. |

> **Amended 2026-08-29 by #2033:** the mechanical-lane row is narrowed by
> `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`: pure mechanical laps remain
> non-publishing, while mixed laps preserve and adjudicate valid content siblings without clearing
> infrastructure.

**No approved ADR is violated by the conditioned design.** Two adjacent decisions are amended
explicitly because the behavior really changes: a content FAIL gains a semantic post-join before
routing, and repeated semantic cases strengthen the older tree/no-op escalation.

> **Amended 2026-08-29 by #2033:** repo-wide conflict-check found one approved-story conflict in the
> mechanical-exhaustion composition. The successor ADR resolves it by preserving content adjudication
> on mixed laps; the corrected design has no remaining approved ADR/story violation.

## Domain integrity

### Ownership boundaries

| Domain | Owns | Must not own |
|---|---|---|
| Rubric coordinator/raw aggregate | fan-out, branch validity, exact raw identities, mechanical join | semantic merge, priority, route, external effects |
| Operator disposition reducer | exact operator-accepted risk and reduced coverage | autonomous case judgement or semantic equivalence |
| Remediate case judge | current source-to-case mapping, act/defer/reject/merge judgement, priority | durable ids, budget mutation, issue creation, plan append |
| Case reconciler/outbox | ids, state transitions, completeness, idempotency, effect status | semantic re-derivation from prose |
| build_review adapter | BUILD work order, existing kickback, effective verdict | plan growth, rubric catalog, SHIP gate allowances |
| Intake adapter | sanitized GitHub issue creation and existing labels/dependencies | deciding whether a finding is truly deferred |

### State model

The case store is a discriminated, versioned record—not optional flags layered onto raw findings.
Each current source maps exactly once. Canonical cases carry one disposition and one resolution state;
effects carry one independent state. Invalid combinations are unrepresentable or rejected:

- `act` requires BUILD route plus concrete work and a work-order effect;
- `defer` requires out-of-scope justification plus an intake effect;
- `reject` has no external effect;
- `merged` exists only on a source link and must name a canonical case;
- `applied` effects require their durable work-order or issue reference;
- a repeated `acted` case with attempt evidence cannot transition back to a new reserved effect.

The provider proposes bindings; the engine owns transition legality. Old raw source links are append-
only and never rewritten away, preserving traceability.

### Failure behavior

Every uncertainty is fail-closed: unreadable case state, lock failure, context overflow, stale/missing
remediate output, source omission/duplication, unknown prior-case reference, contradictory routes,
work-order persistence failure, kickback cap, intake lookup/create failure, and unrenderable effective
evidence. None can publish PASS. Mechanical faults below their allowance never consume an action
budget; exhausted faults require exact operator reduced coverage before content adjudication.

> **Amended 2026-08-29 by #2033:** a mixed lap may consume the semantic budget only for a newly
> actionable content work order. Its infrastructure result remains blocking; infrastructure-only
> laps retain the no-charge mechanical behavior.

## Wiring Surface

Design-time commitments; `/plan` must name and order these production paths, and the as-built review
must independently verify their reachability.

| New or changed production surface | Required production caller/consumer |
|---|---|
| Additive build_review case mode in `.pipeline/remediation.json` | emitted only by the existing `remediate` dispatch when engine context names `build_review`; parsed by a source-complete case parser, not the legacy gap-plan parser |
| `RemediationCaseStore` (`.pipeline/remediation-cases.json`) | read before every content adjudication; mutated under lease by reconciliation/effect executor; read by effective verdict and BUILD context |
| Current/prior context assembler | called after raw aggregate validation and operator-risk reduction, before `stepRunner.run('remediate', ...)` |
| Case result validator/reconciler | called after fresh remediation output and before any state/effect/budget mutation |
| Durable BUILD work-order projection | written by the outbox executor; read by BUILD dispatch context using stable effect id, including after restart |
| Idempotent kickback charge by effect id | wraps the existing `consumeKickbackBudget('build_review', ...)`; persists the effect id in the same kickback ledger update that increments counters |
| Semantic-repeat escalation | called before any new charge/route when a current case binds an already-attempted or formerly resolved action case; writes existing `needs-human` HALT and event |
| Deferred intake executor | reserves marker, searches configured repo, then calls existing `fileIntakeIssue`; records open or closed issue ref before effective PASS |
| Effective build-review reducer | consumes raw aggregate, operator dispositions, finalized source outcomes, and required effect status; used at every route/HALT/PASS exit |
| New events | emitted through the current `ConductorEventEmitter`; declared in `EVENT_SINKS`; persisted by the current `EventPersister` |
| Config key | parsed/resolved with the current build_review config and documented in the canonical configuration/gates/steps docs |
| Remediate skill contract | teaches one judge the additive case mode and preserves every existing gap-plan caller unchanged |

### Early overlap scan

`ai-conductor overlap-scan` ran over the coordinator, aggregate/domain, proposed case-store,
remediation parser/skill, conductor, kickback ledger, intake adapter, events/sinks, and config seams.
It returned no report and no actionable overlap. The scan is advisory and cannot see semantic overlap
in specification-only branches.

The substantive known overlaps are intake #2020 (catalog/blocking authority) and #2060 (validation-
group shared remediation accounting). Neither is a prerequisite. `/conflict-check` must re-scan the
same seams after stories and explicitly preserve the ownership split.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation / acceptance |
|---|---|---:|---:|---|
| False semantic merge/reject suppresses a legitimate raw finding from the effective blocker set | Model/correctness | Medium | **High** | Current-lap source-complete judgement; raw evidence retained; confidence/rationale required; separate operator authority; fail-closed schema. This is the irreducible judgement trade-off requiring operator approval. |
| Crash between case reservation, kickback charge, navigation, and effect finalization double-charges or loses BUILD work | Data/integration | Medium | **High** | Stable effect id; idempotent charged-effect set in kickback ledger; durable work order read by BUILD; adversarial restart matrix as a hard condition. |
| Crash after GitHub issue creation creates a duplicate issue | External effect | Medium | High | Reserve hidden marker before call; exact open+closed search before every create; reconcile marker to issue ref; create failure blocks. |
| A repeated acted case is misclassified as equivalent and halts a fixable new defect | Model/availability | Low-Medium | High | Halt contains both raw sources and case rationale; no risk is accepted and no finding is erased. Operator can inspect/restart after correction. |
| All-case context grows beyond provider limits | Performance/availability | Low | Medium | Bound every field and total bytes; include all or halt, never silent truncation. Follow-up compaction requires its own ADR. |
| New case mode breaks existing SHIP/stall remediation readers | Compatibility | Low | High | Discriminated additive mode; legacy artifact fixtures and every current caller must pass unchanged; kill switch reverts build_review only. |
| build_review accidentally appends remediation tasks and steals plan-growth authority | Architecture | Low | **High** | Explicit no-append condition, negative integration test, and source-gated appender remains limited to prd_audit/as-built. |
| Exhausted mechanical/content aggregate performs content effects before reduced coverage is authorized | Correctness/authority | Low | High | Infrastructure authority is resolved first; without exact operator reduced coverage there is no remediate dispatch or effect. Below-cap faults publish no aggregate. |
| #2060 independently invents a second judge or incompatible case format | Integration | Medium | Medium | Shared ADR contract plus targeted issue comment after this spec PR exists; #2060 owns only downstream domain effects. |

> **Amended 2026-08-29 by #2033:** the corrected risk is accidental clearing, hiding, or semantic
> charging of infrastructure during mixed-lap content adjudication. Infrastructure is excluded from
> `remediate`, retained in the effective blocker set, and clearable only by healing or exact operator
> reduced coverage; only a new content work order takes the semantic charge.

## Verify-claims ledger

| Claim | Confidence / basis | Result |
|---|---|---|
| Current build_review raw FAIL routes directly to BUILD and does not dispatch `remediate`. | 99% verified in the daemon failure block in `conductor.ts`; it reads the aggregate, checks effective operator dispositions, consumes `build_review`, emits kickback, and navigates to BUILD. | Corrects the older skill prose; D3 is real new behavior. |
| Rubric coordinator outputs are independent and the aggregate join is mechanical. | 99% verified in `build-review-coordinator.ts` and `build-review-aggregate.ts`. | D1 composes with existing machinery. |
| Operator dispositions are feature-local, leased, atomically replaced, and fail closed on store errors. | 99% verified in `build-review-dispositions.ts`. | Valid precedent for store mechanics, but not a reason to share authority/schema. |
| Existing plan remediation admits plan growth only from validated prd_audit/as-built provenance. | 99% verified in `planRemediation` and its `requiresPlanGrowthAllowance`/admission branches. | build_review must use a work order, not append tasks. |
| Kickback `cumulative` increments unconditionally on every consumed route. | 99% verified in `bumpKickbackGate`; approved by the cumulative-bound ADR. | D7 cannot introduce a free repeated route. |
| Current intake creation is not idempotent. | 98% verified in `engine/engineer/intake/file-issue.ts`: it creates, then applies labels/dependencies, with no pre-create effect-key lookup. | Marker/outbox reconciliation is required. |
| Existing remediation artifact is overwritten run evidence with one disposition per gap. | 99% verified in `artifacts.ts` and `skills/remediate/SKILL.md`. | New mode must be discriminated and freshness-bound. |
| Event persistence already has an exhaustive event-to-sink declaration. | 99% verified in `types/events.ts`, `event-sinks.ts`, and `event-persister.ts`. | Extend the spine; no sidecar. |
| All feature-local prior cases can fit in one bounded provider input. | 70% inferred; future rubric count and rebase invalidations can grow history. | Not assumed: overflow halts. |

**Verdict:** CLEAR for an operator decision. No unresolved factual assumption is permitted to turn
into fail-open behavior; the one low-confidence sizing assumption is guarded by a hard overflow halt.

## ADR created

- `adr-2026-08-29-build-review-remediate-case-adjudication.md` — **APPROVED**, operator-approved
  2026-08-29. An ADR is required because the feature introduces durable state/outbox transitions,
  assigns a new judgement authority after the raw join, and strengthens semantic no-progress routing.

> **Amended 2026-08-29 by #2033:** that ADR is superseded by
> `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, which retains the case/outbox
> design and corrects mixed-lap transition precedence.

## Conditions binding on stories and plan

1. **No plan growth from build_review.** Its `act` output becomes a durable BUILD work order/retry
   context only. A negative acceptance test must prove the active plan and growth ledger are unchanged.
2. **No free semantic loop.** Only a not-yet-attempted or crash-interrupted stable effect may resume
   without a second charge. An attempted equivalent case and a reappearing resolved action case halt.
3. **Crash matrix before happy-path implementation is accepted.** Tests cover failure/restart after
   reservation, after kickback charge, after work-order persistence, after navigation, after issue
   creation, and after effect finalization; each yields at most one charge/issue and no lost work.
4. **Source completeness is atomic.** One missing/duplicated current finding invalidates the whole
   case result before any effect. Valid siblings from a malformed adjudication are not partially
   applied.
5. **Operator authority remains exact and first.** Autonomous case state is never written to or
   interpreted as the operator disposition store, and late acceptance is re-read at every exit.
6. **All prior cases or halt.** The context assembler may bound fields and total bytes but may not
   truncate history silently.
7. **Legacy remediation compatibility.** Existing prd_audit, as-built, finish, and build-stall plans
   parse/route byte-for-byte unchanged when no case-mode discriminator is present.
8. **Deferred intake is idempotent and traceable.** The hidden marker is reserved before external
   I/O, search covers open and closed issues, and PASS requires a recorded issue reference.
9. **Event-spine completeness.** Every new occurrence is in `ConductorEvent` and `EVENT_SINKS`; no
   standalone log/state artifact is treated as telemetry.
10. **Adjacent intake handoff.** Once the spec PR URL exists, comment on #2033 with the authoritative
    scope and on #2060/#2020 only where needed to prevent duplicate judge/contract ownership.
11. **Mechanical exhaustion composes before semantic judgement.** Below-cap infrastructure faults
    remain non-publishing. Exhausted faults permit content adjudication only after exact operator
    reduced coverage resolves every infrastructure branch.

    > **Amended 2026-08-29 by #2033:** this condition now distinguishes pure-mechanical and mixed
    > laps. Infrastructure-only below-cap laps remain non-publishing. Mixed laps send valid content
    > siblings through one adjudication and may route newly actionable work, while infrastructure
    > remains independently blocking and only healing or exact operator reduced coverage can permit
    > PASS.
12. **Foreign-stem amendments land first.** The three approved corrections to older accepted
    story/spec artifacts ship through companion PR #2066, the repository-supported path around the
    composer stem-isolation gate. Do not hand #2033 to BUILD until that companion is on `main`.

## Conflict-check amendment

The operator approved the mixed-lap correction on 2026-08-29 after repo-wide conflict-check exposed
that the earlier mechanical-exhaustion amendment contradicted the already accepted contract for a lap
containing both a real finding and a mechanical fault. The corrected condition 11 above supersedes
the narrower reduced-coverage-first wording. It does not weaken the mechanical lane: pure mechanical
laps remain non-publishing, infrastructure never enters autonomous judgement, and autonomous state
still cannot grant reduced coverage. It prevents infrastructure from erasing or delaying valid
sibling content, matching the selected fan-out/fan-in design.

## Recommendation

Approve the ADR and proceed to stories with the conditions above. This is the smallest design that
preserves independent rubrics, uses the already-owned `remediate` judgement capability, keeps all
bookkeeping deterministic, and closes cycling rather than merely moving it behind a new counter.

## Post-plan compliance review — 2026-08-30

**Mode:** recurring architecture check after the implementation plan
**Plan reviewed:** `.docs/plans/build-review-rubrics-need-a-post-join-adjudicator-.md`
**Verdict:** APPROVED — no architectural drift and no new condition

The plan realizes the approved component boundaries without adding a second judge, lifecycle step,
provider member, external service, or rubric. Shared `remediation-case-*` modules own the bounded
case schema, leased state, reconciliation, and effect lifecycle; `build-review-adjudication.ts` owns
the domain projection and closed transition; `conductor.ts` remains the production navigation
caller. This matches the component and sequence diagrams updated with the planned module names.

Condition-to-plan confirmation:

| Binding condition | Plan evidence | Result |
|---|---|---|
| No plan growth from build_review | Tasks 9, 12, and 20 require byte-identical plan/growth state and forbid append calls/writes. | Satisfied by design |
| No free semantic loop | Tasks 10 and 17 persist stable charged effect ids and halt attempted/regressed cases independent of tree movement. | Satisfied by design |
| Crash recovery across every effect boundary | Tasks 2, 12, 13, and 19 define leased state, reservations, exact replay, and the full fault-injection matrix. | Satisfied by design |
| Atomic source completeness and all-history input | Tasks 3–5 and 15 reject truncation, omission, duplication, and partial reconciliation before effects. | Satisfied by design |
| Exact operator authority remains separate and first | Task 16 re-reads the existing disposition store at every exit and tests both stores for cross-write absence. | Satisfied by design |
| Legacy remediation remains compatible | Tasks 1, 6, and 20 keep the no-mode parser unchanged and reject mixed/unknown case modes. | Satisfied by design |
| Deferred intake is idempotent | Tasks 11, 13, and 19 reserve stable markers, search open and closed issues, and recover after remote creation. | Satisfied by design |
| Event-spine completeness | Task 14 extends `ConductorEvent` and `EVENT_SINKS` and explicitly forbids a second writer/file. | Satisfied by design |
| Mixed-lap content and infrastructure compose without erasure | Tasks 3, 8, 15, 18, and 20 exclude infrastructure from semantic input, retain it as a blocker, and test both transition directions. | Satisfied by design |
| Adjacent ownership stays separate | The plan adds no rubric catalog member and no SHIP budget/append behavior; #2020 and #2060 remain handoffs. | Satisfied by design |
| Foreign-stem amendments land first | Companion PR #2066 contains only the three accepted-artifact corrections rejected by the feature-stem land gate. | Satisfied as delivery dependency |

The task dependency graph is acyclic and orders durable state and validation before effects, effects
before orchestration, orchestration before conductor navigation, and all recovery seams before the
compatibility closeout. Production state defaults are filesystem-backed under the feature worktree;
tests use injected fakes only at provider and tracker boundaries. No new security boundary, shared
port, database, package, or migration appears.

The prior High-impact risks remain real and already operator-accepted with concrete task coverage;
this pass introduces no new risk or load-bearing assumption. No new ADR is warranted because the
plan implements the already approved state architecture and component ownership rather than making
another structural decision.

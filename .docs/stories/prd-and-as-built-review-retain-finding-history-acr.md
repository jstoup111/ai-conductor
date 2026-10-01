**Status:** Accepted

# PRD and as-built review retain finding history across laps

Technical track; source jstoup111/ai-conductor#2440. Governing architecture: approved `adr-2026-09-30-gate-local-review-finding-continuity` D1-D12. The operator confirmed full continuity within each gate, excluding combined routing/budget redesign, cross-gate equivalence, and unrelated verdict-parser migrations. Existing #2429 widening authority and #2188 typed as-built behavior are preserved.

These stories describe observable behavior introduced by this slice. Existing widening/typed-review stories remain their owners; preservation criteria here exercise them only across the new history boundaries. All claims about required behavior derive from the approved ADR and operator scope. No unconfirmed behavior assumption is introduced.

## Story 1: Upgrade history without losing another gate's records

**Requirement:** ADR D1-D2; preserve existing authority and history.

As an operator, I want existing finding and decision records to survive the history upgrade and later reviews.

### Acceptance Criteria

#### Happy Path
- Given a feature with supported older history containing build-review cases, effects, suppressions, and PRD widening provenance, when history is upgraded, then every original record and reference remains attributable to the same feature with unchanged authority.
- Given upgraded history containing both review gates, when a build-review or widening operation updates its own records, then both review histories and all unrelated records remain intact.
- Given both review gates have a finding with the same report-local label, when their histories are recorded and reread after restart, then their observations remain separate and neither gate inherits the other's relationships or approval.

#### Negative Paths
- Given malformed, unsupported-version, or foreign-feature history, when an upgrade or mutation is requested, then the operation reports the specific defect and leaves the stored bytes unchanged.
- Given an older writer attempts to replace an upgraded envelope without its new histories, when the write reaches validation, then it is refused and none of the histories is lost.
- Given a model attempts to supply an original operator decision, durable identifier, or another gate's relationship, when its result is consumed, then those unauthorized fields/references are rejected without altering authority.
- Given a lease failure or failed atomic replacement during upgrade, when the operation settles, then the original history is readable and no successful migration or gate completion is claimed.

### Done When
- [ ] Fixtures upgraded through the production history boundary retain the original record values and cross-references after both existing writer families run.
- [ ] Restart reads recover both gate histories independently, and refused mutations leave an identical prior persisted value.

## Story 2: Distinguish fresh history from lost required history

**Requirement:** ADR D2/D7/D9; missing history must be explicit.

As an operator, I want missing required history to stop the review instead of being interpreted as an empty past.

### Acceptance Criteria

#### Happy Path
- Given a feature has never run the gate and has no evidence of earlier review, when the first review begins, then it starts with an explicitly fresh history and establishes that history as required before dispatch.
- Given initialized history was persisted but execution stopped before its enrollment reference was saved, when the feature resumes, then the matching initialized history is recovered without inventing a legacy gap or another initialization.
- Given an enrolled gate has complete matching history after restart, when entry or completion is checked, then the same required-history identity is used and existing current evidence can proceed.

#### Negative Paths
- Given an enrolled gate's history has disappeared, when any entry, completion, retained-result, or final-publication check runs, then it returns a lost-required-history result and cannot pass using an empty history.
- Given an enrollment reference names another feature, gate, or unavailable history generation, when it is read, then the mismatch is reported and neither a provider dispatch nor a success verdict is authorized.
- Given history initialization succeeds but the required enrollment write fails, when the first review is prepared, then the provider is not invoked and the matching initialized history remains recoverable.

### Done When
- [ ] First-use and missing-enrolled-history inputs produce distinguishable production results.
- [ ] Fault injection between initialization and enrollment recovers the same identity; a missing enrolled store prevents entry and completion.

## Story 3: Recover legacy history without inventing continuity or approval

**Requirement:** ADR D2/D10; original evidence and explicit legacy coverage boundaries.

As an operator, I want an upgrade to disclose what history it can recover and require my decision for an acknowledged gap.

### Acceptance Criteria

#### Happy Path
- Given supported legacy review evidence includes attributable decisions, findings, pending repairs, and recorded outcomes, when it is imported, then all recoverable facts retain their original provenance and repeated import creates no duplicate fact.
- Given a valid legacy feature has an unreconstructable earlier interval, when recovery is evaluated, then it stops with legacy-history-incomplete and identifies the missing interval and the known evidence it retained.
- Given the engine offered a new coverage boundary for that valid legacy gap, when the attributed operator explicitly selects it with a rationale against the same feature/gate/evidence, then the gap and approval remain visible in subsequent history while review begins from the approved boundary and all known prior records remain.

#### Negative Paths
- Given a legacy source cannot prove whether a repair ran or succeeded, when import runs, then no attempted/completed/resolved fact is invented and the missing provenance remains explicit.
- Given a recovery halt was cleared without an explicit choice, rationale, or attributable operator, when recovery resumes, then no coverage-boundary approval is recorded and the gap still blocks.
- Given the offer's evidence, feature, gate, or immutable reference changed, when an earlier choice is replayed, then it cannot authorize the changed boundary; replay of an already-applied unchanged choice is inert.
- Given corrupt, foreign, or previously enrolled lost history, when a coverage-boundary choice is supplied, then that path is refused and restoration remains required.
- Given a valid boundary acknowledgement coexists with a refused widening or current blocking finding, when completion is checked, then the acknowledgement does not accept that finding, erase the refusal, or pass the gate.

### Done When
- [ ] Repeated import and acknowledgement produce one attributable record with preserved known evidence.
- [ ] Every invalid acknowledgement variant leaves the gap blocking; successful acknowledgement alone leaves existing finding authority unchanged.

## Story 4: Give each reviewer complete bounded history

**Requirement:** ADR D3-D4/D7; history-aware review in both execution shapes.

As a reviewer, I want the relevant original findings, decisions, attempts, and resolution evidence before judging the current implementation.

### Acceptance Criteria

#### Happy Path
- Given a gate has open, resolved, absent, uncertain, and reopened cases, when its next review is dispatched, then its input includes each case with original/current evidence, applicable decision references, repair facts, resolution evidence, and any acknowledged legacy gap.
- Given equivalent feature state is reviewed serially or in a concurrent validation group, when the reviewers are dispatched, then each receives the same gate-local history content and authority for the same evidence snapshot.
- Given both gates run concurrently, when one gate's history differs from the other's, then each input remains attributable to its intended member with no transfer of sibling-only case authority.
- Given inputs fit all approved history limits, including values exactly at an individual boundary while other dimensions fit, when prepared, then they are retained completely; the gate's pre-existing input requirements remain enforced.

#### Negative Paths
- Given required original evidence or governing references cannot be read, when a history projection is prepared, then the affected gate and evidence are named and no incomplete projection is dispatched.
- Given any approved count or byte bound is exceeded, when input is prepared, then the result names the dimension, actual value, and limit and preserves the untrimmed stored history without a provider call.
- Given a sibling gate changes after one member's immutable input was prepared, when that member is dispatched, then it receives its own prepared history and never the sibling's replacement context.
- Given PRD decision capture fails before review, when general history preparation is attempted, then the failure remains blocking and an input without the required original authority is not substituted.

### Done When
- [ ] Captured serial and concurrent production dispatch inputs contain the expected complete histories with member separation.
- [ ] Boundary/overflow cases distinguish byte limits from character counts and prove that incomplete inputs never reach the provider.

## Story 5: Account for every finding and prior case

**Requirement:** ADR D3/D5; complete typed reconciliation.

As an operator, I want every reported finding to have a traceable relationship result, including findings that require human decisions.

### Acceptance Criteria

#### Happy Path
- Given a review contains criterion failures and NC findings, or as-built BLOCKED findings, PLAN_GAP findings, and nonblocking drift notes, when reconciliation is published, then every current finding has exactly one traceable result and every supplied prior case has an accounted-for outcome.
- Given two current observations describe the same retained case, when a valid relationship judgment relates them, then both source observations remain individually traceable to that case without replacing the original evidence.
- Given a known fresh history has no prior obligations, when current observations are recorded, then the engine establishes the explicit initial history without paying for an unnecessary semantic comparison; PASS evidence creates no fabricated defect.
- Given a changed non-NC source has relevant prior history, when reconciliation judges it, then it records new-case, same-case, or uncertain with reasons and supplied evidence references, and new durable identities remain engine-owned.

#### Negative Paths
- Given a result omits or duplicates a current source or prior case, when validation runs, then publication is rejected with the coverage defect and no partial batch becomes effective.
- Given a result cites an unknown, foreign-feature, sibling-gate, or unsupported evidence reference, when validation runs, then the result is rejected without linking the source to that record.
- Given source-level and case-level outcomes contradict one another, when they are validated, then the contradiction is reported and cannot become effective history.
- Given the existing NC reconciliation partition fails or remains unaccounted for while general PRD reconciliation succeeds, when the PRD batch is assembled, then no complete PRD result or clean completion is claimed.

### Done When
- [ ] One validated batch accounts for the entire supplied source/case sets, including nonblocking and human-owned findings.
- [ ] Missing, duplicated, foreign, contradictory, and partial-partition results leave prior effective history untouched.

## Story 6: Resolve repeated assertions from current evidence

**Requirement:** ADR D5-D6/D9; equivalence, resolution, and recurrence remain judgments under current authority.

As an operator, I want repaired findings to stay resolved through wording changes while real recurring defects remain actionable.

### Acceptance Criteria

#### Happy Path
- Given an earlier resolved finding reappears with changed wording, order, or report-local label and unchanged underlying facts, when current evidence supports the same case and its resolution, then the repeat remains attached to that case and does not create a new unresolved obligation.
- Given a previously resolved defect materially recurs or changes, when current evidence establishes recurrence, then the case reopens with the reason and evidence retained alongside its prior resolution.
- Given an earlier finding is absent and current evidence establishes that its criterion or approved clause is satisfied, when reconciliation records resolution, then that evidence and the current judgment are retained without deleting the original finding.
- Given an earlier finding is absent but current evidence cannot establish resolution, when its history is reconciled, then it is recorded as not-observed and its prior resolution/refusal evidence remains intact.

#### Negative Paths
- Given only an earlier autonomous dismissal, another gate's approval, or a matching summary supports a proposed resolution, when the result is checked, then it cannot clear the current finding.
- Given a proposed reopening cites only changed wording, ordering, or labels without material current evidence, when it is checked, then it cannot create a justified reopened obligation; the unsupported judgment remains unresolved.
- Given a repair task is merely admitted, started, or marked complete without current criterion/clause evidence, when resolution is proposed, then it is not accepted as a verified repair.
- Given the available evidence cannot distinguish same-case from a different defect, when judgment returns uncertainty, then the affected source remains explicitly unresolved and the engine does not repeatedly ask for a more favorable answer on identical input.

### Done When
- [ ] A reworded resolved finding, a materially recurring defect, and an absent unproven finding produce distinct retained outcomes through the production reconciliation boundary.
- [ ] Every effective resolution/reopening has current evidence and a reason; historical authority alone never manufactures that evidence.

## Story 7: Preserve each gate's approval boundaries

**Requirement:** ADR D1/D5-D6/D9; preserve #2429's original decision semantics.

As an operator, I want finding continuity to preserve the exact scope of my decisions and each gate's governing authority.

### Acceptance Criteria

#### Happy Path
- Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override.
- Given a story-criterion decision applies to one criterion, when nearby findings are reconciled, then the decision remains scoped to its original criterion and unrelated criteria retain their own grades.
- Given an as-built finding requires an unapproved architectural decision, when its history is reconciled, then it remains a human decision under the governing ADR/plan authority even when another gate approved related work.

#### Negative Paths
- Given general-history judgment contradicts or broadens a validated NC binding, when the complete result is assembled, then it is rejected and the original widening authority is retained.
- Given the latest operator revision refuses a widening, when an older acceptance, ordinary cleared halt, or legacy coverage acknowledgement is replayed, then it cannot supersede that refusal.
- Given a result converts DESIGN to REMEDIABLE or grants a missing architectural choice solely from prior history, when effective classification is evaluated, then that conversion is refused and no unauthorized repair route is created.

### Done When
- [ ] New history integration preserves original NC case/decision references and criterion scope across replay and changed wording.
- [ ] Unauthorized widening, decision reversal, and architectural conversion remain blocking with attributable diagnostics.

## Story 8: Publish and resume reconciliation without stale or duplicate effects

**Requirement:** ADR D7/D10; freshness, atomic publication, and replay.

As an operator, I want a restart or concurrent update to preserve completed judgment without applying it to changed evidence.

### Acceptance Criteria

#### Happy Path
- Given a reconciliation batch is published against a frozen gate input, when the same input is encountered again, then the stored result is reused without another judgment, duplicated observation, or repeated effect.
- Given the process stops after history publication but before its completion reference is recorded, when it resumes, then the matching receipt completes that reference and keeps the same judgment and case identities.
- Given another gate publishes an unrelated history update, when this gate checks its unchanged relevant snapshot, then the unrelated update neither erases records nor invalidates its usable judgment.
- Given one concurrent member supplies valid current history while a sibling fails to produce a verdict, when the join settles, then valid sibling history is retained and the failed sibling is not marked satisfied.

#### Negative Paths
- Given source evidence, code, governing artifacts, operator revision, repair evidence, or the relevant contract changes during judgment, when publication rechecks its snapshot, then stale output is refused and prior authority is not overwritten.
- Given history replacement or the completion-reference write fails, when execution stops, then no incomplete batch qualifies a gate and the recoverable persisted state identifies which publication step remains incomplete.
- Given a current reference names a missing or mismatched receipt, when reuse is attempted, then no success is granted and the named inconsistency remains recoverable.
- Given rebase or normal invalidation makes current review evidence unusable, when reuse is considered, then its existing authority rules prevent reuse while the historical cases remain available for fresh review.

### Done When
- [ ] Injected crashes on either side of publication recover the same batch or stop explicitly, with no repeated judgment/effect.
- [ ] Relevant mutations reject stale results, unrelated gate mutations preserve reuse, and failed group members never inherit sibling satisfaction.

## Story 9: Retain actual repair attempts after reports are replaced

**Requirement:** ADR D8; repair provenance without new routing ownership.

As a reviewer, I want to see what repair was actually admitted and executed instead of assuming an intended repair succeeded.

### Acceptance Criteria

#### Happy Path
- Given an existing repair path admits appended or existing tasks for a finding, when admission is recorded, then history binds the exact admitted tasks and repair identity to that finding without independently appending work.
- Given that repair starts and later completes, fails, or is interrupted, when the responsible execution transition records its evidence, then history distinguishes those actual states and retains them for the next review.
- Given successful as-built review projects pending repair findings into its current verdict, when pending evidence is cleared or a later verdict replaces it, then attributable finding, attempt, and outcome facts remain available from durable history.
- Given repair admission was durable but history import failed, when the feature resumes, then the existing admission is imported once without another task append, budget charge, or invented repair execution.

#### Negative Paths
- Given append/admission fails or its binding cannot be proven, when repair history is assembled, then no successful admission is invented and the missing binding produces a named recoverable result.
- Given an admitted task never dispatched because an existing cap stopped BUILD, when the next history is read, then it remains admitted/unexecuted and cannot be presented as completed or resolved.
- Given history cannot retain pending finding/outcome evidence, when clearing or replacement would occur, then the required pending evidence is kept and the persistence failure blocks that transition.
- Given a matched case already has recorded attempts, when history is supplied to remediation, then history itself neither appends tasks nor changes planner dispositions, kickback caps, plan-growth accounting, or combined routing policy.

### Done When
- [ ] Production admission and execution transitions produce attributable, distinct attempt states that survive verdict replacement.
- [ ] Partial import recovery does not duplicate a repair or alter existing budget totals, and retention failure does not erase pending evidence.

## Story 10: Use one effective result at every completion boundary

**Requirement:** ADR D6-D7/D9; consistent completion with no review/join cycle.

As an operator, I want every completion and publication check to agree on whether current review evidence is sufficient.

### Acceptance Criteria

#### Happy Path
- Given raw review and current validated reconciliation jointly establish satisfaction, when serial routing, group completion, retained-sibling reuse, or final publication is evaluated, then each uses the same effective classification and source trace.
- Given a repeated criterion failure is resolved by evidence of that exact criterion's current satisfaction, when the effective result is derived, then that source can clear while unrelated grades remain unchanged.
- Given a repeated as-built PLAN_GAP is resolved with explicit evidence that its affected outcome is currently delivered, when the effective result is validated, then existing delivery and gate rules apply to that outcome rather than a guessed success.
- Given a concurrent branch has valid reviewer output but awaits join-owned reconciliation, when branch validation finishes, then it reaches the join without retrying solely because final history publication has not yet occurred.

#### Negative Paths
- Given raw reviewer success coexists with pending, corrupt, missing, stale, or uncertain required history, when any completion boundary runs, then the gate cannot pass and the specific history condition is returned.
- Given one resolved source coexists with an unrelated criterion failure, unexplained violation, or parser/completeness fault, when effective classification runs, then the unrelated failure remains and prevents any success it previously blocked.
- Given an as-built outcome is claimed delivered without current evidence, when resolution would clear a PLAN_GAP, then that resolution is rejected and the original delivery failure remains.
- Given the history result is unavailable at a completion reader, when completion is queried repeatedly, then the reader reports its state without invoking a provider, matching prose, or turning absence into a pass.

### Done When
- [ ] The same fixtures yield consistent classifications at serial, group, retained-result, and final-publication boundaries.
- [ ] A valid branch reaches the join once; unresolved final evidence blocks publication without hidden judgment calls or an infinite retry cycle.

## Story 11: Enforce the same bounded judgment contract on both providers

**Requirement:** ADR D5/D10-D11; provider parity and mechanical failure ownership.

As an operator, I want Claude and Codex to produce equivalent validated history results and preserve existing provider failure handling.

### Acceptance Criteria

#### Happy Path
- Given equivalent Claude and Codex adapter fixtures return the same valid structured reconciliation, when invoked through the production provider path, then both receive the engine-owned contract and produce equivalent history results apart from engine run identity.
- Given the configured reconciliation allowance is two attempts and one mechanical attempt failed before restart, when the resumed second attempt fails, then the same gate/input reaches exhaustion without resetting the allowance or charging BUILD/plan growth.
- Given a successful or uncertain result already exists for unchanged frozen input, when either provider would otherwise be invoked again, then the recorded result is reused and no additional semantic opinion is requested.

#### Negative Paths
- Given the selected provider cannot enforce the required native output contract, when dispatch is prepared, then it is refused with the provider and missing capability named and no unconstrained fallback result is accepted.
- Given terminal structured output is missing or malformed but prose contains a plausible result, when it is consumed, then the attempt is a mechanical failure and prose is not parsed as successful reconciliation.
- Given authentication, rate-limit, or provider availability handling applies, when an incomplete result is received, then the original provider category retains precedence rather than being relabeled as a finding or ordinary schema error.
- Given repeated mechanical failures exhaust the configured allowance, when execution settles, then a named recovery stop preserves prior history and no successful relationship or repair is manufactured.
- Given the provider times out or becomes unavailable during reconciliation, when the attempt settles, then that failure category and spent attempt survive restart while prior authority is preserved and no partial relationship is accepted.

### Done When
- [ ] Both fake provider adapters traverse the actual structured-result boundary with equivalent accepted/rejected outcomes.
- [ ] Restart preserves spent attempts, uncertainty reuses the same result, and failure classification leaves BUILD/growth totals unchanged.

## Story 12: Make history outcomes and recovery traceable

**Requirement:** ADR D9-D11; human-readable evidence and existing event spine.

As an operator, I want to trace each finding to its history and know which evidence or decision is needed when continuity fails.

### Acceptance Criteria

#### Happy Path
- Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence.
- Given a reconciliation transition starts, completes, reuses a result, reopens a case, or fails, when its owning transition is recorded, then the occurrence reaches the existing event stream with gate and execution attribution plus applicable batch/source/case references and bounded reasons.
- Given a recovery condition names lost history, malformed/foreign/unsupported state, incomplete legacy provenance, overflow, missing evidence, uncertainty, stale input, provider failure, or publication failure, when it is surfaced, then the operator sees the affected gate/evidence and the corresponding recoverable action while valid retained authority remains available.

#### Negative Paths
- Given a state publication fails, when reports/events are emitted, then they do not claim that the unpublished resolution or completion succeeded; the failure remains attributable to the attempted transition.
- Given rendered report text is edited or contains history-like material, when effective completion is read, then it cannot create relationships or approvals; derived as-built text and generated history sections are not reparsed as authority.
- Given an overflow or corruption report, when recovery is presented, then it does not silently prune, reset, or delete history or represent such destruction as restoration.

### Done When
- [ ] Production views retain source/case and decision attribution for both clean and stopped outcomes.
- [ ] Existing event persistence receives attributable transition records, including failure; editing derived text cannot change effective history authority.

## Coverage disposition

All criteria above describe new behavior at this feature's boundaries, or preservation exercised through those new boundaries. None is marked covered solely by an older test or a prompt wording check. The plan must name the concrete test owner and selector for each criterion before BUILD.

Use lower-layer behavioral proofs for schema permutations, reference ownership, byte/count limits, immutable history, source/case completeness, effective-grade derivation, and retry arithmetic. Use focused production-boundary integration for storage migration through actual writers, dispatch context, typed-provider consumption, publication/restart recovery, repair evidence, completion/fence integration, and event/report outputs. A full-system spec is reserved for a distinct multi-step flow whose interactions cannot be proved at these boundaries; it does not duplicate every failure permutation. Third-party boundaries are replaced with faithful local fakes.

## Planned behavioral proof groups

Each criterion below has a planned proof disposition; these are proof subjects, not claims that tests already exist. The plan assigns concrete owners/selectors. Integration means the minimum real internal boundary with local state and fake external adapters, never an unrestricted full conductor run.

| Criteria | Lowest sufficient proof | Concrete proof subject |
| --- | --- | --- |
| S1.1–S1.7 | Store/writer integration | Migration preservation and refused mutation inventories, using temporary state and injected lease/write failures |
| S2.1–S2.6 | Entry/completion integration | Fresh enrollment versus missing required history and both sides of the enrollment crash window |
| S3.1–S3.8 | Recovery-boundary integration | Legacy import, bound explicit operator choice, idempotent replay, and rejection without changed authority |
| S4.1–S4.3 | Dispatch-boundary integration | Captured serial/group member history inputs with distinct gate records |
| S4.4–S4.8 | Lower-layer projection/entry tests | Exact limits, overflow/unreadable evidence, immutable input and capture-failure short circuit |
| S5.1–S5.4 | Coordinator integration | Complete current/prior results, shared-case source traces, initial-history shortcut, and engine identity stamping |
| S5.5–S5.8 | Lower-layer contract/partition tests | Missing, duplicate, foreign, contradictory, and incomplete-partition rejection |
| S6.1–S6.8 | Lower-layer reconciliation/classification tests | Current evidence distinguishes continued resolution, recurrence, not-observed, and uncertainty |
| S7.1–S7.6 | Authority-adapter integration | Existing NC decisions and criterion/ADR authority survive general-history publication and replay |
| S8.1–S8.8 | Publication/restart integration | Receipt/checkpoint crash windows, relevant versus sibling mutations, failed member retention and invalidation |
| S9.1–S9.8 | Repair-boundary integration | Actual admission/execution facts, idempotent partial import, retained pending evidence and unchanged budgets |
| S10.1–S10.8 | Completion-boundary integration | Effective classification across serial/group/reuse/fence readers, with bounded branch-to-join progression |
| S11.1 | Provider-adapter integration | Both provider seams receive the same engine contract and consume equal structured results |
| S11.2–S11.8 | Lower-layer coordinator/provider-result tests | Durable attempt accounting, uncertainty reuse, capability/shape failures and original provider category precedence |
| S12.1, S12.3, S12.5, S12.6 | Lower-layer view/recovery/authority tests | Attributable rendering, record-specific recovery, inert derived text and forbidden destructive recovery |
| S12.2, S12.4 | Event-boundary integration | Real existing event persistence observes attributed transitions and cannot report unpublished success |

## Negative-category evaluation

Invalid input, permissions/authority, concurrency, resource exhaustion, partial failure, unavailability, integrity, immutable provenance, idempotency keys, and alternate-path side effects are all covered above. Provider timeouts/availability belong to Story 11 and persistence/lease failures to Stories 1/8/9. Exception classification is checked through observable provider categories rather than an invented exception hierarchy. Cascade deletion is not a new operation in this slice; missing enrolled history and forbidden reset/prune behavior are covered by Stories 2/3/12. There is no new user authentication endpoint or external service.

## Review basis

Verify-claims: CLEAR. Every expected behavior is grounded in the approved architecture D1-D12 and confirmed scope. Existing code evidence is recorded in the approved architecture review; this proposal does not claim implementation or test execution. Operator accepted all twelve stories in composer on 2026-09-30.

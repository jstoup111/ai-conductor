**Status:** Accepted

# PRD audit receives bounded inputs and returns validated typed verdicts

Source: jstoup111/ai-conductor#2521; incorporates the remaining outcomes of closed #2875.

Technical track, Tier L. Scope and architecture were approved on 2026-09-30.
Architecture: `.docs/decisions/architecture-review-2026-09-30-prd-audit-receives-bounded-inputs-and-returns-vali.md`.
The stories describe the approved target behavior; existing grade, approval and routing
semantics are survivors of the migration, not a new policy.

## Story 1: An audit receives complete, bounded evidence for its active feature

As a reviewer, I want the authoritative feature evidence supplied within explicit bounds so that
I can judge the right requirements without losing obligations to truncation.

### Acceptance Criteria

#### Happy Path
- Given an active plan with sealed stories, applicable PRD intent, coherence mapping, changes and available prior findings/decisions, when an audit is prepared, then the reviewer receives one versioned input containing every authoritative criterion and its happy/negative classification, task ownership and completion conditions, plan intent, applicable requirements and mappings, changes, and attributable available history.
- Given technical-track work with no applicable PRD and no prior history, when an audit is prepared, then those absences are explicit and the complete story/task evidence remains available.
- Given changed-source excerpts that exceed the permitted diff capacity, when the audit is prepared, then the omitted files are identified with their content identity and remain available for read-only inspection, while structured obligations stay complete.

#### Negative Paths
- Given an unresolved active plan, an unreadable sealed story/required PRD, or unparseable required criteria/task completion conditions, when preparation runs, then the audit stops before provider invocation with the affected source and dimension named.
- Given a required structured input exceeding its configured engineering limit, when preparation runs, then it stops before invocation with the dimension, actual size and limit; it does not dispatch a shortened obligation set.
- Given present history that is corrupt, foreign to the feature or of an unsupported version, when preparation runs, then it names the faulty source and preserves it for recovery rather than treating it as empty history.
- Given another feature's otherwise valid plan, stories or history in the repository, when this feature's audit is prepared, then that unrelated material cannot substitute for its unresolved authoritative input.

### Done When
- [ ] A populated fixture's dispatched evidence contains the expected complete criterion/task/requirement/history sets and the projection version.
- [ ] Missing optional sources produce explicit absence; each required-source failure records zero reviewer invocations and a named diagnostic.
- [ ] Over-limit diff fixtures retain omission identities; over-limit structured fixtures never reach the reviewer.

## Story 2: Both providers return the same managed judgment contract

As the engine operator, I want provider choice to leave the audit contract unchanged.

### Acceptance Criteria

#### Happy Path
- Given either supported provider, when managed PRD audit runs, then the invocation requests the engine-owned native structured-output contract and receives the same engine-rendered evidence and judgment responsibilities.
- Given auto mode or interactive conduct mode, when the managed audit dispatches, then it obtains its judgment through a fresh one-shot invocation while standalone interactive skill use remains available for human review.
- Given equal valid judgments returned by the two provider fixtures, when their audits settle, then they yield equivalent validated findings and gate behavior apart from engine-owned attempt metadata.

#### Negative Paths
- Given a selected candidate without native structured-output capability, when audit dispatch is prepared, then that candidate is not invoked without the capability and the existing candidate policy either selects a capable candidate or reports the missing capability and recovery.
- Given a successful prose-only provider response, when the managed audit settles, then a well-formatted chat verdict cannot substitute for the missing terminal structured judgment.
- Given authentication failure, rate limiting, model unavailability or an unresolved skill command, when the adapter reports that condition, then its existing dedicated handling takes precedence over a generic missing-judgment diagnosis.
- Given a provider invocation that times out or fails during setup, when it settles, then its existing cleanup and bounded failure handling complete without leaving that attempt accepted as an audit.

### Done When
- [ ] Both adapter fixtures show the native schema request through their existing supported invocation seam and complete scratch-resource cleanup.
- [ ] Auto and managed-interactive fixtures use fresh managed invocations; standalone use does not manufacture gate evidence.
- [ ] Equal provider judgments have equal substantive results, and each negative case retains its distinct classification.

## Story 3: References and independent finding defects are checked without losing valid siblings

As a gate consumer, I want only validated findings with independently resolved references.

### Acceptance Criteria

#### Happy Path
- Given a complete valid set of criterion judgments using PASS, FIXABLE, PLAN_GAP and OVER_SCOPE, when it is validated, then each judgment resolves to its active criterion and retains its evidence, rationale and permitted requirement associations.
- Given active story IDs containing letters or nested numbering and active task IDs including remediation IDs, when judgments cite them, then the references resolve under the existing shared rules, including supported case normalization and multiple evidence-task citations.
- Given a FIXABLE judgment, when it is accepted, then exactly one existing task is identified as its repair owner; no-owner scope observations instead retain OVER_SCOPE with an explicit intent relation and receive only a presentation ordinal.
- Given independently valid entries beside an invalid entry in a readable supported result envelope, when validation runs, then valid siblings remain available with a diagnostic identifying the rejected entry and field, and the result remains incomplete.

#### Negative Paths
- Given an invented criterion, unresolved task or requirement reference, or a FIXABLE entry with zero or multiple owners, when validation runs, then that entry is rejected with its reference or ownership defect named and cannot become repair work.
- Given duplicated normalized criterion references, when validation runs, then every carrier of that duplicate is rejected and the gate cannot pass by choosing one arbitrarily.
- Given an omitted required criterion, an invalid grade, or an absent/invalid OVER_SCOPE intent relation, when validation runs, then the resulting incompleteness is explicit and cannot be accepted through a scope or negative-gap override.
- Given a missing/malformed result envelope or unsupported root version, when settlement runs, then there is no new usable judgment and neither chat nor intermediate tool output is scraped for replacement findings.
- Given a resolved PRD requirement lacking story coverage, when coverage is checked, then it remains an explicit blocking gap unless valid existing criterion PLAN_GAP evidence accounts for it; the audit cannot invent a criterion or a new repair authority.
- Given reviewer fields claiming operator acceptance, refusal, engine identity or recorded disposition, when validation runs, then those claims grant no authority and the offending unsupported fields produce a mechanical diagnostic.

### Done When
- [ ] The validation result distinguishes complete evidence, retained valid siblings with named rejection diagnostics, and no usable result.
- [ ] Every accepted FIXABLE judgment has one resolved parent and every accepted criterion key belongs to the active stories.
- [ ] Duplicate, omitted, invented and unsupported entries leave an unsatisfied gate without synthetic repair findings.

## Story 4: The engine publishes one authoritative judgment and its human view

As an operator, I want a review's persisted evidence and human report to reflect the same judgment.

### Acceptance Criteria

#### Happy Path
- Given a validated current-dispatch judgment, when settlement succeeds, then the engine persists it with its own attempt identity and reviewed code stamp and produces the corresponding human-readable report.
- Given recorded PLAN_GAP or OVER_SCOPE dispositions, when the engine projects them for display and shipment, then the original judgment remains distinguishable from recorded dispositions and attributable operator authority.
- Given a report whose wording or presentation is edited after a valid judgment, when completion, routing or publication reads the audit, then its substantive result still follows the authoritative typed evidence and current decision state.

#### Negative Paths
- Given failure writing the authoritative verdict, when settlement completes, then it reports a persistence failure and cannot count an older verdict as this dispatch's output.
- Given a report-render failure after typed persistence, when settlement completes, then it reports that failed output step and does not claim successful dispatch; durable operator decisions are unchanged.
- Given unreadable, corrupt or unsupported typed evidence alongside a plausible Markdown report, when a consumer reads the audit, then it rejects the typed evidence with a named diagnostic and cannot fall back to the report.
- Given failure while recording a disposition, when routing attempts to settle the gate, then it remains blocked with the affected projection named rather than claiming a recorded acceptance or deliverable gap.

### Done When
- [ ] A successful dispatch leaves inspectable matching typed and human evidence with engine-owned identity.
- [ ] Failure fixtures distinguish authority-write, report-render and disposition-projection failures.
- [ ] Changing report text alone cannot change gate satisfaction, recorded authority or shipment findings.

## Story 5: Missing current-dispatch output has a precise and bounded recovery

As an operator, I want to distinguish a reviewer that produced no verdict from substantive findings.

### Acceptance Criteria

#### Happy Path
- Given either managed PRD audit or the already-typed as-built review produces no terminal judgment, when the dispatch is evaluated, then its diagnostic explicitly names that step, the current attempt and expected output and explains that this dispatch produced no verdict.
- Given a retryable missing or invalid reviewer result and remaining allowance, when the existing retry path runs, then it uses a fresh invocation and accepts only that new attempt's valid output.
- Given deterministic missing input or unsupported required capability, when the failure is handled, then it identifies the input/capability and recovery without repeating an invocation that cannot succeed.

#### Negative Paths
- Given an older verdict with a recently modified timestamp or refreshed independent stamp, when a new dispatch produces no verdict, then the older judgment is not accepted for the new attempt.
- Given retries repeatedly produce no usable result, when the existing allowance is exhausted, then the feature halts needs-human with the missing/invalid current-output reason and no synthetic substantive gap.
- Given a validation-group member exhausts its allowance without a verdict while a sibling has independently verified passing evidence, when the group joins, then the failed member is not routed as a remediation finding and valid sibling retention follows the existing join policy.
- Given a provider-classified auth/rate/model failure, when failure reporting runs, then the missing-verdict explanation does not replace its more specific provider recovery.
- Given an incomplete result with rejected entries, when existing override routes are considered, then those defects remain named and blocking rather than becoming PASS or an inferred user decision.

### Done When
- [ ] PRD and as-built missing-output fixtures distinguish current absence from prior evidence and preserve provider-specific failures.
- [ ] Bounded serial and group fixtures reach the expected retry or halt terminal without new BUILD work for missing output.
- [ ] A fresh timestamp or unrelated stamp update cannot make the failed attempt satisfy its handshake.

## Story 6: Existing grading and bounded repair behavior survive the migration

As an operator, I want the new carrier to preserve the decisions the audit already makes.

### Acceptance Criteria

#### Happy Path
- Given complete clean criterion evidence, when the gate is evaluated, then it passes under the existing completion and preservation rules.
- Given a valid FIXABLE finding with an admitted existing owner, when the repair route runs, then it uses the existing bounded append or existing-task disposition and preserves the current BUILD-dispatch accounting for lap and growth allowances.
- Given a happy-path PLAN_GAP, when it is routed, then it requires the existing human plan decision; given a negative-path PLAN_GAP, it retains the existing record-and-ship behavior unless configured to halt.
- Given an OVER_SCOPE judgment marked within intent or outside intent without user-visible impact, when it is classified, then it remains recorded and non-blocking under current policy without creating new operator approval authority.

#### Negative Paths
- Given a proposed repair not owned by an active task, when repair admission checks it, then no new repair authority is inferred from a report, a requirement association or a no-owner scope observation.
- Given exhausted lap or growth allowance, when the next admitted BUILD repair would dispatch, then the existing cap halt and pending-repair state are preserved rather than resetting the allowance during conversion.
- Given a happy/negative criterion classification that cannot be resolved or configuration requiring all plan gaps to halt, when a PLAN_GAP is evaluated, then it cannot silently take the record-and-ship branch.
- Given mixed blocking grades or incomplete evidence, when a recordable gap or widening is also present, then that recordable item cannot override the other blockers and pass the gate.

### Done When
- [ ] Grade-route fixtures show the same pass, repair, record or halt disposition and existing cap effects using typed evidence.
- [ ] Existing-task repair adds no task-growth charge, while appending repair retains its established accounting.
- [ ] Mixed-grade, unresolved-owner and exhausted-cap fixtures remain blocked for the named reason.

## Story 7: Original approvals, refusals and semantic reconciliation remain authoritative

As an operator, I want a report-format migration to preserve decisions I already made.

### Acceptance Criteria

#### Happy Path
- Given attributable accepted or refused widening decisions and original cases, when a new audit begins, then existing decision capture preserves their order, provenance and explicit reversals before current findings are reconciled.
- Given a current no-owner finding established as the same case through the existing semantic reconciliation, when effective authority is evaluated, then its original acceptance or refusal remains effective despite changed wording or presentation ordinal.
- Given unchanged source/code/feature/decision revision and contract version, when reconciliation is revisited, then it reuses the valid existing result without another semantic judgment; rendering recorded dispositions alone does not invalidate that reuse.

#### Negative Paths
- Given a stale cleared acceptance and a newer explicit refusal, when audit entry processes the old clear again, then it cannot overwrite the newer refusal.
- Given a changed source or decision revision during reconciliation, when publication checks freshness, then stale relationships are not published and original decisions remain intact.
- Given an uncertain or different-case relation, when scope classification runs, then it does not inherit an unrelated approval or turn a no-owner finding into BUILD work.
- Given corrupted authority or a failed store lease/write, when capture or reconciliation runs, then it names the recovery fault and cannot treat it as empty approved history.
- Given a changed projection contract version after upgrade, when prior relationships are considered, then they cannot bypass current freshness checks; original decisions/cases remain available for fresh reconciliation without re-approval solely for presentation drift.

### Done When
- [ ] Accept/refuse, explicit-reversal and old-clear-replay fixtures preserve the same decision identities and authority.
- [ ] Current-source replay survives derived rendering, while concurrent semantic changes invalidate publication.
- [ ] Uncertain, unrelated, corrupt and failed-write cases cannot grant authority or erase original history.

## Story 8: Restart, rebase, cleanup and publication use the same evidence

As an operator, I want all lifecycle paths to agree about whether the audit remains valid.

### Acceptance Criteria

#### Happy Path
- Given a complete typed result whose reviewed inputs remain valid under the existing code-stamp and decision checks, when the run resumes before a new dispatch, then it reuses the evidence without another reviewer call.
- Given the engine's valid rebase translation or selective replay proof, when preservation is evaluated, then the audit retains the same approved preservation behavior; gate-relevant story/PRD changes still invalidate it.
- Given recorded audit dispositions, when the pre-finish fence and shipment publication run, then both consume the same validated evidence and preserve the grade, decision and rationale in the shipped record.

#### Negative Paths
- Given only legacy Markdown audit evidence, when the upgraded lifecycle evaluates completion, then it requires a new audit and preserves existing widening-decision and legacy-clear import data.
- Given a relevant changed input, unreachable/unexplained code stamp, uncomputable preservation check or currently blocking decision, when reuse is considered, then the old PASS cannot authorize publication.
- Given code-validity preservation is disabled, when a legacy or stale audit is considered, then the option does not enable Markdown or timestamp-based verdict authority.
- Given rewind or a stale-evidence sweep invalidates the audit, when cleanup runs, then verdict and derived report are treated as the same evidence family while durable operator decisions remain available.
- Given a report with forged recorded findings or a valid-looking report beside unusable typed evidence, when shipment collection runs, then those report claims cannot reach the shipped record or satisfy the publication fence.

### Done When
- [ ] Resume, replay, sweep, rewind and pre-finish fixtures agree on the same current typed evidence.
- [ ] Legacy-report fixtures request re-audit without altering decisions; valid typed preservation records zero new reviewer calls.
- [ ] Shipment fixtures preserve genuine recorded dispositions and reject forged report-only findings.

## Story 9: Reviewer guidance agrees with the managed contract

As a reviewer, I want output responsibilities that permit the required judgment without granting mutation authority.

### Acceptance Criteria

#### Happy Path
- Given a managed PRD-audit invocation, when the reviewer receives its role and contract, then the engine supplies the bounded evidence and output shape while the skill supplies judgment guidance; it requires a terminal structured judgment without asking the reviewer to persist engine-owned verdicts or decisions.
- Given standalone interactive use, when the skill is invoked for human review, then it can explain its judgment without claiming it created current managed gate evidence.
- Given the existing contract audit checks the migrated skill surface, when judgment guidance and standalone human presentation are present, then they remain permitted while the machine contract stays owned by the engine.

#### Negative Paths
- Given either validator delegates evidence collection, when the briefs are formed, then the prohibition on executing project code or making unrelated writes applies to reviewer and delegates, and the reviewer cannot finish with delegated work outstanding.
- Given a managed instruction that grants the reviewer authority to write accepted/refused decisions or substitutes report authoring for the terminal judgment, when the migrated contract is checked, then the conflicting output responsibility is rejected.
- Given a reintroduced engine-input recipe or machine-output table grammar in the migrated PRD-audit skill surface, when the existing contract audit evaluates it, then the audit fails for the contract violation rather than silently making that prose authoritative.

### Done When
- [ ] Managed invocation fixtures receive one engine contract and compatible judgment guidance for both providers.
- [ ] Contract-audit fixtures distinguish forbidden machine recipes/authority from permitted standalone presentation.
- [ ] Review of the final skill changes confirms the existing execution/write bans and delegated-work completion obligation remain intact.

## Negative-category coverage

Invalid input, references and incomplete evidence: Stories 1, 3, 4 and 5.
Provider authentication, permission/capability, timeout and availability: Stories 2 and 5.
Resource bounds: Story 1. Partial writes and rollback/recovery: Stories 4 and 7.
Concurrent state and immutable original authority: Story 7. Dedup/replay key correctness:
Stories 7 and 8. Alternate-branch side effects, failed dispatch and group cleanup: Stories 2,
5 and 8. No entity/directory deletion is introduced; evidence cleanup preserves dependent
operator state in Story 8. Failure classification follows existing typed provider outcomes,
so no new exception-hierarchy assumption is made.

## Verification and coverage intent

Every criterion needs a concrete existing-test, lower-layer-test or acceptance-flow disposition
in the plan/coherence mapping. These stories do not require a new system test for each criterion.
Unit and focused integration layers cover most cases; bounded serial/group paths prove the
distinct lifecycle joins. Provider/process/network boundaries remain faithful fakes.

Verified governing behavior: approved architecture decisions 1-10 and the three amended ADRs;
shared reference resolver and existing widening/retry/preservation owners were inspected.
No unconfirmed load-bearing assumptions remain. The operator approved these stories in chat
on 2026-09-30. Verify-claims verdict: CLEAR.

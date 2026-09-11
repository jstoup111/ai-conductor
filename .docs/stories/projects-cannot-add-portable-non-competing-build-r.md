**Status:** Accepted

# Stories: Portable, non-competing build review policy

**Source:** jstoup111/ai-conductor#1986
**Track / tier:** Product / Large
**Requirement baseline:** Approved PRD `2026-09-10-projects-cannot-add-portable-non-competing-build-r`
**Architecture baseline:** APPROVED `adr-2026-09-10-portable-build-review-policy` D1–D12, `adr-2026-09-10-separate-custom-review-coverage-identity` D1–D4, and their adjacent amendments, operator-approved 2026-09-10
**Accepted by:** James Stoup, 2026-09-10
**Scope boundary:** Full #1986 functional outcome; #1804 effective-policy cache correctness included where required. General custom-step redesign in #1344 remains excluded.

These stories describe the additional custom-policy behavior and the cache correction. Existing rubric and adjudication contracts remain the baseline, including mixed infrastructure/content laps, suppression, settled recurrence, and cumulative bounds. Criteria below extend those contracts to custom policies; they do not recreate a separate adjudicator. A supported custom-policy environment initially means Linux with proven read-only containment for the selected provider. Standard automated verification replaces every third-party boundary with a faithful fake; no private package or live model account is an acceptance prerequisite.

## Story 1: Select an installed policy from each supported source

**Requirement:** FR-1

As a project maintainer, I want to name an installed policy so that adopting it does not require maintaining a project copy.

### Acceptance Criteria

#### Happy Path

- Given one enabled project-local installation of a named policy and a valid enabled custom declaration, when review resolves that selection, then it selects that installation, delivers its criteria, and leaves its installed files unchanged without creating an authored project copy.
- Given one enabled global installation of a named policy and no competing match, when the same kind of declaration is reviewed, then the global installation supplies the criteria without requiring a local installation or changing another project's selection.
- Given an enabled installed plugin containing a named skill, when the project selects that plugin-qualified skill, then review uses that plugin's skill and preserves its plugin identity and installation source.

#### Negative Paths

- Given distinct project and global installations match an unqualified selection, when review resolves it, then it names the conflicting sources and requests disambiguation without invoking either policy; an explicit matching source selection resolves the ambiguity.
- Given the selected global installation is absent or unreadable, when review resolves it, then it names the policy and failed source without substituting a project or harness copy.
- Given a plugin is disabled, only present in a marketplace listing, or lacks locally available required files, when review resolves its skill, then it reports unavailable installed policy without downloading, enabling, or choosing a cached alternative.

### Done When

- [ ] The source-selection matrix observes the exact selected installation and unchanged original files for project, global, and plugin cases.
- [ ] Ambiguous and unavailable selections produce a policy-specific reason with zero affected judging calls and zero installation mutations.

## Story 2: Control participation through project configuration

**Requirement:** FR-2

As a maintainer, I want to enable individual custom rubrics in the existing review gate so that only selected policies can affect a lap.

### Acceptance Criteria

#### Happy Path

- Given a valid custom declaration, when the maintainer enables it, then the existing build-review gate includes that member alongside enabled built-in members without a harness implementation edit.
- Given a declaration is disabled or omits enablement, when review runs, then it performs no discovery, cache access, or judgment for that member; disabling the public gate disables all its members.

#### Negative Paths

- Given a declaration uses a built-in or retired id, a prototype key, an invalid id or field, a duplicate configuration key, or more than 32 custom declarations, when configuration is loaded, then it identifies the invalid declaration before any rubric invocation.
- Given custom review is enabled while aggregate adjudication is disabled, when configuration is loaded, then it refuses that combination before judging rather than permitting independent repair authority.
- Given a formerly enabled rubric has cached findings but is now disabled, when the next lap is evaluated, then its historical evidence remains inspectable but supplies no current blocker or new repair work.

### Done When

- [ ] Configuration-driven participation produces the expected enabled-member list and zero disabled-member discovery, cache, and judging calls.
- [ ] Invalid declarations and incompatible authority settings return named configuration errors before dispatch.

## Story 3: Stop clearly when policy selection cannot be established

**Requirement:** FR-3

As an operator, I want loading failures distinguished from judgments so that an uninformed review cannot appear to provide coverage.

### Acceptance Criteria

#### Happy Path

- Given complete valid installed-policy metadata with one eligible canonical match, when review resolves the policy, then it proceeds with that match and identifies the selected source.
- Given two discovered aliases resolve to the same canonical installation, when selection is evaluated, then it selects that one installation without reporting a false ambiguity.

#### Negative Paths

- Given catalog output is partial, malformed, reports errors, or uses an unsupported format, when selection runs, then it reports a catalog failure rather than treating an empty or incomplete list as confirmed absence or successful coverage.
- Given catalog discovery times out, is canceled, or cannot read the selected source, when discovery terminates, then the candidate's discovery activity is stopped and the affected policy receives a loading failure with no judging call, cache hit, or cache write.
- Given two byte-identical copies have different canonical installation origins, when an unqualified selection is resolved, then review reports ambiguity instead of deduplicating them by content.
- Given a required declared capability is unavailable to the selected reviewer, when preflight examines that policy, then it names the capability and recovery action before requesting its judgment; it does not activate unrelated plugin components.

### Done When

- [ ] Complete, aliased, conflicting, partial, timed-out, canceled, and unreadable catalog cases have distinct observable outcomes with the selected policy/source named.
- [ ] Failed selection leaves no affected judging call or eligible cache entry, and no discovery activity survives its candidate.

## Story 4: Adopt criteria under the supported review role

**Requirement:** FR-3, FR-5

As a policy maintainer, I want my installed review criteria usable without republishing the skill for this harness.

### Acceptance Criteria

#### Happy Path

- Given a compatible installed skill with ordinary instructions and supporting criteria, when it participates in review, then the reviewer receives those criteria and returns attributable findings without requiring new harness-specific frontmatter or an installed-file edit.
- Given a skill describes a standalone presentation format but can apply its criteria in review mode, when it is invoked, then its review evidence follows the shared finding contract and its presentation instructions do not replace the aggregate verdict.

#### Negative Paths

- Given declared required actions cannot run in the supported review role, when policy preflight runs, then the affected policy is refused before judging, with the incompatible requirement named and no reported coverage.
- Given an undeclared dynamic dependency or incompatible instruction is discovered during review, when the policy reports that inability, then the result is explicitly unsupported rather than an empty successful judgment or permission to edit code, install dependencies, or publish comments.

### Done When

- [ ] A standard policy fixture produces valid shared review evidence while its installed definition remains byte-identical.
- [ ] Both preflight-detected and runtime-reported incompatibility produce explicit failed coverage and no repair authorization from the individual rubric.

## Story 5: Preserve policy obligations across providers and fallback

**Requirement:** FR-4

As a maintainer, I want the same policy selection to work under either supported provider so that routing does not change what is reviewed.

### Acceptance Criteria

#### Happy Path

- Given equivalent installed policy content for Claude Code and Codex, when each provider reviews the same declared policy and implementation input, then each receives the complete selected criteria and the same review obligations and output contract, with its own producing provenance; identical model wording is not required.
- Given the preferred provider or model is unavailable and a configured fallback can load the selected policy, when fallback runs, then that actual candidate reviews its resolved policy under the same declaration and reports its own identity.

#### Negative Paths

- Given the fallback lacks the selected policy or resolves it ambiguously, when it prepares review, then it reports failed policy coverage without borrowing the preferred provider's policy or silently selecting another installation.
- Given policy loading fails on an otherwise available candidate, when routing evaluates that failure, then it does not classify it as provider unavailability merely to obtain a different policy judgment.
- Given a candidate fails authentication, is canceled, or returns a malformed review result, when that attempt ends, then it retains the existing cause-specific failure/fallback rules and records no invented successful judgment; all candidate-owned activity ends.

### Done When

- [ ] Both provider adapters deliver the selected criteria through their actual invocation boundary using faithful metadata and model fakes.
- [ ] A fallback observation identifies the actual producing candidate, while missing-policy and non-availability failure cases cannot produce false coverage or an unauthorized fallback.

## Story 6: Review with complete, stable supporting material

**Requirement:** FR-5

As a maintainer, I want all supporting criteria available so that the selected policy is applied in full.

### Acceptance Criteria

#### Happy Path

- Given a selected skill references supporting criteria inside its package, when review begins, then the reviewer can read the captured required content at its preserved relative locations, including safely resolved in-package links.
- Given the installed package remains unchanged throughout loading, when review uses it, then the effective content identity describes exactly the captured definition and supporting package bytes delivered to that candidate.

#### Negative Paths

- Given a required resource is missing or unreadable, a local file reference is broken, or a link escapes the admitted package or cycles, when policy loading runs, then it identifies the resource defect and requests no informed judgment or cache lookup from that policy.
- Given the package exceeds 4,096 files or 64 MiB, or contains a special file, when loading runs, then it reports the breached limit or unsupported resource without truncating the policy into apparent coverage.
- Given package content changes during capture or storage cannot complete the captured material, when loading finishes, then it rejects the incomplete or inconsistent material without publishing an eligible judgment/cache entry; a later attempt must load again.

### Done When

- [ ] Captured fixture content and the candidate's readable content agree for the definition, nested resources, and supported links.
- [ ] Every missing, escaping, cyclic, changing, over-limit, and failed-write case identifies the cause and produces zero affected judging calls or reusable judgments.

## Story 7: Attribute judgments and reuse to their real source

**Requirement:** FR-6

As an operator, I want to trace each outcome to the policy and provider that produced it.

### Acceptance Criteria

#### Happy Path

- Given a successful custom-policy judgment, when evidence is published, then it identifies the semantic skill, declaration, installation source, plugin/version when available, effective content, reviewed input, and producing provider/model policy.
- Given a compatible prior judgment is reused, when the current lap is published, then it retains the original producing provenance and identifies the current reuse separately without claiming another model execution or token charge.

#### Negative Paths

- Given a policy fails loading or invocation, when its result is reported, then it is distinguishable from a judged result and does not claim that unavailable criteria were reviewed.
- Given a reviewer supplies a forged rubric, lap, policy, provider, verdict, case identity, or out-of-input evidence reference, when its result is validated, then those claims cannot become authoritative evidence or an eligible cache result.
- Given custom policy configuration is later removed or changed, when historical evidence is inspected, then it remains attributable to its original descriptor rather than being relabeled through today's configuration or rendered unreadable.

### Done When

- [ ] Published and rendered judgment/reuse records expose producing and current-lap identities without duplicate execution accounting.
- [ ] Failure, forged-identity, and historical-read cases preserve the judged-versus-uncovered distinction and original attribution.

## Story 8: Reuse only compatible effective review input

**Requirement:** FR-7

As an operator, I want unchanged informed judgments reused while changes to review criteria force a new judgment.

### Acceptance Criteria

#### Happy Path

- Given a valid prior result and unchanged effective policy, review input, contracts, engine content, and execution policy, when the same candidate reviews again, then it reuses that judgment without another judging call.
- Given only temporary runtime paths, lap timing, or commit addresses change while all semantic inputs remain equivalent, when reuse is evaluated, then those incidental changes alone do not invalidate the judgment.

#### Negative Paths

- Given the skill definition, a supporting package file, declared question/source, reviewed content, contract, engine content, or resolved execution policy changes, when reuse is evaluated, then an incompatible prior judgment is not reused and the mismatch remains attributable.
- Given a legacy entry lacks effective-policy evidence or a stored entry is malformed, when review encounters it, then it misses without fabricating provenance; only a newly valid result can replace it.
- Given loading of the current effective policy fails or a cache write cannot complete, when that branch settles, then no partial entry becomes eligible for future reuse and the existing failure semantics remain effective.

### Done When

- [ ] Identity-preserving changes produce observed hits; independently changing each review-relevant identity component produces a miss.
- [ ] Legacy, malformed, unloaded-policy, and failed-write fixtures never return a false cache hit or publish partial reusable evidence.

## Story 9: Keep candidate-specific caches correct during fallback

**Requirement:** FR-7, FR-4

As an operator, I want fallback reuse tied to the candidate that actually supplied the policy.

### Acceptance Criteria

#### Happy Path

- Given the actual fallback has an eligible judgment for its own effective policy, when the preferred candidate is unavailable, then fallback reuses its own result and retains that producing identity.
- Given both preferred and fallback candidates have different valid warm results, when routing alternates between them, then each can reuse its own compatible result without the other's write destroying its reusable candidate entry.

#### Negative Paths

- Given a warm preferred-candidate result and different effective policy bytes for the fallback, when fallback is selected, then the preferred result cannot satisfy it, even if the declaration and implementation input are unchanged.
- Given preferred-candidate preparation succeeds but invocation reports provider/model unavailability, when fallback prepares, then it performs policy resolution and reuse eligibility for itself rather than inheriting the earlier prepared identity.
- Given candidate preparation or cancellation ends before policy resolution succeeds, when that attempt is cleaned up, then it leaves no claimed cache hit, judged artifact, or successful coverage for that candidate.

### Done When

- [ ] Alternating-candidate traces show independent valid reuse and correct producing identity.
- [ ] Fallback after both early and late unavailability cannot consume a judgment bound to another effective candidate.

## Story 10: Protect a shared immutable input for custom-policy laps

**Requirement:** FR-8

As an implementation worker, I want every reviewer to inspect the same unchanged input so that their findings can be considered together.

### Acceptance Criteria

#### Happy Path

- Given a lap with enabled custom policies and a built-in peer, when the rubrics execute, then all observe the same frozen implementation input and receive only their own review context, regardless of completion order.
- Given the selected provider needs writable bookkeeping during a supported custom review, when the reviewer runs, then it can write its private scratch while the reviewed source, original checkout, original policy installation, and engine evidence remain protected.

#### Negative Paths

- Given a reviewer attempts to modify protected input or read a sibling's private review evidence, when that access is attempted, then it cannot alter protected state or obtain the sibling evidence; no later rubric observes a changed input caused by that reviewer.
- Given containment is unavailable, a protected-write or scratch-write probe fails, or the host's nested sandbox cannot support the boundary, when review prepares, then it names the provider, missing capability, and recovery action before judging, with no writable fallback.
- Given the original checkout changes after a custom lap's input was captured, when remaining reviewers execute, then they still observe that lap's captured input and their evidence is not relabeled as reviewing the new checkout.

### Done When

- [ ] A mixed built-in/custom lap observes one captured input identity with independent reviewer context.
- [ ] Allowed scratch and refused protected/sibling access are proved through the production access boundary; unavailable containment yields zero reviewer launches and unchanged protected fixtures.

## Story 11: Use one aggregate authority in attended and daemon review

**Requirement:** FR-9

As an operator, I want the same repair authority in both execution modes so that a custom rubric cannot start its own repair loop.

### Acceptance Criteria

#### Happy Path

- Given enabled custom policies produce unresolved findings in either attended or daemon execution, when all branches settle, then one aggregate decision consumes their eligible findings and supplies the sole repair or decision-stop route for that lap.
- Given a valid custom finding and a sibling infrastructure failure, when the lap is evaluated, then both remain visible, content receives the one aggregate judgment, and an admitted consistent repair may proceed while the infrastructure result remains independently blocking.

#### Negative Paths

- Given one reviewer finishes early or instructs immediate repair, when other branches are unsettled, then no implementation work or semantic charge is authorized by that individual result.
- Given an infrastructure-only lap, or content already settled by exact permitted dispositions with no live finding, when review evaluates it, then it preserves the corresponding existing no-judgment route rather than inventing new content work.
- Given an attended compatibility path cannot provide the required custom-review capability, when it prepares the lap, then it refuses before judging rather than routing raw findings directly to BUILD; consuming a recorded aggregate result never invokes a second adjudicator.

### Done When

- [ ] Both execution modes observe exactly one content decision and one resulting route for an eligible custom lap, with no rubric-owned repair dispatch.
- [ ] Mixed, early-completion, already-settled, infrastructure-only, and unsupported-path observations preserve authority and charge ownership.

## Story 12: Resolve overlapping and contradictory findings before repair

**Requirement:** FR-10

As an implementation worker, I want one justified consistent repair set instead of competing reviewer instructions.

### Acceptance Criteria

#### Happy Path

- Given two custom policies identify the same admitted defect, when the aggregate judgment merges their findings, then one repair case retains both original findings and the reason for their shared disposition.
- Given two policies propose incompatible repairs and the aggregate judgment resolves them consistently within approved scope, when that judgment is accepted, then the worker receives only the selected consistent repair set and can inspect the disposition of both proposals.

#### Negative Paths

- Given the conflict remains unresolved, when the aggregate reports blocked consistency, then no action from that adjudication reaches the worker and the stop identifies the implicated findings and rationale.
- Given a decision omits consistency, has contradictory outcomes, or references nonexistent findings/cases, when it is checked, then none of its action effects is applied and the defect is reported.
- Given complete current findings, relevant policy/scope context, or required prior-case history cannot fit within the supported bounds or cannot be loaded, when adjudication prepares, then it stops rather than judging a truncated account or delivering partially reconciled work.

### Done When

- [ ] A duplicate case and a resolved-conflict case preserve all source findings with one consistent authorized repair set.
- [ ] Unresolved, malformed, and incomplete-context cases produce an inspectable stop and zero repair effects.

## Story 13: Account for every blocking custom finding

**Requirement:** FR-11

As an operator, I want a complete disposition record so that review cannot pass by forgetting a finding.

### Acceptance Criteria

#### Happy Path

- Given several current unresolved custom findings, when the aggregate settles, then every finding has one traceable permitted outcome, including a retained canonical target for merged findings, and only admitted action outcomes supply repair work.
- Given rejected, legitimately deferred, operator-resolved, or confidence-suppressed custom findings, when the effective gate outcome is derived, then those findings remain inspectable without becoming autonomous repair work; suppression remains distinct from accepted risk.

#### Negative Paths

- Given a judgment omits, duplicates, or invents a source finding or leaves a merge target unresolved, when it is validated, then it cannot settle successfully or partially apply valid sibling actions.
- Given a custom finding has absent confidence, invalid confidence, or an attempted self-awarded disposition, when its result is interpreted, then absent confidence is not suppressed, invalid confidence is malformed, and the reviewer cannot grant itself operator authorization.
- Given a current policy update changes a finding's effective identity, when historic settled outcomes are considered, then the new finding cannot be treated as an exact settled recurrence solely because its rubric name or wording matches; prior cases remain available for semantic judgment.

### Done When

- [ ] The disposition report accounts for every source exactly once and excludes all non-action outcomes from the delivered work set.
- [ ] Omitted/duplicate sources, invalid confidence, and changed-policy recurrence cannot manufacture successful settlement or transferable authorization.

## Story 14: Return off-plan findings to their decision owner

**Requirement:** FR-12

As an operator, I want policy findings to respect approved decisions so that review cannot authorize a different product or architecture.

### Acceptance Criteria

#### Happy Path

- Given a policy finding requires changing the approved product requirement, implementation plan, or architecture, when the aggregate identifies that need, then it records the appropriate decision owner and an actionable stop with the source findings preserved.
- Given an actionable finding can be repaired under an existing approved task, when the aggregate authorizes it, then the repair cites the admitting task and explains how the repair fits that approved scope.

#### Negative Paths

- Given a custom policy attempts to take over product-completion or architecture-choice authority, when findings are adjudicated, then it cannot override that authority or authorize an unapproved mechanism; the recorded outcome explains rejection or the required decision stop.
- Given an action cites a nonexistent task or lacks admission evidence, or any case requires escalation, when the result is checked, then no action from that adjudication is delivered and no plan task is appended or BUILD charge spent for the escalation.
- Given a gap affects the current approved outcome, when a reviewer proposes treating it as an unrelated future improvement, then review cannot settle it through a non-blocking deferral; after an explicit owning decision changes the approved baseline, recovery re-evaluates without rewriting the old verdict into PASS.

### Done When

- [ ] Product, plan, and architecture gap cases each identify an owner, source evidence, and zero unauthorized implementation effects.
- [ ] Every delivered action has a valid admitting task; current-outcome gaps cannot disappear through deferral or automatic plan mutation.

## Story 15: Repair within the existing convergence limits and verify again

**Requirement:** FR-13

As an operator, I want accepted custom-policy repairs to receive fresh verification without an endless review loop.

### Acceptance Criteria

#### Happy Path

- Given a new consistent set of admitted code repairs within the remaining allowance, when the aggregate authorizes repair and BUILD completes it, then one repair route is charged and all tests and reviews invalidated by that repair must supply current evidence before the feature proceeds.
- Given a settled non-action custom finding recurs with the same effective identity, when the next lap is evaluated, then its permitted finalized outcome can be reused without a new adjudicator call or semantic repair charge, while retaining the original case evidence.

#### Negative Paths

- Given an attempted or regressed case is reported again with equivalent substance despite wording or code movement, when the aggregate identifies that unrefuted recurrence and again proposes action, then it follows the existing repeated-case stop rather than granting a fresh repair allowance.
- Given the cumulative bound is exhausted or a policy is renamed, updated, disabled, and re-enabled, when new repair routing is evaluated, then those changes do not reset the feature's accumulated charges or authorize an over-limit route.
- Given repair completes but invalidated test or review evidence is stale, missing, or failing, when progression is attempted, then the feature cannot proceed on the pre-repair success and the known failure remains blocking.

### Done When

- [ ] A bounded repair-and-reverification flow observes one initial charge and requires current evidence at the progression boundary.
- [ ] Equivalent recurrence, exhausted allowance, policy changes, and stale verification cannot create a free route or erase prior charge/attempt evidence.

## Story 16: Recover custom review without duplicated effects or lost blockers

**Requirement:** FR-14

As an operator, I want interrupted review to resume from durable decisions without authorizing the same repair twice.

### Acceptance Criteria

#### Happy Path

- Given an admitted custom-policy action is interrupted around decision persistence, work publication, or charge recording, when recovery runs, then it completes only missing authorized effects, retains original source attribution, and records at most one publication and one semantic charge for that action.
- Given a custom policy is removed or its installation changes after a decision was recorded, when recovery reads the old decision, then it retains that decision's original identity and complete unresolved history while evaluating any new lap against current policy.

#### Negative Paths

- Given concurrent recovery attempts encounter the same pending effect, when they try to resume it, then only one can own its application and the other cannot duplicate work or charge.
- Given required durable state is unreadable, malformed, incomplete, or cannot be written, when recovery evaluates it, then it stops with the affected state named rather than assuming completion, dropping unresolved findings, or publishing a partial second effect.
- Given recovery resumes a decision stop or an already attempted repeated case, when the run restarts, then restart alone neither clears the stop nor buys another repair route; required operator decisions and existing bounds remain in force.

### Done When

- [ ] Crash-boundary recovery observations retain one action publication/charge and the complete original source-to-decision links.
- [ ] Concurrent, corrupt-state, removed-policy, and decision-stop recovery cannot duplicate effects, relabel evidence, or lose blocking state.

## Story 17: Preserve exact operator risk and coverage authority

**Requirement:** FR-15

As an operator, I want my explicit risk decisions preserved without allowing automated reviewers to impersonate them.

### Acceptance Criteria

#### Happy Path

- Given an exact current operator accepted-risk decision covers a custom finding, when review evaluates it, then that finding remains visible as operator-resolved and does not create autonomous repair work.
- Given a valid custom declaration whose policy has never loaded, an exhausted loading failure, a healthy judged sibling, and an exact current operator reduced-coverage decision for that declaration and closed failure reason, when the aggregate is evaluated, then that decision applies without an effective content fingerprint and the failed branch remains visibly unjudged.
- Given a custom reduced-coverage decision and the same validated declaration and closed failure reason, when the installed package changes or review restarts, then the decision still applies to that missing coverage and the current failure is reported without claiming the package was judged.

#### Negative Paths

- Given an automated rejection, deferral, merge, suppression, or escalation occurs, when it is recorded, then it cannot create, replace, or broaden an operator accepted-risk or reduced-coverage decision.
- Given risk acceptance belongs to different effective policy content, or reduced coverage belongs to a different validated declaration or closed failure reason, when current evidence is evaluated, then it cannot authorize the new finding or failure merely because its rubric name matches.
- Given the operator records a disposition after adjudication starts but before effects apply, when the result is applied, then the current exact disposition is respected and cannot be overwritten by stale autonomous work; unrelated unresolved findings remain blocking.
- Given a previously covered policy now produces a judged finding, or every rubric remains unjudged, when the aggregate is evaluated, then reduced coverage cannot suppress that finding or make the entirely unjudged lap pass; invalid declarations and non-operator callers cannot gain waiver authority.

### Done When

- [ ] Exact risk acceptance remains content-bound, while first-use loading-failure coverage works without a digest and persists across package changes for the same declaration/reason.
- [ ] Changed-declaration/reason, healed-policy, wholly unjudged, invalid-declaration, non-operator, and late-operator-decision cases preserve the distinct authorities and current failure evidence.

## Story 18: Preserve existing projects while correcting policy identity

**Requirement:** FR-16

As an existing project maintainer, I want accurate cache reuse without being forced to enable custom policies or acquire their runtime prerequisites.

### Acceptance Criteria

#### Happy Path

- Given no custom declarations, when review runs, then existing built-in selection/defaults, empty-container and empty-scope behavior, permitted dispositions, and attended/daemon routing remain effective without requiring custom-policy containment.
- Given an enabled built-in rubric and an unchanged effective policy on the actual candidate, when an eligible judgment exists, then review retains reuse; changed effective built-in criteria invalidate incompatible reuse without erasing existing built-in operator-risk binding.

#### Negative Paths

- Given an unknown key in the legacy rubric subtree or a retired rubric key, when configuration is loaded, then the unknown key retains rejection and the retired key retains its warning/no-op behavior rather than silently becoming a custom policy.
- Given a built-in candidate cannot load the effective criteria, when review considers a warm harness-root judgment, then it cannot use that cache entry to claim successful coverage; missing effective-policy evidence still requires a miss or loading failure.
- Given a custom finding shape is supplied to the built-in rubric, when the result is validated, then the specialized built-in vocabulary, scope, preflight, and anchor rules remain intact rather than accepting the generic custom contract.

### Done When

- [ ] Built-in-only compatibility observations retain default/no-op behavior and operator-disposition binding without a new containment dependency.
- [ ] Effective-candidate cache misses and closed built-in validation prevent stale coverage or generic-contract weakening.

## Coverage dispositions

Criterion ids are derived in story order, happy paths followed by negative paths. The ranges below identify every criterion's intended lowest sufficient proof. They are coverage assignments for BUILD, not claims that these tests already exist. Scenario variants grouped in one criterion must retain each listed failure permutation at the assigned lower layer.

| Criteria | Planned proof and terminal observation |
|---|---|
| S1.1–S1.6 | Lower-layer installed-policy integration: source fixtures through real selection and content delivery, fake host metadata boundary; selected origin, unchanged originals, zero unavailable-policy judgments. |
| S2.1–S2.5 | Configuration/runner integration: loaded project settings reach effective participation; instrument discovery/cache/provider calls and invalid-input rejection. |
| S3.1–S3.6 | Catalog adapter and candidate-lifecycle tests: complete/error/partial/timeout/cancel outputs, canonical identities, call counts, and teardown. |
| S4.1–S4.4 | Review-contract integration: ordinary installed content reaches provider fake; supported findings versus explicit unsupported result and unchanged package. |
| S5.1–S5.5 | Provider-execution integration through both real adapters with faithful process/model fakes: delivered criteria, candidate identity, eligibility, and cleanup. |
| S6.1–S6.5 | Material-loading integration with disposable local files and injected I/O faults: readable captured bytes, content identity, resource refusal, and no partial result. |
| S7.1–S7.5 | Evidence publication/read/render integration and result-boundary validation: provenance, reuse accounting, invalid references, and historic descriptors. |
| S8.1–S8.5 | Cache/runner integration with injected candidates and real temporary cache files: hit/miss observation per independent identity mutation and incomplete-entry refusal. |
| S9.1–S9.5 | Candidate-loop/cache integration: early/late unavailable candidate, fallback preparation, retained per-candidate hits, and teardown. |
| S10.1–S10.5 | Input/containment/provider integration with a faithful process boundary: shared input and allowed/refused accesses; optional disposable Linux containment smoke proves real OS behavior without third parties. |
| S11.1 | Acceptance flow A: configured custom policies through real attended and daemon review entry, branch settlement, aggregate decision, and one terminal repair or decision-stop route; fake every third-party boundary. |
| S11.2–S11.5 | Conductor review-boundary integration: mixed, early, settled, infrastructure-only, and unsupported cases terminate at the observed route, asserting decision/effect/charge counts. |
| S12.1–S12.5 | Adjudication-context/result/application integration: deterministic duplicate/consistent/blocked provider responses exercise source preservation and zero effects on incomplete or invalid decisions. |
| S13.1–S13.5 | Domain/disposition/adjudication integration: exhaustive graph, confidence and suppression, historic/custom identity, and delivered work set. |
| S14.1–S14.5 | Aggregate decision/routing integration: owner stops, task admission, no partial actions, and re-evaluation against an explicitly changed approved baseline. |
| S15.1, S15.5 | Acceptance flow B: custom review → one bounded repair → invalidated verification → progression decision; use current/missing/failing proof variants and stop at that boundary. |
| S15.2–S15.4 | Existing convergence and case-recurrence seams extended with custom identities: semantic recurrence, exact settled reuse, exhausted allowance, and policy changes. |
| S16.1–S16.5 | Recovery integration using the real case/effect/charge flow and disposable state: crash injection at each persistent boundary, competing resumes, state failures, and retained original attribution. |
| S17.1–S17.7 | Operator-disposition/application integration: content-bound risk, first-use digestless coverage, package-change persistence, changed declaration/reason, healed or entirely unjudged laps, stale autonomous result, and no operator-store mutation by autonomous outcomes. |
| S18.1–S18.5 | Built-in runner/cache/config/result regression proof at the existing boundaries, including both execution modes and effective policy loading. |

Process-boundary tests must prove the production adapter reaches the injected fake before trying refused/destructive arguments, including under counterfactual restoration. No ordinary test launches a real provider, metadata CLI, tracker client, or installer. All temporary state belongs to the fixture. Acceptance flow A stops at the aggregate route; flow B stops at the post-repair verification/progression decision. Neither continues into unrelated lifecycle work. Case history and suppression retain the established behavior exercised in the existing post-join adjudication and confidence-floor story sets; new tests add only the custom identity or changed boundary proof.

## Negative-category review

| Category | Evaluation |
|---|---|
| Invalid input | Applicable: declarations, catalogs, results, resource paths, and case graphs; S2–S4, S6–S7, S12–S14, S18. |
| Auth/permission | Applicable: unreadable installations, host authentication, and protected reviewer surfaces; S1, S3, S5–S6, S10. No new application user-role system. |
| Timeout/network | Applicable to metadata/provider candidate lifecycle and existing fallback; S3/S5/S9. Policy adoption never installs or fetches a missing package. |
| Concurrent access | Applicable to changing policy/input, late operator decisions, and competing recovery; S6/S10/S16/S17. Configuration is fixed for each lap. |
| Resource exhaustion | Applicable to package/context bounds and incomplete persistent writes; S6/S8/S12/S16. No truncation into apparent coverage. |
| Partial failure/rollback | Applicable to candidate preparation, branch settlement, validation, and effect application; S3/S5–S9/S11–S13/S16. No partial action set on an invalid aggregate. |
| Dependency unavailable | Applicable to catalogs, declared policy capabilities/resources, provider candidates, and containment; S1/S3–S6/S9–S10. |
| Data integrity | Applicable to evidence, cache identity, complete dispositions, and durable recovery; S7–S9/S12–S18. |
| Cascade deletion | No entity/directory deletion is delivered. Removing a policy declaration/installation must preserve historic evidence and cases; S2/S7/S16. |
| Immutability | Applicable to captured input, policy originals, historic producing identity, and operator authority; S1/S6–S7/S10/S16–S17. |
| Exception classification | Applicable to existing provider/model unavailability versus load/auth/cancel/invalid-result failures; S3/S5/S9. No new assumed exception hierarchy. |
| Dedup/idempotency keys | Applicable to source aliases, candidate cache identity, exact versus semantic recurrence, custom operator binding, and effects; S1/S3/S8–S9/S13/S15–S17. |
| Alternate-branch side effects | Cleanup and honest evidence are required on hits, failures, fallback, cancellation, already-settled routes, and recovery; S3/S5/S7–S9/S11/S15–S16. |

## Verify-Claims Ledger

- **Verified:** FR-1–FR-16 above are the approved functional baseline; each has at least one tagged story, with expected outcomes grounded in approved ADR D1–D12.
- **Operator-confirmed:** Initial Linux/bubblewrap custom-policy support, review-role adaptation, complete captured package identity, shared attended/daemon custom authority, and preserved built-in behavior were approved on 2026-09-10.
- **Verified:** Existing post-join adjudication stories cover mixed laps, complete source handling, durable effects, and one-charge recovery; confidence-floor stories cover suppression and settled recurrence. This feature adds custom-policy identity and explicit consistency/decision outcomes to those behaviors.
- **Unverified and not assumed:** The private Kotlin package's compatibility or live host integration. Faithful portable fixtures prove the agreed interface; optional real-provider smoke is separate from default acceptance.
- **No unconfirmed load-bearing assumptions.** Model semantic correctness is not a deterministic test claim: fake adjudicator outcomes prove context delivery, output validation, and resulting authority/effects, while the approved design retains the model judgment limitation.

**Verify-claims verdict:** CLEAR. Stories accepted by the operator on 2026-09-10; conflict-check precedes planning.

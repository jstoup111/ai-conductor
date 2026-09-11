# PRD: Portable, non-competing build review policy

**Date:** 2026-09-10
**Status:** Approved
**Approved by:** Operator, 2026-09-10
**Source:** jstoup111/ai-conductor#1986
**Track / complexity:** Product / Large, operator-confirmed

## Problem / Background

Teams maintain reusable organization-specific and language-specific review policies outside individual projects. They need those policies to participate in the project's authoritative build review without copying their definitions into every repository or running disconnected reviews.

The current capability does not let a consumer project declare additional installed review policies. Portability also requires knowing which policy definition actually informed a judgment when execution changes providers. Review reuse must not conceal a change in that definition.

Multiple review policies introduce another failure mode: individually plausible findings may demand incompatible repairs. The operator needs one accountable review outcome, and the implementation worker needs one consistent set of authorized work. Existing product and architecture decisions must remain authoritative.

## Goals & Non-Goals

### Goals

- Let consumer projects select their installed review policies without copying those policies into the project or modifying the harness implementation.
- Preserve equivalent review obligations across supported providers and provider fallback.
- Make each judgment and reused result attributable to the policy definition that produced it.
- Resolve competing findings before they become implementation work, with complete evidence and bounded remediation.
- Preserve existing behavior for projects that do not opt into custom review policies.

### Non-Goals

- General-purpose custom lifecycle-step portability or release-policy redesign.
- Installing, purchasing, publishing, or updating third-party review policies.
- Authoring or distributing the motivating organization's Kotlin policy.
- Allowing a review policy to rewrite approved requirements or architecture.
- Replacing other lifecycle review authorities or redesigning their budgets.

## Users / Personas

- **Project maintainer:** selects policies appropriate to a project's language and organizational obligations without maintaining local copies.
- **Policy maintainer:** distributes a reusable review skill whose identity and supporting review criteria survive project adoption.
- **Operator:** inspects evidence, understands a blocked review, and makes decisions that require human authority.
- **Implementation worker:** receives an internally consistent, authorized set of repairs and does not choose between competing reviewers.

## Functional Requirements

### Policy selection and portability

- **FR-1 — Installed policy selection:** A project maintainer can select a review skill by stable semantic identity from a project-local, global, or marketplace/plugin installation without copying its files into the project. The capability is independently demonstrable for each installation source.
- **FR-2 — Project-managed rubric membership:** A project maintainer can add, enable, and disable custom rubrics in the existing public build-review gate without changing harness implementation. Disabled rubrics produce no judgment and cannot introduce blocking findings.
- **FR-3 — Unambiguous policy selection:** When a configured policy is missing, ambiguous, unreadable, or cannot satisfy the supported review contract, review reports the affected policy and an actionable reason before requesting a judgment from it. That failure cannot count as a clean judgment or successful coverage.

> **Amended 2026-09-10 by #1986:** the operator-approved architecture distinguishes preflight-detectable incompatibility from an undeclared dynamic dependency first encountered during review. Known missing resources or required capabilities fail before judging; a runtime-discovered inability remains an explicit unsupported result and can never count as a clean judgment or successful coverage. This preserves the coverage guarantee without assuming arbitrary prose compatibility can be determined in advance.

- **FR-4 — Provider-equivalent execution:** The same project policy selection applies equivalent review obligations under each supported provider, including fallback. A candidate unable to load the selected policy cannot substitute an unrelated policy or report successful policy coverage.
- **FR-5 — Complete review criteria:** The selected skill's supporting review criteria are available to the reviewer. If required supporting material cannot be loaded, the result is an explicit policy-loading failure rather than an apparently informed judgment.

### Evidence and review reuse

- **FR-6 — Judgment provenance:** Each judgment identifies the selected semantic skill, its installation source, the effective policy content identity, its version when available, and the provider that produced it. Evidence distinguishes an informed judgment from a failure to load its criteria.
- **FR-7 — Correct review reuse:** A previous judgment can be reused only when the effective policy content and all other review-relevant inputs match the producing judgment. A policy-content change, including changed supporting criteria or a different fallback candidate's effective policy, prevents reuse of an incompatible judgment. Equivalent unchanged inputs retain eligible reuse.
- **FR-8 — Shared review inputs:** Every active rubric in a review lap judges the same immutable implementation review input. A rubric cannot change that input for itself or its siblings; findings remain attributable to the lap that produced them.

### Consistent findings and bounded repair

- **FR-9 — One aggregate authority:** Only the aggregate build-review authority can direct review-driven implementation repair or declare a review-driven need for human intervention. Individual rubrics produce evidence and findings without independently sending work back to implementation.
- **FR-10 — Conflict resolution before repair:** Overlapping or contradictory findings are considered together before repair is authorized. All involved findings and the reason for their disposition remain inspectable. The worker receives one internally consistent repair set; an unresolved conflict blocks authorization instead of forcing the worker to choose a reviewer.
- **FR-11 — Complete finding disposition:** A review lap cannot settle successfully while any blocking finding lacks a recorded disposition. Rejected, disabled, and otherwise non-blocking findings cannot silently become implementation work.
- **FR-12 — Decision ownership:** A finding that requires changing approved requirements, the implementation plan, or architecture returns to the owning decision boundary or stops for operator input. Custom policy selection does not grant permission to implement such a change off-plan or transfer another review authority's responsibilities.
- **FR-13 — Bounded code repair:** Accepted code-fixable findings may trigger repair admitted by the existing approved scope, followed by rerunning the tests and reviews invalidated by that repair. Repeated equivalent findings or incidental code movement cannot create an unbounded repair loop or reset existing convergence limits.
- **FR-14 — Restart-safe review decisions:** After interruption, recorded dispositions and repair authorization remain attributable to the original findings. Recovery neither duplicates an already-authorized repair effect nor settles a lap by forgetting unresolved blocking work.
- **FR-15 — Preserved operator authority:** Automated conflict resolution cannot impersonate an operator's accepted risk or coverage waiver. A policy-loading or execution failure remains distinct from a policy judgment even when an existing explicit operator coverage decision permits progress.

### Compatibility and adoption

- **FR-16 — Existing-project compatibility:** A project declaring no custom rubrics keeps its existing review policy selection, enablement defaults, and successful review behavior. The correction of incompatible cached judgments applies wherever needed for accurate policy identity, including existing rubrics; it does not make unchanged, equivalent judgments ineligible for reuse.
## Delivery Requirements

> **Amended 2026-09-10 by #1986:** The following unchanged adoption-guidance obligation is classified as delivery documentation, outside the functional story/task chain. It remains required under the approved full scope and D12; the stories and plan skills exclude ordinary documentation artifacts from functional tasks. Its historical FR-17 label is retained for traceability.

- **FR-17 — Usable adoption guidance:** A maintainer can follow the consumer documentation to select an installed review skill, control its participation, inspect resulting evidence, and resolve missing or ambiguous policy selection without discovering an undocumented harness-specific requirement.

## Non-Functional Requirements

- **Isolation:** Review policy adoption and execution must not rewrite the original installed policy, a sibling project's policy selection, or the implementation input under review.
- **Reliability:** Incomplete, malformed, or stale policy evidence cannot be interpreted as successful coverage. Valid findings remain visible when a sibling rubric experiences an execution failure.
- **Traceability:** An operator can connect a review outcome to its policy content, implementation input, contributing findings, disposition, and authorized repair.
- **Compatibility:** Existing operator risk decisions and lifecycle authority boundaries remain effective. New policy capability cannot grant broader implementation permissions.
- **Cost:** Rubrics that are disabled or have eligible reusable judgments do not require new judgment calls. This feature adds no policy-installation network requirement.

## Acceptance Criteria / Success Metrics

- A consumer project adopts an already-installed review skill from each of the three supported installation sources without creating a project-local copy.
- The same policy selection is exercised with both supported providers and with provider fallback; missing and ambiguous policies never produce successful coverage.
- Changing the effective review criteria prevents reuse of the old judgment; an unchanged equivalent invocation can reuse it.
- Two rubrics raising incompatible repairs produce either one justified, consistent authorized repair set or an actionable stop, with both original findings retained.
- Off-plan findings return to a decision owner or operator; within-scope code findings receive bounded repair and fresh invalidated verification.
- Interruption and recovery do not duplicate repair authorization or lose unresolved blockers.
- Existing projects without custom rubrics preserve normal review behavior, subject only to the required cache correctness repair.
- Every functional requirement has positive and applicable negative behavioral coverage using faithful fakes at third-party boundaries. No live third-party service is required by the default verification suite.

## Scope

### In Scope

All outcomes of #1986: installed semantic review-policy selection; project-controlled custom rubrics; provider portability and fallback; effective-policy evidence and correct reuse; shared immutable review input; aggregate authority; conflict resolution; complete dispositions; bounded repair; and consumer adoption documentation. The effective-provider cache correctness gap described in #1804 is included where needed to deliver these guarantees.

### Out of Scope

The general custom-step and release-policy redesign of #1344; redesign of other lifecycle stages; policy distribution management; and changes to the content of third-party review policies. Closure of adjacent issues is not itself a deliverable.

## Key Decisions & Rationale

- **Complete portable-review capability:** The operator approved the full #1986 outcome set. Policy selection, trustworthy evidence, and consistent repair are jointly necessary for an authoritative gate.
- **Bounded adjacent work:** Effective-policy cache correctness is included because incorrect reuse defeats the feature's promise. General custom-step redesign is excluded because installed build-review policy does not require broadening every lifecycle extension.
- **Independent policy evidence, accountable combined outcome:** Maintainers retain visibility into each policy's contribution while implementation receives one authorized result.
- **Preserve decision ownership:** Policy adoption does not authorize new product scope or architectural changes during a repair loop.

## Dependencies

- Existing supported hosts are Claude Code and Codex; installed skill sources may expose different host-specific discovery interfaces.
- The existing public gate is `build_review`. Existing shared adjudication and operator-disposition capabilities are available to extend; this product specification does not establish a new competing gate.
- #1823 is closed and the current review coordinator rejects an unavailable rubric skill digest. This is reusable baseline behavior, not proof that all new installation sources and effective provider environments already work.
- The organization-specific Kotlin review skill referenced by #1986 is a motivating example, not a required runtime dependency or a source of requirements beyond the issue's stated outcomes.

## Open Questions

These are architecture decisions; none changes the approved product scope.

- How should semantic selection resolve installation precedence and expose ambiguity while retaining distribution identity across hosts?
- How should a generic installed review skill participate in the required finding contract, including access to supporting resources, without requiring a project-local copy?
- What constitutes the complete effective policy content for provenance and reuse, and how is it bound to the actual prepared provider candidate?
- What extensions to the existing adjudication capability make conflict resolution, review-question ownership, and off-plan routing explicit for custom rubrics?
- How should project-declared review policy coexist with legacy ignored rubric settings without silently changing their meaning?

## Verify-Claims Ledger

- **Verified:** The checked-out rubric registry declares only `testQuality`; project-configured rubric membership is new capability. Read the current registry at baseline commit `faa8914fff74619fb8331877ba8040485a7c1352`.
- **Verified:** Current review identity is resolved from harness-root skill content before candidate-specific invocation; that does not establish the effective-provider identity promised here. Read the current runner's identity and dispatch paths at the same baseline.
- **Verified:** Current code includes shared adjudication, durable cases, and repair routing. The corresponding shipped record references implementation PR #2087.
- **Verified:** GitHub reported #1823 closed and #1804 and #1344 open during exploration. No assumption that issue closure alone proves the wider requested capability.
- **Operator-confirmed:** Target repository, full bounded scope, inclusion of #1804 as needed, exclusion of general #1344 redesign, product track, Large tier, and independent rubric reviews with existing shared adjudication.
- **No unconfirmed factual assumption is used as an implementation requirement.** Installation precedence, package completeness, and contract adaptation remain explicit architecture questions. The third-party example's internals have not been inspected and are not relied upon.

**Verify-claims verdict:** CLEAR. Product requirements approved by the operator on 2026-09-10; architecture choices remain unsettled.

> **Amended 2026-09-10 by #1986:** architecture choices are now operator-approved in adr-2026-09-10-portable-build-review-policy, including read-only policy adoption and initial Linux/bubblewrap containment. The open questions above retain their original context; that ADR records their binding resolution.

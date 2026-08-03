# PRD: Coherent FINISH Publication

**Date:** 2026-08-01
**Status:** Approved

## Problem / Background

Unattended FINISH can spend minutes on a judgment pass before discovering publication gaps that are mechanically detectable. Those gaps may then enter broad remediation and restart already-complete implementation work. Operators wait longer for results, retry budget is consumed, and completed work is exposed to unrelated churn.

Interactive conduct must remain conversational: operators still choose outcomes and resolve ambiguous or destructive decisions. The opportunity is to make safe, deterministic publication behavior coherent across interactive and unattended operation without weakening the quality of judgment-dependent PR prose.

## Goals & Non-Goals

**Goals**

- Detect mechanically knowable FINISH blockers before spending a judgment pass.
- Make publication resumable and idempotent, with exact failure state and recovery confined to FINISH when implementation remains valid.
- Preserve interactive conduct and all supported foreground and daemon execution modes.
- Retain an explicit quality judgment for PR title and body.

**Non-Goals**

- Automatically merge a pull request.
- Guess ambiguous, destructive, or operator-owned publication decisions.
- Re-evaluate completed implementation unless implementation evidence is invalid.
- Remove the conversational finish experience from interactive conduct.

## Users / Personas

- **Interactive operator:** guides conduct in a supported host and expects to retain control over publication choices.
- **Unattended operator:** expects a daemon or automatic foreground run to publish safely without avoidable provider latency or implementation churn.
- **Recovery operator:** needs an exact, actionable account of the incomplete publication state after a halt.

## Functional Requirements

- **FR-1:** Before requesting judgment-dependent FINISH work, the system evaluates every publication prerequisite that is deterministically knowable at that point.
- **FR-2:** When a deterministic prerequisite is unsatisfied, FINISH stops before the judgment call and reports the exact missing or invalid state.
- **FR-3:** Publication advances through one coherent, resumable lifecycle whose completed transitions are retained across retries.
- **FR-4:** Retrying or resuming publication does not duplicate pull requests, shipped records, comments, or other already-completed publication effects.
- **FR-5:** A publication-only failure remains in FINISH recovery and does not route to BUILD while implementation and SHIP evidence remain valid.
- **FR-6:** A failure routes to BUILD only when current evidence identifies an implementation defect or invalid implementation evidence.
- **FR-7:** A normal feature with green SHIP gates and satisfiable publication prerequisites completes FINISH with at most one judgment-dependent quality pass.
- **FR-8:** PR title and body receive an explicit quality check before FINISH completes; mechanically generated placeholder prose is not accepted as equivalent.
- **FR-9:** Interactive conduct preserves the operator's publication choices and conversational control while deterministic publication actions use the same completion rules as unattended operation.
- **FR-10:** Unattended operation performs only safe, authorized publication actions and halts with an actionable explanation when a decision is ambiguous, destructive, or operator-owned.
- **FR-11:** Foreground conduct, foreground automatic conduct, and daemon conduct remain supported, with mode-appropriate interaction but consistent publication outcomes.
- **FR-12:** FINISH never merges a pull request as part of publication.
- **FR-13:** Publication completion is recorded only after all required durable state and externally visible effects are verified coherent.

## Non-Functional Requirements

- Publication transitions must be idempotent under retry, restart, and partial prior completion.
- Deterministic precondition evaluation must not require a judgment pass.
- Failure reporting must identify the failed publication condition and the permitted next action.
- The behavior must be consistent across supported hosts.

## Acceptance Criteria / Success Metrics

- A known deterministic publication gap produces no FINISH judgment dispatch and names the gap directly.
- A publication-only failure resumes at FINISH without a BUILD dispatch when implementation evidence is still valid.
- A partially completed publication resumes without duplicating external or durable effects.
- A green, publishable unattended feature completes FINISH with no more than one judgment-dependent pass.
- Interactive conduct still asks for operator-owned choices and completes through the same publication validity rules.
- Ambiguous or destructive publication conditions halt without guessing, merging, or discarding work.
- PR prose that lacks the required quality bar blocks completion or receives its bounded judgment pass.

## Scope

### In Scope

- FINISH readiness evaluation, publication progress, recovery classification, completion verification, and mode-specific interaction.
- Existing publication effects required to make the completion record coherent.
- Documentation and observability needed for operators to understand FINISH progress and recovery.

### Out of Scope

- Changes to BUILD implementation behavior unrelated to FINISH routing.
- Automatic PR merge or approval.
- General transaction infrastructure for lifecycle phases other than FINISH.
- Release-note ownership, changelog rendering, semver aggregation, version cutting, and retirement of the legacy implementation-PR token workflow; those belong to the separately approved bot-owned release-PR specification.
- New user configuration unless architecture proves an existing policy cannot express a required safety boundary.

## Key Decisions & Rationale

- Interactive and unattended conduct share publication validity rules so the same feature cannot be considered complete in one mode and incomplete in another.
- Judgment is retained for reader-facing PR prose because correctness of publication state does not establish communication quality.
- Publication-only failures are isolated from BUILD to protect already-validated implementation work.

## Dependencies

- Existing git and GitHub publication capabilities and credentials remain external operational dependencies.
- Existing SHIP gate evidence remains the authority for whether implementation is valid.
- FINISH consumes the repository's resolved release-readiness result but does not author changelog or version state; the active bot-owned release-PR specification owns that contract transition.

## Open Questions

- Which publication transitions can be evaluated or completed before prose judgment, and which require the final PR identity first?
- What durable progress representation best supports safe resume without creating a second source of truth?
- How should transient external-service failures differ from ambiguous or operator-owned decisions at the recovery boundary?

## Verify-Claims Ledger

### Claims

- [verified] Current FINISH completion can discover deterministic publication gaps only after a judgment dispatch; confirmed from the current runner and completion predicate.
- [verified] Current unattended recovery can offer FINISH failures to broad remediation that may select BUILD; confirmed from the current conductor failure path.
- [verified] Foreground and daemon flows share the core conductor and step runner, allowing one behavioral contract with mode-specific interaction.

### Assumptions

- None pending. The operator approved the product track, the engine-owned resumable publication direction, continued interactive conduct, and safe unattended halting.

Verdict: CLEAR

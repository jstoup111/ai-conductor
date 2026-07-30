# PRD: Restore Conflict Remediation for Shipped Pull Requests

**Date:** 2026-07-30
**Status:** Approved
**Track:** Product
**Tier:** M
**Source:** jstoup111/ai-conductor#737; incorporates jstoup111/ai-conductor#1150

## Problem / Background

A shipped pull request can become conflicting while it waits for review. The continuous-integration repair lane recognizes that conflict remediation takes precedence, but conflict remediation may perform no attempt and provide no actionable terminal outcome. The pull request then remains blocked indefinitely while the daemon repeats a deferral that points to no active owner.

This failure was observed on pull request #688: its conflict-attempt count stayed at zero for hours, no conflict-remediation outcome appeared, and progress resumed only after a manual rebase. A later workspace-retention change adds a second known blocker by retaining the completed feature's evidence workspace while its pull request remains open. Workspace retention is required for recoverability, but mere retention must not suppress post-ship conflict remediation.

## Goals & Non-Goals

**Goals**

- Restore hands-off conflict remediation for shipped, watched pull requests, including those whose completed feature workspace is retained.
- Give every conflicting watched pull request one visible remediation owner and an actionable outcome.
- Escalate exactly once when remediation cannot safely run, naming the reason and required operator action.
- Preserve all existing branch-safety, verification, retry-bound, and human-merge guarantees.

**Non-Goals**

- Automatically merge pull requests.
- Remediate pull requests that are not shipped and watched by the daemon.
- Redesign continuous-integration repair for non-conflicting failures.
- Add new classes of automatic semantic conflict resolution.
- Remove completed feature workspaces before the shipped record reaches the default branch.

## Users / Personas

- **Repository operator:** expects shipped pull requests to remain mergeable without manual rebases and needs one actionable escalation when automation cannot proceed.
- **Pull-request reviewer:** expects conflict remediation to preserve reviewed feature work and never overwrite unseen branch changes.

## Functional Requirements

- **FR-1:** When a shipped, watched, non-draft pull request becomes conflicting, automatic conflict remediation must begin within the next normal watch cycle when no transient safety condition prevents it.
- **FR-2:** Retention of the completed feature's evidence workspace alone must not make a shipped pull request ineligible for conflict remediation.
- **FR-3:** Draft, closed, merged, missing, or unwatched pull requests must never receive a conflict-remediation attempt.
- **FR-4:** At most one conflict-remediation attempt may run at a time per repository, and the same pull-request branch must never be mutated concurrently by two daemon activities.
- **FR-5:** Every conflicting watched pull request must receive one explicit disposition for a watch cycle: remediation started, temporarily deferred with a concrete reason, already under sticky escalation, or newly escalated.
- **FR-6:** A transient deferral must not consume an attempt or create a human escalation; the pull request must remain eligible for a later watch cycle.
- **FR-7:** When automatic conflict remediation is active but an attempt is unavailable, permanently ineligible, or exhausted, the pull request must receive exactly one sticky operator escalation identifying the failed stage, concrete reason, and recovery action.
- **FR-8:** Repeated watch cycles must not duplicate an unchanged sticky escalation, comment, or operator notification.
- **FR-9:** Continuous-integration repair may defer a conflicting pull request only when conflict remediation has recorded an explicit disposition for that pull request; it must never defer to a silent or absent remediation lane.
- **FR-10:** Before any refreshed branch is published, all pre-attempt feature work must remain present, the branch must be current with the base used for remediation, and the repository's required verification must pass.
- **FR-11:** If the remote pull-request branch changes after remediation begins, the system must publish nothing, preserve the unseen remote work, and escalate exactly once with the concurrent-change reason.
- **FR-12:** A successful attempt must refresh the existing pull request, clear its conflict-attempt state, and allow continuous-integration repair to evaluate any remaining non-conflict failures on a later watch cycle.
- **FR-13:** Failed attempts must remain bounded by the existing retry and cooldown policy; exhaustion must produce one sticky escalation and no further attempts until operator intervention.
- **FR-14:** Every terminal remediation outcome must identify the pull request, stage reached, and result in the daemon's operator-visible log.
- **FR-15:** Automatic remediation must never merge the pull request; merge authority remains exclusively with the operator.
- **FR-16:** When continuous-integration repair is active while automatic conflict remediation is intentionally inactive, daemon startup must emit one loud incompatibility diagnostic; conflicting pull requests must be identified as requiring manual resolution rather than reported as deferred to an active remediation owner.

## Non-Functional Requirements

- **Reliability:** Daemon restart or repeated watch cycles must not lose retry bounds or duplicate an unchanged escalation.
- **Safety:** Remediation must not disturb the primary checkout, retained feature evidence, or another feature's workspace.
- **Data integrity:** No unseen remote commit or pre-attempt feature work may be overwritten or dropped.
- **Efficiency:** A conflicting pull request that is already under sticky escalation must not consume repeated resolution or assistant work.
- **Observability:** A silent conflict-precedence loop is a release-blocking failure; every non-attempt must have a concrete, operator-visible reason.

## Acceptance Criteria / Success Metrics

- A shipped watched pull request with a retained completed-feature workspace and a deterministic changelog-only conflict receives an automatic remediation attempt and returns to a non-conflicting state without operator action.
- A conflicting pull request for which remediation is unavailable receives one actionable escalation; ten unchanged watch cycles create no duplicate escalation or comment.
- A daemon profile with continuous-integration repair active and automatic conflict remediation inactive emits one startup diagnostic and never claims that a conflicting pull request was deferred to an active remediation owner.
- A temporary concurrency deferral consumes no attempt and becomes eligible after the active remediation finishes.
- A remote branch update during remediation is preserved, no refreshed branch is published, and one concurrent-change escalation is visible.
- A conflicting pull request never produces continuous-integration conflict-precedence deferrals without a corresponding conflict-remediation disposition.
- Existing tests continue to prove bounded retries, workspace isolation, feature-work preservation, verification-before-publish, and operator-only merge authority.

## Scope

### In Scope

- Conflict-remediation eligibility for shipped watched pull requests whose completed feature workspace is retained.
- Explicit ownership and disposition across conflict remediation and continuous-integration repair.
- Exactly-once sticky escalation for unavailable or permanently ineligible remediation.
- Activation of automatic conflict remediation in this repository's normal daemon operation.
- Amendment or supersession of the prior decision that equated workspace presence with active build ownership.
- Operator documentation for automatic attempts, transient deferrals, and sticky escalation.

### Out of Scope

- Automatic merging.
- Unwatched or unshipped pull requests.
- New semantic conflict resolvers.
- General consolidation of all remediation activities into a new orchestration system.
- Changes to completed-workspace retention or shipped-record cleanup timing.

## Key Decisions & Rationale

- **Deliver recovery, not alarm-only behavior:** #1150 is incorporated so this work restores hands-off remediation instead of knowingly shipping only a diagnostic for the adjacent blocker.
- **Retain completed evidence:** recoverability remains more important than using workspace absence as a proxy for branch ownership.
- **Preserve the established trust model:** automatic remediation remains bounded, verified before publication, safe against unseen remote changes, and unable to merge.
- **Sticky, exactly-once escalation:** an operator decision point must remain visible without producing watch-cycle noise or repeated external mutations.
- **Deliberate opt-out remains mutation-free:** inactive conflict remediation produces a loud compatibility diagnostic and truthful manual-action disposition, but does not apply automated pull-request mutations.

## Dependencies

- The existing shipped-pull-request watch and conflict-remediation capability.
- The existing continuous-integration repair capability and its conflict-precedence behavior.
- The existing retry, cooldown, work-preservation, verification, and safe-publication guarantees.
- GitHub pull-request state, labels, and comments as pre-existing operator-facing external surfaces.

## Open Questions

- Which existing runtime evidence should architecture use to prove that a watched shipped branch is no longer owned by BUILD, without introducing a second persisted ownership lifecycle?
- Where should the single conflict-remediation disposition be decided so continuous-integration repair cannot defer to an absent owner?
- Which existing sticky operator signal should carry exactly-once escalation, and how should unchanged repeated watch cycles be deduplicated?
- Which repository verification command should automatic conflict remediation run before publishing a refreshed branch?
- Should the prior workspace-lifecycle decision be amended in place or superseded by a focused replacement decision?

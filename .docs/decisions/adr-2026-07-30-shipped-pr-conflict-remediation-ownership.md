# ADR: Shipped-PR conflict remediation ownership and disposition

**Date:** 2026-07-30
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session (DECIDE)
**Source:** jstoup111/ai-conductor#737; incorporates jstoup111/ai-conductor#1150
**Supersedes:** adr-2026-07-04-resolution-worktree-lifecycle
**Related:** adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep, adr-2026-07-04-autoresolve-state-and-config, adr-2026-07-07-ship-ci-feedback-loop, adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main

## Context

The shipped-PR watch enrolls a pull request only after `daemon-runner` has verified a legitimate ship, then marks the feature processed and retains its build worktree as recoverable evidence. The mergeable sweep subsequently owns post-ship remediation. The daemon loop is serial at the sweep boundary, autoresolve already permits only one resolution process-wide, and publication already passes work-preservation, base-currency, repository-verification, and force-with-lease gates.

The superseded ADR nevertheless treats `.worktrees/«slug»` existence as proof that BUILD still owns the branch. Once completed feature worktrees are correctly retained until their shipped record reaches the default branch, that proxy rejects every open shipped PR. Separately, CI repair rejects every conflicting PR for conflict precedence even when the conflict lane is inactive or produces no disposition. Issue #737 observed that deadlock for hours with zero conflict attempts; issue #1150 records the retained-worktree variant.

The design must restore automatic resolution without inventing a second ownership lifecycle, disturbing retained evidence, weakening remote-change safety, or converting deliberate autoresolve opt-out into pull-request mutation.

## Options Considered

### Option A: Shipped-watch ownership plus existing serial and publication guards

- **Pros:** Uses the lifecycle fact already established at verified ship; no new durable state or stale-lease recovery; keeps the retained and transient workspaces disjoint; remote races still fail at the lease push.
- **Cons:** Safety depends on preserving watch enrollment order, sweep serialization, and the existing hard guards as one proof chain.

### Option B: Persist a separate active-feature ownership lease

- **Pros:** Explicit cross-process ownership evidence independent of watch enrollment.
- **Cons:** Creates a second state lifecycle with acquisition, token ownership, stale-owner reclamation, crash cleanup, and migration concerns; duplicates the daemon's existing run/sweep boundaries.

### Option C: Merge autoresolve and CI repair into one remediation state machine

- **Pros:** One component would own every remediation disposition.
- **Cons:** Broadly rewrites two working bounded lanes, increasing regression surface beyond #737/#1150; still needs the same branch-ownership and publication proofs.

## Decision

Choose Option A.

1. **Watch membership is the post-ship ownership boundary.** A pull request reaches conflict-remediation eligibility only through verified shipped-watch enrollment. Retained build-worktree existence is removed from autoresolve eligibility and is not replaced by another persisted lease.

2. **The transient resolution workspace remains disjoint.** Resolution continues under `.worktrees/resolve-«slug»`; it never edits `.worktrees/«slug»` or the primary checkout. The process-wide resolution guard still permits only one resolution attempt at a time.

3. **The existing publication proof chain remains mandatory.** Every attempt must preserve feature work, prove current-with-base state, run the configured repository verification, and publish only through force-with-lease. Any failure escalates without a fallback force or overwrite.

4. **Eligibility becomes an explicit conflict disposition.** The autoresolve eligibility seam returns one typed result: `dispatch`, `defer`, `already-escalated`, or `escalate`, always with a reason where applicable. In-flight ownership and cooldown are transient `defer` results that burn no attempt. A sticky remediation marker is `already-escalated`. Attempt exhaustion and enabled-but-terminal unavailability are `escalate`.

5. **The mergeable sweep is the single per-cycle conflict arbiter.** Every conflicting candidate receives one disposition before CI repair candidates are dispatched. A conflicting PR is not added to the CI-repair candidate set; the defensive conflict-precedence gate remains inside CI repair for direct callers, but the normal sweep path emits the conflict disposition instead of a repeated CI-fix deferral.

6. **Exactly-once escalation completes the actionable signal before making it sticky.** Conflict remediation uses the existing remediation marker and label, but their write order is contractual: a confirmation-returning marked-comment operation first proves that the current stage, reason, and recovery action are present; only then may `needs-remediation` be applied. An indeterminate comment lookup does not fall back to an unproven create, and a failed comment write leaves the label unapplied so a later sweep retries without burning a remediation attempt. If the comment succeeds but the label write fails, the later retry updates the same marked comment and retries the idempotent label. Once the label is observed, subsequent sweeps classify the PR as `already-escalated` and perform no external mutation. This stricter operation is scoped to conflict escalation; existing best-effort comment callers retain their current behavior.

7. **Deliberate opt-out remains mutation-free.** The existing default-disabled autoresolve contract is preserved. When CI repair is active while autoresolve is inactive, daemon startup emits one compatibility diagnostic, and conflicting PRs receive a truthful manual-resolution disposition rather than a claim that an active conflict lane has precedence. No sticky PR mutation is applied solely because autoresolve is disabled.

8. **ai-conductor opts in with full repository verification.** Its repository configuration enables autoresolve and supplies a root-relative verification command that runs both the conductor aggregate tests and `test/test_harness_integrity.sh` before publication. No new configuration key is introduced.

9. **The superseded ADR's unaffected rules survive here.** Fresh transient-workspace provisioning, namespace preparation, teardown on success and failure, stale resolution-workspace replacement, and disjoint naming remain authoritative. Only its build-worktree-existence eligibility rule is rejected.

## Consequences

### Positive

- Conflicting shipped PRs with retained evidence workspaces can self-heal again.
- CI repair cannot silently defer to an inactive or disposition-less conflict lane.
- Exactly-once operator escalation uses existing GitHub surfaces with a fail-closed comment-first, label-last completion boundary.
- No new ownership file, schema, cleanup loop, external integration, or dependency is added.

### Negative

- Watch enrollment order, sweep serialization, resolution serialization, and lease publication form a multi-part invariant that tests must pin together.
- An explicit autoresolve opt-out still requires manual conflict resolution; the improvement is one startup diagnostic plus truthful per-PR disposition, not automatic mutation.
- The configured repair verification runs both aggregate TypeScript tests and harness integrity, increasing the duration of successful conflict refreshes.

### Follow-up Actions

- [ ] Replace boolean eligibility with the typed conflict disposition and cover every disposition in unit tests.
- [ ] Remove the retained-build-worktree eligibility gate while preserving transient resolution-workspace isolation tests.
- [ ] Exclude conflicting PRs from the normal CI-repair candidate set and retain the defensive direct-call gate.
- [ ] Add a confirmation-returning marked-comment operation for conflict escalation and apply the sticky label only after actionable content is confirmed.
- [ ] Add the once-per-startup compatibility diagnostic for active CI repair plus inactive autoresolve.
- [ ] Enable autoresolve for ai-conductor with both required verification suites.
- [ ] Update daemon/configuration documentation and the superseded ADR status.

## Verification of Load-Bearing Claims

| Claim | Basis | Confidence |
|---|---|---:|
| Watch enrollment occurs only after a verified ship, before processed marking and retained-workspace logging | Verified directly in `daemon-runner.ts` verified-ship path | 99% |
| Sweep work runs at startup/idle/post-feature boundaries and is awaited rather than launched concurrently | Verified in `daemon.ts` and `daemon-runner.ts` | 97% |
| Retained build-worktree existence now rejects every open shipped PR after the retention change | Verified from `autoresolve.ts` Gate 6 plus the APPROVED 2026-07-29 retention ADR | 99% |
| Resolution already has a process-wide serial guard, work-preservation checks, repository verification, and force-with-lease publication | Verified directly in `autoresolve.ts` | 99% |
| The current label-first escalation can suppress recovery after a comment failure | Verified directly from `autoresolve.ts`: the label is added before non-reporting `upsertComment`, while eligibility treats the label as terminal | 99% |
| Comment-first, label-last ordering permits safe retry without a new persisted state | Reasoned from the verified sticky-label gate and marker-addressed comment surface; operator selected this amendment on 2026-07-30 | 98% |
| The current CI-fix conflict-precedence gate does not consult autoresolve availability or outcome | Verified directly in `ci-fix.ts` | 99% |

No unconfirmed load-bearing assumption remains. The disabled-mode contract conflict and the partial-escalation ordering gap were presented to and resolved by the operator on 2026-07-30.

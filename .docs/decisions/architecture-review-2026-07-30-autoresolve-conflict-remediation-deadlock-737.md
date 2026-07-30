# Architecture Review: Restore Conflict Remediation for Shipped Pull Requests

**Date:** 2026-07-30
**Mode:** Full pre-stories review, Medium-tier lightweight scope
**Input:** Approved PRD `2026-07-30-autoresolve-conflict-remediation-deadlock-737`; approved architecture diagram; issues #737 and #1150
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** Feasible with the existing TypeScript engine, injected sweep dependencies, GitHub adapter, worktree helpers, and repository configuration. No new package, service, account, or infrastructure is required.
- **Prerequisites:** The autoresolve and CI-repair lanes, shipped watch, sticky escalation helper, aggregate conductor suite, and harness integrity suite already exist.
- **Integration surface:** The change crosses autoresolve eligibility, mergeable-sweep arbitration, defensive CI-fix eligibility, daemon startup wiring, repository configuration, and operator documentation. This is appropriate for tier M but requires explicit wiring commitments below.
- **Data implications:** No new schema or migration. Existing watch-entry attempt/cooldown fields remain authoritative.
- **Performance:** Successful remediation runs two repository verification suites; only one resolution runs at a time. Normal watch reads remain bounded by the existing registry cap.
- **Worktree isolation:** Feasible without shared-resource changes. Retained `.worktrees/«slug»`, transient `.worktrees/resolve-«slug»`, and the primary checkout remain distinct.

## Architectural Alignment

- The selected design conforms to the verified-ship enrollment boundary and the approved 2026-07-29 decision to retain feature evidence until the shipped record reaches main.
- It supersedes the 2026-07-04 worktree-lifecycle ADR because that ADR's directory-existence proxy now contradicts retained-workspace behavior. Its transient-workspace and teardown rules are preserved in the replacement ADR.
- It preserves the approved sweep-native remediation pattern and the two sanctioned rebase-resolution call sites; no third assistant dispatch site is introduced.
- It preserves deliberate default-disabled autoresolve semantics after the operator-approved PRD correction. Inactive autoresolve produces no automated PR mutation.
- The approved component/sequence diagram accurately shows proposed ownership, non-mutation boundaries, per-cycle disposition, and the publication safety chain.

## Wiring Surface

| Production surface | Production caller / consumer |
|---|---|
| Typed conflict disposition returned by autoresolve eligibility | Called by the mergeable sweep through the existing daemon-cli injected autoresolve adapter |
| Per-cycle conflict arbiter and conflicting-candidate exclusion from CI repair | Executed inside the mergeable sweep before the existing CI-repair dispatch loop |
| Terminal pre-dispatch conflict escalation | Mergeable sweep calls the autoresolve escalation adapter; a confirmation-returning marked-comment operation proves actionable content before the adapter applies the sticky label, and the next sweep consumes that label as `already-escalated` |
| Startup remediation compatibility diagnostic | Daemon CLI evaluates resolved autoresolve activation and effective CI-repair activation once after CI-fix preflight, then writes one greppable daemon log line |
| ai-conductor autoresolve activation and verification command | Existing daemon-cli config reader supplies it to the autoresolve dispatch adapter and suite runner |
| Operator behavior documentation | Configuration reference documents opt-out/diagnostic semantics; daemon guide documents dispatch, deferral, escalation, and recovery |

The plan must give every production-code task a `Wired-into:` statement derived from this table.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A branch changes during resolution | Data | Low | High | Existing feature-work preservation, current-with-base proof, and force-with-lease; no fallback force |
| Watch enrollment or sweep ordering regresses | Integration | Low | High | Cross-seam tests pin verified ship → watch enrollment → processed marking and sweep-before-CI disposition |
| Partial GitHub escalation write leaves an unactionable sticky label | Integration | Medium | High | Confirm marked actionable comment first, apply sticky label last, and leave comment failures retryable without attempt burn |
| Combined verification makes remediation slow | Performance | Medium | Medium | One resolution at a time; watch label pass completes before dispatch; duration is operator-visible |
| Disabled-mode diagnostics become noisy | Observability | Low | Low | Emit compatibility warning once per daemon startup and exclude conflicting PRs from repeated CI-fix deferral logging |

## ADRs Created

- `adr-2026-07-30-shipped-pr-conflict-remediation-ownership` — APPROVED; supersedes the incompatible worktree-lifecycle proxy while preserving its unaffected isolation rules.

## Early Overlap Scan

The advisory scan named a very large set of historical and open `spec/*` branches as overlapping every candidate path, including branches unrelated to remediation, and its dependency query for issue #737 was indeterminate because GitHub was unreachable. This output is too broad to establish a concrete blocker. It is recorded as advisory only; conflict-check and the implementation branch's eventual rebase remain authoritative.

## Conditions — Satisfied 2026-07-30

1. The operator approved the new ADR; it is `Status: APPROVED`.
2. `adr-2026-07-04-resolution-worktree-lifecycle` is `Status: SUPERSEDED` with a pointer to the replacement ADR in this diff.
3. The downstream stories gate must cover the two High-impact negative paths: concurrent remote branch movement and loss of the verified-ship/sweep-ordering invariant.

## Amendment — 2026-07-30 conflict-check kickback

Conflict-check verified that the existing label-first escalation can add `needs-remediation`, fail
to write its actionable comment, and then suppress every retry because label presence is terminal.
The operator selected the least-disruptive correction: conflict escalation confirms its current
marker-tagged comment before applying the sticky label. The confirmation operation reports success
or failure, does not create when lookup state is indeterminate, and leaves failures eligible for a
later no-attempt-burn retry. No new persisted lifecycle or external integration is introduced.

This amendment is feasible within the existing GitHub adapter boundary and resolves the structural
gap without changing deliberate opt-out, publication safety, or retry-cap decisions. Verdict
remains **APPROVED**.

## Blocking Issues

None after the operator-approved disabled-mode and escalation-ordering corrections. Conditions 1–2 are lifecycle gates, not unresolved design questions.

## Plan Alignment Review — 2026-07-30

**Verdict:** APPROVED

- All six design-time production surfaces have concrete plan wiring: typed classification,
  per-cycle sweep arbitration, terminal escalation, startup compatibility diagnosis, self-host
  activation, and operator-visible outcomes.
- The new strict marked-comment operation is called only by conflict escalation; the existing
  best-effort upsert contract for other callers remains intact.
- Task 17 pins the High-impact verified-ship enrollment and sweep-ordering invariant. Task 18 pins
  concurrent remote movement, preservation/current-base/verification failure, lease-only publish,
  terminal logging, and operator-only merge authority.
- The task graph is acyclic, has 18 tasks, and introduces no migration, package, external service,
  new configuration key, or persisted ownership/escalation lifecycle.
- The plan-updated Mermaid component and sequence diagrams both render successfully.

No new ADR, condition, or architectural risk is introduced by the plan. The earlier review marker
remains appropriate because this feature already contains a superseding ADR and High-impact risks.

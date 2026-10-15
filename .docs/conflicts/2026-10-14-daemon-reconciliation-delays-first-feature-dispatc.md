# Conflict Check: Dispatch-first daemon maintenance (#1174)

**Date:** 2026-10-14
**New stories:** `.docs/stories/daemon-reconciliation-delays-first-feature-dispatc.md` (Stories 1–9)
**Result:** Passed. Zero blocking conflicts remain and no degrading conflict was accepted. Every
conflict was resolved by operator-approved edits (2026-10-14).

## Resolved conflicts

### A1: Startup dashboard rendered before the first dispatch
**Stories involved:** "Render the inherited-state dashboard at startup" (`daemon-halt-reconciliation.md`) vs Story 1
**Type:** sequencing contradiction. **Severity:** blocking for the existing test.
**Resolution:** The dashboard renders once at startup, as the first step of the background job,
after the first claim attempt. The existing criterion and its Done-When are rewritten in place.

### A2: Dashboard before the startup re-kick
**Stories involved:** "A base advance during downtime re-kicks halted work on restart" vs Story 3
**Type:** sequencing contradiction. **Severity:** degrading.
**Resolution:** Inside the background job the dashboard runs before rekick and resume
consumption, so inherited HALTs are still shown. ADR D3 and Story 3 are revised. The existing
story holds unchanged.

### A3: Dashboard parked annotations need classification
**Stories involved:** `parked-feature-reconciliation-1060.md` S3/S6 vs Story 2
**Type:** state conflict. **Severity:** degrading.
**Resolution:** The dashboard keeps its informational parked classification (auto-cleanup off)
and only drops its own fetch. ADR D2 and Story 2 are revised.

### B1: When a queued repair consumes an attempt
**Stories involved:** `ship-ci-feedback-loop.md` and `restore-failing-ci-check-context-in-ci-fix-session.md` vs Stories 5 and 6
**Type:** state conflict. **Severity:** degrading.
**Resolution:** `ciFixAttempts` is bumped at claim, before git work, never at queue time. ADR D5
and Story 5 are revised.

### B2: A queued request goes stale before its claim
**Stories involved:** `auto-resolve-open-pr-conflicts.md` (merged/closed prune) and `shipped-is-fire-and-forget-no-reconciliation-sweep.md` vs Story 5
**Type:** sequencing. **Severity:** degrading.
**Resolution:** Eligibility is re-read at claim. Merged, closed, draft, or green PRs are dropped.
ADR D5 and Story 5 are revised.

### B3: Halt-PR in-flight skip vs delta-only logging
**Stories involved:** `halt-pr-reconciliation-sweep-logs-on-delta-only-52.md` vs Story 4
**Type:** overlap. **Severity:** degrading.
**Resolution:** The skip is logged once per transition through the delta cache and is never a
conformance outcome. ADR D4 and Story 4 are revised.

### B4: Skipped parked run summary vs outcome-cache suppression
**Stories involved:** `parked-feature-reconciliation-1060.md` S1/S7 vs Story 7
**Type:** state conflict. **Severity:** degrading.
**Resolution:** The event is emitted on every run. The log summary stays under outcome-cache
suppression. ADR D6 and Story 7 are revised.

### C1–C6: Assertions superseded by the amended ADRs
The new ADR amends `adr-2026-08-27-daemon-dispatcher-executor-seam` D5/D7,
`adr-2026-07-07-ship-ci-feedback-loop` decision 3, and the
`adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` consequence. These existing criteria
were rewritten in place:

- `ship-ci-feedback-loop.md`: the one-per-tick limit, the shared serial guard, and bump-at-dispatch.
- `auto-resolve-open-pr-conflicts.md`: one PR per tick and the global serial guard, now one per PR.
- `restore-failing-ci-check-context-in-ci-fix-session.md` Story 4: the serial guard and per-tick
  limit, now a same-PR skip.
- `enable-single-repo-daemon-concurrency-un-clamp-the.md` Story 2: width-1 parity now covers
  feature ordering and gates. A fetch during a build at width 1 is now allowed, because work
  orders pin their base.
- `parked-feature-reconciliation-1060.md` S1: the startup sweep runs in the background job after
  the first claim.

### C7: Halt-PR sweep cadence
`halt-pr-presentation-reliability.md` says "startup and each idle tick". This is still satisfied:
the sweep runs at startup in the job and on idle and busy ticks. No edit was needed.

## Pairs examined and compatible

These pairs were checked and found compatible:

- Pause gates every dispatch path (Story 6).
- The rate-limit episode gate and the episode-end rekick (Story 6, Story 3).
- Stale-engine rebuild at a drained boundary and the refresh throttle (Stories 1–3).
- WorkClaims, no double dispatch, and the operator-park re-check (Stories 1 and 5).
- The provider-scratch lease.
- Autoresolve active-run skip and conflict precedence over CI-fix (Story 5).
- In-flight retention during reclaim and ancestry re-verification (Stories 4 and 7).
- Atomic halt-state clear (Story 4).
- The rekick SHA guard and first-run seeding (Story 2).
- `daemon_backlog_snapshot` persistence (Story 8).
- SIGTERM drain (Story 3).
- Dashboard render extensions (priority bands, GATED, status-hides-completed).

## ADRs

**Examined:**
- adr-2026-08-27-daemon-dispatcher-executor-seam
- adr-2026-07-07-ship-ci-feedback-loop
- adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep
- adr-2026-07-27-ancestry-proven-park-reconciliation
- adr-2026-07-05-halt-pr-presentation-reliability
- adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic
- adr-2026-07-20-ci-fix-startup-preflight-and-error-classification
- adr-2026-07-04-durable-pause-marker
- adr-2026-07-10-observed-close-watch-registry
- adr-2026-08-01-multi-proof-park-deletion-authority
- adr-2026-07-04-autoresolve-state-and-config
- adr-2026-07-20-ci-fix-dispatch-via-steprunner
- adr-2026-08-09-worktree-local-provider-scratch
- adr-2026-10-09-shipped-pr-readiness-verdict
- adr-2026-10-14-dispatch-first-daemon-maintenance

**Narrowed out (subject does not overlap):**
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting
- adr-2026-07-03-gated-snapshot-status-read-model
- adr-2026-06-29-rebase-conflict-resolution-dispatch
- adr-2026-07-03-post-rebase-force-with-lease
- adr-2026-07-22-auth-failure-classification-observed-401-patterns
- adr-2026-07-09-setup-failure-triage
- adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
- adr-2026-07-25-content-addressed-full-suite-proof
- adr-2026-08-05-worktree-classification-evidence-derived-reasons
- adr-2026-08-07-project-teardown-hook-contract-and-containment
- adr-2026-07-29-ship-start-draft-pr
- adr-2026-09-05-gh-cli-version-floor-and-environment-gate
- adr-2026-08-26-setup-once-per-worktree-marker
- adr-2026-07-22-daemon-level-missing-credential-gate
- adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history
- adr-2026-08-07-worktree-removal-coverage-guard
- adr-2026-09-29-plan-slice-manifest
- adr-2026-10-10-stacked-restack-journaled-replay
- adr-2026-08-09-one-pr-per-branch-halt-is-a-state
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
- adr-2026-09-11-github-operation-ownership
- adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal

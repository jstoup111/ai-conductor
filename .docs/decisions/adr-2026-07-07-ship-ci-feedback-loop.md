# ADR: Ship→CI feedback loop — sweep-native bounded remediation of red shipped PRs

**Date:** 2026-07-07
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session (DECIDE)
**Source-Ref:** jstoup111/ai-conductor#397

## Context

Five consecutive daemon ships (#384, #392, #393 among them) passed every in-worktree gate and
then failed CI for environment/parity reasons the local gates structurally cannot catch
(runner default-branch differences, 2-core timing, full-contract breakage outside the feature's
scope). The daemon never observes its ship going red — the PR sits broken in the operator's
merge queue until a human notices and fixes it by hand.

The daemon already watches its shipped PRs: `.daemon/mergeable-watch.jsonl` maps each shipped
`prUrl` to its `slug` and `repoCwd`, and `sweepMergeableLabels` (startup + every idle tick +
post-feature) already fetches `statusCheckRollup` per PR via `prMergeState` — but collapses it
into one `hasFailingOrPendingChecks` boolean that only gates the `mergeable` label.

Constraints:
- The processed-ledger/spec-hash dedup machinery has a history of duplicate-dispatch incidents;
  a fix path must not perturb it.
- By ship time the feature's worktree is torn down and the slug marked processed; any
  remediation needs a deliberately re-created workspace.
- Pushing fixes to an already-shipped PR is a new autonomy surface — it must be bounded and
  converge to a human HALT, never loop on a permanently-red PR.

## Options Considered

### Option A: Sweep-native remediation dispatch (mirror the Task-17 autoresolve seam)
- **Pros:** CI state is already fetched (zero new polling); PR→slug bounding state lives in the
  watch entry (`ciFixAttempts`, like `resolveAttempts`); reuses the proven injected-dispatch
  shape (`AutoresolveDispatchOpts`) and the existing resolution scaffolding
  (`withResolveWorktree` at the PR branch tip, serial in-flight guards, acceptance guards,
  suite gate, push-refreshed); never touches the processed ledger; remediation starts from the
  shipped PR branch — the correct base.
- **Cons:** the sweep gains a second dispatch responsibility; a new resolver flavor (fix-CI)
  must be written.

### Option B: Re-enqueue through the discovery loop
- **Pros:** single dispatch path.
- **Cons:** requires un-marking the slug processed — directly perturbs the duplicate-dispatch-
  prone dedup machinery; the rebuild would start from the spec, not the shipped PR branch,
  risking a divergent second implementation.

## Decision

**Option A**, operator-confirmed. Specifics:

1. **Check-state classification (additive).** Extend `PrMergeState` with a distinct checks
   outcome (pending vs failed vs green/none) derived from the per-check `status`/`conclusion`
   fields already present in the `gh pr view` response. `hasFailingOrPendingChecks` and
   `isMergeable` semantics are unchanged.
2. **Sweep branch.** In `sweepMergeableLabels`, per watched entry: checks pending → no-op;
   checks FAILED → ensure a `ci-failed` label, emit a halt-monitor-visible `ci_failed` event,
   and collect the entry as a CI-fix candidate. A later sweep seeing the rollup green removes
   the `ci-failed` label.
3. **Bounded dispatch.** A `CiFixDispatchOpts` seam with the same injected shape as
   `AutoresolveDispatchOpts` (`enabled`, `isEligible`, `dispatch`); at most one dispatch per
   tick, shared serial in-flight guard with conflict autoresolve. `ciFixAttempts` is bumped on
   the watch entry BEFORE git work (crash-safe bounding), reset on a later green observation.
   `MAX_CI_FIX_ATTEMPTS = 2` (mirrors `MAX_KICKBACKS_PER_GATE`).
4. **Remediation run.** Dispatch re-creates an isolated worktree from the PR branch tip
   (`withResolveWorktree` pattern), gathers the failing checks' identity + a failing-job log
   excerpt as the `RETRY:` hint, drives a fix run, then applies the existing acceptance
   guards + suite gate before pushing to the same PR branch. The next sweep re-reads the
   rollup — CI itself is the verifier.
5. **Exhaustion.** Attempts exhausted and still red → `needs-remediation` label + escalation
   comment via `build-failure-escalation`, HALT-grade event so the halt-monitor files/triages
   it. No further dispatches for that PR (sticky until a human clears).
6. **Config.** `ci_watch.enabled` config key, **default true** (operator explicitly chose
   wired-on bounded auto-remediation over a flag-off rollout); the key exists as a kill switch,
   consistent with `mergeable_autoresolve.enabled`.
7. **Fixture-portability guards (companion deliverable).** A glob-based structural meta-test
   over `src/conductor/test/**` flagging (a) `git init` without `-b` (non-bare) across all exec
   wrapper shapes, (b) `.unref()` on engine-loop timers in `src/engine`, (c) tmp-file writes
   staged outside the target directory then renamed/copied. Escape hatch =
   `// portability-ok: <reason>` comment marker; falsifiability tests prove each pattern fires;
   the ~16 existing non-portable `git init` sites are fixed in the same change.

### Claims and assumptions (verify-claims)

- **Verified:** `prMergeState` already fetches `statusCheckRollup` but collapses failed/pending
  (pr-labels.ts); watch registry shape + legacy normalization (mergeable-sweep.ts:35-104);
  autoresolve seam mechanics incl. bump-before-dispatch and one-per-tick (mergeable-sweep.ts:
  244-276); `withResolveWorktree`/guards/suite-gate/push-refreshed scaffolding (autoresolve.ts);
  sweep trigger points (daemon.ts sweepBestEffort; daemon-runner maybeSweep); kickback/HALT
  constants and escalation path (conductor.ts, build-failure-escalation.ts).
- **Inferred (~90%), non-decision-changing:** a failing-job log excerpt is obtainable via
  `gh pr checks` → `gh run view --log-failed`. If a log excerpt is unavailable (external check,
  permissions), the RETRY hint degrades to check names + links — the design is unchanged.

## Consequences

### Positive
- Environment parity by construction: whatever CI checks, the loop enforces — no local CI
  simulation. The "ship went red and nobody noticed" class (#384/#392/#393) closes.
- Bounded and observable: attempts in the watch entry, ✋-grade events, sticky
  `needs-remediation` on exhaustion.
- Fixture guards prevent the most common red-CI *causes* from being authored at all.

### Negative
- The daemon now pushes commits to already-shipped PRs (new autonomy surface, bounded to 2
  attempts and gated by `ci_watch.enabled`).
- Sweep tick can take longer when a fix run dispatches (serial guard defers other work that
  tick).
- A flaky CI check can consume fix attempts on a healthy PR (mitigated: attempts reset on green
  observation; exhaustion is a HALT, not a loop).

### Follow-up Actions
- [ ] Extend `PrMergeState` + classification tests
- [ ] `ci-failed` label lifecycle in the sweep + `ci_failed` event type
- [ ] `CiFixDispatchOpts` seam + eligibility gates (cooldown, cap, sticky labels, serial guard)
- [ ] Fix-CI resolver: worktree from PR branch, log-excerpt RETRY hint, guards + suite gate, push
- [ ] Exhaustion → `needs-remediation` + escalation comment + HALT-grade event
- [ ] `ci_watch.enabled` config key (default true) + docs (README + src/conductor/README)
- [ ] Structural fixture-portability meta-test + fix the 16 `git init` sites

# PRD: Daemon PR Labeling — `needs-remediation` & `mergeable`

**Date:** 2026-06-29
**Status:** Approved

## Problem / Background

The conductor runs unattended in daemon mode and opens many pull requests over a run. A human
engineer reviewing that output today has **no at-a-glance signal** on a PR for two states that
matter most:

1. **A run that failed and needs a human.** When the autonomous BUILD phase cannot be completed
   (retries exhausted), the daemon parks the feature with a local marker. The engineer only finds
   out by inspecting daemon logs / the startup dashboard and digging into a worktree. Any code the
   build *did* produce is stranded on a local branch with no remote surface and no explanation of
   why it failed.
2. **A run that succeeded and is ready to merge.** When a feature completes the full SDLC cleanly,
   its PR still has to clear CI and be conflict-free before a human should merge it. Nothing
   distinguishes "green, ready to merge" from "still churning" in the PR list.

Both gaps slow the human down: failures hide until someone goes looking, and ready-to-merge work
is indistinguishable from in-flight work. Two GitHub labels, applied by the daemon, close the gap
and let the engineer triage the PR list directly on GitHub.

## Goals & Non-Goals

**Goals**
- Make every irrecoverable autonomous build failure visible on GitHub (when there is code to show),
  with a clear reason and an explicit "manual remediation required" signal.
- Let a human filter the daemon's PRs to the ones that are genuinely ready to merge, with that
  signal staying truthful over time.
- Never let labeling/PR side-effects interfere with the daemon's core job — failures in the
  GitHub steps must not block or crash a run.

**Non-Goals**
- Not changing how interactive (human-at-the-keyboard) runs behave — both labels are daemon-only.
- Not auto-merging anything. `mergeable` is an advisory filter, not an action.
- Not performing the remediation itself — the label flags that a human (or the existing remediation
  flow) is needed; it does not fix the build.
- Not labeling or commenting on the originating intake issue — the PR is the only surface.

## Users / Personas

- **The engineer (human operator).** Periodically reviews the daemon's output, decides what to
  merge, and steps in on failures. Wants to triage from the GitHub PR list without opening each PR
  or reading daemon logs.

## Functional Requirements

### Failure surfacing (`needs-remediation`)

- **FR-1:** When an unattended (daemon) run exhausts its retries on the BUILD phase and cannot
  proceed, the run is treated as an irrecoverable build failure for the purposes of this feature.
- **FR-2:** On an irrecoverable build failure **where the feature branch contains at least one
  commit**, the daemon surfaces the work as a pull request labeled `needs-remediation`.
- **FR-3:** That pull request carries a comment explaining **why** the build failed (the failure
  reason and the relevant error), stating that manual remediation is required.
- **FR-4:** That pull request is opened as a **draft**, so it cannot be merged accidentally and
  reads as "not ready" independent of the label.
- **FR-5:** If an eligible pull request already exists for the branch, it is reused — the failure
  comment and `needs-remediation` label are applied to the existing PR rather than creating a
  duplicate.
- **FR-6:** On an irrecoverable build failure **with no commits on the branch**, no PR, comment, or
  label is produced; the existing local failure signal (HALT marker, daemon dashboard/logs) is the
  only surface, unchanged from today.
- **FR-7:** The failure-surfacing side effects are **best-effort and non-blocking**: if any push,
  PR, comment, or label step fails, the run still parks/halts exactly as it does today and the
  failure is recorded. Surfacing the *reason* takes priority over surfacing the code.
- **FR-8:** Failure surfacing applies **only in daemon/auto mode**. Interactive runs are unchanged.

### Ready-to-merge surfacing (`mergeable`)

- **FR-9:** Only pull requests from features that **completed the full SDLC successfully** (reached
  a "done" outcome) are eligible for the `mergeable` label. Failed, halted, or still-running
  features are never eligible.
- **FR-10:** An eligible pull request is labeled `mergeable` when it is genuinely ready to merge:
  it is open, has no merge conflicts, and its CI is passing (a PR with no required checks counts as
  passing).
- **FR-11:** The `mergeable` label is **kept in sync with reality**: it is removed if the PR later
  becomes non-mergeable (new conflicts, CI breaks, or it is no longer open), and re-added if it
  becomes ready again.
- **FR-12:** A pull request carrying `needs-remediation` is **never** labeled `mergeable`.
- **FR-13:** Once a tracked pull request is merged or closed, it is dropped from ongoing
  consideration (no further labeling activity for it).
- **FR-14:** Because CI is generally not finished at the moment a PR is opened, the `mergeable`
  determination is made by **re-checking over time**, not as a one-time check at PR creation. The
  label reflects the PR's current state whenever it is evaluated.
- **FR-15:** All `mergeable` labeling is **best-effort and non-blocking** and applies **only in
  daemon/auto mode**. A failure to read PR state or apply/remove a label never disrupts the daemon's
  feature processing.
- **FR-16:** When a feature that previously surfaced a `needs-remediation` PR is later re-dispatched
  and **completes successfully** (reaches `done`) on the same branch, the daemon **clears the stale
  failure signal** on that PR: it removes the `needs-remediation` label and marks the PR
  ready-for-review (un-drafts it), best-effort, as part of enrolling it for the `mergeable` sweep.
  This keeps both labels truthful (a shipped feature is no longer flagged as needing remediation)
  and unblocks FR-12 so the now-clean PR can be evaluated for `mergeable` normally. The exclusion in
  FR-12 is unchanged — it still applies to any PR that genuinely still carries `needs-remediation`.

## Non-Functional Requirements

- **Reliability:** Neither behavior may block, slow materially, or crash a daemon run. Every
  GitHub interaction is advisory and independently recoverable.
- **Truthfulness:** The `mergeable` label must not assert a stale state — when in doubt (e.g. merge
  state still being computed), it is better to omit the label than to assert readiness wrongly.
- **Observability:** Each labeling/PR action (and each swallowed failure) is recorded in the daemon
  log so the engineer can see what was attempted.

## Acceptance Criteria / Success Metrics

- An irrecoverable daemon build failure with commits results in a **draft PR labeled
  `needs-remediation` with a failure-reason comment**; the same failure with no commits produces
  **no GitHub artifacts** and the run still parks locally.
- A failure in any GitHub step still leaves the run parked exactly as before (no crash, no hang).
- A cleanly shipped feature's PR is labeled `mergeable` once it is conflict-free and CI-green, the
  label is **removed** when that stops being true, and a `needs-remediation` PR never receives it.
- Interactive runs show **no change** in behavior.
- All FRs are covered by passing tests, including the negative paths (no-commits, each GitHub step
  failing, non-mergeable transitions, needs-remediation exclusion).

## Scope

### In Scope
- Daemon-mode surfacing of irrecoverable build failures as a labeled draft PR with a reason comment.
- Daemon-mode `mergeable` labeling of successfully-shipped PRs, kept in sync with CI/merge state.
- Best-effort, non-blocking semantics for every GitHub interaction in both behaviors.

### Out of Scope
- Any interactive-mode behavior change.
- Labeling/commenting on originating intake issues.
- Auto-merging, auto-marking-ready, or otherwise acting on the labels.
- Performing remediation of the failed build.

## Key Decisions & Rationale

- **Daemon-only.** Interactive runs have a human present who already drops into a recovery session;
  auto-PRs/labels there would be surprising and redundant.
- **Comment prioritized over code on failure.** The engineer needs the *reason* most; pushing the
  code is a convenience that must never block the reason from being recorded.
- **Draft PR for failures.** A clear "not ready" signal that survives even if someone ignores
  labels.
- **`mergeable` is done-only and kept in sync.** Limiting to fully-shipped features avoids
  mislabeling in-flight or failed work; keeping it in sync prevents the filter from lying as CI and
  conflicts evolve.
- **No GitHub surface when there are zero commits.** There is nothing to show; the existing local
  signal already covers it.
- **Success clears the failure signal (FR-16).** A re-kicked feature that ultimately ships `done`
  must not keep a stale `needs-remediation` draft PR — otherwise it would be permanently barred from
  `mergeable` (FR-12) and the label would lie. Clearing on success is preferred over leaving it for a
  human (it forces manual work on an auto-success) and over flipping FR-12's precedence (which risks
  stripping the label off PRs that still need work).

## Dependencies

- GitHub access for the daemon (remote + authenticated `gh`). When absent, both behaviors no-op
  gracefully (consistent with best-effort semantics) and the run is otherwise unaffected.
- The existing daemon failure-parking and successful-ship outcome signals, which these behaviors
  observe.

## Open Questions

- None outstanding. Label names (`needs-remediation`, `mergeable`) and the two label colors are
  taken as given for human-filtering; they can be revisited without affecting the behavior.

# PRD: Auto-Resolve Merge Conflicts on Open Harness PRs

Status: Approved
Date: 2026-07-04
Track: product
Tier: M
Source: intake issue jstoup111/ai-conductor#247

## Problem / Background

When the default branch advances while a harness-authored PR sits open (parked,
awaiting review, or slow to merge), the PR frequently becomes conflicting. Today
the harness only *reports* this: the merge-status watch removes the PR's
`mergeable` label, and everything after that is manual operator toil — the
operator must rebase, resolve, verify, and re-push by hand. PR #231 hit this
twice in a single day as the default branch advanced under it.

The harness already owns a bounded, verified conflict-resolution mechanism at
finish time (before a PR is first opened): known-safe conflict classes are
resolved mechanically, ambiguous ones go to a gated assistant-driven resolution
with a configured attempt cap, and hard guards reject resolutions that lose
work. This feature extends that same trust model to PRs that are **already
open**: when a watched PR goes conflicting, the harness refreshes it
automatically and returns it to a mergeable state — escalating to a human only
when a conflict is a real semantic collision.

## Goals

- Eliminate manual rebase toil for open, harness-watched PRs whose conflicts
  fall in known-safe classes.
- Reuse the trust model already established at finish time: bounded attempts,
  work-preservation guards, full verification before anything is published.
- Escalate loudly and safely when automatic resolution is not confidently
  possible.

## Non-Goals

- Merging PRs. The operator remains the only party who merges — unchanged.
- Resolving conflicts on PRs the harness does not already watch.
- Changing the existing finish-time resolution behavior.
- Resolving genuinely semantic code collisions automatically; those park for a
  human, as they do today.

## Users / Personas

- **Operator (James):** merges PRs, currently performs all conflict rebases by
  hand; wants parked PRs to stay mergeable without being pinged.
- **The per-repo daemon:** the autonomous actor that watches PR merge status and
  will now also refresh conflicting PRs.

## Functional Requirements

### Detection & eligibility

- **FR-1** Only PRs already tracked by the existing merge-status watch are
  eligible. The system detects, on its normal watch cadence, when a tracked
  open PR has become conflicting with the repository's default branch.
- **FR-2** A merged or closed PR is never a resolution target (it is pruned
  from watching, as today).

### Resolution behavior

- **FR-3** When every conflict on an eligible PR falls in a known-safe class,
  the system refreshes the PR branch onto the latest default branch and returns
  the PR to a mergeable state with no human action.
- **FR-4** Changelog "Unreleased" conflicts resolve as: keep the default
  branch's entries, re-append only this feature's own lines, never duplicate a
  block.
- **FR-5** Collisions between parallel features' planning/spec documents
  resolve by keeping both sides' documents.
- **FR-6** Known-safe conflict classes are resolved without consuming an
  assistant session; assistant-driven resolution cost is paid only for
  conflicts outside those classes.
- **FR-7** Conflicts outside the known-safe classes are handed to the existing
  gated rebase-resolution capability, bounded by the same configured attempt
  cap it uses today (default 3).

### Verification & safety (hard gates on every resolution)

- **FR-8** Every feature commit present before the refresh must survive it; a
  resolution that loses a commit is rejected and escalated, never published.
- **FR-9** The refreshed branch must be verified as actually current with the
  base it was refreshed onto.
- **FR-10** The project's full test suite must pass on the refreshed branch
  before the PR is updated.
- **FR-11** Publishing the refreshed branch must fail safely — and escalate —
  if the PR branch changed remotely after resolution began; the system never
  overwrites work it has not seen.
- **FR-12** On any failure at any stage, the in-progress resolution is fully
  abandoned and the PR branch is left exactly as it was. On the success path,
  the single branch refresh is the only externally visible mutation.

### Escalation & bounding

- **FR-13** When resolution fails or is rejected by a gate, the PR is marked as
  needing human remediation using the existing label vocabulary, and receives a
  comment stating the concrete reason.
- **FR-14** A PR that escalated is not automatically retried until an operator
  intervenes; the escalation marker is the off-switch, exactly as it is for the
  existing watch behavior.
- **FR-15** Attempts are bounded per conflict occurrence, and a failing PR is
  not re-attempted on every watch cycle (a cooldown applies), so a
  pathological PR cannot consume unbounded work.

### Observability

- **FR-16** Every auto-resolution outcome — refreshed, or escalated and why —
  is visible in the daemon's log with the PR identified.

## Non-Functional Requirements

- **NFR-1** Token cost: the mechanical conflict classes (changelog, parallel
  planning documents) — the overwhelmingly common case — must resolve at zero
  assistant-session cost (FR-6).
- **NFR-2** Isolation: resolution work must never disturb the operator's
  working copies or any in-progress build workspace.
- **NFR-3** The watch cadence must not degrade materially when a resolution is
  in progress.

## Acceptance Criteria / Success Metrics

- A watched PR made conflicting by a changelog-only collision returns to
  mergeable automatically, with its commits intact and no duplicate changelog
  blocks, within one watch cycle plus verification time.
- A watched PR with a semantic code collision is not force-refreshed; it gains
  the needs-remediation marker and a reason comment, and is not retried until
  the operator clears it.
- A resolution attempt that would drop a commit or fails the suite publishes
  nothing.
- Operator manual rebases on watched PRs drop to zero for known-safe conflict
  classes.

## Scope

**In:** conflicting-state detection on watched PRs; automatic refresh via the
deterministic-first ladder; verification gates; escalation labelling +
commenting; attempt bounding + cooldown; logging.

**Out:** merging; unwatched PRs; changes to finish-time resolution; new
conflict classes beyond the two named known-safe ones (future work may add
classes); any UI beyond labels, comments, and logs.

## Key Decisions & Rationale (product)

- **Deterministic-first, assistant-second (operator-selected Approach A):** the
  conflict class that motivated this feature is mechanical; paying an assistant
  session for it contradicts the harness's token-efficiency priority. The
  assistant path remains for ambiguous conflicts, unchanged in its bounds.
- **Same trust model as finish-time:** operators already trust the bounded,
  guarded finish-time mechanism; extending it (rather than inventing a new
  policy) keeps one mental model for "when does the harness rewrite a branch".
- **Escalation is sticky (FR-14):** a human decision point, once raised, is
  never silently retried away.

## Dependencies

- The existing per-repo daemon and its merge-status watch registry and label
  vocabulary (`mergeable`, `needs-remediation`) — pre-existing.
- The existing gated rebase-resolution capability and its configured attempt
  cap — pre-existing.
- The existing finish-time work-preservation guards (commit survival,
  branch-currency) — pre-existing, to be applied unchanged.
- GitHub PRs, labels, and comments as the operator-facing surface —
  pre-existing external constraint.

## Open Questions (for architecture-review)

- Where per-PR attempt/cooldown state should live so it survives daemon
  restarts (trade-off: extend the existing watch registry vs a separate
  ledger).
- How the isolated resolution workspace is provisioned and cleaned, and how it
  relates to any still-existing build workspace for the same feature.
- Whether multiple conflicting PRs found in one watch cycle are resolved
  serially or concurrently (trade-off: cycle latency vs resource contention).
- How the full test suite is selected/invoked for verification in repos with
  multiple suites (trade-off: fixed project convention vs configurable).

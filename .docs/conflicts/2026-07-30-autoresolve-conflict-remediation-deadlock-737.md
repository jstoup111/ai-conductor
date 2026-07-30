# Conflict Check: Restore conflict remediation for shipped pull requests

**Date:** 2026-07-30
**New stories:** `.docs/stories/autoresolve-conflict-remediation-deadlock-737.md`
**Result:** PASSED — 2 blocking conflicts found and resolved; 0 blocking or degrading conflicts remain

## Scope and method

The check inventoried all 229 story files, all 43 specs, and all 143 prior conflict reports. It
then performed full-text interaction checks across conflict remediation, shipped-watch enrollment,
retained worktrees, continuous-integration repair, sticky escalation, retry state, repository
verification, safe publication, and merge authority. The five required conflict classes were
evaluated: contradiction, behavioral overlap, state conflict, resource contention, and sequencing.

## Conflict 1: Retained evidence both permits and forbids remediation

**Stories involved:** “Eligible shipped conflicts enter remediation” vs “Resolution runs in a dedicated transient worktree”
**Files:** `.docs/stories/autoresolve-conflict-remediation-deadlock-737.md` vs `.docs/stories/auto-resolve-open-pr-conflicts.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the older criterion explicitly skipped remediation whenever the feature worktree existed, while FR-2 requires retained-worktree presence alone not to block it.

**Description:** The 2026-07-29 retention decision makes the completed feature worktree remain for
every shipped open pull request. The 2026-07-04 story treated that directory as active BUILD
ownership, so retaining evidence made every watched shipped conflict permanently ineligible.

**Resolution options:**

1. Use verified shipped-watch enrollment as the post-BUILD ownership boundary and remove directory existence as an eligibility proxy.
2. Add a second persisted active-build ownership lease.
3. Keep the worktree gate and deliver alarm-only behavior.

**Resolution:** Option 1, selected by the operator during architecture review and recorded in
`adr-2026-07-30-shipped-pr-conflict-remediation-ownership`. The older story now says retained
evidence does not block the disjoint resolution workspace and points to the superseding ADR.

## Conflict 2: A partial escalation can become sticky before it is actionable

**Stories involved:** “Terminal inability escalates once and remains actionable” vs the existing autoresolve escalation and idempotent-comment contracts
**Files:** `.docs/stories/autoresolve-conflict-remediation-deadlock-737.md`, `.docs/stories/auto-resolve-open-pr-conflicts.md`, and `.docs/stories/remediation-comment-upsert.md`
**Type:** sequencing and state conflict
**Severity:** blocking
**Confidence:** 99% — `autoresolve.ts` adds `needs-remediation` before calling the non-reporting comment upsert, while eligibility treats that label as terminal.

**Description:** If label creation succeeds and the actionable comment fails, every later cycle
classifies the pull request as already escalated and performs no mutation. The operator receives no
stage, reason, or recovery action, contradicting FR-7. Retrying the existing best-effort helper
after an indeterminate lookup can also create a duplicate comment, contradicting FR-8.

**Resolution options:**

1. Confirm the actionable marked comment first and apply the sticky label last; failures remain retryable without attempt burn.
2. Persist a separate escalation-pending lifecycle and reconcile it across cycles.
3. Relax the exactly-once/actionable requirement and permit label-only terminal states.

**Resolution:** Option 1, selected by the operator on 2026-07-30. The ADR, architecture review,
diagram, new stories, and affected older autoresolve story now require a confirmation-returning
comment operation before label application. Indeterminate lookup does not create, comment failure
does not apply a new sticky label, and label failure retries against the same marked comment. The
stricter operation is scoped to conflict escalation, so other best-effort comment callers keep
their accepted behavior.

## Compatible overlaps verified

- **CI-repair precedence:** The accepted ship-to-CI story already excludes `CONFLICTING` pull
  requests. The new per-cycle disposition makes that precedence explicit and prevents the normal
  sweep from sending the same candidate to both lanes.
- **Retry and cooldown state:** Existing `resolveAttempts` and `lastResolveAt` remain authoritative;
  transient conflict deferral and escalation-write retry do not increment them.
- **Watch-registry cap:** A capped-out entry is unwatched and therefore remains outside automatic
  remediation, matching FR-3; retained-worktree visibility and operator reclaim remain governed by
  the accepted retention stories.
- **Full-suite ownership:** The reusable BUILD-to-SHIP gate explicitly preserves autoresolve's
  independent post-mutation repository verification. No suite-evidence ownership changes.
- **Safe branch rewriting:** Existing work-preservation, current-base, and force-with-lease stories
  remain stricter than or equal to FR-10/FR-11; no bare-force path is introduced.
- **Sticky label meaning:** A completed `needs-remediation` escalation remains operator-owned and
  suppresses automatic attempts. Only the pre-label completion order changes.
- **Merge authority:** Existing autoresolve and CI-repair stories already prohibit automatic merge;
  FR-15 preserves that boundary.

## Re-check

After the two resolutions, all five conflict classes were re-evaluated. The retained evidence and
transient resolution workspaces are disjoint; every conflicting candidate has one lane disposition;
escalation cannot become newly sticky before its actionable content is confirmed; retry counters
remain bounded; and CI repair cannot race a conflicting candidate. Zero blocking or degrading
conflicts remain.

# ADR: Gated-spec announcements via the pr-labels seam, warn-once per state change

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #208

## Context

PRD FR-8..FR-10/FR-12: when the owner gate skips a spec, the block must be announced on the
spec's PR (comment + label) and, for intake-originated specs, on the `Source-Ref` issue —
idempotently, and never blocking the scan. The repo already has exactly one sanctioned
GitHub-write seam: `pr-labels.ts` (`upsertComment` hidden-marker edit-in-place,
`ensureLabel`/`addLabel` via REST — Projects-classic-safe), with
`build-failure-escalation.ts` (needs-remediation) as the proven orchestration template.

## Options Considered

### Option A: Mirror needs-remediation — marker comment + label, per-spec, at skip time
A gate write-back step runs when a spec lands in the gated list: `ensureLabel` + `addLabel`
(`owner-gated`) and `upsertComment` with a dedicated hidden marker
(`<!-- conductor:owner-gated -->`) carrying reason + remedy on the spec PR; for intake specs,
the same marker-comment upsert on the Source-Ref issue. Advisory: every failure is logged
and swallowed.
- **Pros:** reuses proven idempotency (marker PATCH-in-place, terminal on PATCH failure — no
  duplicate pileup); one comment that always shows the CURRENT reason; label makes gated
  PRs filterable.
- **Cons:** one extra GitHub round-trip per newly-gated spec per pass (bounded by marker
  dedup).

### Option B: Reuse `.daemon/warned/` markers to gate the write-back locally
- **Pros:** zero GitHub reads for dedup.
- **Cons:** once-forever semantics — a spec that un-gates and re-gates (owner removed,
  cutover moved) would never re-announce; a second local ledger to keep consistent; the
  server-side marker already provides dedup for free.

### Option C: No write-back (dashboard/status only)
Rejected by operator during scoping — the block must be visible where the work lives.

## Decision

**Option A**, with **re-announce on state change**: the upsert body embeds the gate reason;
since `upsertComment` edits in place, a reason transition (e.g. `unowned-indeterminate` →
`other-owner`) updates the one living comment rather than posting anew — matching the
waiting-channel ADR's warn-once-per-state-change semantics. Label `owner-gated` is added
when gated. Un-gating does NOT retroactively edit the comment or remove the label in this
feature (current-state lives in dashboard/status; PR history is history) — noted as
acceptable and revisitable. Repo-level warnings (identity unresolved / no cutover) do NOT
write back to GitHub — they have no single PR/issue home; they stay on dashboard/status
(PRD open question resolved: dashboard/status-only). All write-back is fire-and-forget
best-effort: failures log once and never affect scan, snapshot, dashboard, or builds
(FR-12); the gated channel and snapshot are written BEFORE write-back is attempted, so
GitHub unavailability cannot hide gated state locally.

## Consequences

### Positive
- One living, current announcement per surface; zero-spam by server-side marker dedup.
- Collaborators on multi-operator repos see "waiting on owner X" on the PR itself.

### Negative
- A stale `owner-gated` label can outlive the gated state until a human or a later feature
  removes it (accepted trade-off; removal would require tracking un-gate transitions).
- One more marker constant + label name in the pr-labels vocabulary to document.

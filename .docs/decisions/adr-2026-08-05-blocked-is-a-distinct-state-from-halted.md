# ADR: `BLOCKED` is a distinct daemon state, not an extension of `HALTED`

**Date:** 2026-08-05
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #1330

## Context

The operator's directive is that a merged spec which cannot build must be *blocking and
visible*, not skipped. That state needs a home in the daemon's existing taxonomy:
`PARKED`, `HALTED`, `IN-PROGRESS`, `RETAINED WORKTREES`, `GATED`, `WAITING`, `ELIGIBLE`,
`PROCESSED`. The operator asked directly whether reusing `HALTED` would serve better than
introducing a new bucket.

`HALTED` entries are derived by `daemon-dashboard.ts` from per-worktree `.pipeline/HALT`
markers. Their presence is consumed by `halt-pr-rehabilitation.ts`,
`build-failure-escalation.ts`, `episode-halt-tracker.ts`, `daemon-rekick.ts`, and
`park-reconciliation.ts`. Its documented remedy is
`docs/runbooks/stalled-or-stuck-feature.md`: inspect the retained worktree, clear
`.pipeline/HALT`, let the daemon re-dispatch.

An unbuildable merged spec has no worktree, no attempt id, no recovery count, no PR, and no
`.pipeline/` state. Its remedy is a commit on the default branch.

## Options Considered

### Option A: A new `BLOCKED` group and channel (chosen)
- **Pros:** carries the correct remedy ("fix the spec on the default branch"); leaves halt
  automation untouched; self-clearing (a fixed spec simply stops being blocked next pass);
  mirrors the already-shipped `GATED` channel + snapshot pattern, so the implementation is a
  known quantity in the same files.
- **Cons:** one more bucket in the taxonomy and one more precedence edge to pin.

### Option B: Synthesize `HALTED` entries for unbuildable specs
- **Pros:** no new bucket; operators already look at HALTED.
- **Cons:** every HALTED consumer would need a "not really halted" carve-out, or would
  misfire — `halt-pr-rehabilitation` would hunt for a PR that does not exist,
  `daemon-rekick` would try to resume a build that never started, `park-reconciliation`
  would reason about a worktree that was never created. It would also require writing
  `.pipeline/HALT` markers into worktrees the daemon has not made, i.e. inventing state to
  satisfy a display. The runbook operators would follow is the wrong one.

### Option C: Fold it into `GATED`
- **Pros:** `GATED` is already "held back with a reason and a remedy".
- **Cons:** `GATED` is documented and typed as the *ownership* gate specifically
  (`GatedSpecItem.reason: 'other-owner'`), and its write-back announces ownership on the
  spec PR. Overloading it would make "gated" mean two unrelated things and would drag
  content problems into ownership write-back.

## Decision

Option A. `BLOCKED` is its own channel from `discoverBacklog`, its own snapshot, and its own
`daemon status` section. `HALTED`, `GATED`, park, and the dependency gate are untouched.

**Startup-dashboard rendering is deliberately deferred.** The operator cut it from this
change: the dashboard already renders 102 lines with rows up to 328 characters, 85 of them
inert, so adding a ninth group would make it less readable, not more. The reported triage
happened through `conduct-ts daemon status`, which this change does cover. How the dashboard
should present blocked work is part of its redesign, tracked by
[#1332](https://github.com/jstoup111/ai-conductor/issues/1332).

## Consequences

- The `blocked` channel is available to the dashboard as data from the moment this ships;
  #1332 decides how to render it. Nothing in the dashboard changes here.
- A blocked spec never reaches the owner gate or the dependency gate, because content vetting
  runs first — so `BLOCKED` can never co-occur with `GATED` or `WAITING` for one slug. That
  invariant is a property of the gauntlet order, not of any rendering, and it holds whether or
  not a group is displayed.
- The parked, processed, and shipped exclusions are applied in *discovery* rather than at
  render time (see `adr-2026-08-05-blocked-classification-after-dedup`), so any future
  consumer — dashboard, status, or otherwise — receives an already-actionable list.
- `.daemon/blocked.json` joins `.daemon/gated.json` as a per-pass snapshot; the two are
  independent files with the same lifecycle.
- No halt-related automation, runbook, or marker format changes.

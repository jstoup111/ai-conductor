# Conflict Check: staleness-decisions-invisible-in-daemon-log

Feature: staleness-decisions-invisible-in-daemon-log
Issue: jstoup111/ai-conductor#982
Date: 2026-07-26
Verdict: **PASS with two coordination notes** — no contradictions, no state conflicts, no
resource contention. Two textual merge collisions and one intra-feature ordering constraint
are recorded below.

## Checked against

- Committed `.docs/stories/`, `.docs/plans/`, `.docs/decisions/` on this branch's base.
- All local `spec/*` branches, filtered to those touching `types/events.ts`,
  `daemon-cli.ts`, `event-persister.ts` or `audit-trail.ts`.
- Open PRs #989, #990, #979, #969.

## C1 — Completes an unfulfilled prior decision (not a conflict; strengthens the spec)

`adr-2026-07-13-session-fresh-verdict-artifacts.md` **D2** already decided this:

> the conductor emits a `verdict_freshness` `StepEvent` (`types/events.ts`) recording
> fresh-verdict vs stale-reused per evaluation, **so the audit trail shows** …

The event was implemented; the audit-trail subscription never was. This feature does not
contradict D2 — it completes it. The `verdictFreshness` payload's discriminated `outcome`
is a refinement of D2's "fresh-verdict vs stale-reused" distinction, extended to separate
*preserved-despite-stale* from *genuinely rewritten*, which D2's boolean could not express.

**Action:** the plan cites D2 as the originating decision so the completion is traceable.

## C2 — The audit-trail ADR already anticipated the missing test (not a conflict)

`adr-2026-07-07-audit-trail-event-sink.md` lists among the chosen option's benefits:

> testable completeness (subscribe list vs emitted types)

That completeness test either does not exist or does not cover this, since 19 of 57 event
types are dead in all three sinks. Story 3's compile-time exhaustiveness and Story 4's
routing-equivalence test are the concrete discharge of that stated-but-unbuilt benefit. No
contradiction — the earlier ADR asked for exactly this class of guard.

## C3 — Textual merge collision: `spec/codex-readiness-park-970`

That branch edits `event-persister.ts` `ALL_EVENT_TYPES` (adding `credentials_park` and
`credentials_park_progress`) and adds a `credentials_park_progress` member to
`types/events.ts`. This feature **removes** `ALL_EVENT_TYPES` in favor of the registry, so
the two edits collide textually in the same hunk.

Not a semantic conflict: both changes want the same outcome (those types persisted), and
`main` already carries both entries — the branch appears to predate that landing and may be
partly superseded. Whichever merges second resolves by moving the entry into the registry.

**Note:** once the registry is total, that branch's new event member will **fail to compile**
until it declares its sinks. That is the feature working as designed (Story 3), not a
regression, but it is a real coordination cost to flag to whoever rebases it.

## C4 — Textual merge collision: `daemon-cli.ts` renderer switch

`spec/multi-operator-ownership-hardening`, `spec/self-host-phase6-wiring` and
`spec/codex-hook-self-host-parity-907` each modify `daemon-cli.ts`. This feature adds one
`case 'verdict_freshness':` to `renderDaemonEventUnsafe`.

Low risk: three-way merges of independent `case` arms in a large `switch` normally resolve
cleanly, and none of those branches was found to touch the freshness/staleness rendering path.
Flagged for awareness only.

## C5 — Intra-feature ordering constraint (not a conflict)

Story 4 asserts the registry's derived subscription sets are **identical to the pre-refactor
literals except for `verdict_freshness`**. That assertion is only meaningful if the
pre-refactor sets are captured *before* the literals are deleted.

**Action:** the plan sequences the equivalence test's fixture capture ahead of the removal of
`ALL_EVENT_TYPES` / `SUBSCRIBED_EVENT_TYPES`, so the test cannot be written against the very
thing it is meant to pin.

## Non-conflicts explicitly considered

| Candidate | Verdict |
| --- | --- |
| `spec/647-kickback-evidence-invalidation` | Adjacent, not overlapping — it invalidates *task* completion evidence on kickback; this feature changes only how a staleness decision is reported. No shared symbol. |
| `#989` gate kickback counter reset | Touches retry/kickback counting, not the completion-result facet or the sinks. |
| `3efb0e63` wiring re-derivation / `8c12993b` retry budget | Already on `main`; this feature deliberately does not revisit them, and `wiring_check` does not populate `verdictFreshness`. |
| `.docs/stories/emit-intra-step-build-progress-and-stall-as-events.md` | Added `build_progress` / `build_stall`, both already in `ALL_EVENT_TYPES`. The registry preserves their current routing unchanged. |
| `gate-code-validity.ts` consumers | Untouched — the preserve/rerun decision is out of scope, so no gate behavior changes. |

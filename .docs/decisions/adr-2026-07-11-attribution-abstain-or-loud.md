# ADR: Attribution machinery is abstain-or-loud — a stale stamp is never left, an id is never guessed, an invalid id never passes

**Date:** 2026-07-11
**Status:** APPROVED (operator, 2026-07-11)
**Amends:** adr-2026-07-09-deterministic-evidence-attribution-enforcement (removes its
`prepare-commit-msg` unique-in_progress fallback clause; all other clauses stand)
**Context issues:** #519 (this fix), #501 (resolved by the same validation repair), #494/#505
(the machinery), #474/F4 (explicitly out of scope)

## Context

The #492 build (2026-07-11) halted with retries exhausted while 100% of its 16 tasks were
implemented and committed: `.pipeline/current-task` froze at task 1's id and all 15 later
commits were silently trailer-stamped `Task: 1`, so the evidence gate correctly credited
nothing. Code inspection of the shipped hooks (kept worktree) verified the failure class:

1. `pre-dispatch.sh` (from `session-hook-assets.ts`) exits 0 **silently, leaving a stale
   stamp**, on four uncertainty paths: `task-status.json` unreadable; unparseable JSON;
   wrong shape (`tasks` not an array); atomic write/rename failure. (Confidence: verified —
   read from the shipped script. The specific path that fired in #492 is unprovable — the
   session transcript died with the throwaway self-build sandbox — accepted unknown,
   operator-approved 2026-07-11.)
2. `prepare-commit-msg` (from `git-hook-assets.ts`), when the stamp is absent, **guesses** the
   id from the unique `in_progress` row in `task-status.json` — a second silent attribution
   source that inherits stale state. (Verified.)
3. `commit-msg` validates the trailer id against `Object.keys(data.tasks || {})` where
   `data.tasks` is an **array** — i.e. against indices `"0"…"N-1"`, not ids. A stale
   `Task: 1` always passes; the last task's id (== N) is wrongly rejected — the #501 report.
   This code already violates the APPROVED adr-2026-07-09 clause "reject a trailer id outside
   the seeded id set". (Verified.)

A stale-but-plausible id is indistinguishable from a correct trailer to every downstream
check, so the stamp file is the only place the cascade can be broken.

## Decision

The attribution machinery may fail to attribute; it may never attribute wrongly, and it may
never fail silently. Concretely:

1. **No stale stamp, ever.** Every uncertainty path in `PRE_DISPATCH_HOOK`'s stamping block —
   status file unreadable, unparseable, wrong shape, row lookup impossible, or
   write/rename failure — REMOVES `.pipeline/current-task` and writes a stderr diagnostic
   naming which path failed. Invariant: if `current-task` exists, it was written by the most
   recent successful dispatch bookkeeping. The success path, dispatch grammar, idempotent
   re-dispatch, and overlap-guard clear-on-switch are unchanged.
2. **Stamp or abstain — never guess.** `prepare-commit-msg` stamps from `current-task` only.
   The unique-in_progress fallback is deleted (this amends adr-2026-07-09). An absent stamp
   yields an unstamped message, which the #509 gate then handles loudly.
3. **Validate against real ids.** `commit-msg` validates the trailer id against the actual
   `id` fields of the seeded tasks (restoring adr-2026-07-09 conformance; resolves #501).
   Unknown/stale-out-of-set ids are rejected with the existing instructive message.
4. **The loud path is the composition, and it is tested.** Abstained commit → #509 fail-closed
   rejection (build-step active) → agent self-stamps the correct id → real-id validation
   accepts. Regression tests pin the #519 shape end-to-end: sequential dispatches where a
   later dispatch's bookkeeping fails must produce abstention/rejection — never a commit
   carrying an earlier task's id.

## Constraints honored

- **Mechanical-lane cap** (adr-2026-07-11-semantic-attribution-verification-lane): no new
  hook, sentinel, marker, or enforcement surface — existing surfaces hardened only. That ADR
  explicitly sanctions #519/#501 as repairs.
- **Embedded assets, no dist:** hooks stay pure bash + inline `node -e` (stale-engine
  immunity, #403 class).
- **Provisioning stays fail-open** (worktree-prepare.ts): provisioning failures never block
  worktree setup; only the hooks' *runtime* uncertainty handling changes.

## Out of scope

- Parallel-native attribution: one global stamp cannot represent two in-flight tasks (live
  evidence in the #520 build). Filed as its own intake issue (F4), positioned as a
  prerequisite of #474. This ADR's abstain semantics are what keep interim parallel dispatch
  safe (abstain → loud reject → correct self-stamp).
- Gate-time semantic attribution: covered by the #522 lane, in flight; revisit after live
  observation.
- The `task-N` alias grammar inconsistency between derivation and hook (documented non-goal
  of the semantic-lane ADR).

## Consequences

- A wedged bookkeeping file now costs one loud, instructive commit rejection instead of a
  silently poisoned build that burns all retries and halts with finished work (63 min + halt
  in #492).
- Commits during a legitimately stamp-less window (e.g. host restart mid-task) are rejected
  until the agent self-stamps — intended friction, bounded by the gate's instructive message.
- If a later attribution redesign (F4/#474 or a post-#522 gate-time lane) replaces the stamp
  mechanism, items 2–4 and the regression invariant survive as its acceptance criteria; only
  item 1's internal hardening is superseded with the stamp itself. Operator weighed this
  explicitly and approved full hardening (2026-07-11).

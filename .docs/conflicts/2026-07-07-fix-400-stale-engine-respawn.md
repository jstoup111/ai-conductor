# Conflict Check: Fix #400 — single-generation stale-engine respawn
**Date:** 2026-07-07
**New stories:** `.docs/stories/fix-400-stale-engine-respawn-in-place-stacks-daemo.md` (TS-1..TS-5 + e2e capstone)
**Result:** PASSED — 0 blocking, 2 overlaps resolved by story amendment, 3 pairs verified clean

## Overlap 1 (resolved): fired-trigger exit vs #353 TR-2 fire-and-stay

**Stories involved:** "Fired trigger terminates the predecessor" (TS-1) vs "stale-engine
detection respawns the daemon in place when session-hosted" (TR-2,
`daemon-restart-leaves-the-daemon-stopped-when-orig.md`)
**Type:** behavioral overlap · **Severity:** degrading (design already reconciled by APPROVED ADR)

TR-2's happy path implicitly pinned "fire `triggerSelfRestart` and stay resident" (and the
#393 tests pin it explicitly); TS-1 requires release + exit 0 after a fired trigger. Both
cannot hold. adr-2026-07-07-single-generation-stale-respawn (APPROVED) resolves in TS-1's
favor for the fired-success case ONLY; TR-2's trigger-failure and marker-write-failure
stay-alive contracts remain binding and are re-asserted in TS-1's negative paths.
**Resolution applied:** amendment banner added to the #353 stories file (2026-07-07).

## Overlap 2 (resolved): headless-only exit scoping in #256 stories

**Stories involved:** TS-1 vs the 2026-07-06 amendment banner in
`2026-07-03-daemon-auto-restart-stale-engine.md` ("release lock → exit 0 applies only to
headless daemons")
**Type:** contradiction (scoping) · **Severity:** degrading (same root as Overlap 1)

**Resolution applied:** second amendment banner added (2026-07-07): session-hosted fired
success also releases + exits; failure paths unchanged. Config-flag stories (default false,
fail-closed validation) are untouched by TS-5, which changes only this repo's configured
VALUE — verified compatible, not amended.

## Verified-clean pairs (interactions actually reasoned through)

1. **Verb-path lifecycle controls (FR-8/FR-9, `2026-07-04-daemon-lifecycle-controls.md`):**
   "never exits without a successor arranged" — TS-1 exits only after a FIRED trigger
   (successor arranged) or leaves a revivable dead pane; "failed trigger retries" — preserved
   by TS-2's retry-after-failure negative; hyphen marker + `restartTriggeredSuccessfully`
   untouched. No shared flag/marker/state. CLEAN (confidence: high — pairwise text compared).
2. **Supervised hosting (FR-1/2/4/12, `daemon-supervised-hosting.md`):** "exactly one
   daemon", "loser no-op", race → one winner — TS-3/TS-4 strengthen these (loser provably
   exits; bounded wait keeps single-winner O_EXCL). A start racing a live owner gets a
   slower bounded loser verdict, same outcome. CLEAN.
3. **Test-leak kill-switch (`test-spawned-daemons-leak-real-tmux-daemons-persis.md`):** the
   new real-tmux e2e must and does carry the `AI_CONDUCTOR_NO_REAL_EXEC` guard + no leaked
   `cc-daemon-*` sessions in teardown (stated in stories preamble + capstone Done-When). CLEAN.

## Notes

- No ADR was superseded by this check (the reconciling ADR was created and APPROVED during
  architecture-review, before stories).
- Sequencing/resource-contention scan: the only shared mutable resources are the pidfile and
  the underscore marker; both are single-writer by design and unmodified in schema.

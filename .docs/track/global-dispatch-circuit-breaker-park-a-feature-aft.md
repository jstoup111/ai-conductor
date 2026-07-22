# Track: Global dispatch circuit-breaker

**Track: technical**

## Why technical

This is a daemon reliability / control-flow change with **no user-facing product
requirement**. It adds a bound to the daemon's outer dispatch loop so a feature
that fails to dispatch (or resume) deterministically cannot be re-attempted
forever. There are no new end-user screens, APIs, or product behaviors — only a
new internal safety invariant plus one operator-visible config knob and a
dashboard/log surfacing of the trip reason.

Because it is technical, the DECIDE flow **skips `/prd` and `prd-audit`**;
acceptance criteria live in the stories (`.docs/stories/`).

## Problem (from issue jstoup111/ai-conductor#714)

**Observed.** On 2026-07-20 the daemon spent ~7.6h of a ~10h active day
re-attempting failed dispatches: 256 `git worktree add … exit 128` failures
(semantic-judge 166× over 4h07m, engine-gc 41×, build-stall 45×), each retried
~5s apart with **no backoff and no cap**, shipping nothing. #681 fixes that one
stale-cache attach bug, but nothing caps the **general class**: any
dispatch/resume that fails deterministically is retried forever.

**Impact.** A single wedged feature can consume the daemon's entire day; the
failure mode is silent (log-only) until an operator notices.

**Desired outcome.** A hard circuit-breaker: **N consecutive failed
dispatch/resume attempts for the same feature → park it with the failure
reason, regardless of the error class** — so no future unforeseen loop class can
spin unbounded.

## Root-cause seam confirmed during exploration

The spin is real and mechanically explained. In `runDaemon`
(`src/conductor/src/engine/daemon.ts`):

- A pre-build `createWorktree` failure (`git worktree add` exit 128) throws
  inside `makeRunFeature` (`daemon-runner.ts`). Because the throw happens
  **before** a worktree exists (`worktree` is still `null`), the `catch` block's
  `if (worktree) writeErrorHalt(...)` is skipped — **no `.pipeline/HALT` marker
  is ever written**. The feature returns `{status:'error'}`.
- `collectOne` adds the slug to the in-memory `parked` set. But on the next poll,
  `pickEligible` evaluates the parked slug against `isHalted`: with no HALT
  marker, `isHalted` is `false`, so the "still parked" guard is skipped and the
  slug **falls through as eligible** ("marker cleared, or progress-gated re-kick
  eligible → fall through") and is **re-dispatched immediately** — every
  `idlePollMs` (~5s). Forever.

None of the existing bounds catch this: the retry-as-escalation ladder (#188),
`stepMaxRetries`, and `build_progress_halt` all live **inside** a build that
never started. The gap is a **per-feature, error-class-agnostic bound on the
outer dispatch loop** — exactly what #714 asks for.

## Candidate hypotheses carried into DECIDE (not chosen)

The issue embeds a fix shape ("N consecutive failed attempts → park"). Treated as
the filer's hypothesis. Alternatives weighed in `/explore`:

- **A — Per-feature consecutive-failure counter → durable auto-park at N**
  (chosen). Counts outcomes, not error classes; parks via the existing
  `.daemon/parked/<slug>` marker so all existing dispatch gates honor it.
- **B — Exponential backoff per failing slug** (rejected as the primary fix).
  Backoff slows the spin but never stops it; the issue explicitly wants a *hard*
  stop, not a slower loop. (Could compose later; out of scope.)
- **C — Global daemon-wide failure budget** (rejected). Title says "global" but
  the body scopes it to "the same feature"; a daemon-wide budget would let one
  wedged feature starve/park healthy ones. "Global" = **across all error
  classes**, per-feature.

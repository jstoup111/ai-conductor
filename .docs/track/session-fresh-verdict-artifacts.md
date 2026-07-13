# Track: Step completion checks consume a stale verdict artifact across retries (#649)

Track: technical

## Rationale

Internal daemon/engine correctness fix. A SHIP-tail completion check that reads a session-produced
verdict artifact (`architecture_review_as_built` → `.pipeline/architecture-review-as-built.md`,
`prd_audit` → `.pipeline/prd-audit.md`, `build_review` → `.pipeline/build-review.json`) already
guards against a *prior feature's* stale file via `fileIsFreshSinceSession(f, ctx.sessionStartedAt)`
(`src/conductor/src/engine/artifacts.ts`). But `sessionStartedAt` is `state.session_started_at`,
stamped exactly **once per conductor `run()`** (`conductor.ts:1231-1233`). In daemon mode a single
`run()` drives the whole SHIP loop including *every retry* of a review step, so all retries share one
floor. A verdict artifact written by an early retry (cycle 2, mtime 19:56Z) stays `>= sessionStartedAt`
forever, so `fileIsFreshSinceSession` passes it on every subsequent retry even after the code it judged
was replaced.

Result: a review step whose session fails to (re)write its verdict artifact converts into an infinite
deterministic fail loop no code fix can exit — the check re-scores the **stale** verdict against code
that no longer exists. Live incident 2026-07-13 (`2026-07-12-wiring-reachability-gate`): the ADR
violation was fixed at 20:22Z (commit a79ca7a5), yet `architecture_review_as_built` returned the
identical BLOCKED verdict at 20:26-20:39Z, three more times, off the 19:56Z file (which self-dates:
it cites the pre-fix line range and "zero wiring-probe imports", both false in the post-fix worktree).

The finish-choice marker already has the correct discipline (mtime `>= sessionStartedAt` **plus** a
session-start sweep of stale markers, `artifacts.ts` `FINISH_CHOICE_MARKER` ~`:1144`) — but review
verdict artifacts have neither a per-attempt floor nor a sweep. No user-facing product capability, no
new command, no breaking surface (a config toggle would be additive). → **technical track** (skip
`/prd`).

## Corrected premise (load-bearing — verified against code)

The issue states the fix is to require "artifact mtime/stamp >= the judging session's start
(sessionStartedAt is already in CompletionContext)". Verified false as a trivial add: the guard
**already exists** and **already uses** `ctx.sessionStartedAt` — and is insufficient precisely because
`sessionStartedAt` is the *conductor-run* start, not the *per-attempt judging-session* start. All
retries of a review step live inside one `run()` and share that single floor (`conductor.ts:1231`;
retry loop `:1653-1760`, dispatch at `:1702`; `completionCtx` sets `sessionStartedAt:
state.session_started_at` at `:680`/`:3447`). The real fix is a **finer floor**: thread the timestamp
captured immediately before each review dispatch and require the verdict artifact to be fresh relative
to *that*. This correction is carried into the ADR and stories.

## Approaches weighed (explore)

1. **Per-attempt judging-session floor threaded into the completion check (chosen).** Capture
   `attemptStartedAt = Date.now()` in the retry loop immediately before the step dispatch
   (`stepRunner.run(step.name, …)`, `conductor.ts:1702` — the generic path all three review steps
   take), expose it on the `CompletionContext` the post-dispatch check receives, and have the three
   verdict predicates require the artifact mtime `>= attemptStartedAt` (falling back to
   `sessionStartedAt` when absent, preserving legacy/test behaviour). A verdict not rewritten by the
   just-dispatched session is stale → score a loud, distinct "no fresh verdict", never reuse a prior
   session's verdict. Deterministic, reuses the existing `fileIsFreshSinceSession` primitive and the
   finish-choice precedent; localized to the retry-loop dispatch seam + the three predicates.

2. **Session-start sweep of verdict artifacts (like finish-choice markers).** Rejected as the primary
   fix: the finish sweep runs once at `run()` start, which in daemon mode is *before all the retries* —
   it would not delete a within-run cycle-2 artifact. A per-attempt sweep is equivalent to the chosen
   floor but destroys the artifact (losing it for diffing) and is racier than an mtime comparison.

3. **Content-hash / verdict-provenance stamp inside the artifact.** Rejected for tier S: requires the
   review skills to emit a session-id stamp and the predicate to parse it — a skill-contract change and
   prompt-discipline dependency, exactly what CLAUDE.md says to avoid when a deterministic mtime floor
   the engine already owns suffices.

4. **Raise/lower the retry budget.** Rejected: turns an infinite deterministic loop into a shorter one
   that still burns N reviews on stale input and dead-ends in a generic HALT that never says the input
   never changed (#280 owns progress-aware budgets; orthogonal).

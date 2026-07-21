# Step completion checks require a session-fresh verdict artifact (#649)

Status: Accepted

## Context

Three SHIP-tail completion checks read a verdict artifact produced by a dispatched judging session and
already reject a *prior feature's* file via `fileIsFreshSinceSession(f, ctx.sessionStartedAt)`
(`src/conductor/src/engine/artifacts.ts:105`): `architecture_review_as_built`
(`.pipeline/architecture-review-as-built.md`), `prd_audit` (`.pipeline/prd-audit.md`), and
`build_review` (`.pipeline/build-review.json`). But `ctx.sessionStartedAt` is `state.session_started_at`,
stamped once per conductor `run()` (`conductor.ts:1231-1233`); one `run()` drives every in-loop retry of
a review step (`:1653-1760`, dispatch `:1702`), so all retries share one floor. A verdict written by an
early retry stays `mtime >= sessionStartedAt` and passes freshness on every later retry — even after the
judged code was replaced — so a review session that fails to rewrite its verdict loops the stale verdict
forever.

Observed 2026-07-13 (`2026-07-12-wiring-reachability-gate`): ADR violation fixed at 20:22Z (commit
a79ca7a5); `architecture_review_as_built` returned the identical BLOCKED verdict at 20:26-20:39Z off the
19:56Z stale file (which self-dates: cites the pre-fix line range and "zero wiring-probe imports", both
false post-fix); three retries wasted on the critical path. Intake: jstoup111/ai-conductor#649.

Fix: a per-attempt "judging session start" floor (captured before each review dispatch), threaded into
the completion check; the verdict artifact must be fresh relative to *that*, not the conductor-run start.

## Story 1 — a review session that rewrites its verdict this attempt passes freshness

As a verdict completion check, when the just-dispatched judging session (re)writes its verdict artifact,
I must accept it — including a byte-identical rewrite — so a legitimate re-review is never blocked.

### Happy Path

- **Given** `architecture_review_as_built` dispatched with a per-attempt floor `attemptStartedAt = T`,
  and the review session writes `.pipeline/architecture-review-as-built.md` with `Verdict: APPROVED`
  and mtime `>= T`,
- **When** the completion check runs with `ctx.attemptStartedAt = T`,
- **Then** the artifact is fresh (`mtime >= verdictFreshnessFloor(ctx)`), the verdict is parsed, and the
  step is `done` — regardless of whether the content is identical to a prior attempt's verdict.

### Negative Path — verdict not rewritten this attempt is scored "no fresh verdict"

- **Given** the same step re-dispatched at `attemptStartedAt = T2 > T`, but the session does **not**
  rewrite the artifact (its mtime is still `T`, from the earlier attempt),
- **When** the completion check runs with `ctx.attemptStartedAt = T2`,
- **Then** the check returns `done:false` with a **distinct** "no fresh verdict — the judging session
  did not rewrite its verdict this attempt" reason (not the prior-feature-stale reason, and not the
  BLOCKED-verdict reason), and the stale verdict's *content* is never consulted.

## Story 2 — the guard applies to all three dispatched-judge verdict artifacts

As the freshness rule, I apply identically to `architecture_review_as_built`, `prd_audit`, and
`build_review`, so no dispatched-judge verdict can be reused across attempts.

### Happy Path

- **Given** each of `prd_audit` (`.pipeline/prd-audit.md`, all-ALIGNED) and `build_review`
  (`.pipeline/build-review.json`, `verdict: PASS`) written with mtime `>= attemptStartedAt`,
- **When** its completion check runs with the per-attempt floor,
- **Then** each is `done` (fresh + otherwise-valid).

### Negative Path — a stale prior-attempt PASS/ALIGNED is not reused

- **Given** a `prd_audit` report or a `build_review` PASS whose mtime predates the current
  `attemptStartedAt` (written by an earlier attempt, not rewritten this attempt),
- **When** the check runs,
- **Then** it returns `done:false` "no fresh verdict" — a prior session's passing verdict never
  false-GREENs the current attempt.

## Story 3 — no per-attempt floor falls back to the conductor-session floor

As the guard, when no per-attempt floor is provided (resume/backstop `completionCtx`, legacy state,
tests), I behave exactly as before — `fileIsFreshSinceSession(f, sessionStartedAt)`.

### Happy Path

- **Given** `ctx.attemptStartedAt === undefined` and `ctx.sessionStartedAt = S`,
- **When** any verdict check runs,
- **Then** `verdictFreshnessFloor(ctx) === S`, and the outcome is identical to the pre-change behaviour
  (artifact fresh iff `mtime >= S`).

### Negative Path — undefined session floor too is fail-open

- **Given** both `attemptStartedAt` and `sessionStartedAt` undefined (very old state),
- **When** a verdict check runs,
- **Then** `fileIsFreshSinceSession` returns true on file presence (fail-open on upgrade, unchanged from
  today) — the change never hard-fails an in-flight feature on rollout.

## Story 4 — the fresh/stale-reused outcome is auditable per attempt

As the audit trail, I distinguish a fresh verdict from a stale-reused one on every verdict-step
evaluation.

### Happy Path

- **Given** a verdict-step completion check,
- **When** it evaluates,
- **Then** the conductor emits a `verdict_freshness` event carrying `{ step, artifact, fresh,
  floorSource: 'attempt' | 'session', mtimeMs, floorMs }`, so each retry's fresh-vs-stale decision is
  visible in the run record.

### Negative Path — repeated evaluation is stable

- **Given** identical on-disk state (same artifact mtime, same floor),
- **When** a verdict check is evaluated more than once,
- **Then** it yields the same fresh/stale decision and the same reason string every time (pure mtime
  comparison, no hidden state, no counter drift).

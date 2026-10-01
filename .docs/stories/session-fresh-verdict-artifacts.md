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

## Story 1 — a review that produces current typed evidence passes freshness

As a verdict consumer, I want PRD and as-built evidence tied to the actual reviewer attempt.

### Happy Path
- Given PRD audit or as-built returns a valid structured result, when the engine validates, persists and renders it with that attempt's identity, then the gate treats it as fresh even if its substantive judgment equals the prior attempt's.

### Negative Path
- Given PRD audit or as-built produces no usable terminal result on a new dispatch, when completion is checked, then it names that step, attempt and expected output as missing current evidence and does not use old findings, even if their timestamps or sidecars were refreshed.

## Story 2 — each dispatched judge uses its authoritative freshness proof

### Happy Path
- Given a current-attempt typed PRD/as-built judgment or a fresh otherwise-valid build-review PASS, when its completion check runs, then it satisfies the applicable freshness proof.

### Negative Path
- Given an older build-review PASS below its attempt floor, when its completion check runs, then it returns no fresh verdict.
- Given only a fresh-mtime PRD/as-built Markdown report, when its completion check runs, then it scores absent and requests a new audit.

## Story 3 — legacy floors remain only for gates with a timestamp contract

### Happy Path
- Given build_review has no attempt floor but has session floor S, when freshness is checked, then its existing session-floor comparison applies.
- Given a typed PRD/as-built verdict before a new dispatch with valid code and decision preservation, when completion is checked, then the existing preservation proof permits reuse.

### Negative Path
- Given build_review has neither attempt nor session floor, when its freshness helper runs, then its existing file-presence fallback remains unchanged.
- Given PRD/as-built has only legacy Markdown or corrupt typed evidence and no attempt floor, when completion is checked, then it cannot pass through a timestamp or file-presence fallback.


## Story 4 — the fresh/stale-reused outcome is auditable per attempt

As the audit trail, I distinguish a fresh verdict from a stale-reused one on every verdict-step
evaluation.

### Happy Path

- **Given** a verdict-step completion check,
- **When** it evaluates,
- **Then** the conductor emits a `verdict_freshness` event carrying the step, artifact, freshness and applicable proof outcome; mtime-based gates retain their floor fields, while typed gates report attempt identity or code-validity preservation, so each retry's fresh-vs-stale decision is
  visible in the run record.

### Negative Path — repeated evaluation is stable

- **Given** identical evidence and applicable identity, decision, code-validity or timestamp inputs,
- **When** a verdict check is evaluated more than once,
- **Then** it yields the same fresh/stale decision and the same reason string every time (no hidden state or counter drift).

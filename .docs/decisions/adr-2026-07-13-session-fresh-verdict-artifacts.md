# ADR 2026-07-13: Step completion checks require a session-fresh verdict artifact (per-attempt floor)

Status: Proposed
Feature: session-fresh-verdict-artifacts
Issue: jstoup111/ai-conductor#649

## Context

Three SHIP-tail completion checks read a verdict artifact produced by a dispatched judging session:

| Step (`StepName`) | Verdict artifact | Predicate (`artifacts.ts`) |
| --- | --- | --- |
| `architecture_review_as_built` | `.pipeline/architecture-review-as-built.md` | as-built predicate (~`:960`) |
| `prd_audit` | `.pipeline/prd-audit.md` | prd_audit predicate (~`:1000`) |
| `build_review` | `.pipeline/build-review.json` (`BUILD_REVIEW_VERDICT`) | build_review predicate (~`:1035`) |

Each already rejects a *prior feature's* stale file via
`fileIsFreshSinceSession(f, ctx.sessionStartedAt)` (`artifacts.ts:105`). But `ctx.sessionStartedAt` is
`state.session_started_at`, stamped **once per conductor `run()`** (`conductor.ts:1231-1233`) and never
re-stamped. In daemon mode one `run()` drives the entire SHIP loop, and each review step is retried
in-loop (`conductor.ts:1653-1760`, dispatch at `:1702`). So every retry shares one floor: a verdict
artifact written by an early retry stays `mtime >= sessionStartedAt` for the whole run and passes
freshness on every later retry — even after the judged code was replaced.

A review session that fails to (re)write its verdict artifact therefore becomes an infinite
deterministic fail loop no code fix can exit: the check re-scores the stale verdict. Live incident
2026-07-13 (`2026-07-12-wiring-reachability-gate`): fix at 20:22Z (commit a79ca7a5), yet
`architecture_review_as_built` returned the identical BLOCKED verdict at 20:26-20:39Z off the 19:56Z
stale file, three more retries, on the critical-path build.

The finish-choice marker already has the right discipline (`fileIsFreshSinceSession(choicePath,
sessionStartedAt)` **plus** a session-start sweep of stale markers, `artifacts.ts` ~`:1144`) — but the
sweep runs once at `run()` start, i.e. before the retries, and would not catch a within-run cycle-2
artifact. Verdict artifacts need a floor that advances **per judging attempt**.

## Decision

Introduce a per-attempt judging-session floor and require the three verdict artifacts to be fresh
relative to it. Do **not** touch completion derivation, evidence corroboration, or the review skills'
contracts.

### D1 — Per-attempt floor threaded into the completion check

Add optional `attemptStartedAt?: number` to `CompletionContext` (`artifacts.ts:334`). In the conductor
retry loop, capture `Date.now()` immediately before the step dispatch (`conductor.ts:1702` — the
generic `stepRunner.run` path taken by all three review steps) into a transient conductor field, and
have `completionCtx` (`:612`) include it. `completionCtx` calls that are not part of a just-dispatched
attempt (resume/backstop) leave it `undefined` → unchanged behaviour. Legacy state / tests without the
field also leave it `undefined`.

Introduce a helper `verdictFreshnessFloor(ctx) = ctx.attemptStartedAt ?? ctx.sessionStartedAt`. The
three verdict predicates use `fileIsFreshSinceSession(f, verdictFreshnessFloor(ctx))` in place of the
current `ctx.sessionStartedAt`. When the artifact is older than the per-attempt floor, the predicate
returns `done:false` with a **distinct, loud** reason — e.g. *"as-built review verdict was not
rewritten by this judging session (mtime predates the review dispatch) — scoring 'no fresh verdict';
a prior session's verdict is never reused"* — separate from the existing prior-feature-stale reason so
the incident class is instantly identifiable in logs.

### D2 — Verdict-freshness audit event

The predicate returns a small `verdictFreshness` trace on `CompletionResult`
(`{ artifact, mtimeMs, floorMs, floorSource: 'attempt' | 'session', fresh: boolean }`). After the
verdict-step completion check, the conductor emits a `verdict_freshness` `StepEvent`
(`types/events.ts`) recording fresh-verdict vs stale-reused per evaluation, so the audit trail shows,
per retry, whether the judging session actually produced a fresh verdict.

### Scope: guarded now vs deferred

**Guarded now** (the three dispatched-judge verdict artifacts that loop while BLOCKED/FAIL and whose
stale reuse can false-GREEN a ship): `architecture_review_as_built`, `prd_audit`, `build_review`.

**Enumerated and deferred (with rationale):**

- `manual_test` (`.pipeline/manual-test-results.md`) — already carries the #367 whitewash guard
  (a FAIL→PASS flip requires HEAD to have moved), a *stronger* content-level guard than an mtime floor
  for its reuse class. The per-attempt floor is compatible but not required to close #649's incident;
  deferred to avoid perturbing the whitewash-marker logic in a tier-S change.
- `acceptance_specs` RED-evidence JSON — session-produced but consumed once at the DECIDE→BUILD
  boundary, not a verdict that loops while blocked, and has no freshness guard today at all; adding one
  is orthogonal scope.
- `retro` (`.docs/retros/*.md`) — a report, not a verdict; already session-fresh-checked and never
  loops on a verdict.

**Enumerated and out of scope (not verdict-consuming completion checks):**

- `review-required-<step>` markers (`conductor.ts:3249,3282`) — a conductor routing signal, written by
  the engine, **not read by any STEP_COMPLETION_CHECK**.
- `code-review-satisfied` — no such artifact exists in this codebase (grep-verified).

## Non-goals (explicit)

- **Why the review sessions fail to rewrite the artifact** (agent behaviour) — separate question
  (issue non-goal). The deterministic guard makes it loud either way.
- **No content-hash / session-id stamp inside the artifact** — would require a review-skill contract
  change; the engine-owned mtime floor suffices.
- **No verdict-artifact sweep** — a per-attempt sweep would destroy the file needed for diffing and is
  racier than the mtime comparison.
- **No change to completion derivation** (`autoheal.ts` `deriveCompletion`, the `build` predicate) —
  which keeps this orthogonal to the unmerged #642.
- **No retry-budget change** — #280 owns progress-aware budgets.

## #642 interaction

**Orthogonal.** #642 rewrites `autoheal.ts` `deriveCompletion` (build evidence corroboration) +
`autoheal.test.ts`. This ADR changes `artifacts.ts` (three verdict predicates + `CompletionContext`),
`conductor.ts` (retry-loop capture + `completionCtx`), and `types/events.ts` — no shared symbol except
`CompletionContext` (this ADR only *adds* an optional field; #642 does not touch it) and `CHANGELOG.md`
(textual, not semantic). Either may merge first; if #642 lands first, only a CHANGELOG rebase is
needed. Plan tasks anchor to the predicate/dispatch seams, never to `autoheal.ts` line numbers.

## Consequences

A review step whose session does not rewrite its verdict artifact now scores a loud "no fresh verdict"
on the first stale retry instead of re-scoring a prior verdict forever; the audit trail names the stale
reuse per retry. A legitimate re-review — including one that rewrites a byte-identical verdict — writes
the file during dispatch, so its mtime exceeds the per-attempt floor and it passes. The change is
localized, additive to `CompletionContext`, fail-open on missing floor, and reuses the existing
`fileIsFreshSinceSession` primitive.

## Task sketch (tier S, RED-first)

1. `attemptStartedAt` on `CompletionContext` + `verdictFreshnessFloor` helper + the three verdict
   predicates use it, with the distinct loud reason and the `verdictFreshness` trace on
   `CompletionResult` (RED tests in `artifacts.test.ts`).
2. Conductor: capture the per-attempt floor before dispatch, expose via `completionCtx`, add the
   `verdict_freshness` `StepEvent` and emit it after the verdict-step check (RED tests in the conductor
   test).
3. Regression + fallback + docs + CHANGELOG + integrity/vitest validate.

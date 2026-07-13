# Implementation Plan: Step completion checks require a session-fresh verdict artifact

Stem: session-fresh-verdict-artifacts
Track: technical
Tier: S
Source: jstoup111/ai-conductor#649
ADR: .docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md

## Goal

Make the three dispatched-judge SHIP-tail verdict checks
(`architecture_review_as_built`, `prd_audit`, `build_review`) require their verdict artifact to be
fresh relative to the **per-attempt judging session**, not the conductor-run start — so a review
session that fails to rewrite its verdict scores a loud "no fresh verdict" instead of re-scoring a
prior verdict forever (incident `2026-07-12-wiring-reachability-gate`, 2026-07-13).

Mechanism: capture `attemptStartedAt = Date.now()` immediately before each review dispatch, thread it
onto `CompletionContext`, and have the three verdict predicates use
`verdictFreshnessFloor(ctx) = ctx.attemptStartedAt ?? ctx.sessionStartedAt`. Fall back to the current
`sessionStartedAt` floor when no per-attempt floor is present (resume/backstop/legacy/tests). A
per-evaluation `verdict_freshness` audit event records fresh vs stale-reused.

## Files

- `src/conductor/src/engine/artifacts.ts` — Task 1. Add `attemptStartedAt?: number` to
  `CompletionContext` (near `:334`); add `verdictFreshnessFloor(ctx)` helper next to
  `fileIsFreshSinceSession` (`:105`); change the freshness call in the three verdict predicates
  (`architecture_review_as_built` ~`:960`, `prd_audit` ~`:1000`, `build_review` ~`:1035`) to use it,
  with a distinct "no fresh verdict" reason and a `verdictFreshness` trace field on the returned
  `CompletionResult` (extend the `CompletionResult` type).
- `src/conductor/src/engine/conductor.ts` — Task 2. Capture `attemptStartedAt` in the retry loop
  immediately before the generic dispatch (`:1702`) into a transient instance field; include it in
  `completionCtx` (`:612`/`:680`); after the verdict-step completion check, emit the new
  `verdict_freshness` event from the returned trace.
- `src/conductor/src/types/events.ts` — Task 2. Add the `verdict_freshness` arm to the `StepEvent`
  union.
- `src/conductor/test/engine/artifacts.test.ts` (or the nearest existing predicate test file) —
  Task 1 RED tests.
- `src/conductor/test/engine/conductor-*.test.ts` (nearest existing conductor completion/retry test) —
  Task 2 RED tests.
- `README.md`, `src/conductor/README.md` — Task 3. Note the per-attempt verdict-freshness rule.
- `CHANGELOG.md` — Task 3. `[Unreleased] → ### Fixed`.

## Non-goals

- **No change to completion derivation** (`autoheal.ts` `deriveCompletion`) or the `build` predicate —
  keeps this orthogonal to the unmerged #642; do not anchor any task to `autoheal.ts` lines.
- **No guard on `manual_test`, `acceptance_specs` RED evidence, or `retro`** this round — enumerated and
  deferred in the ADR (manual_test already has the #367 whitewash guard; the others are not
  looping-verdict artifacts).
- **No verdict-artifact sweep, no in-artifact content/session-id stamp, no review-skill contract
  change.**
- **No retry-budget change** — #280 owns progress-aware budgets.
- **Do not modify the incident feature's worktree/branch** — it is evidence.

## Task Dependency Graph

```
Task 1 (CompletionContext.attemptStartedAt + verdictFreshnessFloor + 3 predicates + trace + RED tests)
   └─> Task 2 (conductor capture + completionCtx wiring + verdict_freshness event + RED tests)
          └─> Task 3 (regression/fallback tests + README + CHANGELOG + validate)
```

## Tasks

### Task 1: Per-attempt floor in the completion predicates (RED first)

Add `attemptStartedAt?: number` to `CompletionContext`. Add
`export function verdictFreshnessFloor(ctx: CompletionContext): number | undefined { return
ctx.attemptStartedAt ?? ctx.sessionStartedAt; }`. In the `architecture_review_as_built`, `prd_audit`,
and `build_review` predicates, replace `fileIsFreshSinceSession(f, ctx.sessionStartedAt)` with
`fileIsFreshSinceSession(f, verdictFreshnessFloor(ctx))`; on the stale branch return a **distinct**
reason ("… verdict was not rewritten by this judging session (mtime predates the review dispatch) —
scoring 'no fresh verdict'; a prior session's verdict is never reused") and set a `verdictFreshness`
trace on the returned `CompletionResult` (`{ artifact, mtimeMs, floorMs, floorSource, fresh }`). Also
populate the trace with `fresh:true` on the pass path.

**RED tests** (`artifacts.test.ts`):
- `as-built passes when artifact mtime >= attemptStartedAt` — fresh APPROVED with `ctx.attemptStartedAt
  = T`, mtime `T+1` → `done:true`.
- `as-built scores no-fresh-verdict when mtime < attemptStartedAt though >= sessionStartedAt` — the
  incident: `sessionStartedAt = S`, `attemptStartedAt = T > S`, artifact mtime in `(S, T)` → `done:false`
  with the distinct "no fresh verdict" reason (asserts the reason string differs from both the
  prior-feature-stale and the BLOCKED-verdict reasons).
- `as-built byte-identical rewrite this attempt passes` — same APPROVED content, mtime `>= T` →
  `done:true` (regression, Story 1).
- `prd_audit reuses no stale ALIGNED across attempts` — all-ALIGNED report with mtime `< attemptStartedAt`
  → `done:false` no-fresh-verdict.
- `build_review reuses no stale PASS across attempts` — valid `PASS` json with mtime `< attemptStartedAt`
  → `done:false` no-fresh-verdict.
- `verdictFreshnessFloor falls back to sessionStartedAt when attemptStartedAt undefined` — floor equals
  `sessionStartedAt`; predicate outcome identical to pre-change (Story 3).
- `verdictFreshness trace is populated on both pass and stale paths` — asserts `floorSource` is
  `'attempt'` when `attemptStartedAt` set, `'session'` when only `sessionStartedAt` set.

### Task 2: Conductor per-attempt capture + audit event (RED first)

In the retry loop, immediately before the generic `this.stepRunner.run(step.name, …)` dispatch
(`conductor.ts:1702`), set `this.currentAttemptStartedAt = Date.now()`; clear it (`undefined`) in the
same `finally` that stops the build watcher, so only a just-dispatched attempt carries a floor. In
`completionCtx` (`:612`), include `attemptStartedAt: this.currentAttemptStartedAt`. Add the
`verdict_freshness` arm to the `StepEvent` union (`types/events.ts`): `{ type: 'verdict_freshness';
step: StepName; artifact: string; fresh: boolean; floorSource: 'attempt' | 'session'; mtimeMs?: number;
floorMs?: number }`. After the completion check for a verdict-consuming step, if the result carries a
`verdictFreshness` trace, emit the event.

**RED tests** (nearest conductor completion/retry test):
- `completionCtx carries attemptStartedAt only during a dispatched attempt` — set during dispatch,
  `undefined` at resume/backstop call sites.
- `a review retry whose session does not rewrite the verdict does not pass the gate` — end-to-end over a
  stubbed step runner that leaves the artifact stale across two attempts: the second attempt's check is
  `done:false` no-fresh-verdict (guards against the incident loop).
- `verdict_freshness event is emitted with fresh:false / floorSource:'attempt' on stale reuse` and
  `fresh:true` on a rewrite.

### Task 3: Regression, fallback, docs, CHANGELOG, validate

- Regression/fallback tests: (a) with no `attemptStartedAt`, all three predicates behave exactly as
  before against `sessionStartedAt` (Story 3); (b) both floors undefined → fail-open on presence
  (Story 3 negative); (c) repeated evaluation of identical on-disk state yields identical decision +
  reason (Story 4 negative). Place with Task 1's tests.
- Document the per-attempt verdict-freshness rule in `README.md` and `src/conductor/README.md`
  (SHIP-tail gates section).
- Add a CHANGELOG `[Unreleased] → ### Fixed` entry. No Migration block — no `bin/conduct` CLI,
  `settings.json` schema, hook wiring, or skill-symlink change.
- Run `test/test_harness_integrity.sh` and the conductor vitest suite; both green before commit.

# Complexity: Step completion checks consume a stale verdict artifact across retries (#649)

Tier: S

## Rationale

Small. One deterministic mechanism (a finer freshness floor) applied at one dispatch seam and three
existing predicates, reusing a primitive the engine already ships.

- **The guard, the primitive, and the precedent already exist.** `fileIsFreshSinceSession(path, floor)`
  (`artifacts.ts:105`) is the exact comparison; the three verdict predicates already call it with
  `ctx.sessionStartedAt`; the finish-choice marker already demonstrates a stricter per-run floor
  (`artifacts.ts` ~`:1144`). The work is *narrowing the floor these three predicates use*, not building
  new machinery.
- **One capture point covers all three review steps.** `architecture_review_as_built`, `prd_audit`,
  and `build_review` all dispatch through the generic `this.stepRunner.run(step.name, …)` path
  (`conductor.ts:1702`) inside the single retry loop (`:1653`). Capturing `Date.now()` immediately
  before that call, once, gives every verdict predicate its per-attempt floor.
- **Threading is additive.** Add an optional `attemptStartedAt?: number` to `CompletionContext`
  (`artifacts.ts:334`), set it from a transient conductor field in `completionCtx` (`:612`), and let
  the three predicates prefer `attemptStartedAt ?? sessionStartedAt`. Every other `completionCtx`
  call site (resume/backstop, `:3655`, `:4068`) leaves it undefined → exact prior behaviour. Legacy
  state / tests without the field → falls back to `sessionStartedAt`, fail-open on upgrade.
- **Audit event is one union arm.** A `verdict_freshness` `StepEvent` (`types/events.ts`) emitted by
  the conductor after the verdict-step check, fed by a small `verdictFreshness` trace the predicate
  returns on `CompletionResult`.
- **Breaking-surface check:** no `bin/conduct` CLI, `settings.json` schema, hook wiring, or skill
  symlink change. Plain `### Fixed`; no CHANGELOG Migration block.

Not M: no new step, no new store, no cross-run/persisted state (the floor is transient, per attempt),
no scheduler change, and the completion-derivation core (`autoheal.ts` `deriveCompletion`, the `build`
predicate's evidence path) is untouched — which is what keeps this orthogonal to the unmerged #642.

## #642 orthogonality (verified)

PR #642 rewrites `autoheal.ts` `deriveCompletion` (build evidence corroboration) + `autoheal.test.ts`.
This spec touches `artifacts.ts` (the three verdict predicates + `CompletionContext`), `conductor.ts`
(retry-loop dispatch capture + `completionCtx`), and `types/events.ts` — **not** `autoheal.ts`, **not**
`deriveCompletion`, **not** the `build` predicate. The only overlap is `CHANGELOG.md` (`[Unreleased]`),
a textual merge, not a semantic one. Either PR may land first; if #642 lands first only a CHANGELOG
rebase is needed. Plan tasks are anchored to the predicate/dispatch seams, never to `autoheal.ts` line
numbers. Verdict: **orthogonal**.

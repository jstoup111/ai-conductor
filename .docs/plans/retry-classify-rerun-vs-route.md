# Implementation Plan: Classify step-failures rerun-vs-route (#646)

Stem: retry-classify-rerun-vs-route
Track: technical
Tier: M
Source: jstoup111/ai-conductor#646
ADR: .docs/decisions/adr-2026-07-13-retry-classify-rerun-vs-route.md

## Goal

Decide **rerun-vs-route BEFORE burning a retry** for the SHIP-tail verdict steps
(`architecture_review_as_built`, `prd_audit`, `build_review`): a fresh adverse verdict (named route)
routes on the first signal, an identical failure on unchanged inputs routes on the second, and a
missing/stale/changed-input failure still reruns — all through the EXISTING `planRemediation`/kickback
path, gated by a `retry_routing.enabled` kill-switch (default on, exact revert). No retry-budget
change; the `build` step is out of scope (#280 owns its budgets).

## Files

- `src/conductor/src/engine/artifacts.ts` — Tasks 1, 2. Add `routeClass?: 'named-route' | 'absent'`
  to `CompletionResult` (`:308`); set it in the `architecture_review_as_built` (`:1014`) and
  `build_review` (`:1058`) predicates on their `done:false`/`done:true` branches; add the pure
  `classifyRetryDecision(...)` helper (near `classifyPrdAuditGaps`, `:1652`) that consults the facet
  for as-built/build_review and `classifyPrdAuditGaps` for prd_audit.
- `src/conductor/src/types/config.ts` — Task 3. Add `RetryRoutingConfig { enabled?: boolean }` and the
  optional `retry_routing?` field on the config interface (mirror `BuildProgressHaltConfig`, `:247`).
- `src/conductor/src/engine/config.ts` — Task 3. Add `retry_routing` to `knownTopLevelKeys` (`:198`);
  add `RETRY_ROUTING_DEFAULTS = { enabled: true }`, `validateRetryRoutingBlock`, and
  `resolveRetryRoutingBlock` (mirror `build_progress_halt`, `:965`); wire both into the config
  validate/resolve flow (`:697-705`).
- `src/conductor/src/types/events.ts` — Task 4. Add the `retry_decision` arm to `ConductorEvent`
  (`:24`, alongside `step_retry` `:29`).
- `src/conductor/src/engine/conductor.ts` — Task 4. Generalize the prd_audit short-circuit (`:2128`)
  into a flag-gated `classifyRetryDecision` call over the verdict steps; capture the prior attempt's
  `completion.reason`, HEAD sha, and verdict-artifact mtimes in loop-scoped vars for signal (b); on a
  `route` decision `break`, on `rerun` fall through; emit `retry_decision`; thread `unchangedInput`
  into the routed-halt reason (D5). Preserve the original short-circuit verbatim when
  `retry_routing.enabled` is false.
- `src/conductor/test/engine/artifacts.test.ts` (or nearest existing predicate/classifier test file) —
  Tasks 1, 2 RED tests.
- `src/conductor/test/engine/config*.test.ts` — Task 3 RED tests.
- nearest existing conductor completion/retry test (`src/conductor/test/engine/conductor*.test.ts`) —
  Task 4 RED tests.
- `README.md`, `src/conductor/README.md` — Task 5. Document `retry_routing` + the rerun-vs-route rule.
- `CHANGELOG.md` — Task 5. `[Unreleased] → ### Added`.

## Non-goals

- **No change to the `build` step's retry/progress accounting** — the classifier is never invoked on
  `build`; do not touch `stepMaxRetries`, `build_progress_halt`, or the progress-bypass gate (#280).
- **No new routing mechanism** — reuse `planRemediation`/`earliestRemediationTarget`; do not duplicate
  `classifyPrdAuditGaps`.
- **No change to `autoheal.ts` `deriveCompletion` or the `build` predicate** — keeps this orthogonal to
  #642; anchor no task to `autoheal.ts` lines.
- **No new artifact, no review-skill contract change, no in-artifact stamp.**
- **Do not modify the incident feature's worktree/branch** — it is evidence.

## Task Dependency Graph

```
Task 1 (routeClass facet + verdict predicates set it + RED)
   └─> Task 2 (classifyRetryDecision helper: signals a+b, verdict-step scope + RED)
Task 3 (retry_routing config block + kill-switch + RED)   [independent of 1/2]
Task 2 + Task 3
   └─> Task 4 (conductor seam generalization + capture + retry_decision event + halt threading + RED)
          └─> Task 5 (regression/negative + README + CHANGELOG + validate)
```

## Tasks

### Task 1: `routeClass` facet on verdict predicates (RED first)

Add `routeClass?: 'named-route' | 'absent'` to `CompletionResult`. In `architecture_review_as_built`:
a fresh non-`APPROVED` verdict → `done:false, routeClass:'named-route'`; a missing / stale /
unparseable-verdict result → `done:false, routeClass:'absent'`. In `build_review`: a fresh valid `FAIL`
→ `named-route`; missing / stale / malformed → `absent`. Leave `routeClass` undefined on the `done:true`
paths and on all other predicates.

**RED tests** (`artifacts.test.ts`):
- `as-built BLOCKED fresh → routeClass 'named-route'` (fresh file, `Verdict: BLOCKED`).
- `as-built missing file → routeClass 'absent'`; `as-built stale file → routeClass 'absent'`;
  `as-built unparseable verdict → routeClass 'absent'`.
- `build_review fresh FAIL → routeClass 'named-route'`; `build_review missing/stale/malformed →
  routeClass 'absent'`.
- `as-built APPROVED fresh → done:true, routeClass undefined` (regression).

### Task 2: `classifyRetryDecision` pure helper (RED first)

`export function classifyRetryDecision(input: { step: StepName; completion: CompletionResult;
attempt: number; priorReason?: string; inputsUnchanged: boolean; prdAuditNonClean?: boolean }):
{ decision: 'rerun' } | { decision: 'route'; signal: 'named-route' | 'identical-repeat' }`. Scope:
returns `rerun` immediately for any step not in `{architecture_review_as_built, prd_audit,
build_review}`. Route on signal (a) when the step's route signal is `named-route`
(`completion.routeClass === 'named-route'`, or `prdAuditNonClean` for prd_audit). Route on signal (b)
when `attempt >= 2 && priorReason !== undefined && priorReason === completion.reason &&
inputsUnchanged`. Else `rerun`. (The conductor computes `inputsUnchanged` and `prdAuditNonClean` and
passes them in — the helper stays pure/synchronous and fully table-testable.)

**RED tests** (`artifacts.test.ts` or a new `retry-classify.test.ts`):
- truth table over `{named-route | absent} × {attempt 1 | 2} × {reason same | diff} ×
  {inputsUnchanged true | false}` asserting the documented decision + signal.
- `build step always → rerun` (scope guard).
- `prd_audit with prdAuditNonClean:true → route 'named-route' on attempt 1`.
- `identical-repeat requires attempt>=2 AND same reason AND inputsUnchanged` (each condition flipped
  independently → rerun).

### Task 3: `retry_routing` config kill-switch (RED first)

Add `RetryRoutingConfig`/`retry_routing?` to `types/config.ts`. In `config.ts`: add `retry_routing`
to `knownTopLevelKeys`, `RETRY_ROUTING_DEFAULTS = { enabled: true }`, `validateRetryRoutingBlock`
(object-only; `enabled` boolean-only; reject unknown keys), `resolveRetryRoutingBlock` (default
`enabled:true`), and wire both into the top-level validate/resolve flow.

**RED tests** (`config*.test.ts`):
- absent block → resolves `{ enabled: true }`.
- `retry_routing: { enabled: false }` → resolves false.
- non-boolean `enabled` → validation error; unknown key inside block → validation error; unknown
  top-level sibling still rejected (regression that `retry_routing` is now known).

### Task 4: Conductor seam generalization + telemetry + halt threading (RED first)

Add the `retry_decision` arm to `ConductorEvent`. In the retry loop, hold loop-scoped
`priorCompletionReason`, `priorHeadSha`, `priorArtifactMtime` across attempts (set at each
completion-check evaluation). Replace the `:2128` prd_audit short-circuit with: if
`resolveRetryRoutingConfig(this.config).enabled` and the step is a verdict step, compute
`inputsUnchanged` (HEAD sha via `currentCommitSha` unchanged vs `priorHeadSha` AND verdict-artifact
mtime unchanged vs `priorArtifactMtime`) and `prdAuditNonClean` (via `classifyPrdAuditGaps` for
prd_audit only), call `classifyRetryDecision`, emit `retry_decision`, and `break` on `route`; else fall
through to the unchanged `:2601` retry. When `enabled` is false, run the original prd_audit-only
short-circuit verbatim (exact revert). For a signal-(b) route, record the `unchangedInput` string and
prepend it to the routed-halt reason when the routed path HALTs (D5).

**RED tests** (nearest conductor completion/retry test, stubbed step runner):
- **Incident replay:** daemon + fresh as-built BLOCKED → routes on attempt 1 (no second same-step
  `step_retry`), `retry_decision {decision:'route', signal:'named-route', attempt:1}` emitted, control
  reaches the as-built `planRemediation` path.
- daemon + as-built absent verdict on attempt 1 → `rerun` (`step_retry` emitted, `retry_decision
  {decision:'rerun'}`).
- daemon + build_review generic FAIL (no named-route facet), attempt-2 byte-identical reason + HEAD &
  mtime unchanged → routes with `signal:'identical-repeat'`; if HEAD advanced between attempts → reruns.
- `retry_routing.enabled:false` → as-built burns retries then routes at `step_failed` (exact revert),
  prd_audit still short-circuits on try 1, no `retry_decision` emitted.
- prd_audit fresh-blocking still routes on try 1 with the flag on (single `classifyPrdAuditGaps`
  evaluation, no double-route).
- a signal-(b) routed HALT reason contains the unchanged-input note, not "retries exhausted".

### Task 5: Regression, negatives, docs, CHANGELOG, validate

- Negatives: interactive (non-daemon) mode unchanged; a DECIDE-target route still HALTs via #644;
  earlier routing does not exceed `MAX_KICKBACKS_PER_GATE`.
- Document `retry_routing` (config block + rerun-vs-route rule, exact-revert note) in `README.md` and
  `src/conductor/README.md` (SHIP-tail gates / config section, next to `build_progress_halt`).
- Add a CHANGELOG `[Unreleased] → ### Added` entry. No Migration block — no `bin/conduct` CLI,
  `settings.json` schema, hook wiring, or skill-symlink change (pure engine + additive config).
- Run `test/test_harness_integrity.sh` and the conductor vitest suite; both green before commit.

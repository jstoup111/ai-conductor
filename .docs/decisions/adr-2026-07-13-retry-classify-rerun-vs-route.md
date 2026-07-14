# ADR 2026-07-13: Classify step-failures rerun-vs-route before burning a retry (#646)

Status: Approved
Approved-By: jstoup111 (operator ruling 2026-07-14, spec merged as PR #653)
Feature: retry-classify-rerun-vs-route
Issue: jstoup111/ai-conductor#646

## Context

The in-loop retry machinery (`conductor.ts` retry loop `:1670`, dispatch `:1702`) handles a
completion-gate miss at `:2601`:

```
if (progressBypassed || attempt < stepMaxRetries) { emit step_retry; continue; }  // rerun same step
```

For a SHIP-tail **verdict** step that judges unchanged code/artifacts, this rerun re-reads the same
inputs and fails identically until the per-step retry budget drains. Only THEN does the existing
`planRemediation` routing engage at `step_failed` (`:2927` prd_audit, `:3069` as-built/finish) — the
routing that already knows where the fix belongs.

`prd_audit` is the exception: a fresh blocking report already short-circuits the retry loop on try 1
(`:2128`, via `classifyPrdAuditGaps`, `artifacts.ts:1652`) and drops into routing. But
`architecture_review_as_built` and `build_review` have no such short-circuit:

| Step | Predicate | Adverse-verdict reason (names the route) | Retry-loop short-circuit today? |
| --- | --- | --- | --- |
| `prd_audit` | `artifacts.ts:1652` (classify) | non-clean gap class | **yes** (`conductor.ts:2128`) |
| `architecture_review_as_built` | `artifacts.ts:1014` | `:1050` "…Fix the code or supersede the ADR…" | no |
| `build_review` | `artifacts.ts:1058` | FAIL verdict + grader reasons | no |

Live incident 2026-07-13 (`2026-07-12-wiring-reachability-gate`): `architecture_review_as_built`
returned a byte-identical BLOCKED verdict on tries 1-3, then kicked back to `build`. Tries 2-3 were
~5 min + 2 dispatches of pure waste; the try-1 verdict already named the route. Operator priority is
throughput: eliminate the foredoomed reruns.

## Decision

Add a deterministic **rerun-vs-route classifier** at the completion-gate-miss seam that decides, before
the next retry burns, whether a rerun can plausibly change the gate's inputs. Route-class failures
engage the EXISTING `planRemediation`/kickback path immediately. No new routing mechanism; no
retry-budget change.

### D1 — Machine-readable route facet on the verdict predicates

Extend `CompletionResult` (`artifacts.ts:308`) with an optional facet
`routeClass?: 'named-route' | 'absent'` (alongside the existing `missing?: 'recording' | 'other'`).
The three verdict predicates set it on the `done:false` path:

- **`architecture_review_as_built`** (`:1014`): a **fresh** artifact whose verdict is not a clean
  `APPROVED` → `routeClass: 'named-route'`. A missing / stale / unparseable-verdict artifact →
  `routeClass: 'absent'`.
- **`build_review`** (`:1058`): a **fresh** valid `FAIL` verdict → `named-route`. Missing / stale /
  malformed → `absent`.
- **`prd_audit`**: the predicate itself only checks presence; the route signal is computed by
  `classifyPrdAuditGaps` (a fresh blocking report is non-clean). The classifier consults
  `classifyPrdAuditGaps` for this step rather than a predicate facet — **reusing the existing
  `:2128` signal, not duplicating it.**

`named-route` means "the check names a route (a remediation disposition / kickback target exists) and
the input is settled"; `absent` means "no verdict yet — a re-run can produce one".

### D2 — The classifier (pure, deterministic)

`classifyRetryDecision({ step, completion, attempt, priorReason, inputsUnchanged }) →
{ decision: 'rerun' } | { decision: 'route'; signal: 'named-route' | 'identical-repeat';
unchangedInput?: string }`, scoped to the verdict steps (`architecture_review_as_built`, `prd_audit`,
`build_review`). Returns `route` when EITHER:

- **Signal (a) named-route (try 1+):** the step's route signal is `named-route` (predicate facet, or
  `classifyPrdAuditGaps` non-clean for prd_audit). Cheapest reliable signal per the issue — the
  completion check already names the route.
- **Signal (b) identical-repeat (try 2+):** `attempt >= 2` AND `priorReason === completion.reason`
  (byte-identical) AND `inputsUnchanged`. `inputsUnchanged` = HEAD sha unchanged since the prior
  attempt (`currentCommitSha`, already called in-loop) AND the step's verdict-artifact mtimes
  (`STEP_ARTIFACT_GLOBS[step]`) unchanged since the prior attempt.

Otherwise `rerun`. The `build` step is never passed to the classifier — its retry/progress accounting
is #280's and stays untouched.

### D3 — Seam: generalize the prd_audit short-circuit

Replace the prd_audit-only short-circuit at `conductor.ts:2128` with a call to `classifyRetryDecision`
covering all three verdict steps, gated by the kill-switch:

- Flag **on**: on a `route` decision, `break` the retry loop (drop into the existing `!succeeded`
  routing). On `rerun`, fall through to the unchanged retry decision at `:2601`.
- Flag **off** (exact revert): the classifier is bypassed and the **original** prd_audit short-circuit
  runs verbatim (prd_audit still routes on try 1; as-built/build_review burn retries then route at
  `step_failed`, exactly as pre-#646).

The prior attempt's `completion.reason`, HEAD sha, and artifact mtimes are held in loop-scoped
variables captured at each completion-check evaluation, feeding signal (b) on the next attempt.

### D4 — Telemetry: `retry_decision` audit event

Add a `retry_decision` arm to the `StepEvent` union (`types/events.ts`):
`{ type: 'retry_decision'; step: StepName; attempt: number; decision: 'rerun' | 'route';
signal?: 'named-route' | 'identical-repeat'; unchangedInput?: string }`, emitted on every
classifier-covered completion-gate miss. Pairing each `retry_decision` with the subsequent step outcome
(`step_completed` / `step_failed` / `kickback` / `loop_halt`) in the event log yields the operator's
requested **success-% of same-step reruns vs routed retries**. (The percentage is computed downstream
from the log; the engine records the decision + lets the existing outcome events supply the result.)

### D5 — Halts name the unchanged input

When a route produced by signal (b) dead-ends in a HALT (e.g. #644's DECIDE-target guard, or #648's
zero-progress escalation), the halt reason includes the `unchangedInput` string (HEAD sha unchanged at
`<sha>`; `<artifact>` unchanged since attempt N) rather than the generic "retries exhausted" message.
Named-route (signal a) routes already produce gap-named halts via `planRemediation`, so no extra text
is required there.

### D6 — Config kill-switch (exact-revert, `build_progress_halt` precedent)

New optional top-level `retry_routing:` block, validated/resolved exactly like `build_progress_halt`
(`config.ts:198`, `:965`, `types/config.ts:247`):

- `RETRY_ROUTING_DEFAULTS = { enabled: true }`.
- Validate: object only, `enabled` boolean only, unknown keys rejected; add to `knownTopLevelKeys`.
- Resolve: `enabled` defaults to `true` when absent.
- `enabled: false` is an **exact revert** to pre-#646 behaviour (D3 flag-off).

## Composition with neighbours (compose, do not duplicate)

- **#644 (merged, `planRemediation` DECIDE-halt guard, `conductor.ts:915-931`):** routing goes through
  `planRemediation` → `earliestRemediationTarget`, so a route whose target is a DECIDE-phase step is
  HALTed by #644's guard exactly as today. The classifier only changes *when* `planRemediation` is
  reached (earlier), never *what it decides*.
- **#648 (merged, kickback→build no-op / zero-progress escalation D1-D3):** guards the kickback
  **re-entry** into `build`. The classifier fires the route earlier (try 1/2 vs budget-exhaustion) but
  through the SAME kickback path, so #648's D1/D2/D3 apply unchanged and engage sooner — the intended
  effect. `MAX_KICKBACKS_PER_GATE` is untouched, so earlier routing cannot increase total kickback
  churn.
- **#649 / PR #652 (spec merged, impl pending — per-attempt verdict freshness):** directly complementary
  and touches overlapping seams (verdict predicates, `completionCtx`, `types/events.ts`). Semantic
  interlock: #649 decides whether a verdict artifact is **fresh this attempt**; #646 keys signal (a)
  off exactly that fresh-vs-absent distinction. A not-yet-rewritten verdict is #649's "no fresh
  verdict" → our `routeClass: 'absent'` → **rerun** (let the judge produce it); a fresh adverse verdict
  → `named-route` → **route** (the judge spoke; a rerun won't change it). Whichever implements first,
  the other rebases the shared files; plan tasks anchor to seam descriptions, not to line numbers that
  the other PR may shift. If #649 lands first, signal (a)'s "fresh" test uses its per-attempt floor;
  if #646 lands first, #649 rebases the predicate reason/facet.
- **#280 (merged, progress-aware build budgets):** untouched. The classifier excludes the `build` step
  entirely; no change to `stepMaxRetries`, `build_progress_halt`, or the progress-bypass gate.

## Non-goals (explicit)

- **No new retry budgets or ceilings** (#280 owns them).
- **The `build` step's retry/progress accounting** — out of scope; the classifier never runs on `build`.
  The build-side deterministic evidence-gate false-rejects the issue mentions (#548/#535) are addressed
  by their own merged fixes (#642), not here.
- **No new routing mechanism** — reuse `planRemediation`/kickback.
- **No change to completion derivation** (`autoheal.ts`) or review-skill contracts.
- **No LLM in the classifier** — plain engine code keyed off machine-readable facets and sha/mtime.
- **Not diagnosing WHY a judging session re-emits a verdict** — agent behaviour, separate concern.

## Consequences

A fresh adverse verdict on a SHIP-tail step routes to remediation on the first signal instead of after
the retry budget drains, cutting the incident's 3 dispatches to 1 and surfacing the resolving route
sooner. The audit trail records rerun-vs-route per attempt with the outcome, enabling data-driven
tuning of the classifier. Halts on the routed path name the unchanged input. The change is additive
(new optional facet, new optional config block, new event arm), fail-open (unknown facet / absent
config → default `enabled: true`; the `build` step and interactive mode unchanged), and exactly
revertible via `retry_routing.enabled: false`.

## Task sketch (tier M, RED-first)

1. `routeClass` facet on `CompletionResult` + set it in the `architecture_review_as_built` and
   `build_review` predicates (`artifacts.ts`); RED predicate tests.
2. `classifyRetryDecision` pure helper (signals a + b, verdict-step scope, prd_audit via
   `classifyPrdAuditGaps`); RED unit tests over the truth table.
3. `retry_routing` config block (`config.ts` + `types/config.ts`) with validate/resolve/defaults +
   kill-switch; RED config tests.
4. Conductor seam: generalize the `:2128` short-circuit to call the classifier (flag-gated,
   prd_audit exact-revert preserved), capture prior-reason/HEAD/mtime for signal (b), break-to-route,
   emit `retry_decision` (`types/events.ts`), thread `unchangedInput` into routed halts; RED conductor
   tests (incident replay: as-built routes on try 1; identical-repeat routes on try 2; input-changed
   reruns; flag-off exact revert; prd_audit preserved).
5. Regression/negative + README + `src/conductor/README.md` + CHANGELOG + integrity/vitest validate.

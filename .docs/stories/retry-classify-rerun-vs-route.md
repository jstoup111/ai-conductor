# Classify step-failures rerun-vs-route (#646)

Status: Accepted

## Context

The engine's in-loop retry machinery (`conductor.ts` retry loop `:1670-1760`, dispatch `:1702`)
re-dispatches a failing step verbatim on a completion-gate miss (`:2601` — `if (progressBypassed ||
attempt < stepMaxRetries) { emit step_retry; continue; }`). For the SHIP-tail verdict steps that judge
unchanged code/artifacts, a rerun cannot change the gate's inputs, so it fails identically until the
budget drains — only THEN does the existing `planRemediation` routing engage at `step_failed`
(`:2927` prd_audit, `:3069` as-built/finish).

`prd_audit` already avoids this: a fresh blocking report short-circuits the retry loop on try 1
(`:2128`, via `classifyPrdAuditGaps`, `artifacts.ts:1652`) and drops into routing. But
`architecture_review_as_built` (predicate `artifacts.ts:1014`, adverse-verdict reason at `:1050`
literally naming "Fix the code or supersede the ADR") and `build_review` (predicate `:1058`, fresh
FAIL) have no such short-circuit — they burn every retry first.

Live incident 2026-07-13 (`2026-07-12-wiring-reachability-gate`): `architecture_review_as_built`
returned a byte-identical BLOCKED verdict on tries 1-3 before kicking back to `build`; tries 2-3 were
pure waste. The try-1 verdict already named the route.

The fix: a deterministic classifier that decides rerun-vs-route BEFORE burning a retry, generalizing
the prd_audit precedent to all three verdict steps and adding a general "identical failure on
unchanged inputs" signal, routing through the EXISTING remediation path.

## Non-goals

- No new retry budgets or ceilings — #280 owns progress-aware budgets; the `build` step's retry/progress
  accounting is untouched.
- No new routing mechanism — reuse `planRemediation`/kickback, honoring #644's DECIDE-halt and #648's
  no-op escalation.
- No change to completion derivation (`autoheal.ts`) or review-skill contracts.
- Not fixing WHY a judging session re-emits the same verdict (that is agent behaviour / #649's freshness
  concern) — the classifier makes the deterministic case loud and fast either way.

## Signal vocabulary (used by the scenarios)

- **named-route (signal a):** a completion-gate miss where the step's completion check reports a
  **fresh** artifact recording an **adverse** verdict whose resolution is a known remediation/kickback
  target (as-built non-APPROVED; prd_audit `classifyPrdAuditGaps` non-clean; build_review FAIL). The
  reason already names the route. Route on **try 1**.
- **absent (rerun):** the artifact is missing / stale / unparseable — the judging session has not
  produced a verdict; a re-run CAN help. Rerun.
- **identical-repeat (signal b):** `attempt >= 2` AND the current `completion.reason` is byte-identical
  to the immediately-prior attempt's AND inputs are unchanged (HEAD sha unchanged since the prior
  attempt AND the step's verdict-artifact mtimes unchanged). Route on **try 2**.

---

## Story 1 — As-built BLOCKED routes on try 1 instead of burning retries (happy path)

As the daemon engine, when a fresh `architecture_review_as_built` verdict is BLOCKED (adverse, route
named) on unchanged code, I route to remediation on the first signal so I don't waste retries.

- **Given** daemon mode, `retry_routing.enabled` (default) true, and a fresh
  `.pipeline/architecture-review-as-built.md` whose verdict is `BLOCKED`
- **When** the completion check fails on attempt 1 with the adverse-verdict reason (routeClass
  `named-route`)
- **Then** the classifier returns `route` with signal `named-route`, the retry loop breaks
  immediately (no `step_retry` emitted for a second same-step attempt), and control drops into the
  existing as-built `planRemediation` routing at `step_failed`
- **And** a `retry_decision` event is recorded with `decision: 'route'`, `signal: 'named-route'`,
  `attempt: 1`.

## Story 2 — Missing/stale verdict still reruns (rerun path, negative)

As the daemon engine, when the judging session has NOT produced a fresh verdict, I rerun (a re-run can
produce one) rather than routing on nothing.

- **Given** daemon mode and the as-built check fails because the artifact is **absent** (no file) or
  **stale** (mtime predates the freshness floor)
- **When** the classifier runs on attempt 1
- **Then** it returns `rerun` (routeClass `absent`), the loop `continue`s and emits `step_retry` exactly
  as today
- **And** the `retry_decision` event records `decision: 'rerun'`, `signal: undefined`.

## Story 3 — Identical repeat on unchanged inputs routes on try 2 (signal b)

As the daemon engine, when a non-prd_audit verdict step fails with a byte-identical reason twice on
unchanged inputs, I route rather than burning the rest of the budget.

- **Given** daemon mode, a `build_review` FAIL whose predicate does not set `named-route` on attempt 1
  (e.g. the reason is generic), attempt 1 reruns
- **When** attempt 2 fails with a `completion.reason` byte-identical to attempt 1, HEAD sha unchanged
  since attempt 1, and the verdict-artifact mtime unchanged
- **Then** the classifier returns `route` with signal `identical-repeat`, the loop breaks into routing
- **And** the `retry_decision` event records `decision: 'route'`, `signal: 'identical-repeat'`,
  `unchangedInput` naming the HEAD sha and artifact.

## Story 4 — Input changed between attempts still reruns (signal b negative)

As the daemon engine, when inputs changed between two same-reason attempts, the failure may not be
deterministic, so I rerun.

- **Given** attempt 2 fails with a reason byte-identical to attempt 1 BUT the HEAD sha advanced (a
  commit landed) OR the verdict-artifact mtime advanced since attempt 1
- **When** the classifier runs on attempt 2
- **Then** it returns `rerun` (inputs changed → not proven deterministic), and the loop `continue`s.

## Story 5 — Kill-switch off is an exact revert (negative / compatibility)

As an operator, disabling the feature restores byte-identical pre-#646 behaviour.

- **Given** `retry_routing.enabled: false`
- **When** any verdict step fails its completion check
- **Then** the classifier is bypassed: `prd_audit`'s existing fresh-blocking short-circuit
  (`conductor.ts:2128`) is unchanged, `architecture_review_as_built` and `build_review` burn retries
  and route only at `step_failed` exactly as before, and no `retry_decision` event is emitted
- **And** an absent/malformed/unknown-key `retry_routing` block resolves to the documented default
  (`enabled: true`), with an unknown key rejected by config validation.

## Story 6 — Routed halt names the unchanged input, not "retries exhausted" (observability)

As an operator triaging a halt, the halt reason tells me WHAT never changed.

- **Given** an `identical-repeat` route that, after `planRemediation`, dead-ends in a HALT (e.g. a
  DECIDE-target route caught by #644's guard, or #648's zero-progress escalation)
- **When** the loop halts
- **Then** the HALT reason/`loop_halt` includes the unchanged-input note (HEAD sha unchanged at `<sha>`;
  `<artifact>` unchanged since attempt N) rather than the generic "retries exhausted" message.

## Story 7 — prd_audit behaviour is preserved, not duplicated (regression)

As the daemon engine, the existing prd_audit fresh-blocking short-circuit continues to route on try 1,
whether via the generalized classifier (flag on) or the original short-circuit (flag off).

- **Given** daemon mode and a fresh blocking `.pipeline/prd-audit.md`
- **When** the completion check fails on attempt 1
- **Then** the retry loop breaks on try 1 and routes exactly as today (single, not double, evaluation
  of `classifyPrdAuditGaps`), with no behavioural change to the prd_audit routing at `step_failed`.

# ADR: Kickback event emission completeness + log-line prominence

**Status:** APPROVED (amended 2026-07-04: front-half cap enforcement added at conflict-check; re-approved by operator)
**Date:** 2026-07-04
**Feature:** daemon-logs-surface-kickback-steps-visibly (jstoup111/ai-conductor#240)

## Context

Backward pipeline motion is under-observable in the daemon log:

1. The `kickback` event renders as `· ↩ kickback: <from> re-opened <to> — <evidence> (×N)`
   with the same dim `·` chrome as routine step lines (`daemon-cli.ts` renderDaemonEvent) —
   indistinguishable at a glance, and the durable `.daemon/daemon.log` is ANSI-stripped, so
   color cannot carry prominence there.
2. DECIDE-phase amendment kickbacks (conflict-check/stories writing a kickback verdict onto
   `architecture_review`/`prd`, per adr-2026-06-29-architecture-before-stories-convergent-kickback)
   emit **no event at all**: `advanceTail` returns before its kickbackTargets scan for any step
   earlier than the first loopGate (`conductor.ts:1869-1871`). The verdict is acted on later —
   silently — when the selector engages at `build`. A side effect verified during review: the
   per-gate kickback cap is only **counted** in the tail scan, so front-half re-opens are today
   neither logged nor counted toward the anti-ping-pong cap.
3. `navigation_back` (operator-initiated checkpoint "back") falls through the renderer's
   silent default case.

## Decision

**Observability plus one bounded enforcement completion.** Routing (which step runs next on
the happy path) is unchanged; the single behavior change is extending the existing
anti-ping-pong cap — already approved policy in
adr-2026-06-29-architecture-before-stories-convergent-kickback ("the existing per-gate
kickback cap applies to the new targets") — to front-half-detected re-opens, closing that
ADR's implementation gap. Specifically:

1. **Prominent line format (structural, not color-only).** The kickback line drops the dim `·`
   chrome and renders undimmed bold yellow with an uppercase tag:
   `↩ KICKBACK: <from> re-opened <to> — <evidence> (×<count>)`.
   The uppercase `KICKBACK` token is the prominence carrier in the ANSI-stripped file log and
   the grep anchor. `test/engine/daemon-render.test.ts` remains the byte-exact format contract.
2. **Front-half emission at detection time, with cap enforcement.** After a front-half step
   completes, `advanceTail` scans kickbackTargets for verdicts with
   `kickback.from === <completed step>` **before** its front-half early return, increments
   the shared per-gate kickback count, and emits the same `kickback` event shape. If the
   count exceeds `MAX_KICKBACKS_PER_GATE`, the run HALTs exactly as the tail scan does
   (write `.pipeline/HALT`, surface the remediation PR, emit `loop_halt` → the ✋ line);
   otherwise the scan still returns null — linear advance unchanged, no `navigateBack`.
   Detection time is chosen over effect time (when the selector later routes back) because
   the semantic event — "conflict_check re-opened architecture_review" — is true the moment
   the verdict lands, and that is when an operator watching DECIDE needs to see it. Exactly
   one emission per verdict: the tail scan must not re-emit a front-half-origin kickback it
   did not detect (`from` never equals the tail step for those, which already guarantees
   this). The counter is one per gate across both scans, so front-half and tail re-opens of
   the same gate accumulate toward the same cap.
3. **`navigation_back` renders** with its own marker (visually distinct from engine-initiated
   kickback, e.g. `↰ BACK: <from> → <to> (operator)`) so operator-driven backward motion is
   also visible; exact glyph/format settled in stories against the renderer test contract.
4. **Event shape unchanged.** The existing `ConductorEvent` `kickback` variant
   (`from`, `to`, `evidence`, `count`) is reused verbatim; consumers (OTel exporter per
   adr-014-otel-observability-exporter, dashboard) see more complete data, no schema change.

**Out of scope:** any change to when the selector actually routes back to a front-half gate
(non-exceeded amendment kickbacks still advance linearly until `build` engages the selector,
exactly as today).

*Amendment note (2026-07-04):* the first approved revision deferred front-half cap
enforcement to a follow-up issue; conflict-check surfaced this as a degrading conflict with
decide-pipeline-restructure S8 ("cap exceeded → HALT"), and the operator resolved it by
expanding scope to enforce the cap in the front half — closing adr-2026-06-29's
implementation gap in this feature instead of deferring it.

## Consequences

- Every backward move — tail kickback, SHIP remediation route, rebase invalidation,
  DECIDE amendment, operator back-navigation — produces exactly one prominent, greppable
  log line; `renderDaemonEvent` stays the single choke point.
- The durable log gains a stable `KICKBACK` grep anchor; any external tooling grepping the
  old lowercase `kickback:` line must be updated (only known consumer is the renderer test).
- Front-half kickback counts become accurate in the ×N display, and an oscillating DECIDE
  amendment loop now HALTs at the same cap as tail oscillation — adr-2026-06-29's
  cap-applies-to-new-targets policy is fully enforced for the first time. A daemon run that
  previously spun silently through DECIDE amendments will now stop for a human; that is the
  intended behavior per the earlier ADR, not a regression.

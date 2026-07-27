# ADR: One kickback-phase policy, consulted at both backward-navigation seams

**Status:** APPROVED
**Date:** 2026-07-27
**Issue:** jstoup111/ai-conductor#551
**Track:** technical (no PRD)
**Tier:** M
**Architecture:** `.docs/architecture/2026-07-27-daemon-mode-kickbacks-route-human-judgment-gaps-in.md`

## Context

The engineer owns DECIDE; the daemon builds merged specs (ADR-008). In autonomous mode the
conductor must never re-author operator-approved DECIDE artifacts in response to its own
downstream findings.

The conductor has **two** independent seams that move the run index backward:

1. **`planRemediation`** (`conductor.ts:1655`) — `/remediate` writes dispositions;
   `earliestRemediationTarget` picks a target from
   `REMEDIATION_TARGET_STEPS = ['build','acceptance_specs','architecture_review','plan']`.
   Two of those four are DECIDE. **This seam is already guarded**: #644 added an inline
   `this.daemon && targetPhase === 'DECIDE' → halt` check at `conductor.ts:1722-1737`.
2. **`scanKickbackVerdicts`** (`conductor.ts:6189`) — any gate may persist a verdict of shape
   `{satisfied:false, kickback:{from, evidence}}` onto an upstream gate; the scan then
   `navigateBack`s to it. Its target set is `topo.kickbackTargets`, and `kickbackTarget: true`
   is set on exactly four steps — `prd`, `architecture_review`, `stories`, `plan` — **all four
   DECIDE-phase** (`steps.ts:61, 85, 96, 117`). **This seam has no daemon gate and no phase
   gate whatsoever.**

So the rule the operator believes is enforced is enforced on one of two paths. The daemon's
DECIDE preseed (`PRESEEDED_DONE`, `daemon-cli.ts:288`) does not cover the gap either: it is a
*forward*-walk guard, and `navigateBack` resets the target to `pending`, undoing the preseed
before `selectNextGate` picks it up from `topo.regionStart` (which is itself the first
kickbackTarget — a DECIDE step).

## Decision

**Extract one pure predicate and consult it at both seams.**

Add `src/conductor/src/engine/kickback-policy.ts` exporting a pure, I/O-free function of the
shape:

```ts
export type KickbackDisposition =
  | { kind: 'route' }
  | { kind: 'halt'; reason: string };

export function decideKickbackDisposition(input: {
  target: StepName;
  steps: StepDefinition[];
  daemon: boolean;
}): KickbackDisposition;
```

Rule: `daemon === true && phaseOf(target) === 'DECIDE'` → `halt`; otherwise `route`.
Phase is resolved from the passed `steps` table, never from a hardcoded name list, so a
config-added custom DECIDE step or a future `kickbackTarget` is covered without edits.

Consult it at:
- **`planRemediation`** — replacing the inline #644 check. Behavior-identical; the existing halt
  detail string and `{kind:'halt'}` return shape are preserved so #644's coverage stays green.
- **`scanKickbackVerdicts`** — new coverage, evaluated **after** the existing counter bump,
  `kickback` event emit and `MAX_KICKBACKS_PER_GATE` cap check, and **before** `navigateBack`.

The new halt is written with `writeHaltMarker(body, 'needs-human')` — never a bare `writeFile` —
and follows the canonical emit pair the rest of the conductor uses: marker → `writeState` →
`surfaceRemediationPr(reason)` → `emit({type:'loop_halt', reason, prUrl})`.

### Why `needs-human` specifically

`rekickSweep` skips a `needs-human` halt on **every** sweep and never clears it
(`daemon-rekick.ts:173-193`), whereas an `unclassified` halt (what the four legacy
`writeFile`-direct sites produce) is mechanically re-kickable. A guard whose halt the daemon
auto-clears is not a guard. This is the single most load-bearing detail in the change.

### Ordering: cap first, phase second

The cap check must stay first so outcome 4 ("existing kickback caps / anti-ping-pong behavior
preserved") holds unchanged on the interactive path, and so a daemon run that trips the cap
still reports the *ping-pong* reason rather than being masked by the phase reason.

## Consequences

- The invariant "in daemon mode the index never moves backward into DECIDE" becomes true of the
  whole engine rather than one of two code paths, and is expressed once.
- The front-half `scanKickbackVerdicts` call site (`conductor.ts:6420`, `navigate:false`) also
  gains the guard. That is correct and intentional: the front half is DECIDE territory, so in
  daemon mode reaching it at all is already anomalous, and halting there surfaces the anomaly
  instead of deferring it to the tail.
- Interactive `/conduct` is untouched — every existing kickback test that constructs a
  `Conductor` **without** `daemon: true` (e.g. `test/integration/gate-loop.test.ts:224`
  "re-opens plan on kickback", `:479` front-half amendment suite) must remain green unmodified.
  Their continued passing is the regression proof for outcome 3.
- Deterministic kickbacks (`manual_test`, `test_suite`, `wiring_check`, non-completeness
  `build_review`) hardcode `build` and are unaffected — outcome 2 holds by construction.
- A daemon feature with a genuine architectural gap now stops instead of drifting. That is a
  throughput cost paid deliberately: the operator resolves it, clears the HALT, and #532's
  verdict-aware resume clamp re-enters at the earliest unsatisfied gate rather than re-walking.

## Alternatives considered and rejected

**Wire `selector.ts`'s existing `loopGatesOnly` clamp in daemon mode.** The flag is declared
(`selector.ts:40`), implemented (`:98`) and documented (`:84`) but **set by no caller in the
repo**. Wiring it would make the selector *skip* DECIDE targets — the kickback verdict stays
unsatisfied on disk and the finding silently evaporates, with no halt and no operator signal.
Outcome 1 requires a HALT carrying the gap ledger. Rejected.

**Strip `kickbackTarget: true` from the four DECIDE steps when `daemon`.** Same evaporation
failure — the verdict no longer matches any target and is ignored — plus it mutates shared step
topology, risking the interactive amendment kickbacks that ADR 2026-06-29 deliberately added.
Rejected.

**Enforce inside `navigateBack`.** Wrong seam: `navigateBack` is also the mechanism for the
rebase-invalidation re-open (`conductor.ts:4203-4238`) and every deterministic BUILD kickback.
Guarding there would either need the same phase test anyway or would over-block. Rejected.

**Leave it to `/remediate`'s prompt-level halt categories.** Forbidden by this repo's Design
Principle (deterministic where machinery can do it) and by the issue itself. It is also lossy:
`readRemediationPlan` drops any `halt` gap whose `category` is not one of
`architectural-clarity | product-scope` (`artifacts.ts:2888-2894`) — and `skills/remediate/SKILL.md`
still documents a third category, `unanswerable`, which is therefore silently discarded.
Rejected. (The category mismatch is a real latent bug but is out of scope here — noted for
follow-up.)

**Couple to #550's forward-walk seam, as the intake hypothesized.** #550's guard is
`PRESEEDED_DONE`, a *status preseed* in `daemon-cli.ts`, not a dispatch predicate. The only
thing the two share is the `phase === 'DECIDE'` test. Coupling them would join a CLI-layer
bootstrap concern to an engine-layer routing concern for no gain. The intake's hypothesis is
recorded as a candidate and **not adopted as stated**; its spirit — "one rule, two call sites" —
is adopted against the kickback seams instead.

## Assumptions (verify-claims)

| # | Assumption | Confidence | If wrong |
|---|---|---|---|
| A1 | A SHIP-phase gate does in practice emit a kickback verdict aimed at a DECIDE target in a real daemon run | 70% inferred | The guard is defensive-only; still required as an engine-enforced invariant, and the issue specifies test-injected observability, so nothing is blocked |
| A2 | `needs-human` is never auto-cleared by any sweep | 90% verified (`daemon-rekick.ts:173-193`) | The guard could be auto-cleared and the daemon would proceed into DECIDE anyway — pinned by a dedicated negative-path story |
| A3 | No production caller sets `loopGatesOnly`, so leaving it unwired changes nothing | 90% verified (repo-wide grep) | If some caller does set it, DECIDE targets are already skipped and the halt would be unreachable |

None of these blocks the build: A1 is observability-only, A2 and A3 are verified and are each
pinned by a story acceptance criterion.

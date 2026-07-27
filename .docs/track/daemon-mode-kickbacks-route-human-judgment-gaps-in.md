# Track: daemon-mode kickbacks must HALT instead of re-running DECIDE (#551)

Track: technical

**Date:** 2026-07-27
**Stem:** daemon-mode-kickbacks-route-human-judgment-gaps-in
**Source:** `jstoup111/ai-conductor#551` (intake)

## Track decision

**Technical.** No user-facing product surface, no new FRs, no PRD. The change is an
engine-internal routing rule in the conductor's gate loop: which step a daemon-mode kickback
is permitted to target, and what happens when it targets a forbidden one. Acceptance criteria
live in the stories file.

## Problem statement (from the intake, restated)

In autonomous (daemon) mode the conductor can re-open a DECIDE-phase step in response to its
own downstream review findings. DECIDE artifacts (PRD, ADRs, stories, plans) are
operator-approved by design — the engineer owns DECIDE, the daemon only builds merged specs
(ADR-008). A daemon that re-authors them unattended is silent scope drift with an audit trail
that looks legitimate.

## Desired outcomes (from the intake)

1. Engine-enforced (not prompt-classified): in daemon mode, a kickback/remediation whose target
   step is DECIDE-phase produces a HALT carrying the gap ledger, not a step dispatch.
2. BUILD-phase targets (`build`, `acceptance_specs`) stay autonomous.
3. Interactive `/conduct` kickbacks unchanged.
4. Existing kickback caps / anti-ping-pong behavior preserved on the interactive path.
5. Negative path: a HALTed DECIDE-kickback, once resolved by a human, resumes at the right step
   without re-walking.

## Discovery findings (verified by reading the source, 2026-07-27)

All line references are against `src/conductor/src/` at
`spec/daemon-mode-kickbacks-route-human-judgment-gaps-in` base.

### The routing seams — there are exactly two, and only one is guarded

The conductor re-opens an upstream step through two independent paths:

**Path A — LLM-planned remediation (`planRemediation`, `conductor.ts:1655-1766`).**
`/remediate` writes `.pipeline/remediation.json`; `readRemediationPlan`
(`artifacts.ts:2871`) parses it; `earliestRemediationTarget` (`conductor.ts:7103`) picks the
earliest target among the routable fixes; the caller then `navigateBack`s to it.

> **This path is ALREADY GUARDED.** `conductor.ts:1722-1737` carries the #644 guard:
> ```ts
> // #644: DECIDE is operator-only in daemon mode.
> const targetPhase = steps.find((s) => s.name === target)?.phase;
> if (this.daemon && targetPhase === 'DECIDE') {
>   return { kind: 'halt', detail: `autonomous remediation would rewind to DECIDE step '${target}' — human gate required ...` };
> }
> ```
> Confidence **95% (verified — read directly)**. So outcome 1 is *partially* delivered
> already, for remediation dispositions only.

**Path B — verdict-driven kickbacks (`scanKickbackVerdicts`, `conductor.ts:6189-6231`).**
Any gate step may write a verdict of shape `{satisfied:false, kickback:{from, evidence}}` onto
an upstream gate (`gate-verdicts.ts:44-50`, persisted to `.pipeline/gates/<step>.json`).
`scanKickbackVerdicts` walks `topo.kickbackTargets`, bumps the per-gate counter, emits the
`kickback` event, HALTs past `MAX_KICKBACKS_PER_GATE`, and otherwise calls
`navigateBack(state, target, steps)`.

> **This path has NO daemon or phase gate at all.** And every one of its possible targets is
> DECIDE-phase: `kickbackTarget: true` is set on exactly four steps — `prd` (`steps.ts:61`),
> `architecture_review` (`:85`), `stories` (`:96`), `plan` (`:117`). Confidence **95%
> (verified)**.

Call sites: `conductor.ts:6420` (front half, `navigate:false` — observe only) and
`conductor.ts:6473` (tail, `navigate:true` — the one that actually rewinds).

### Why the daemon's existing DECIDE preseed does not already prevent this

The daemon marks DECIDE steps done before the loop starts (`PRESEEDED_DONE`,
`daemon-cli.ts:288-296`; `preseedStepStatuses`, `:303`). That is the **forward-walk** guard
(#550's territory). It does not survive a **backward** rewind: `navigateBack`
(`conductor.ts:336`) sets the target back to `pending` and cascade-stales its downstream
(`state.ts:166-183`), after which `selectNextGate` scans from `topo.regionStart` — which
`deriveGateTopology` (`conductor.ts:250`) sets to the first `kickbackTarget`, i.e. a DECIDE
step — and dispatches it. Confidence **85% (inferred from the three functions read
end-to-end; no live daemon repro run)**.

### The one clamp that would have helped is dead code

`selector.ts:40` declares `loopGatesOnly?: boolean` and `:98` implements it
(`if (loopGatesOnly && !step.loopGate) continue;`) — documented at `:84` as the "resume entry
only re-enters the looped region (build onward), skipping DECIDE-phase kickback targets"
clamp. **No caller anywhere in the repo sets it** (grep: the only four hits are the four lines
inside `selector.ts` itself). Confidence **90% (verified by repo-wide grep)**. So it neither
mitigates the bug today nor can be cited as the fix without wiring it.

### Deterministic kickbacks are already safe

`manual_test` (`conductor.ts:2464`), `test_suite` (`:4973`), `wiring_check` (`:5236`) and
non-completeness `build_review` (`build-review-disposition.ts:253`) all hardcode `build` as the
target — BUILD-phase, which outcome 2 says must stay autonomous. No change needed, but they are
the reason a blanket "no backward navigation in daemon mode" rule would be wrong.

## Assumption ledger (verify-claims)

| # | Assumption | Confidence | Impact if wrong | How to confirm |
|---|---|---|---|---|
| A1 | Path B is reachable in a real daemon run (a SHIP-phase gate does write a kickback verdict aimed at a DECIDE target) | 70% inferred | If unreachable, the fix is defensive-only and the issue is nearly closed by #644 | Grep daemon logs for `kickback` events with `to` in {prd, architecture_review, stories, plan}; or drive `Conductor` with a seeded verdict in a test |
| A2 | The intake's hypothesis (share #550's forward-walk seam) is **wrong** as literally stated | 85% verified | Wasted refactor coupling two unrelated mechanisms | #550's guard is `PRESEEDED_DONE` in `daemon-cli.ts` (a status preseed), not a dispatch predicate; nothing to share but the `phase === 'DECIDE'` test |
| A3 | Reusing the existing `HALT` marker + `HaltClass: 'needs-human'` is the right halt vehicle | 80% inferred | A halt the daemon auto-rekicks (rekick skips `needs-human`, `daemon-rekick.ts:172`) would defeat the whole guard | Confirmed by reading `halt-marker.ts` + `daemon-rekick.ts`; needs a test asserting the class sidecar is written |

**A1 is load-bearing and is resolved in favor of building anyway**: even at 70%, the guard is
required by outcome 1 as an *engine-enforced invariant*, and the issue explicitly specifies the
observability as "injecting an architectural-gap disposition in a daemon-mode test and watching
HALT" — i.e. a test-injected verdict, not a field repro. No operator gate is blocked on A1.

## Chosen approach

**One shared predicate, two call sites** — which is the intake's hypothesis in spirit, but
against the *kickback* seam rather than #550's preseed seam (A2).

Extract the phase test currently inlined at `conductor.ts:1729` into a small pure module
(e.g. `engine/kickback-policy.ts`) exporting something like
`decideKickbackDisposition({ target, steps, daemon }) → { kind: 'route' } | { kind: 'halt', reason }`,
then consult it from **both** `planRemediation` (replacing the inline check, behavior-identical)
and `scanKickbackVerdicts` (new coverage, before the `navigateBack`). The halt writes the marker
via `writeHaltMarker(..., 'needs-human')` — not a bare `writeFile`, which four existing sites do
and which leaves no `HALT.class` sidecar so `daemon-rekick` treats them as re-kickable.

### Alternatives weighed and rejected

- **Wire `selector.ts`'s dead `loopGatesOnly` clamp in daemon mode.** Rejected: it silently
  *skips* the DECIDE target rather than halting, so the human never learns a gap was found —
  the finding evaporates. Outcome 1 demands a HALT carrying the gap ledger.
- **Strip `kickbackTarget: true` from the four DECIDE steps when `daemon`.** Rejected: it makes
  the kickback verdict unmatched and therefore silently ignored — same evaporation problem, and
  it would also disable the interactive path's legitimate amendment kickbacks if the topology is
  shared.
- **Leave it to `/remediate`'s prompt-level halt categories.** Rejected by this repo's Design
  Principle (deterministic where possible) and by the issue itself; also `readRemediationPlan`
  drops any halt gap whose `category` is unrecognized (`artifacts.ts:2888-2894`), so the prompt
  path can lose a halt entirely.

## Out of scope

- #550's forward-walk dispatch guard (separate issue, separate seam).
- The per-`run()` in-memory kickback counters resetting on each daemon dispatch (#989).
- Normalizing the four `writeFile`-direct HALT sites that skip `writeHaltMarker` — noted as a
  follow-up, not required here beyond using the helper for the new halt.

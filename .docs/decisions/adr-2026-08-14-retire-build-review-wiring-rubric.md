# ADR: The build_review wiring rubric is retired

**Date:** 2026-08-14
**Status:** APPROVED (operator-directed, 2026-08-14)
**Deciders:** James Stoup (operator)
**Supersedes:** `adr-2026-08-11-wiring-judged-in-build-review` (the Wiring rubric item only)

## Context

`adr-2026-08-11-wiring-judged-in-build-review` deleted the `wiring_check` probe machinery and moved
static reachability judgement into `build_review` as a fifth rubric item. The step itself became a
deprecated no-op, retained for topology compatibility by
`adr-2026-08-11-deprecated-no-op-step-retirement`.

Three months of operation show the relocated judgement does not earn its cost.

**It fails on refactored code, which is the normal case.** The rubric asks whether every new or
changed production surface is reachable from a fixed `wiring.entry_points` list. `simplify` runs at
every batch boundary and legitimately moves call paths; a surface that was reachable before the
refactor is judged unreachable after it. The rubric cannot distinguish "never wired" from "wired
somewhere the entry-point list does not enumerate".

**Its failures route out of BUILD.** The grader phrases wiring findings as planning omissions — "the
plan declares no intentional later-feature scaffolding", "no scaffolding waiver" — which reads
directly into `remediate`'s `plan` disposition ("in scope but the plan simply omitted"). On
2026-08-14, three of four features halted `needs-human` on a DECIDE-entry refusal whose only
DECIDE-routed gap was `wiring`; every other rubric's gaps routed to `build` correctly. The routing
rule in `skills/remediate/SKILL.md` has listed "wiring bug with clear evidence → build" since #120
and did not hold, which is the prompt-discipline failure mode this repository's design principle
names.

**Its judgement is duplicated where it is sound.** `architecture-review`'s `## Wiring Surface`
section already declares, at DECIDE time, where each new production surface is reached from, and the
SHIP `--as-built` sweep independently verifies shipped code against approved architecture. Both are
authoritative on their own terms and neither depends on the BUILD-time rubric.

## Decision

Remove Wiring from `build_review` entirely. The gate scores four rubric items — Tautology, Scope,
Root cause, Completeness — under the same all-or-FAIL rule.

- The grader prompt no longer describes a Wiring item and no longer receives entry points. It states
  explicitly that reachability is not judged, so a grader cannot reintroduce the item from memory.
- `rubric.wiring` and `findings.wiring` leave the `.pipeline/build-review.json` contract. Unknown
  keys in a stored verdict are ignored rather than rejected, so an in-flight artifact written before
  this change still parses.
- The `findings.wiring`-required-when-`rubric.wiring`-is-true validation rule retires with the item;
  it never applied to any other rubric.
- `wiring.entry_points` leaves `.ai-conductor/config.yml` and the `HarnessConfig` type. The `wiring`
  key stays on the accepted-key list, ignored, so an existing consumer config does not hard-fail on
  upgrade — the same fail-open reasoning `adr-2026-08-11-deprecated-no-op-step-retirement` applied to
  the step name.

`wiring_check` remains a deprecated no-op. Nothing here changes it: removing the name would
reintroduce the `Unknown step` hazard that ADR exists to prevent.

## Consequences

- A production surface no configured entry point reaches now passes `build_review`. That is the
  intended change: reachability is a design-time and SHIP-time concern, not a per-diff BUILD gate.
- The `wiring`-shaped `needs-human` halts stop. Gaps that remain are genuinely buildable and route to
  `build`.
- Coverage that used the wiring key incidentally — as the stand-in for "the newest required rubric
  key" when proving a legacy verdict is rejected — is repointed at `completeness`, which is now that
  key. The fail-closed intent is preserved.
- `architecture-review`'s `## Wiring Surface` section is untouched and remains a Medium/Large tier
  DECIDE requirement. Whether it survives its own cost-benefit review is a separate decision.

> **Amended 2026-08-22 by #1805:** rubric membership is now the registry with test-quality as the only member (default off), an empty enabled set is a valid no-dispatch PASS, and retired rubric keys are accepted as no-ops; four-rubric enumerations here narrow to the registry (adr-2026-08-22-build-review-opt-in-rubric-container).

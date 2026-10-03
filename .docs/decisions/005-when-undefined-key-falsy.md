# ADR 005: Undefined `${state_key}` in `when:` Evaluates Falsy

**Date:** 2026-04-19
**Status:** APPROVED

## Context

The `when:` DSL (ADR-004) supports `${state_key} == value` to gate steps on `conduct-state.json` contents. A config author can typo a key (`${bootstap_mode}` instead of `${bootstrap_mode}`). Two reasonable behaviors exist:

- **Strict:** Throw `WhenEvaluationError` at dispatch time — fails fast, surfaces typos loudly.
- **Lenient:** Evaluate to `false` — step is skipped, a `when_skip` event records the undefined key.

Strict is the typical "fail loud" choice. Lenient is the typical "graceful degradation" choice. For a workflow tool used during long-running feature development, the cost of a strict failure mid-pipeline (work halts, user has to fix config and resume) is higher than the cost of a silent skip — because the silent skip is **fully observable** via the event bus and state file.

## Decision

`when: ${nonexistent_key} == value` evaluates to `false`. The step is skipped. A `when_skip` event is emitted with `{ step, condition, undefinedKey: 'nonexistent_key' }`. The state file records `step: "skipped"`. Downstream gate checks treat skipped as satisfied (per ADR-004).

> **Decision index (backfilled 2026-10-03, #2140).** Additive citable ids over the approved text above;
> no change of substance. Each id names a decision exactly as already stated above.
>
> **D1** — `when: ${nonexistent_key} == value` evaluates to `false` and the step is skipped (above: "`when: ${nonexistent_key} == value` evaluates to `false`")
> **D2** — A `when_skip` event is emitted with `{ step, condition, undefinedKey }` and the state file records `step: "skipped"` (above: "A `when_skip` event is emitted")
> **D3** — Downstream gate checks treat skipped as satisfied, per ADR-004 (above: "Downstream gate checks treat skipped as satisfied")

## Consequences

- **Pro:** Long-running pipelines are not derailed by a config typo. The skip is recorded and visible to anyone watching the event log or terminal renderer.
- **Pro:** Idempotent "first run" semantics: a state key that hasn't been set yet (e.g., `${first_build_completed} == true` on the very first build) cleanly evaluates false — no need to seed default state.
- **Con:** Typos can silently disable steps. **Mitigation:** the `when_skip` event payload includes `undefinedKey: <name>`, which the terminal renderer surfaces in human-readable form ("Step X skipped — undefined state key: bootstap_mode"). A reviewer scanning the event log will see the typo on first run.
- **Con:** No way to express "fail if key is undefined." If that becomes a requirement, a future grammar addition `${key!}` (strict marker) can be added without breaking this default.

## Evidence

- Existing harness behavior under bash conductor: missing optional config keys default to falsy/empty rather than throwing. Consistent with that precedent.
- The `when_skip` event with `undefinedKey` is testable (Plan D includes the test case at `wave-b-conditional-parallel.md` line 26).

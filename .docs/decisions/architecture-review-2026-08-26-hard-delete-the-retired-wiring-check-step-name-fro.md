# Architecture Review: Hard-delete the retired wiring_check step name
**Date:** 2026-08-26
**Stories reviewed:** none yet (pre-stories DECIDE pass, technical track, M tier — lightweight mode)
**Verdict:** APPROVED WITH CONDITIONS

Second phase of `adr-2026-08-11-deprecated-no-op-step-retirement` (issue #1896). Scope boundary
(binding, from `.docs/track/`): complete excision — registry, group, event unions, all call sites,
tests, docs. Operator exclusions: no dead-config-key warning; no conduct-state tolerance machinery.

## Feasibility

All verified against this worktree's HEAD (delegated survey, file:line cites in the amendment
notes and conditions below).

- **`StepName` union removal fans out at compile time** (verified, 98%): deleting the member at
  `types/steps.ts:18` breaks every exhaustive `Record<StepName, …>` (`resolved-config.ts:28,64`;
  `provider-model-policy.ts:32,61,90`; `model-table-metadata.ts:5,23`; `artifacts.ts:316` +
  derived `:415-423`) and every literal comparison (`conductor.ts:6124,7401,7916`;
  `step-runners.ts:738`; `daemon-cli.ts:2360`) until each site is deleted. Partial maps
  (`artifacts.ts:2360→3343-3345`, `gate-verdicts.ts:154`, `skill-invocation.ts:12`,
  `selector.ts:25`, `ui/dashboard-snapshot.ts:10`) need an explicit grep pass — they will not
  error.
- **Resume on stale state is already safe** (verified): `readState` does no schema validation;
  the resume walk iterates the registry (`conductor.ts:5144`, `findResumeIndex`
  `conductor.ts:11921-11946`), never state keys. A leftover `"wiring_check": "done"` or
  `"build_verification__wiring_check"` key is an inert orphan; a stale
  `.pipeline/gates/wiring_check.json` enters `readAllVerdicts` but no registry iteration touches
  it. The `Unknown step` hazard the retirement ADR feared does not materialize on resume at
  current HEAD. Two committed fixtures already encode stale-key state.
- **Consumer config takes the ordinary unknown-key path** (verified): once the name leaves
  `ALL_STEPS`, a `steps.wiring_check:` block classifies as a custom-step declaration
  (`config.ts:475-493,550`) and fails config load with `Custom step "wiring_check" requires
  'after: <existing-step>'` (`config.ts:657-659`) → `Config error` + exit 1. This is the
  operator-decided behavior — same path as any typo; no special diagnostic is added.
- **Width-1 reality** (verified): the parallel lane runs only when `dispatchable.length > 1`
  (`conductor.ts:6064`). With `test_suite` alone, the lane — `parallel_started/completed` for
  `build_verification`, synthetic `build_verification__*` keys, `build_member_evidence_*`
  emission (`conductor.ts:6369,6377`), the deterministic-failure classification
  (`conductor.ts:6387-6503`), and `reverifyDoneBuildMembers` (`conductor.ts:6026-6028`) — is
  unreachable whether the group is kept one-member or dissolved. Keeping a one-member group buys
  nothing; **dissolve it** (drop `steps.ts:350,375` and the four
  `builtinGroup.name === BUILD_VERIFICATION_GROUP.name` branches).

## Alignment

Full repo-wide ADR sweep (all 510 files in `.docs/decisions/`) run; binding set:

- `adr-2026-08-11-deprecated-no-op-step-retirement` — **complies**; this change IS its owed
  phase 2. Its gate is evidenced, not assumed: four live-state surfaces checked (conduct-state
  keys — resume-safe per above; consumer config — ordinary fail-closed path per operator
  decision; kickback-ledger `gates.wiring_check` objects — condition C3; `parallel:wiring_check`
  execution keys in `events.jsonl` — condition C3). Union narrowing at `types/events.ts` is
  pre-authorized by this ADR as a phase-2 simplification.
- `adr-2026-08-14-retire-build-review-wiring-rubric` — its "removing the name would reintroduce
  the `Unknown step` hazard" sentence affirmatively forbade this; the hazard is spent (resume
  verified safe). **Amended** (additive note, this date).
- `adr-2026-07-29-deterministic-build-verification-fanout` — defines the two-member group.
  **Amended** (additive note): group dissolved; its join/single-writer/no-review-on-failure
  semantics survive via the serial path under conditions C1/C2.
- `adr-2026-08-03-build-repair-member-reuse-validity` — after a repair, every non-skipped
  verification member re-dispatches. The group lane that implemented this dies → condition C1.
- `adr-2026-07-26-event-sink-registry-exhaustiveness` — deleting the `deprecated_step`-adjacent
  and `build_member_evidence_*` event variants requires deleting their `EVENT_SINKS` keys in the
  same change (compile-enforced) → condition C4.
- `adr-2026-07-20-post-rebase-delta-aware-invalidation` — `applyRebaseVerdicts` invalidation set
  must drop `wiring_check` in the same change → condition C4.
- `adr-2026-07-03-generated-model-table-single-source` — drop the `STEP_RATIONALE` /
  `MODEL_FREE_ENGINE_STEPS` entries and regenerate HARNESS.md's table (integrity check 5a) →
  condition C4.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` — `rewind --to wiring_check`
  failing by name post-deletion is the intended behavior; persisted `last_step: wiring_check`
  stays readable (state reads are untyped) — complies.
- Enumeration-prose-only references (`adr-2026-08-04`, `adr-2026-07-21-s-tier`, `adr-2026-08-12`,
  `adr-2026-08-19-tree-attesting`, `adr-2026-07-22`, others) — no conflict; no edits required
  beyond the deletion itself.
- `types/steps.ts:108 deprecated?` field and `conductor.ts:7401` suppression branch lose their
  only user — delete both (the `steps.ts:166` pointer cites `adr-2026-08-11-wiring-judged-in-
  build-review`, a file absent from `.docs/decisions/`; deletion also removes that dangling
  reference).

## Wiring Surface

This feature introduces **no new production surface** — it is pure deletion. The surfaces it
removes are: the registry entry, the group, the serial-ladder arm + `runWiringCheckStep`, the
step-runner guard, the completion predicate, config/policy/model-table entries, the events-union
literals, and the daemon-cli renderer arm. The one behavioral relocation: `test_suite` becomes the
sole BUILD verification, reached via the existing serial dispatch ladder (`conductor.ts:7916+`) —
an already-wired production path, not a new one. Overlap scan: see `.pipeline/` notes; advisory.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Build-repair re-verification of test_suite silently lost with the group lane | Technical | Medium | High | Condition C1 — verify serial equivalence or port; acceptance test |
| Deterministic test_suite failure no longer classified for gate-repair/kickback budget | Technical | Medium | High | Condition C2 — show serial `retainedFullSuiteFailure` path equivalent; acceptance test |
| Persisted kickback-ledger `gates.wiring_check` / `parallel:wiring_check` execution keys unreadable under narrowed types | Data | Low | Medium | Condition C3 — lenient reads verified by test over a committed fixture |
| Partial `Record<StepName>` maps retain dead keys silently | Technical | Low | Low | Explicit grep pass in plan (C4) |
| Merged spec races the 3 in-flight worktrees still naming the step | Integration | Low | Low | Resume verified safe; landing note only — no machinery (operator decision) |

## ADRs Created

None — both structural decisions are owned by existing APPROVED ADRs, amended additively:

- `adr-2026-08-14-retire-build-review-wiring-rubric` — amendment note lifting the deletion
  prohibition (hazard verified spent).
- `adr-2026-07-29-deterministic-build-verification-fanout` — amendment note dissolving the group
  and re-anchoring its surviving semantics on the serial path.

## Conditions

- **C1 (build-repair re-verification, adr-2026-08-03):** the plan MUST verify that after a BUILD
  repair, a previously-`done` `test_suite` is re-run on the serial path, or port the
  `reverifyDoneBuildMembers` semantics there; covered by an acceptance test.
- **C2 (deterministic-failure classification, adr-2026-07-29):** the plan MUST show the serial
  test_suite failure path preserves gate-repair recording + kickback-budget consumption
  equivalent to `conductor.ts:6387-6503`, or port it; covered by an acceptance test.
- **C3 (historical-state readability):** a test over committed fixtures proves a kickback ledger
  with a `gates.wiring_check` entry and an events ledger with `parallel:wiring_check` execution
  keys still load after the deletion.
- **C4 (same-change couplings):** event variants deleted together with their `EVENT_SINKS` keys;
  `applyRebaseVerdicts` invalidation set updated; model table regenerated (check 5a); explicit
  grep pass over Partial step-keyed maps; docs sweep (9 pages) in the same PR; migration block in
  the PR body for the consumer-visible `steps.wiring_check` config break.
- **C5 (landing note):** merge after the 3 in-flight worktrees naming the step ship or reset
  (operator decision; resume is verified safe, so this is hygiene, not a correctness gate).

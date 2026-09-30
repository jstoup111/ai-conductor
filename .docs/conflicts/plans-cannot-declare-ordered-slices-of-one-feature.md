# Conflict Check: Plans declare ordered slices of one feature (#2723)

**Date:** 2026-09-29
**Stories checked:** `.docs/stories/plans-cannot-declare-ordered-slices-of-one-feature.md` (Stories 1–8)
against all 508 other files in `.docs/stories/`
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus` in `.ai-conductor/config.yml`)
**Result:** Conflict check passed — 0 blocking, 0 degrading

## Method

- **Stories.** Every other stories file was grepped with about 35 patterns covering plan grammar,
  land-gate plan checks, `coverage_binding` envelope and reseal behavior, remediation appends,
  config validation and the consumer registry, the event sink registry, and the plan skill. About
  25 stories were opened in full or in their relevant sections. Every pair sharing a behavior,
  entity, field, or gate was tested in both directions ("if the new story is fully satisfied, does
  the old one still hold?", and the reverse).
- **ADRs.** All 325 `adr-*.md` files were read during this session's architecture-review sweep.
  - Examined for story comparison: the governing and constraining set.
    - `adr-2026-08-30-shared-plan-task-reference-resolver`
    - `adr-2026-07-05-engine-owned-task-status`
    - `adr-2026-08-31-coverage-binding-judge-step`
    - `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`
    - `adr-2026-07-26-daemon-decide-preseed-ownership`
    - `adr-2026-09-23-one-owner-for-accepted-story-readability`
    - `adr-2026-08-21-review-bound-by-plan-done-when-criteria`
    - `adr-2026-07-22-coherence-gate-placement-and-validation-split`
    - the event-sink and halt-event chain (`adr-2026-07-26` sink registry exhaustiveness,
      `adr-2026-08-11` halt events on the persisted spine)
    - `adr-2026-09-02-adr-decision-citability-contract`
    - `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`
    - `adr-2026-09-29-plan-slice-manifest`
  - Narrowed out: the remaining ADRs, whose subjects (providers, daemon hosting, telemetry
    backends, rebase, tmux, and so on) do not touch any behavior, entity, field, or gate in
    Stories 1–8. No ADR was excluded on supersession grounds.

## Conflicts

None.

## Near misses examined (compatible)

| Existing story / ADR | Why it is compatible |
|---|---|
| `enforce-the-plan-task-count-hard-stop-at-land`: a below-boundary plan lands "with no new required header" | Unsliced plans are untouched (Story 2). `MAX_PLAN_SLICES` and the task-count boundary are independent. |
| `record-land-gate-rejections-on-the-event-spine`: rejection identifiers form a closed set | Adding `plan-slices` to `LandGateIdentifier` is the prescribed extension (Story 4). |
| `coherence-artifact-passes-engineer-land-then-block` Story 2: discovery rejects what land rejects | That story is scoped to the coherence artifact. Discovery staying presence-only for plans is deliberate (ADR Decision 2, and preseed-ownership D3/D4). A plan that bypasses land is refused at `coverage_binding` (Story 7), so it fails closed. |
| #2088 and #1700 `coverage_binding` stories: the disabled path completes; refusals are needs-human pre-judge | The slice layer uses the same pre-judge needs-human refusal as the #1700 ADR layer. The completion statuses are unchanged, and the disabled-event count is unaffected. |
| #1700 Story 1 / Story 4: an invalidated envelope is not completion evidence, and prior digests survive | Membership is an additive optional field that survives invalidation. The completion-status set is unchanged (Story 7). |
| `remediation-task-ids-are-non-numeric-by-design-but`, `compose-sealed-content-and-engine-remediation-appe` | The `rem-` exemption uses the engine's own `isEngineAppendedRemediationTaskId`, the predicate every other plan validator already uses to attribute appended tasks. |
| `config-keys-that-validate-but-have-no-consumer-inc` Stories 2 and 5 | These stories explicitly allow a `none` declaration with a tracked reason. Story 1 names #2724 as the exit. |
| `non-daemon-projects-inherit-self-host-config-inste`: `templates/ai-conductor-config.yml.template` is byte-for-byte unchanged | Story 1 changes only `templates/project-config.yml.template`, and only with a commented entry. |
| The 18 stories declaring `EVENT_SINKS` rows | None pins the set. `plan_slices_changed` declares persist only (not audited by design, not otel), like its `coverage_binding_*` siblings. |
| `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` and the one-branch/one-PR stories | Nothing reads `stacked_prs.enabled` in this feature (Story 2). The reconciliation with these belongs to #2724/#2725 (ADR follow-up). |

## Notes carried to the plan (not conflicts)

- `resolvePlanTaskReference` splits on commas only. The strict Dependencies parser strips a
  leading `Task` or `Tasks` word from each segment before resolving it, as ADR Decision 4 states.
- A hand-authored heading with a `rem-` prefix is exempt from slice membership, just as the other
  validators already treat it as engine-appended. Tightening that predicate is out of scope.

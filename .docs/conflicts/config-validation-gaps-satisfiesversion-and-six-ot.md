# Conflict Check: Config validation gaps (#1026)

**Date:** 2026-09-28
**Result:** CLEAN after resolution. Two blocking conflicts were found and resolved by the operator, and none remain.
**ADR corpus:** `repo_wide` (per `conflict_check.adr_corpus`)

## Scope Reviewed

- **Stories:** all 494 story files in `.docs/stories/`, plus the prior reports in `.docs/conflicts/`. Every hit was read in full for these terms:
  - `harness_version`, `version_mismatch`
  - `when:` / `parallel`
  - `wiring`
  - `markdown_viewer`, `mermaid_renderer`
  - `otel` / `protocol`
  - step disable and enforcement wording
  - unknown and deprecated keys
- **ADRs:** all 322 files had their title and status skimmed. Full bodies were then grepped for config-validation, telemetry, rendering, versioning, step-DSL and retirement terms. The Decision section of every hit was read, including the non-`adr-`-prefixed `004-when-parallel-workflow-dsl.md`.
- **ADR exclusions:** only ADRs fully marked `SUPERSEDED`, with no residual clause on these surfaces, were excluded.

All six conflict types were evaluated: contradiction, overlap, state, resource, sequencing and oscillating. Each pair sharing a field or gate was tested in both directions.

## Conflict: Rejecting when + parallel contradicts ADR 004

**Stories involved:** original Story 3 ("A step cannot declare both when and parallel") vs ADR: when/parallel workflow DSL
**Files:** [.docs/stories/config-validation-gaps-satisfiesversion-and-six-ot.md] vs [.docs/decisions/004-when-parallel-workflow-dsl.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** 004-when-parallel-workflow-dsl
**Story ID:** Story 3 (as originally authored)
**ADR opposing sentence (verbatim):** "**`when:` on a parallel group:** evaluated before fan-out. If false, all synthetic branch keys set to `"skipped"`, single `when_skip` event emitted for the group, downstream sees the group as satisfied."
**Story opposing sentence (verbatim):** "Given a custom step named `fanout` that declares both `when: \"tier == L\"` and a valid `parallel` branch list, when the config is validated, then validation fails with a message naming `steps.fanout` and stating that `when` and `parallel` are mutually exclusive."

**Description:** ADR 004 is APPROVED and specifies `when:` on a parallel group as supported. `adr-2026-07-10-concurrent-group-core` carries that forward with the config schema unchanged. It is exercised by `src/conductor/test/engine/when-parallel.test.ts` (T21). Rejecting the combination would make that behaviour unreachable. The "Mutually exclusive with `parallel`" comment in `src/conductor/src/types/config.ts` is the defect, not the validator. Issue #1026's desired outcome already allows "or the documentation is corrected".

**Resolution Options:**
1. Drop the story and correct the type comment.
2. Narrow the story to a context ADR 004 does not cover.
3. Supersede ADR 004 to retire when-on-parallel-group.

**Selected:** Option 1 (operator, 2026-09-28). Story 3 was removed and the later stories renumbered 3-7. The track scope and architecture review carry amendment notes, and the diagram was updated.

## Conflict: Failing config load on a bad otel.protocol contradicts the otel non-blocking contract

**Stories involved:** original Story 7 ("The OTLP protocol is one the transport supports") vs "Config-selected transport" (FR-7) and "Exporter failures never break the run" (FR-8)
**Files:** [.docs/stories/config-validation-gaps-satisfiesversion-and-six-ot.md] vs [.docs/stories/otel-observability.md]
**Type:** contradiction
**Severity:** blocking

**Opposing text (verbatim):**
- otel-observability.md: "Given `exporter: <unknown-value>`, when parsed, then the exporter rejects the value with a named error listing valid options and disables itself."
- otel-observability.md: "so that turning on observability can never make a build fail or hang."
- Original Story 7: "Given an `otel` block with `protocol: http/json`, when the config is validated, then validation fails with a message naming `otel.protocol`, the rejected value `http/json`, and the two accepted values `http/protobuf` and `grpc`."

**Description:** `exporter` and `protocol` are sibling enum fields in the same `otel` block. The accepted contract is implemented by `resolveOtelConfig`, whose docstring says "Never throws". Under that contract an invalid value disables telemetry with a named error. The original Story 7 instead made the whole config fail to load, which would stop the run.

`adr-014-otel-observability-exporter` Decision 5 ("never fails or wedges a run") is consistent with this reading. Its sentence is scoped to exporter and transport failures, so it was recorded as a suspicion rather than a second conflict.

**Resolution Options:**
1. Validate `protocol` inside `resolveOtelConfig`: an unsupported value disables telemetry with a named error, and config still loads.
2. Keep the load failure and amend the otel stories so their guarantee covers runtime and export errors only.

**Selected:** Option 1 (operator, 2026-09-28). Story 6 (formerly 7) was rewritten in place.

## Compatible (no conflict)

- **`when-bypasses-gating-enforcement-while-disable-is-.md` (#1777) vs Story 7 (message wording).** The two stories own the same `stepSkipAuthorityError` call sites. #1777's Done-When requires only that the message name the step and its enforcement level, which Story 7 preserves. The rejection predicate is unchanged. The implementer must keep #1777's predicate tests green.
- **`adr-2026-08-14-retire-build-review-wiring-rubric`, `adr-2026-08-11-deprecated-no-op-step-retirement`, `adr-2026-08-22-build-review-opt-in-rubric-container` vs Story 3 (wiring).** The first says the `wiring` key "stays on the accepted-key list, ignored". Story 3 implements exactly that and adds the standard deprecation report.
- **`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` and conflict report `2026-08-26-config-keys-that-validate-but-have-no-consumer-inc`.** They cover the same registry, and their waiver covers different keys. They confirm `wiring` is dead, and there is no conflict.
- **`mermaid-renderer.md` (DRAFT), `update-check-config-single-source-of-truth.md`, `non-daemon-projects-inherit-self-host-config-inste.md`, and the ADRs on project-config scaffolding and the conductor-block single source of truth, vs Stories 4 and 5.** These govern install flow, where the blocks live, and the seed template. None constrains required fields. Installer-written blocks always carry a preset, so they stay valid.
- **`adr-2026-07-03-version-gate-semver-escalation`, `adr-2026-08-09-checkout-is-sole-version-identity-authority`, `wave-c-json-stdout-subscriber.md` vs Stories 1 and 2.** These cover a different version concept: the harness's own version identity and the plugin-manifest `harness_version`.
- **`adr-2026-07-06-manual-test-fail-routing`, `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` vs Story 7.** These establish `configDisableAllowed`, which the reworded message now describes. There is no behaviour change.

## Internal Consistency

- Story 1 depends on Story 2's guarantee that only a valid, non-empty string range reaches the evaluator.
- Stories 3-7 touch disjoint keys.
- No story requires a behaviour another story forbids, and there is no oscillation.

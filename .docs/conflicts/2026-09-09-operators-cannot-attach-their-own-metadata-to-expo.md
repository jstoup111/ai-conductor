# Conflict Report: Operator-supplied static telemetry attributes (#2056)

**Date:** 2026-09-09
**Stories checked:** `.docs/stories/operators-cannot-attach-their-own-metadata-to-expo.md` (Stories 1–6) against every file in `.docs/stories/` and the ADR corpus
**ADR corpus:** `conflict_check.adr_corpus: repo_wide` — all 310 `adr-*.md` examined
**Result:** PASSED — 0 blocking, 1 degrading (resolved in stories), 0 superseding ADRs

## Corpus record (repo_wide)

- **Examined-relevant (3):** `adr-014-otel-observability-exporter` (governing; D12/D13 are the design the stories restate — compared against D1–D9 with no conflict), `adr-2026-07-10-intra-step-build-progress-events` (adds OtelVisualizer subscriptions; no second Resource construction site — verified in `otel-visualizer.ts` `initializeProviders`, the only `buildResource` caller in that class), `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` (mandated mechanism, below).
- **Superseded-excluded (7):** unambiguously `Status: SUPERSEDED` with no retained decision.
- **Narrowed-out (~300):** daemon/build lifecycle, provider supervision, build_review internals, DECIDE governance, attribution/evidence, task-status ownership, cost rollup (shipped-record surface, not OTel), CLI/install/migration, wiring gates, release/CI, intake/tracker/coherence, git/worktree/containment, per-user `conductor:` config block, memory-provider keys, meta-process ADRs. No ADR outside adr-014 discusses OTel Resource attributes, data-point labels, the `otel:` block, exporter warning semantics, or `OTEL_RESOURCE_ATTRIBUTES`.

## Conflict: Per-key warnings could be read as one event per key

**Stories involved:** Story 2 (An invalid attribute is reported by key and never disables telemetry or fails a run) vs `otel-observability.md` FR-8 bounded warnings and `exported-step-cost-under-records-spend-20x-so-ever.md`
**Files:** `.docs/stories/operators-cannot-attach-their-own-metadata-to-expo.md` vs `.docs/stories/otel-observability.md`, `.docs/stories/exported-step-cost-under-records-spend-20x-so-ever.md`
**Type:** overlap
**Severity:** degrading

**Description:** Story 2's all-invalid negative path read "each key is named in a warning", which is ambiguous between one `renderer_error` whose message lists every key (compatible with the repo's bounded-warning convention — "warnings are bounded (not one per event flooding the log)") and one event per key (up to sixteen events, which breaks it). Direction check: bounded convention satisfied ⇒ Story 2 holds only under the first reading; Story 2 under the second reading ⇒ convention fails. One "no" — an overlap, not an oscillation.

**Resolution Options:**
1. Reword Story 2 to require exactly one `renderer_error` whose message enumerates every dropped key, and add a Done-When counting it.
2. Leave the text and rely on precedent.
3. Add only the Done-When count.

**Resolution applied:** Option 1 (with 3 folded in). Story 2's happy paths now say "exactly one `renderer_error` event", the all-invalid negative path says "a single warning message enumerates every dropped key — never one event per key", and the Done-When asserts exactly one event naming every key. Story 1's per-rule criteria ("a warning names the key") describe the message content at resolution time and are unaffected.

## Compatible pairs examined (both directions)

- Story 3/5 "five conductor keys plus declared attributes" vs the exact-five-key metric-Resource assertions in `every-project-reports-the-same-otel-identity-so-me.md`, `stamp-released-harness-version-on-otel-trace-resou.md`, `no-daemon-level-metrics-queue-depth-halts-and-gate.md` — compatible: Story 3 is scoped to "given valid `attributes`"; Story 5 requires the existing exact-set assertions to pass unmodified with no key and treats `attributes: {}` as identical to absent.
- Story 6 vs `daemon-runs-export-conductor-branch-and-conductor-.md` — additive to the trace Resource on disjoint keys; Story 3's "pre-existing trace Resource attribute unchanged" holds.
- Story 1/2 drop-and-warn vs `authenticate-otlp-export-with-env-referenced-heade.md` (invalid `headers` disables the exporter) — different sub-keys with different policies; adr-014 D12 records the carve-out and its reason (a mislabeled dimension is not a credential failure).
- Story 1 "no unknown-key warning" vs `config-keys-that-validate-but-have-no-consumer-inc.md` — disjoint key sets.
- Story 4 vs `every-project-reports-the-same-otel-identity-so-me.md` Story 1 and `no-daemon-level-metrics-queue-depth-halts-and-gate.md` label sets — additive; both state existing labels unchanged.
- `mechanically-enforce-otel-handler-coverage-for-ote.md`, `wave-c-telemetry-event-log.md`, `build-post-task-tail-telemetry.md`, `demote-task-stamping-to-telemetry.md`, `daemon-dispatched-builds-emit-no-otel-telemetry-th.md`, `fix-otel-step-duration-histogram-bucket-saturation.md`, `exported-telemetry-carries-no-cost-signal-so-spend.md` — no shared entity.

## Mandated mechanism carried into the plan (not a conflict)

`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` Decision 4 requires every accepted config key to declare its consumer: `src/conductor/test/engine/config-consumer-registry.ts` already lists `otel.project_name` and `otel.worker_name` individually (lines 190–191), so `otel.attributes` needs a matching entry in the same diff that adds it to `CONFIG_CONSUMER_KEY_SETS.otel`, or the registry-totality test fails. `templates/project-config.yml.template` carries a commented `otel:` example (`worker_name`) that may gain an `attributes` example; no test binds that block's key set to the allowlist.

## Sequencing note (not a story conflict)

#1940's unpushed spec amends adr-014 at the same insertion point (D10/D11) and widens `metrics.ts` labels. Both are one-directional rebases; the intake is `blocked_by #1940` and D12/D13 are numbered past D10/D11 (architecture review, Condition 1).

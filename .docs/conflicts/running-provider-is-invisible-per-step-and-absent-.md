# Conflict Check: Live provider identification per attempt (#1268)

**Date:** 2026-10-14
**Stories checked:** `.docs/stories/running-provider-is-invisible-per-step-and-absent-.md` (Stories 1–12) against all of `.docs/stories/` and approved ADRs
**Result:** PASSED — 0 blocking, 5 degrading (all resolved or accepted by the operator)

## ADR corpus

**Examined:** `003-ui-renderer-plugin-point`, `adr-2026-07-26-event-sink-registry-exhaustiveness`,
`adr-2026-07-30-provider-preparation-lifecycle-supervision`, `adr-2026-08-19-live-provider-stream-observation`,
`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`, `adr-2026-09-10-shared-step-lifecycle-telemetry`,
`adr-2026-07-03-reactive-model-fallback-ladder`, `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability`.

**Narrowed out (no subject overlap):** `adr-014-otel-observability-exporter` (relevant only if the sink row exports to telemetry, handled by C5), `adr-2026-07-10-intra-step-build-progress-events`, `adr-2026-10-07-conductor-decomposition-target-architecture`, `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`, and the remaining approved ADRs matching "event sink" or "daemon log" only incidentally (kickback, halt, rebase, park).

## Conflict: Provider-start line beside the lifecycle running line (C1)

**Stories involved:** Story 10, Story 11 vs daemon-build-review-can-wedge-before-provider-laun TI-1
**Files:** `.docs/stories/running-provider-is-invisible-per-step-and-absent-.md` vs `.docs/stories/daemon-build-review-can-wedge-before-provider-laun.md`
**Type:** overlap
**Severity:** degrading

**Description:** The daemon log already prints a lifecycle `provider running (attempt X, recovery N)` line per logical attempt. The new line reports a different unit: each invoked candidate or model rung, with the provider name. Two "started" lines appear per attempt.

**Resolution Options:**
1. Keep both; state that the lifecycle line is unchanged and the provider-start line is the only added line.
2. Enrich the lifecycle running line with the provider (does not fire again on in-attempt fallback, so it fails FR-5).
3. Suppress the lifecycle line when a provider-start line exists (changes an accepted story's behavior).

**Recommendation and resolution:** Option 1, applied — Story 10 gains a negative path and a Done When item asserting the lifecycle line stays unchanged beside the single added line.

## Conflict: "No log lines" on the model-ladder success path (C2)

**Stories involved:** Story 10 vs model-availability-fallback-ladder "In-attempt ladder walk"
**Files:** `.docs/stories/running-provider-is-invisible-per-step-and-absent-.md` vs `.docs/stories/model-availability-fallback-ladder.md`
**Type:** contradiction (literal reading only)
**Severity:** degrading

**Description:** The ladder story says the configured-model success path has "zero behavior change, no extra calls, no log lines". In context (#186) this scopes to the ladder machinery adding no lines, not to all observability.

**Resolution Options:**
1. Read the ladder clause as scoped to ladder machinery; change neither story.
2. Amend the ladder story to say so explicitly.

**Recommendation and resolution:** Option 1, accepted by the operator.

## Conflict: Non-blocking emit vs ordering before terminal takeover (C3)

**Stories involved:** Story 12 vs Story 2, Story 11; break-the-engine-ui-import-cycle-and-stop-types-im Story 2
**Files:** `.docs/stories/running-provider-is-invisible-per-step-and-absent-.md`, `.docs/stories/break-the-engine-ui-import-cycle-and-stop-types-im.md`
**Type:** oscillating (candidate)
**Severity:** degrading

**Description:** Awaiting the emit would hold dispatch (breaking Story 12), while not awaiting it seemed to risk the line appearing after the provider takes over the terminal (Story 2). Verified that both can hold: `ConductorEventEmitter.emit` (`src/conductor/src/ui/events.ts`) invokes every handler synchronously before its first `await`. A fire-and-forget emit with synchronous renderer writes satisfies both stories.

**Resolution Options:**
1. Record the constraint for the plan: emit fire-and-forget; the renderers write the line synchronously.
2. Await the emit (breaks Story 12).

**Recommendation and resolution:** Option 1, accepted by the operator. This constraint is carried into the plan; no story change.

## Conflict: Provider and model now spelled in two events (C4)

**Stories involved:** Story 11 vs adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability D3 and adr-2026-09-10-shared-step-lifecycle-telemetry D6
**Files:** `.docs/stories/running-provider-is-invisible-per-step-and-absent-.md` vs `.docs/decisions/adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability.md`, `.docs/decisions/adr-2026-09-10-shared-step-lifecycle-telemetry.md`
**Type:** resource-contention
**Severity:** degrading
**ADR filename stem:** adr-2026-09-10-shared-step-lifecycle-telemetry
**Story ID:** Story 11
**ADR opposing sentence (verbatim):** "provider_attempt remains the source of invoked-dispatch accounting and resolved provider/model/fallback metadata."
**Story opposing sentence (verbatim):** "so that I can reconstruct which provider ran when."

**Description:** The start time is a new fact. But carrying provider and model on a second event risks consumers treating it as a second accounting source.

**Resolution Options:**
1. Make the new record non-authoritative for accounting; assert accounting is unchanged by its presence.
2. Fold the start fact into `provider_attempt` (conflicts with the approved design's separate variant).

**Recommendation and resolution:** Option 1, applied — Story 11 gains a negative path and a Done When item asserting cost, usage and running-work results are identical with and without provider-start records.

## Conflict: Explicit unknown vs absent telemetry dimensions (C5)

**Stories involved:** Story 8 vs restore-per-member-telemetry-for-validation-groups Story 2
**Files:** `.docs/stories/running-provider-is-invisible-per-step-and-absent-.md` vs `.docs/stories/restore-per-member-telemetry-for-validation-groups.md`
**Type:** state-conflict (conditional)
**Severity:** degrading

**Description:** Story 8 persists an explicit unknown provider, while telemetry stories keep missing dimensions absent. This conflicts only if the record is exported as a telemetry label.

**Resolution Options:**
1. Assert the unknown state never appears as a provider label value; the plan sets the sink row's export flag accordingly.
2. Drop the explicit unknown (breaks FR-8).

**Recommendation and resolution:** Option 1, applied — Story 8 gains a negative path and a Done When item.

## Pairs examined and judged clean

- unusable-provider-candidate-throws-instead-of-fall Stories 1 and 4 vs Story 6: skipped candidates are never shown as invoked.
- usage-exhaustion-re-dispatches-the-exhausted-provi Stories 1–2 vs Stories 6 and 11: refusals stay on the existing attempt record.
- custom-build-review-rubrics-cannot-run-off-linux-o member skip records vs Story 3: consistent.
- subagent-activity-and-live-per-step-token-burn-are Story 5 vs Story 10: the progress event stays unrendered; the new line is per attempt, not per interval.
- adr-2026-08-19-live-provider-stream-observation D5/D7 vs Stories 10 and 12: consistent.
- restore-per-member-telemetry-for-validation-groups Stories 1–2 vs Stories 3–4: identity parity, no sibling borrowing.
- durable-provider-time-attribution Story 1 vs Stories 6 and 11: one record per started process; the new record claims no timing authority.
- streaming-provider-dispatches-record-no-token-usag Story 6 vs Story 2: compatible given C3.
- make-every-gate-verdict-recoverable-from-the-event Story 2: no clash; the new line does not reuse the completion glyph.
- render-every-declared-render-event-in-inline-runs Story 2 vs Story 2: a dedicated renderer case gives exactly one line.
- non-build-step-in-flight-renders-as-unchanged-buil vs Story 10: a different event and line class.
- retry-log-lines-carry-the-completion-check-reason-, daemon-log-feature-tags-254, generated-project-artifacts-delay-provider-startup, interactive-skill-model-contract, monitor-guided-sessions-no-way-to-choose-provider-: no interaction.
- adr-2026-07-26-event-sink-registry-exhaustiveness, 003-ui-renderer-plugin-point, adr-2026-08-24-one-dispatch-member-on-the-provider-contract, adr-2026-07-03-reactive-model-fallback-ladder D3–D5: consistent with the design.

## Re-check

A re-check after the resolutions found no new conflicts. The added clauses only constrain the new behavior and do not touch any existing story.

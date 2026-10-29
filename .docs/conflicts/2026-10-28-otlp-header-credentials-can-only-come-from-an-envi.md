# Conflict Check: OTLP header credentials from a command (shared credential-reference resolver)

**Date:** 2026-10-28
**New stories:** `.docs/stories/otlp-header-credentials-can-only-come-from-an-envi.md` (Stories 1–6)
**Result:** passed after resolution — 2 blocking conflicts resolved, 1 degrading overlap resolved, 0 remaining

## Inventory

- **Stories compared in depth** (share `otel.headers`, spool delivery or OTel failure reporting):
  `authenticate-otlp-export-with-env-referenced-heade.md` (#1939),
  `durable-otel-export-queue-telemetry-is-buffered-wh.md`, `vitest-daemon-fixtures-leak-into-shared-operationa.md`,
  `operators-cannot-attach-their-own-metadata-to-expo.md`, `config-validation-gaps-satisfiesversion-and-six-ot.md`,
  `otel-observability.md`. The remaining OTel stories concern metrics, identity and dimensions and share no
  header, credential or delivery behavior.
- **ADRs examined:** adr-014-otel-observability-exporter (D15, D16),
  adr-2026-10-28-shared-credential-reference-resolver, adr-2026-07-07-daemon-owned-build-credential,
  adr-2026-09-11-github-operation-ownership.
- **ADRs narrowed out** (mention OTel or credentials only incidentally): adr-2026-07-10-intra-step-build-progress-events,
  adr-2026-07-29-ship-start-draft-pr, adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main,
  adr-2026-09-29-plan-slice-manifest, adr-2026-09-06-inbound-intake-trust-boundary,
  adr-2026-09-10-shared-step-lifecycle-telemetry, adr-2026-10-07-provider-cost-includes-failed-attempts,
  adr-2026-10-24-finish-surfaces-guarded-publish-failures, adr-2026-07-29-engine-observed-provider-time-partition.

## Conflict: #1939 refuses the new `command` key as unknown

**Stories involved:** #1939 Story 2 (Refuse a literal or malformed credential by name) vs Story 1 (Send an OTLP header whose value comes from a command)
**Files:** [.docs/stories/authenticate-otlp-export-with-env-referenced-heade.md] vs [.docs/stories/otlp-header-credentials-can-only-come-from-an-envi.md]
**Type:** contradiction
**Severity:** blocking

**Description:** #1939 required "a header entry whose reference object has an unknown key" to disable otel naming "the supported reference form". `{ command: [...] }` is such an entry under that text, while Story 1 requires it to be accepted.

**Resolution Options:**
1. Reword the #1939 criterion to "a key outside the supported reference forms … naming the supported reference forms".
2. Drop the unknown-key case from #1939 and rely on the new Story 2.

**Resolution (operator, 2026-10-28):** Option 1, replaced in place in the #1939 stories file.

## Conflict: #1939 documents exactly one credential source

**Stories involved:** #1939 Story 3 (Keep credential values out of configuration and diagnostics) vs Story 1
**Files:** [.docs/stories/authenticate-otlp-export-with-env-referenced-heade.md] vs [.docs/stories/otlp-header-credentials-can-only-come-from-an-envi.md]
**Type:** contradiction
**Severity:** blocking

**Description:** #1939 required the reference documentation to state "the reference form, its one supported source". With a `command` source that statement is false.

**Resolution Options:**
1. Reword the criterion and its Done When line to "the reference forms, their supported sources".
2. Leave #1939 unchanged and accept stale documentation.

**Resolution (operator, 2026-10-28):** Option 1, replaced in place. The documentation edit itself is left to the maintain-documentation pre-finish gate.

## Conflict: a credential failure could be suppressed by the network-class warning

**Stories involved:** durable spool story (one `renderer_error` per transition into a failure class) vs Story 4 (A credential failure blocks the send and is reported once)
**Files:** [.docs/stories/durable-otel-export-queue-telemetry-is-buffered-wh.md] vs [.docs/stories/otlp-header-credentials-can-only-come-from-an-envi.md]
**Type:** overlap
**Severity:** degrading

**Description:** The durable spool story requires "exactly one `renderer_error` names the signal and the failure class network, and no further `renderer_error` is emitted while that failure class persists". If a credential failure were classified as network, a drainer already warned for network would never report the credential failure Story 4 requires.

**Resolution Options:**
1. Report credential failures under their own `credential` reporting class (as `spool` already is), leaving `otel_spool_backlog.lastFailureClass` values unchanged.
2. Add `credential` as a delivery failure class, extending the `otel_spool_backlog` event schema.

**Resolution (operator, 2026-10-28):** Option 1. Story 4 gained a criterion and Done When line pinning it, and adr-2026-10-28-shared-credential-reference-resolver decision 5 states it (revised in place; not yet on main).

## Examined, no conflict

- **adr-014 D15 vs Story 4.** "unlike `headers`, whose failure disables the exporter" still holds for configuration-time header failures, which Story 2 keeps disabling. Send-time resolution failures are new behavior governed by adr-2026-10-28-shared-credential-reference-resolver decision 5; the adr-014 sentence is not falsified, so it is not amended.
- **adr-014 D16 vs Stories 1 and 3.** The drainer still POSTs "with the drainer process's own resolved headers"; resolution now happens per POST through the resolver.
- **Durable spool "no spool file contains that header's value" vs Story 5.** Same invariant, extended to command-sourced values.
- **#1939 Story 1 unset-env refusal vs Story 1's mixed env/command negative.** Consistent: the env refusal still applies and the command is never run.
- **Oscillation check.** Each pair above was checked in both directions; after resolution, fully satisfying either side leaves the other holding.

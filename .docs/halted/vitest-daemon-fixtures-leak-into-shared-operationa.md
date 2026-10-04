# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-04T00:43:21.840Z
Slug: vitest-daemon-fixtures-leak-into-shared-operationa
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-vitest-daemon-fixtures-leak-into-shared-operationa
Head SHA: 48783e6d0fd65fe76578809feeae96d5f40290b2
Halted at: 2026-10-04T00:32:30.065Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 2 negative: Given the smoke opt-in variable is set while the test marker is not set, when OTel exporters are built, then export behaves exactly as when the opt-in is unset.
Task ids: 4
Done when checks: `otlpExportRefusal` returns the refusal message, which names both `AI_CONDUCTOR_NO_REAL_EXEC` and `AI_CONDUCTOR_OTEL_SMOKE`, when the marker equals `1` and the opt-in is absent or any value other than `1` (`true`, `0`, empty, and ` 1 ` are asserted). | `otlpExportRefusal` returns `null` when the marker equals `1` and the opt-in equals `1`, and returns `null` whenever the marker is absent, including when the opt-in equals `1` without it. | `otlpExportRefusal` reads only the environment object it is given, as asserted by a case whose argument lacks the marker while `process.env` carries it.
Missing assertion: when OTel exporters are built, then export behaves exactly as when the opt-in is unset.
```

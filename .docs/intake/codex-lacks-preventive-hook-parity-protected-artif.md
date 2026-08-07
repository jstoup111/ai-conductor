# Intake origin: codex-lacks-preventive-hook-parity-protected-artif

Source-Ref: jstoup111/ai-conductor#1254
Owner: jstoup111

## Desired outcome

- A finalized implementation plan cannot assign mutation of protected DECIDE artifacts to a BUILD task.
- Every supported provider prevents protected DECIDE-artifact mutations during BUILD and SHIP before they are committed, while a provider-neutral terminal check still rejects bypassed, disabled, unsupported, or otherwise uncovered mutation paths.
- A remediation finding that requires changing a protected DECIDE artifact returns to its owning DECIDE phase or halts for the required product decision; it is never routed back to BUILD.
- Legitimate DECIDE authoring and sanctioned lifecycle artifacts remain writable in their owning phases.
- A feature encountering this class of violation reports the offending task and artifact without consuming repeated build/review cycles.
- Every harness-supplied host lifecycle control has a documented classification: required preventive safety, advisory feedback/telemetry, superseded by provider-neutral machinery, or intentionally provider-specific.
- For each control classified as required preventive safety, Claude- and Codex-selected runs demonstrate equivalent observable prevention and actionable diagnostics; a missing or disabled provider integration cannot produce a passing terminal verdict.
- Provider-specific lifecycle behavior is covered by executable tests for healthy, missing, disabled, malformed, and bypassed-control paths, while terminal engine checks remain the acceptance authority.
- Existing Claude behavior and Codex self-host isolation remain unchanged except where parity requires an observable early rejection.

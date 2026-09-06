# Track: Scale rate-limit waits by the stated time unit

Track: technical

Scope boundary: Small fix for #2168, approved by the operator on 2026-09-06 (delegated). The slice covers how the two LLM provider adapters turn a duration phrase in a rate-limit message into a wait in seconds: honour an explicitly stated seconds, minutes, or hours unit, and bound a duration whose unit is absent or unrecognized so it can never produce a fast retry. Reset-time parsing, timezone deadlines, rate-limit classification, the episode coordinator's escalation ladder, and the downstream wait/sleep machinery are unchanged and outside this slice.

This is an internal engine correction with no product surface; acceptance criteria live in technical stories rather than a PRD.

The operator approved, on 2026-09-06 (delegated), that an explicitly stated unit is honoured exactly with no ceiling, while a duration with no recognizable unit is read as minutes and bounded between the existing default wait and one hour. Honouring the stated unit exactly preserves the existing behaviour for very long stated waits; bounding only the inferred reading keeps a mis-read number from either racing back into the limit or wedging the daemon for hours.

Scope check: A — consumer-facing (the provider adapters ship in the engine and every repository that installs the harness runs them; no self-host, release-gate, CI, or repo-convention signal fires); B — n/a (no new skill); C — provider-agnostic, and deliberately so: the counterpart seam exists on both supported hosts, so both adapters are corrected in the same slice rather than leaving one host's waits mis-derived. No catalog registration is required.

Verified foundation: the Claude adapter's duration branch matches a number after a retry phrase and never captures the unit, then reads any value under sixty as minutes and any value at or above sixty as seconds, so an hour-phrased or minute-phrased message is mis-scaled. The Codex adapter's duration parse requires a seconds unit token, so a minute-phrased or hour-phrased message never matches and silently collapses to that call's fallback wait. Both adapters call their parse only after rate-limit classification, and both surface the result as the invoke result's wait field, which the conductor turns into an absolute deadline. The unit alternation and the seconds-per-unit mapping are the only genuinely shared logic, so a small shared duration module is the natural home for them; the execution directory has no barrel file, so a new module needs no registration.

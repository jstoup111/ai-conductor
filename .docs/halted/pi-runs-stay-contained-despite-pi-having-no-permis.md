# Halt record

Status: halted
Slug: pi-runs-stay-contained-despite-pi-having-no-permis
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-pi-runs-stay-contained-despite-pi-having-no-permis
Head SHA: 422ac69d146513131c918a56319c92248f662cd9
Halted at: 2026-10-02T01:19:13.260Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 7 negative: Given the same output, when `auditEnvironmentBlockerClaims` runs with provider codex, then nothing is refuted, because codex has an OS sandbox.
Task ids: 15
Done when checks: The environment-claim audit sandbox value for pi is `false` and equals the pi catalog descriptor `osSandbox`, as asserted in environment-claim-audit.test.ts. | For an output claiming the sandbox blocked a file write with no write fence installed, `auditEnvironmentBlockerClaims` with provider pi returns a non-empty `refuted` list and a message carrying the environment-claim-refuted marker, with the same refuted operations as for provider claude, as asserted in environment-claim-audit.test.ts. | For that same output `auditEnvironmentBlockerClaims` with provider codex returns an empty `refuted` list and a null message, as asserted in environment-claim-audit.test.ts.
Missing assertion: No cited check asserts that Codex has an OS sandbox; it only asserts the no-refutation outcome.
```

# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-28T10:58:53.441Z
Slug: pi-as-a-build-provider
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-as-a-build-provider
Head SHA: b552ac107b0f2deac50ba930bb2adf42f587208c
Halted at: 2026-09-26T19:32:11.092Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-5 (adr-2026-08-12-per-provider-live-smoke-legs decision 1)

Blocking findings:
AB-1 (REMEDIABLE; Task 17): Pi's abort handler has no production signal producer, so lifecycle cancellation cannot terminate a running Pi subprocess.
AB-2 (REMEDIABLE; Task 4): `REVIEW_PROVIDER_PREFIXES` is materially changed but remains test-only with no production consumer.
AB-3 (REMEDIABLE; Task 7): The descriptor-backed `defaultCiFixProbe` and its preflight have no production caller.
AB-4 (REMEDIABLE; Task 8): The structural guard excludes adapters and therefore cannot enforce the sealed catalog-owned display-name outcome.
AB-5 (DESIGN; adr-2026-08-12-per-provider-live-smoke-legs decision 1): Pi's standalone adapter smoke violates the approved shared full-daemon run-body architecture.
```

# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-03T19:50:06.107Z
Slug: pi-runs-stay-contained-despite-pi-having-no-permis
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-runs-stay-contained-despite-pi-having-no-permis
Head SHA: 57c643370cfe7275dc1d69ee6d4ab05cfac3ab81
Halted at: 2026-10-03T19:27:39.188Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — Blocking findings: AB-1 (DESIGN; adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 17): 99% verified: remediation restored two dormant production primitives after the prior lap removed them. `PiProvider.invoke`'s read-only branch at `pi-provider.ts:337,346-356` and the extension's `git_read` branch at `pi-harness-extension.ts:37-70` have no reachable production caller. Every producer of `readOnlyReview: true` is a custom-policy path, but Pi is refused for missing `reviewPolicyCatalog` at `step-runners.ts:3283-3294` or `step-runners.ts:4111-4116` before invocation. Although tasks 3, 4, and 9 introduced these primitives, approved D17 explicitly provides no current production entry point, so resolving the conflict requires a human architectural decision.

Blocking findings:
AB-1 (DESIGN; adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 17): 99% verified: remediation restored two dormant production primitives after the prior lap removed them. `PiProvider.invoke`'s read-only branch at `pi-provider.ts:337,346-356` and the extension's `git_read` branch at `pi-harness-extension.ts:37-70` have no reachable production caller. Every producer of `readOnlyReview: true` is a custom-policy path, but Pi is refused for missing `reviewPolicyCatalog` at `step-runners.ts:3283-3294` or `step-runners.ts:4111-4116` before invocation. Although tasks 3, 4, and 9 introduced these primitives, approved D17 explicitly provides no current production entry point, so resolving the conflict requires a human architectural decision.
```

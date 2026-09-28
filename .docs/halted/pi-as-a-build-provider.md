# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-28T23:48:43.821Z
Slug: pi-as-a-build-provider
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-as-a-build-provider
Head SHA: f96c9468521b4efe537875af8293b94c5489807b
Halted at: 2026-09-28T23:47:03.494Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-9 (architectural-clarity: No production path aborts a running provider step for any provider: the daemon SIGTERM handler (daemon-cli.ts:1040-1052) deliberately aborts only rate-limit-wait controllers registered at conductor.ts:10631 and otherwise runs a bounded drain-then-release teardown, and the provider lifecycle supervisor only gates pre-spawn preparation; the only signal-passing callers are build_review paths (step-runners.ts:3145,3899,4287) that exclude Pi by capability. Task 17's Done-when (invoke-level abort kills Pi, sets no fallback signal) is met, and prd-audit graded S5.7 PASS on exactly this reading, so closing AB-9 requires a human decision between (a) adding a new ordinary-step abort path, which reverses the approved drain-on-shutdown design for every provider, or (b) accepting that Pi abort is reachable only when a caller supplies a signal (codex parity) and recording that as the interpretation of the Story 5 lifecycle-abort criterion. Confidence 75% that this is a decision rather than a determinable fix.)
```

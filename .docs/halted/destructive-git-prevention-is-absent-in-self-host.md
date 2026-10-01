# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-01T00:35:48.461Z
Slug: destructive-git-prevention-is-absent-in-self-host
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-destructive-git-prevention-is-absent-in-self-host
Head SHA: 0720768ddf33fed8ffdf4625fa40479cfd37cbf6
Halted at: 2026-09-30T23:50:12.152Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — S11.4 (architectural-clarity: Story 11 negative path (stories:244) and Task 16 Done-when bullet 3 require gate mode to fail on a missing credential, but APPROVED adr-2026-08-12-per-provider-live-smoke-legs decision 3 mandates an absent credential be a named non-gating skip, which smoke-capability.ts:204 and smoke-runner.test.ts:151 implement; the prior halt on this contradiction was cleared by rekick with no decision recorded, so a human must amend that ADR (e.g. an explicit leg-selection mode that fails closed) or amend Story 11/Task 16 to the non-gating skip. Confidence 95% (verified against ADR text).)
```

# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-09-01T14:02:44.926Z
Slug: plan-growth-allowance-is-spent-on-work-existing-ta
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-plan-growth-allowance-is-spent-on-work-existing-ta
Head SHA: 9bf89d52bb745ed6b00c252fe7523f8e9390aea1
Halted at: 2026-09-01T05:48:00.760Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (architectural-clarity: Two APPROVED artifacts contradict each other and only a human can pick one: adr-2026-08-29 D1 requires a cap terminal to persist HALT.class = needs-human, while the sealed stories of the shipped feature every-as-built-blocked-verdict-halts-needs-human-i require class kickback-cap at exactly the terminal AB-1 names (.docs/stories/every-as-built-blocked-verdict-halts-needs-human-i.md:82-83,89, asserted on the persisted marker at src/conductor/test/acceptance/every-as-built-blocked-verdict-halts-needs-human-i.acceptance.test.ts:337, and re-asserted by this feature's own sealed Story 5 Done-when); src/conductor/src/engine/conductor.ts:4260,4284 return KICKBACK_CAP_HALT_CLASS and src/conductor/src/engine/halt-marker.ts:100-102 persists it verbatim, and that constant plus every one of these terminals predates this branch (merge-base a0337d4a6 conductor.ts:4192,4216), so the review's code-compliance option would regress another feature's sealed acceptance criterion rather than fix drift introduced here — the resolution is the review's second option, a human-approved ADR superseding or scoping D1, or a DECIDE amendment of the sibling feature's sealed stories.)
```

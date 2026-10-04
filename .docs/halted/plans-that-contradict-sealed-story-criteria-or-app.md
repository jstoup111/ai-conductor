# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-04T12:27:04.379Z
Slug: plans-that-contradict-sealed-story-criteria-or-app
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-plans-that-contradict-sealed-story-criteria-or-app
Head SHA: 4bfc41214c173269eb2b3414948424fff16b6904
Halted at: 2026-10-04T09:49:56.622Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — S2.12 (architectural-clarity: prd-audit PLAN_GAP (70% inferred): at tier S runCoverageBinding excludes .docs/decisions/adr-* from amendment input (step-runners.ts:4596-4598, from #2745), so assembleConflictClaims' amendment exclusion (coverage-binding-conflict-inputs.ts:61-69,137) never fires and a branch amendment's new decision gets a conflict claim instead of an amendment claim; the sealed criterion requires amendment-only judgement 'including at tier S', while adr-2026-08-31-coverage-binding-judge-step says D18 alone owns branch amendments and D17's ADR layer stays not-applicable at tier S — a human must choose between enabling ADR amendment claims at tier S (changing approved tier-S behavior), detecting amendment blocks independently of the tier-gated layer, or amending the criterion; no plan task (Task 4 implemented its text faithfully; Tasks 3, 8 do not touch the tier gate) admits either change, and the 2026-10-04 operator DECIDE resolved only AB-3, not this.)
```

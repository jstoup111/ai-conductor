# Halt record

Status: halted
Slug: bootstrap-register-never-walk-the-user-through-use
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-bootstrap-register-never-walk-the-user-through-use
Head SHA: 7106770bd6e788bc64deb74aa1edf4f46c766141
Halted at: 2026-09-18T12:50:45.224Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-3 (—), AB-4 (—)

Blocking findings:
AB-1 (REMEDIABLE; adr-2026-08-28-test-suite-drift-budget-and-verification-mode D9): Flagless `config init` no longer preserves its pre-change output path.
AB-2 (REMEDIABLE; adr-2026-08-28-test-suite-drift-budget-and-verification-mode D9): Omitting the new scoped-command flag now rejects a formerly valid invocation instead of retaining its prior default.
AB-3 (DESIGN; —): The shared annotated template cannot also satisfy Stories 2 and 8's exact pre-change byte-identity outcomes.
AB-4 (DESIGN; —): Task 18's top-level-only explanation boundary is narrower than sealed Story 7.
```

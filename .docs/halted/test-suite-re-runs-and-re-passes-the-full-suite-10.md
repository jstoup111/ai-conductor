# Halt record

Status: halted
Slug: test-suite-re-runs-and-re-passes-the-full-suite-10
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-test-suite-re-runs-and-re-passes-the-full-suite-10
Head SHA: a562f3b4fa780e4c61b7561f5296787137115380
Halted at: 2026-08-29T21:56:53.785Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (REMEDIABLE; adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 3): Unbudgetable keys are accepted when set to `none`, and both generated presets emit those forbidden keys.
AB-2 (REMEDIABLE; adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 4): Drift measurement uses raw declarations and ordinary Git paths instead of the fingerprint's expanded declared-input membership.
AB-3 (DESIGN; adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch decision 3): The completion predicate now writes preserved PASS evidence, conflicting with its approved read-only contract and the newer ledger-write design.
AB-4 (REMEDIABLE; adr-2026-08-28-test-suite-drift-budget-and-verification-mode decision 7): Preservation telemetry is incomplete: generic completion skips the emitter, and daemon re-kick loses the budget basis after a second inspection.
```

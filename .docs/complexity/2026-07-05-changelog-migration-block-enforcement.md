# Complexity Assessment: CHANGELOG Migration-block enforcement (fix #282)

**Plan stem:** `2026-07-05-changelog-migration-block-enforcement`
**Date:** 2026-07-05

Tier: M

## Rationale

Signals (same as conduct's S/M/L heuristics):

- **Models / schema:** None new. Adds one structured field to the existing gate
  `GateVerdict` (a remediation kind/hint) and one `.pipeline/` artifact remediate reads.
- **Integrations:** Several existing seams wired together — the self-host release gate
  (`release-gate.ts`), the conductor's finish-time gate branch and its existing
  `/remediate` dispatch machinery (`conductor.ts`), the bash integrity suite
  (`test/test_harness_integrity.sh`), and `bin/migrate`'s parser. No new external
  integration, but four touch points across three languages (TS, bash, Python-in-bash).
- **Auth:** None.
- **State machines:** Minor — reuses the existing per-gate kickback budget
  (`MAX_KICKBACKS_PER_GATE`) and remediation routing; no new multi-state machine.
- **Correctness sensitivity:** Elevated. Two adversarial derivations must hold: the gate
  must still fail-closed on an uncertain diff and on a genuinely absent block for a
  breaking surface (never auto-pass), and the h2 tightening must NOT break `bin/migrate`'s
  ability to run already-shipped `### Migration` (h3) blocks — a backward-compat invariant.
- **Story count:** Estimated ~7–9 stories.

Not **Small**: three subsystems in three languages, a HALT-vs-remediate routing decision,
a format-contract asymmetry (gate strict / migrate lenient) that must be reasoned about and
locked, and a backward-compat hazard. This needs architecture-review + an APPROVED ADR and
a conflict-check.

Not **Large**: no new domain models, no new auth, no new external system, bounded surface.

## Implications (per engineer DECIDE tiering)
- prd: **skipped** (technical track)
- architecture-diagram: **included**
- conflict-check: **included**
- architecture-review: **lightweight** (Medium) — must resolve and produce an APPROVED ADR
  for: (a) route-through-remediate vs keep-HALT and the malformed-vs-missing split, and
  (b) the deliberate gate-strict / migrate-lenient h2/h3 asymmetry and its backward-compat
  rationale.

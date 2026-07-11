# Conflict Check: TR-10 migration-gate waiver (fix #354)

**Date:** 2026-07-06
**New stories:** .docs/stories/self-host-release-gate-bin-conduct-breaking-surfac.md
**Scanned against:** all .docs/stories/ (incl. harness-self-host-guardrails.md,
2026-07-05-changelog-migration-block-enforcement.md), .docs/specs/, prior conflict reports.
**Result:** PASSED — zero blocking conflicts; one ADR-sanctioned supersession annotated,
one degrading overlap accepted by the operator.

## Conflict: New waiver pass-condition contradicts the original TR-10 story text

**Stories involved:** "HALT when a breaking self-build lacks a Migration block"
(harness-self-host-guardrails.md) vs "Valid waiver satisfies TR-10 without a migration block"
**Type:** contradiction (deliberate supersession)
**Severity:** resolved (not blocking)

The original story asserts breaking surface + no block → HALT unconditionally; the new feature
passes when a valid waiver exists. This is the exact amendment approved in
`adr-2026-07-06-migration-gate-waiver` (which amends `adr-2026-06-30-halt-based-release-gates`).

**Resolution applied:** amendment note appended to the original story (append-only; shipped
history preserved). Fail-closed uncertain-diff path explicitly unchanged. Confidence: verified —
contradicting text at harness-self-host-guardrails.md ("then it HALTs naming the breaking
surface") vs the new C3 story; sanctioned by the operator-approved ADR.

## Conflict: Shared modification surface with unbuilt #282 spec

**Stories involved:** "Valid waiver satisfies TR-10…" vs #282 Stories 2–3
(2026-07-05-changelog-migration-block-enforcement.md — verdict `kind` + remediate routing)
**Type:** overlap / sequencing
**Severity:** degrading — ACCEPTED by operator 2026-07-06

Both unbuilt specs modify `evaluateMigration` and the conductor finish-time branch. Not
contradictory: the waiver check runs before the missing/malformed disposition, so a
waiver-satisfied build is `ok` to the remediate route. Residual coordination cost lands on
whichever spec builds second: reconcile verdict kinds for invalid-waiver failures and include
waiver state in the `.pipeline/` remediation-input artifact.

**Resolution applied:** coordination note added to the new stories file header; no story text
weakened. No superseding ADR needed (no architectural decision changed).

## Pairs examined and judged clean (reasoned, not assumed)

- New stories vs version-signal/version-gate stories (semver MAJOR path heuristic): clean —
  the ADR explicitly scopes version-signal.ts OUT; no story asserts waivers affect semver.
- New stories vs remaining harness-self-host-guardrails stories (TR-7 VERSION, TR-8 integrity,
  TR-9 CHANGELOG, sandbox/relink): clean — waiver touches only the TR-10 sub-gate; TR-8/TR-9
  ordering (integrity → changelog → migration) unchanged.
- New containment story vs owner-gate / daemon dispatch stories: clean — no shared resources;
  waiver artifacts are per-plan-stem files read only at self-host finish.

# Conflict Check: harness-daemon-profile (#174) — 2026-07-03

**New stories:** .docs/stories/harness-daemon-profile.md (TR-1..TR-4, 6 stories)
**Scanned:** all .docs/stories/, .docs/specs/, .docs/plans/, open origin spec/* branches
**Result:** 1 conflict found and RESOLVED; zero blocking conflicts remain.

## Conflict: no-marker version-gate behavior (resolved)

**Stories involved:** "HALT for VERSION-bump approval before opening a self-build PR"
(harness-self-host-guardrails.md, TR-7) vs "gate wiring — marker invariance and audited
auto-pass" (harness-daemon-profile.md, TR-3)
**Type:** behavioral overlap (same gate, same no-marker input, different outcome)
**Severity:** blocking (if unresolved)

**Description:** The shipped TR-7 story asserts an absent `.pipeline/version-approval` marker
ALWAYS HALTs a self-build. The new TR-3 story asserts a PATCH-classified change set auto-passes
with an audit record. Both cannot govern simultaneously.

**Resolution (selected via approved ADR, not story-level compromise):** The design fork was
resolved upstream by the operator-approved `adr-2026-07-03-version-gate-semver-escalation`,
which explicitly amends the VersionApprovalGate sub-decision of
`adr-2026-06-30-halt-based-release-gates`. The old story's no-marker negative path is annotated
as amended (pointer to the new ADR + governing stories); it is preserved as the as-built record
of the pre-#174 behavior. Marker-present and marker-mismatch scenarios in TR-7 remain fully
authoritative — the new stories restate them unchanged (marker invariance).

## Checked and clean

- **Resource contention — `.pipeline` namespace:** `version-signal.json` is used by no existing
  artifact or code path; no collision with `version-approval`, `HALT`, `REKICK`,
  `acceptance-specs-red.json`.
- **Resource contention — `bin/setup`:** no existing story/spec/plan claims it; the
  worktree-prepare convention (run-if-present) is additive.
- **Open spec branches** (slice-b owner stamping, content-aware dedup, fable adoption, etc.):
  none touch version-gate.ts, wiring.ts finish gates, or the README self-host section.
  CHANGELOG `[Unreleased]` is a known parallel-worktree merge point (standard ours+append
  resolution) — degrading at worst, accepted as routine.
- **Sequencing:** feature depends only on already-merged Phase 6 wiring; no circular deps.

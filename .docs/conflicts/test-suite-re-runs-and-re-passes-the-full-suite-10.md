# Conflict Report: Budgeted, mode-aware test_suite verification (#2021)

**Date:** 2026-08-28
**New stories:** `.docs/stories/test-suite-re-runs-and-re-passes-the-full-suite-10.md` (Stories 1–8)
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`). All approved ADRs under
`.docs/decisions/` were swept (2026-08-28 exploration pass over the full directory), then
narrowed to the ADRs whose subject overlaps test verification, gate invalidation, scoped runs,
kickbacks, config schema, or bootstrap generation. **Examined:**
adr-2026-07-25-content-addressed-full-suite-proof, adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch,
adr-2026-07-08-post-rebase-gate-first-mechanical-reverify, adr-2026-07-20-post-rebase-delta-aware-invalidation,
adr-2026-08-01-engine-owned-scoped-test-invocation, adr-2026-08-17-framework-agnostic-tautology-scoped-run,
adr-2026-08-01-scoped-run-verb-release-surface, adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence,
adr-2026-07-22-gate-evidence-code-validity-on-redispatch, adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal,
adr-2026-08-11-deprecated-no-op-step-retirement, adr-2026-07-06-migration-gate-waiver,
adr-2026-07-27-project-config-scaffolder, adr-2026-07-29-deterministic-build-verification-fanout,
adr-2026-08-28-test-suite-drift-budget-and-verification-mode. **Narrowed out:** the remaining
ADRs in `.docs/decisions/` (directory holds 531 entries including reviews; the non-examined
ADRs address daemon lifecycle, intake, parking, provider routing, release, PR, and other
subjects with no shared behavior, entity, field, or gate with these stories). Supersession
parsing applied at this scope: adr-2026-07-25 is partially superseded (BUILD-tail ordering
only) and was retained; no examined ADR is unambiguously fully superseded.

The six governing-ADR interactions flagged by the architecture review were re-checked with
the amendment notes in place: adr-2026-08-19 (tree-attesting membership), adr-2026-07-25
(freshness), adr-2026-07-20 (superset invariant), adr-2026-08-18 (refund basis),
adr-2026-08-01 (scoped satisfies gate), adr-2026-07-27 (config init) — each amended in this
change set; no residual opposition. Rebase stories
(`rebase-invalidated-test-suite-proof-halts-build-re.md`,
`rebase-invalidated-test-failures-never-reach-build.md`,
`post-rebase-invalidation-re-runs-every-judged-gate.md`) are conditioned on the gate being
*invalidated*; a within-budget evaluation preserves rather than invalidates, so both
directions hold. `config-keys-that-validate-but-have-no-consumer-inc.md` is satisfied by
Story 1's registry Done-When. Oscillation heuristic was applied in both directions to every
pair sharing the gate, the verifier, the evidence file, the kickback ledger, or the config
block; no oscillation found (confidence: high — each pairing grounded in the quoted texts
below or in compatible conditions).

## Conflict: #588 scope boundary forbids the gate-semantics change Story 6 makes

**Stories involved:** Story 6 (Scoped verification mode satisfies the gate) vs the #588
scope boundary
**Files:** `.docs/stories/test-suite-re-runs-and-re-passes-the-full-suite-10.md` vs
`.docs/stories/reduce-redundant-full-test-suite-runs-in-build-shi.md`
**Type:** contradiction
**Severity:** blocking
**Story ID:** Story 6 (new) vs the binding scope-boundary paragraph (#588)
**Old opposing sentence (verbatim):** "No gate semantics change; nothing may ship on a red CI."
**New opposing sentence (verbatim):** "Given `verification.mode: scoped` and a feature surface containing changed test paths, when the gate executes, then the engine-owned scoped interface runs `scoped_command` with those selectors and a passing exit records a PASS that satisfies the gate"

**Description:** A scoped PASS satisfying the `test_suite` gate is a gate-semantics change
the #588 boundary forbids. The "red CI" half is untouched (CI remains independently
authoritative).

**Resolution Options:**
1. Amend the #588 story's scope boundary to carve out the explicitly configured scoped mode.
2. Drop scoped-satisfies-gate from Story 6 (mode becomes advisory only).
3. Mediating behavior: scoped PASS satisfies the gate only pre-SHIP with an aggregate run at SHIP.

**Recommendation / Resolution (operator-selected 2026-08-28):** Option 1 — the superseded
assertion is replaced in place via a **companion main-based PR** (the spec-branch land gate
rejects foreign-stem story edits), per architecture-review condition C3 and
adr-2026-08-28-test-suite-drift-budget-and-verification-mode D5. The spec PR body links the
companion PR.

## Conflict: #1173 TR-6 negative path forbids a scoped result satisfying the gate

**Stories involved:** Story 6 (new) vs Story 6 "Aggregate verification semantics are
unchanged" (TR-6, #1173)
**Files:** `.docs/stories/test-suite-re-runs-and-re-passes-the-full-suite-10.md` vs
`.docs/stories/build-review-repeats-aggregate-verification-despit.md`
**Type:** contradiction
**Severity:** blocking
**Story ID:** Story 6 (new) vs Story 6 / TR-6 (#1173)
**Old opposing sentence (verbatim):** "Given a scoped run has just completed successfully, when the aggregate gate is subsequently evaluated, then the scoped result does **not** satisfy it; aggregate proof is still required."
**New opposing sentence (verbatim):** "Given `verification.mode: scoped` and a feature surface containing changed test paths, when the gate executes, then the engine-owned scoped interface runs `scoped_command` with those selectors and a passing exit records a PASS that satisfies the gate"

**Description:** TR-6 asserted, unconditionally, that no scoped result satisfies the gate.
Under #2021 that assertion holds in aggregate mode (and wherever the new config is absent)
but is superseded in explicitly configured scoped mode. The governing ADR
(adr-2026-08-01-engine-owned-scoped-test-invocation D7/D8) already carries the approved
amendment note.

**Resolution Options:**
1. Amend the TR-6 story's negative path to condition on aggregate mode / absent config.
2. Drop scoped-satisfies-gate from Story 6.

**Recommendation / Resolution (operator-selected 2026-08-28):** Option 1, in the same
companion main-based PR as the #588 amendment (story artifacts: superseded assertion
replaced in place, no amendment record).

## Outcome

Both blocking conflicts share one root (scoped-satisfies-gate) and one resolution: a single
companion main-based PR amending the two prior story files, opened alongside this spec PR and
linked from its body. No degrading conflicts. Re-check after recording the resolution: clean —
zero unresolved blocking conflicts; no story in the new set required rewording.

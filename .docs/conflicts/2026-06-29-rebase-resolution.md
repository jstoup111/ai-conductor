# Conflict Check: rebase-resolution-skill

**Date:** 2026-06-29
**Stories checked:** `.docs/stories/rebase-resolution-skill.md` (11 stories, FR-1..FR-12)
**Tier:** MEDIUM
**Result:** No blocking story-vs-story conflicts. One anticipated architectural conflict vs an
APPROVED ADR (resolution already decided; deferred to architecture-review). Two internal
precedence clarifications applied to the stories.

---

## Conflict: Stories dispatch a Claude prompt from the rebase step, contradicting ADR-001

**Stories involved:** Dispatch resolver on conflict (FR-1) / Resolver resolves & continues (FR-2)
**Files:** `.docs/stories/rebase-resolution-skill.md` vs `.docs/decisions/adr-001-rebase-insertion-mechanism.md`
**Type:** contradiction (story vs APPROVED ADR)
**Severity:** blocking — but pre-reconciled

**Description:**
ADR-001 (APPROVED) states the rebase step "is deterministic git work, not a Claude skill — it
must not dispatch a prompt." FR-1/FR-2 deliberately dispatch the resolution skill on the
`conflict_halt` path. An APPROVED ADR is binding on implementation, so an unamended ADR-001 would
cause the as-built architecture review to BLOCK at SHIP.

**Resolution Options:**
1. Author an amending ADR (`adr-2026-06-29-rebase-conflict-resolution-dispatch`) that narrows
   ADR-001: detection + the satisfied predicate stay engine-native/prompt-free; only the
   conflict-*resolution* sub-path may dispatch, gated and bounded. Mark ADR-001 amended/superseded
   for that sub-path. **Produce this at the architecture-review step (before BUILD).**
2. Abandon the skill approach and keep pure-engine heuristics (rejected by the user in brainstorm).
3. Reverse ADR-001 wholesale (rejected — over-broad; the rest of the step should stay engine-native).

**Recommendation:** Option 1 — already chosen. The PRD lists the amending ADR as a dependency and
the user approved this direction in brainstorm. **Not re-litigated.** The architecture-review step
is chartered to write the amending ADR; the architecture-review-as-built gate then verifies the
shipped code against it. No action required at conflict-check beyond recording it.

---

## Clarification (non-conflict): cap-0 vs dispatch ordering

FR-1 dispatches on `conflict_halt`; FR-7 says cap `0` ⇒ no dispatch. Coherent once precedence is
fixed: the cap is evaluated **before** dispatch. Applied as cross-story precedence note #1.

## Clarification (non-conflict): "exactly N attempts" vs short-circuit

FR-3 ("exactly N attempts before HALT") vs FR-6 (short-circuit early). Coherent: FR-3 scopes to the
all-fail case without an FR-6 give-up. Applied as cross-story precedence note #2.

## Clarification (non-conflict): manual /rebase vs no-ad-hoc-rebase rule

FR-10's manual `/rebase` is operator-only and must never be invoked by implementation agents
mid-build. Recorded as cross-story precedence note #3. Does not conflict with the sanctioned
daemon finish-time mechanism.

## Verified non-conflict: anti-oscillation

A code-changing resolution (FR-4) kicks back `build`/`manual_test`; on re-entry `performRebase`
finds the branch current (FR-8) → `noop` → satisfied, no re-dispatch. ADR-001's no-op-as-satisfied
property holds, so `MAX_GATE_SELECTIONS`/`MAX_KICKBACKS_PER_GATE` are not threatened.

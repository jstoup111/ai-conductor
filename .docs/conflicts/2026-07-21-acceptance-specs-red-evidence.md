# Conflict Report: acceptance_specs RED-evidence determinism (#741)
**Date:** 2026-07-21
**Stories scanned:** 6 new (this feature) + all existing `.docs/stories/`
**Result:** 1 blocking conflict found and resolved (via ADR supersession); 0 remaining.

## Conflict: skill-enforced vs engine-enforced RED execution

**Stories involved:** #741 "Engine self-heals a missing RED marker" (T-1) + #741
"writing-system-tests records the run contract" (T-2)  **vs**
#297 `writing-system-tests-red-exit-gate.md` Story 1 (Accepted).
**Files:** `stories/acceptance-specs-red-evidence.md` vs `stories/writing-system-tests-red-exit-gate.md`
**Type:** contradiction (approach/state)
**Severity:** blocking

**Description:**
#297's story states the resolution is "the harness convention: make the skill's own exit
gate enforce execution — **fix the skill, not an engine workaround**." #741 introduces
exactly an engine mechanism (the engine executes the recorded run contract and writes the
RED marker). The two cannot both be authoritative: either the skill's prompt-enforced exit
gate is the guarantee, or the engine is.

**Evidence the conflict is real (confidence ~95%):** #297 story lines 16-18 ("fix the
skill, not an engine workaround"); #741 ADR Decision §2 (engine owns execution). #297 has
NO backing ADR — the stance lives only in the story.

**Evidence #297's approach is falsified (confidence ~95%):** the prompt-only exit gate
recurred as a HALT on the #733 daemon build (`.daemon/daemon.log` 2026-07-21T08:35-08:38Z;
tries 2/3 = 16s/13s no-ops; marker hand-written 7 min post-HALT). The repo Design Principle
(CLAUDE.md) independently mandates machinery over prompt discipline.

**Resolution Options:**
1. Supersede only #297's "no engine workaround" clause; keep its skill-side exit gate as
   best-effort; the engine self-heal is the authoritative backstop. (Least disruptive.)
2. Fully replace #297's skill exit gate with the engine mechanism (remove the skill's
   execution responsibility entirely).
3. Keep #297 as-is and drop #741 (revert to prompt-only). Rejected — production-falsified.

**Recommendation & chosen (operator-approved approach C):** Option 1. #741's design is a
strict superset — #297's first-attempt happy path (skill records the marker → no self-heal)
is preserved; only the failure case gains the deterministic engine backstop, and only the
"no engine workaround" prohibition is superseded. Recorded in
`adr-2026-07-21-engine-owned-acceptance-red-execution.md` (§Supersedes). The shipped #297
story is left unedited (cross-feature; its skill gate remains valid) — the supersession is
documented in the ADR, the authoritative layer.

## Re-check
After recording the supersession, no blocking conflicts remain. New stories T-1..T-6 are
mutually consistent (T-1 execution, T-2 contract authoring, T-3 cwd path, T-4 negative
validation, T-5 fallback, T-6 end-to-end recovery — no overlapping contradictory assertions).

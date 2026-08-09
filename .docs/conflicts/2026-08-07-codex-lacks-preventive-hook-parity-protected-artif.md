# Conflict Check: provider-neutral preventive controls for protected DECIDE artifacts (#1254)

**Date:** 2026-08-07
**Stories scanned:** 6 in `.docs/stories/codex-lacks-preventive-hook-parity-protected-artif.md`,
plus the full accepted corpus in `.docs/stories/` and `.docs/decisions/`
**Result:** 1 blocking, 2 degrading, 1 advisory

---

## C1 — Prose path harvesting would reject ~35% of existing plans

**Type:** state-conflict (structural)
**Severity:** BLOCKING
**Involves:** Story 5 vs. the accepted plan-authoring contract in `skills/plan/SKILL.md`
**Root:** architecture — a missing seam, not story phrasing. Routes to `architecture` in
amendment mode per §5c.

### Description

Story 5 requires the scanner to harvest protected paths from prose. Measured against the real
corpus, that is not separable from citation:

```text
plans citing ANY protected path in backticks:            158 / 261
  ... of which cite ANOTHER feature's artifact:           92 / 261   (35%)
current scanner pass rate:                               254 pass / 7 fail
```

Sampled foreign citations are unambiguously references, not targets — *"following the pattern at
`.docs/specs/…`"*, *"per `.docs/decisions/architecture-review-…`"*, *"see `adr-014-…`"*. A naive
widening reclassifies all 92 as violations and blocks them at `land-spec.ts:242`.

The underlying gap: **the design provides no seam distinguishing "this task targets path P" from
"this task cites path P."** For `**Files:**` lines that distinction is explicit; for prose it does
not exist. The approved architecture says "widen path harvesting" without supplying the
discrimination, so the requirement as written cannot be satisfied without a large false-positive
surface. This is a missing boundary, hence structural.

Confidence the false-positive surface is real: **~97%, verified** by direct corpus measurement
(script over all 261 plans, stem-aware via the same `namesOwnFeature` date-prefix rule as
`protected-artifact-seal.ts:508-523`).

### Resolution Options

1. **Mandate the declaration instead of widening the parser.** Do not harvest prose at all. Require
   every plan task to carry a `**Files:**` line, and reject at land any task lacking one. The
   scanner keeps reading declared targets only.
   - `skills/plan/SKILL.md:108` **already** states *"The `**Files:**` line is authoritative for the
     build evidence gate"* — this makes the existing contract enforced rather than inventing a new one.
   - Adoption is already high: 219/261 plans overall carry a `**Files:**` line, 26 of the last 30.
   - Fixes the #1254 case exactly: Task 16 has **no** `**Files:**` line, so it is rejected for the
     missing declaration — deterministically, with zero prose heuristics.
   - False-positive surface: **zero**. Citations in prose are simply never read.
   - Cost: plans authored without `**Files:**` are rejected going forward. Merged plans are not
     re-scanned, so the blast radius is new specs only.
2. **Harvest prose only when a mutation verb is adjacent** (amend/update/change/edit/modify).
   - Keeps prose in play, but is a natural-language heuristic — exactly the kind of fuzzy matching
     `CLAUDE.md`'s Design Principle says to avoid. False negatives (a mutation phrased without a
     listed verb) and false positives (*"do not change X"*) both remain.
3. **Harvest prose only for tasks that have no `**Files:**` line.**
   - Preserves today's fallback semantics, but does not discriminate: Task 16 and a citation-only
     task are both `**Files:**`-less, so it reintroduces the false positives it aims to avoid.

4. **RESOLUTION ADOPTED — Option 1, scoped to genuine ambiguity (backward compatible).**
   Operator decision 2026-08-07: Option 1's mechanism, narrowed so no already-authored plan breaks.
   The `**Files:**` line is treated as the disambiguator rather than as a blanket requirement:

   | Task shape | Behavior | Rationale |
   |---|---|---|
   | Has `**Files:**` | Scan declared targets — **unchanged from today** | The declaration resolves intent: a protected path in prose is provably a citation, not a target. |
   | No `**Files:**`, no foreign protected path in body | Passes — **unchanged from today** | Legacy plans with prose-only tasks keep working. |
   | No `**Files:**` **and** a foreign protected path in the body | **Reject as ambiguous**, directing the author to declare `**Files:**` | The only case where target-vs-citation genuinely cannot be determined. |

   Measured blast radius over the full corpus — per task, stem-aware via the same date-prefix rule as
   `namesOwnFeature` (`protected-artifact-seal.ts:508-523`):

   ```text
   total tasks across all plans                                  : 3099
   tasks with **Files:** (unchanged behavior)                     : 3092
   AMBIGUOUS — no **Files:** AND foreign protected path in body   :    7   (0.23%)
   plans affected                                                 :    5 / 241
   ```

   The seven, in full:

   ```text
   2026-03-30-technical-assessment.md                    Task 4  → .docs/decisions/technical-assessment-YYYY-MM-DD.md
   2026-07-26-daemon-decide-phase-coherence-ownership-971 Task 1  → .docs/plans/*.md          (glob, not a single target)
   codex-fresh-session-per-step-contract.md              Task 7  → .docs/decisions/adr-2026-07-24-provider-awar…
   flow-examples.md                                      Task 8  → .docs/stories/*.md         (glob, not a single target)
   park-reconciliation-refusal-observability-1114.md      Task 16 → .docs/specs/2026-07-04-operator-park.md:37
   ```

   **Task 16 — the exact #1254 failure — is among them.** All five plans are already merged and are
   never re-scanned by the land gate, so the practical impact on existing work is zero.

**Recommendation: Option 4 (adopted).** Deterministic, enforces a contract the repository already
calls authoritative, measured false-positive surface of zero against the 92 citing plans, rejects the
exact task that caused #1254, and requires no change to 99.77% of existing tasks. Options 2 and 3
both keep prose parsing and therefore keep the ambiguity; unscoped Option 1 would have rejected the
42 plans lacking any `**Files:**` line, including ones that never mention a protected path.

**Consequences:**
- Story 5 is rewritten from "harvest prose paths" to the three-case ambiguity rule above.
- The APPROVED ADR carries an additive amendment note recording the change of mechanism.
- Two of the seven name **glob patterns** (`.docs/plans/*.md`), which are not resolvable single
  targets. The implementation must classify a glob over a protected directory as indeterminate and
  reject fail-closed, consistent with `canonicalWorkspaceTarget`'s existing handling of dynamic
  targets (`protected-artifact-seal.ts:167-185`). Added to Story 5.

---

## C2 — Fail-closed wiring contradicts the module's documented fail-open convention

**Type:** contradiction
**Severity:** degrading
**Involves:** Story 4 vs. `worktree-prepare.ts:115`, `:432`, `:459`

### Description

Fail-open is a deliberate, documented, module-wide convention: `:115` describes a sibling as
*"Idempotent … and fail-open like its siblings"*, and `:432` explains the behavior is intentional
*"if .git is inaccessible or read-only."* Story 4 makes one member of that family fail closed,
breaking the module's stated invariant.

This is degrading rather than blocking because it is a deliberate, justified divergence — a
preventive safety control is categorically different from attribution telemetry, and
`.docs/stories/daemon-autonomous-runs-must-fail-closed-on-any-amb.md` establishes fail-closed as the
accepted posture for ambiguity in autonomous runs.

**Resolution:** split the behavior explicitly rather than flipping the whole function. Attribution
hooks (`prepare-commit-msg`, `commit-msg`) keep failing open; the preventive `pre-commit` fails
closed. Update the module comment at `:115` so the convention is documented as *conditional* and the
next reader is not misled. Adopted into Story 4's Done When.

---

## C3 — Protecting `.docs/decisions` must be phase-scoped or it blocks DECIDE authoring

**Type:** overlap
**Severity:** degrading
**Involves:** Stories 3, 5 vs. the ADR lifecycle in `skills/architecture-review/SKILL.md`

### Description

`.docs/decisions` is currently outside `PROTECTED_ARTIFACT_DIRECTORIES`
(`protected-artifact-seal.ts:17-22`). Adding it is correct for BUILD, but ADRs are legitimately
written and mutated during DECIDE: initial authoring, the status transition to APPROVED, supersession
(`Status: SUPERSEDED` + `Superseded by:`), and the additive amendment note the skills mandate when an
accepted assertion is falsified.

Searched `skills/remediate/SKILL.md` and `skills/retro/SKILL.md` for BUILD/SHIP-phase `.docs/decisions`
writes and found none, so the risk is contained — but only if the gate is phase-aware.

**Resolution:** the commit gate must apply protection only during BUILD and SHIP, mirroring
`isActiveStepArtifactException` (`protected-artifact-seal.ts:243-250`, which already gates on
`phase === 'BUILD' || phase === 'SHIP'`). DECIDE-phase ADR authoring and amendment stay writable.
Already covered by Story 3's happy path; added explicitly to its Done When.

---

## C4 — Heavy in-flight overlap on `worktree-prepare.ts`

**Type:** resource contention
**Severity:** advisory (non-blocking, per the skill's advisory-only overlap rule)

`conduct-ts overlap-scan` reports 19+ unmerged spec branches touching
`src/conductor/src/engine/worktree-prepare.ts`, including `origin/spec/self-host-phase6-wiring`,
`origin/spec/per-step-provider-routing-927`, and `origin/spec/daemon-self-host-guardrails`.

No semantic conflict identified — this feature adds a new hook asset and changes one error path,
rather than restructuring the module. Flagged so `/plan` sizes the rebase risk, not as a gate.

---

## Checked and clean

- **Deferred siblings** — no contradiction or double-implementation. #1352 (OS-level sealing) targets
  the *uncommitted* class this gate explicitly does not cover; #1353 (Codex `PreToolUse`) is the
  feedback tier this design keeps non-load-bearing; #1354 (destructive-git) is a disjoint verb set;
  #1009 (dormant `tdd-phase`) is excluded from scope; #627 (Bash-mediated bypass) is *closed* by this
  gate's method-blindness rather than conflicting with it.
- **Existing commit hooks** — `prepare-commit-msg` and `commit-msg` run at different git lifecycle
  points than `pre-commit`; no ordering conflict. `CONDUCT_ENGINE_COMMIT=1` is honored consistently by
  all three (`git-hook-assets.ts:140`).
- **#620 carve-out** (`plan-task-parse.ts:98-108`, digitless headings) — unaffected under Option 1,
  which does not change section attribution. It *was* implicated under prose harvesting, since the
  Task 18 false hit traces to that rule.
- **Story-vs-story** — all 15 pairs among the 6 new stories checked for contradiction, overlap, state,
  resource, and sequencing conflicts. Stories 1–4 (runtime gate) and 5–6 (pre-BUILD gates) operate at
  different lifecycle points and share only the protected-path predicate, which C1's resolution
  unifies.

---

## Status

**PASSED — zero blocking conflicts remain.**

- **C1 — RESOLVED** by Option 4 (operator decision, 2026-08-07). The resolution changes the
  *mechanism* but not the design's structure — no new component, seam, or boundary is introduced, so
  it does not require an architecture re-open in amendment mode. The APPROVED ADR carries an additive
  amendment note; Story 5 is rewritten.
- **C2 — accepted degrading**, resolution folded into Story 4 (split fail-open/fail-closed by control
  class, correct the misleading module comment).
- **C3 — accepted degrading**, resolution folded into Story 3 (protection is phase-scoped to
  BUILD/SHIP, so DECIDE-phase ADR authoring stays writable).
- **C4 — advisory only**, carried to `/plan` as rebase-risk sizing.

Re-check after resolution: clean.

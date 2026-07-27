# Track: 2026-07-26-daemon-decide-phase-coherence-ownership-971

Track: technical

## Rationale

The change corrects an internal phase-ownership boundary in the conductor's daemon dispatch
path: which SDLC phase owns execution of the `coherence_check` step. There is no end-user
product surface — no new command, flag, endpoint, or config key is required by the problem
statement, and the affected artifacts (`PRESEEDED_DONE` in `daemon-cli.ts`, the DECIDE step
table in `steps.ts`, the daemon-wiring integration contract) are all internal harness
mechanism. Acceptance criteria are expressible directly as stories over daemon dispatch
behavior; there are no product requirements to enumerate as FRs. → **technical track**
(skip `/prd`).

Precedent in this repo is consistent: every comparable daemon-boundary guard was specced on
the technical track — `2026-07-09-daemon-merged-pr-guard-on-retry` (technical),
`daemon-false-ship-guard` (technical), `auto-park-markers-written-to-the-worktree-s-daemon`
(technical). Repo-wide the split is 147 technical / 16 product.

## Problem statement (primary framing)

A DECIDE-phase gating step is executed by the autonomous build daemon after operator-led
specification has already completed, so semantic DECIDE authoring happens inside the build
loop rather than inside DECIDE.

## Desired outcomes (from intake, restated observably)

1. A completed spec enters daemon processing with its required coherence decision artifact
   already present, when that artifact is applicable.
2. A daemon-dispatched run never executes the coherence-check authoring step.
3. A missing or invalid required coherence artifact is rejected before BUILD begins rather
   than authored autonomously by the daemon.
4. Tier applicability remains explicit and testable, including the current Small-tier
   exemption unless DECIDE changes that policy.

## Discovery findings (verified)

All claims below were confirmed by direct read at worktree base `b9279061`.

| # | Finding | Basis | Confidence |
|---|---|---|---|
| F1 | `coherence_check` is declared `phase: 'DECIDE'`, `enforcement: 'gating'`, `prerequisites: ['plan']`, `skippableForTiers: ['S']` | `src/conductor/src/engine/steps.ts:119-131` | verified, 100% |
| F2 | `PRESEEDED_DONE` (`src/conductor/src/daemon-cli.ts:285-296`) lists 10 steps and **omits `coherence_check`** | direct read | verified, 100% |
| F3 | `coherence_check` is the **only one of the 9 DECIDE-phase steps** absent from `PRESEEDED_DONE`; the other 8 (`explore`, `complexity`, `prd`, `architecture_diagram`, `architecture_review`, `stories`, `conflict_check`, `plan`) are all present | enumeration of `steps.ts` DECIDE entries vs the list | verified, 100% |
| F4 | The daemon stamps every `PRESEEDED_DONE` entry `'done'` unconditionally on both fresh start and resume | `daemon-cli.ts:882-886` | verified, 100% |
| F5 | `daemon-cli.ts` contains **zero** occurrences of "coherence" — the daemon has no coherence-specific handling at all | `grep -ci coherence` → 0 | verified, 100% |
| F6 | The daemon-wiring integration contract asserts the daemon executes it: `expect(stepsRun[0]).toBe('coherence_check')` | `src/conductor/test/integration/audit-trail-daemon-wiring.integration.test.ts:118-121` | verified, 100% |
| F7 | No test anywhere asserts the daemon should *not* run `coherence_check`; the only test speaking to it asserts the opposite (F6) | repo-wide test search | verified, 95% |
| F8 | Tier-S exemption is **computed**, not pre-stamped: the conductor reads `state.complexity_tier` and marks the step `'skipped'`, emitting a `tier_skip` event | `src/conductor/src/engine/conductor.ts:2549-2557` | verified, 100% |
| F9 | The tier default when `complexity_tier` is absent from state is **`'L'`** (i.e. the step runs) | `conductor.ts:2549` | verified, 100% |
| F10 | The daemon separately seeds `complexity_tier` from the backlog item with fallback `'M'` — so the `'L'` default at F9 is normally masked | `daemon-cli.ts:887` | verified, 100% |
| F11 | The engineer `land` gate **already** validates `.docs/coherence/<plan-stem>.md` fail-closed for non-S tiers, throwing on missing/empty/unparseable/fabricated-id/coverage gaps | `land-spec.ts:294-325`, `coherence-validator.ts:1133-1170, 1277-1391` | verified, 100% |
| F12 | That land gate disengages for `tier === 'S'` (`reason: 'tier-exempt'`) and for a "legacy" change set with no `.docs/coherence/` path | `coherence-validator.ts:1144-1154` | verified, 100% |
| F13 | The post-step artifact verifier for `coherence_check` is the glob `.docs/coherence/*.md` — **not** stem-scoped | `src/conductor/src/engine/artifacts.ts:52` | verified, 100% |
| F14 | Because the daemon's build worktree is a full repo checkout, `.docs/coherence/` already contains unrelated prior-feature `*.md` files, so the F13 glob is satisfied by files that have nothing to do with the feature being built | F13 + `ls .docs/coherence` (5 pre-existing entries at base) | verified, 90% |

**F14 is the sharpest consequence:** the daemon not only executes a DECIDE authoring step, its
completion check for that step cannot detect whether the step produced anything for *this*
feature. The step is both misplaced and unverifiable where it currently sits.

## Correction to the intake's own confidence claim

The intake marked the ownership-split conclusion as *"Inferred with high confidence"*. It is
now **verified** (F1+F2+F3+F6, all direct reads). No part of the problem statement rests on
inference. This was checked before any spec was built on it, per the correctness gate.

## Approaches considered

### A — Add `coherence_check` to the hand-maintained `PRESEEDED_DONE` list

Add the one missing string. Restores symmetry with the other 8 DECIDE steps and satisfies
outcome 2 immediately.

- **Pro:** smallest possible diff; exactly consistent with how the other three tier-skippable
  DECIDE steps (`architecture_diagram`, `architecture_review`, `conflict_check`) are already
  handled — they too are stamped `'done'` unconditionally regardless of tier.
- **Con:** leaves the root cause untouched. The list is hand-maintained with no machinery
  keeping it in sync with `steps.ts`, so the next DECIDE step added drifts exactly the same
  way. This repo's Design Principle explicitly rejects that shape: *"When an agent repeatedly
  violates a rule, the fix is machinery that stamps/validates/rejects at the moment of the
  mistake — not a stronger prompt."* The same logic applies to a hand-maintained constant.
- **Con:** does nothing for outcome 3 (rejection of a missing/invalid artifact) — stamping
  `'done'` is strictly weaker than validating.

### B — Derive the DECIDE preseed set mechanically from `steps.ts`

Replace the hand-written list with a derivation over the step table (`phase === 'DECIDE'`),
retaining the two non-DECIDE entries (`worktree`, `memory`) explicitly, and add a test that
fails if any DECIDE step is not preseeded.

- **Pro:** fixes the *class* of defect, not the instance. Any future DECIDE step is preseeded
  by construction; drift becomes impossible rather than merely corrected once.
- **Pro:** directly serves the repo's stated Design Principle (deterministic machinery over
  discipline).
- **Con:** touches a core dispatch constant, so it needs a deliberate decision about the two
  non-DECIDE members and about whether `phase` is the right ownership predicate (a future
  DECIDE step could legitimately need daemon execution).
- **Con:** larger blast radius than A; warrants an ADR.

### C — Preflight rejection of a missing/invalid required coherence artifact before BUILD

Independent of A/B: before the daemon dispatches, verify that a non-S spec carries a valid
`.docs/coherence/<plan-stem>.md`, and refuse the item if not.

- **Pro:** the only approach that actually satisfies outcome 3. A and B alone convert
  "daemon authors it" into "nobody checks it", which is a regression against outcome 3 for any
  spec that bypassed the land gate (F12's legacy/`S` escapes, or a hand-pushed spec branch
  that never went through `conduct-ts engineer land`).
- **Pro:** it can reuse the already-built, already-tested validator (F11) rather than adding a
  second, divergent notion of validity.
- **Con:** requires choosing the rejection mechanism and its operator-visible result
  (discovery warn-skip vs park vs HALT) — a genuine design decision, not a mechanical one.

### D — Delete `coherence_check` from the step table entirely, leaving only the land gate

- **Pro:** maximal simplification; the land gate (F11) is the real enforcement point.
- **Con:** breaks the interactive `/conduct` path, which legitimately needs a DECIDE step to
  drive `/coherence-check` authoring for M/L features. Discarded.

## Recommended direction

**B + C**, with A as the contained fallback if architecture-review judges B too broad.
B removes the drift class; C preserves the guarantee that A/B would otherwise silently drop.
D is discarded. The precise rejection mechanism for C is deferred to `/architecture-review`
as an ADR — it is the one open design question, and this repo has multiple existing
precedents (discovery warn-skip, park, HALT) that must be weighed rather than guessed.

## Open questions carried into architecture-review

- **OQ1** — What is the operator-visible rejection mechanism for approach C: discovery
  warn-skip (spec silently not built until fixed on main), `park` (feature held, operator
  notified), or HALT? Each already exists in this codebase; the choice determines blast
  radius on an existing merged-spec backlog.
- **OQ2** — Should the derivation predicate in B be `phase === 'DECIDE'`, or an explicit
  per-step ownership flag on the step definition? The former is zero-maintenance but couples
  preseeding to phase; the latter is explicit but is itself a field that can be forgotten.
- **OQ3** — Should the `coherence_check` post-step artifact glob (F13) be tightened to the
  plan stem? It is a latent correctness hole regardless of which approach ships, but may be
  out of scope for this issue.

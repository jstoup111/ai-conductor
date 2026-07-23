# ADR: Coherence gate — authoring step after /plan, deterministic validation at land

**Date:** 2026-07-22
**Status:** APPROVED
**Deciders:** Operator + engineer session (intake jstoup111/ai-conductor#539)

## Context

The DECIDE chain (intake Desired outcomes → PRD FRs → stories → plan tasks) is
self-attested today: coverage claims are authored prose, never verified against the
artifacts they cite (PRD FR-1..6). Two forces are in tension:

- **Semantic judgment is unavoidable** — "does story S express outcome O" is not a
  string match; the adjacent-problem-drift shape (FR-2) is exactly the case a lexical
  check misses.
- **The landing boundary must be deterministic** — per the harness design principle
  ("deterministic where possible; LLM only where necessary") and PRD FR-14/NFR, an
  authoring session's self-report must never be able to pass the gate, and `land` must
  stay fast, offline-capable, and model-free (it already works with a no-remote
  local-commit fallback).

Verified engine facts (basis: direct code reads, 2026-07-22):
- `landSpec` runs a purely deterministic validation ladder
  (`src/conductor/src/engine/engineer/land-spec.ts:89` — dirty-worktree, AuthoringGuard,
  C2 content, DRAFT-ADR, tier/artifact checks) with no LLM dependency.
- The only deterministic→fresh-LLM-judge precedent is `build_review`
  (`step-runners.ts:857`): fresh session, JSON verdict, fail-closed parse.
- Parsers for every id class already exist: `splitStoryBlocks` (`## Story <id>`),
  `collectPlanCoverage` (`**Story:**` lines + `## Coverage Check` table),
  `plan-task-parse.ts` (task-id grammar `[A-Za-z0-9._-]+`), FR-N regexes
  (`artifacts.ts`).

## Options Considered

### Option A: Dedicated /coherence-check step after /plan + deterministic land validator (hybrid)
- **Pros:** semantic judging happens in-session at the cheapest fix point (authoring
  context live); the mapping is a committed, PR-reviewable artifact
  (`.docs/coherence/<plan-stem>.md`); land stays deterministic/model-free; id-level
  fabrication is caught mechanically (a row citing a nonexistent story/task/FR/outcome
  fails set-difference checks).
- **Cons:** the semantic verdicts themselves are same-session-attested — a mapping
  could semantically mislabel a genuine mismatch as covered. Mitigated by: mechanical
  id cross-checks, operator review of the committed artifact in the spec PR, and
  SHIP-phase prd-audit as backstop.

### Option B: Fresh-context LLM judge invoked inside land (build_review pattern)
- **Pros:** zero self-attestation; single unskippable point.
- **Cons:** land gains a model dependency (slow, token-costly, fails when models are
  unavailable — breaking land's offline fallback); verdict is gitignored run evidence,
  not a committed artifact; detection at the latest possible moment forces loops back
  into skills after authoring context is gone.

## Decision

**Option A.** A new `/coherence-check` skill runs as the final DECIDE step (after
`/plan`), authoring `.docs/coherence/<plan-stem>.md` — one row per chain link (intake
outcome → story ids; FR → story ids; story → task ids; task → story/purpose) with a
per-row verdict. `landSpec` gains a `CoherenceValidator` rung in its existing ladder
that (a) parses the artifact fail-closed (absent/empty/unparseable ⇒ reject, FR-14),
(b) mechanically cross-checks every cited id against the real stories/plan/intake/spec
files via the existing parsers, and (c) computes set-difference coverage: unmapped
outcome, uncovered FR (product track), uncovered story, orphan task, or a coverage
claim citing a nonexistent id ⇒ reject with a per-gap report (FR-9).

**Semantic-at-authoring, mechanical-at-land.** The LLM contributes only where judgment
is genuinely required (semantic correspondence, authored in-session); everything
enforceable by code is enforced by code at the boundary.

**Orphan-task rule (FR-5), mechanical form:** a plan task is *covered* iff its
`**Story:**` line cites at least one story id present in the stories file, OR its
`**Type:**` is `infrastructure` or `refactor` AND its `**Story:**` line declares a
non-empty supporting purpose (e.g. `none (infrastructure: test scaffolding for S2)`).
Anything else is an orphan. This reuses the existing per-task `**Story:**`/`**Type:**`
fields — no new plan syntax.

**Track/origin degradation (FR-10/11), mechanical form:** the required layers derive
from committed markers — no `.docs/track/` product marker ⇒ no FR layer required; no
intake outcomes persisted ⇒ no outcome layer required. Absence of a layer is never a
gap; absence of a *required* layer's mapping rows is.

**Tier exemption (FR-12, operator ruling 2026-07-22, conflict-check amendment):**
Small-tier specs are exempt entirely — the `/coherence-check` step is registered
skippable for tier S (joining architecture-diagram/review and conflict-check) and the
land validator engages only when the spec's `.docs/complexity/` tier ≠ S. The
`getSkippableSteps('S')` pinned-set test in `s-tier-pipeline-knobs` is updated in the
same diff that registers the step. The exemption is checked before the fail-closed
missing-artifact rule so it can never be misread as a gap.

**Outcome persistence (conflict-check amendment, resolves
`intake-marker-plan-stem-keying` contradiction):** the claimed intake body's
Desired-outcome bullets are staged in the worktree's gitignored `.pipeline/` at
claim/worktree creation — NOT committed as an idea-slug intake file. `land` commits
them inside the existing plan-stem-keyed `.docs/intake/<plan-stem>.md` marker
(byte-preserved on rewrite). The plan-stem contract, "no idea-slug file," and
"no marker before a plan exists" pins all hold unchanged.

**Model selection for the mapping step (operator directive 2026-07-22):** the
semantic-mapping dispatch steps up by tier — M-tier uses the session-default model;
L-tier pins the opus tier for the `/coherence-check` authoring (the harness pattern of
opus-pinning only the highest-judgment steps). The land validator has no model at any
tier.

## Consequences

### Positive
- The most expensive defect class (DECIDE drift) is caught pre-build at near-zero
  landing cost; coherent specs pass silently (FR-12).
- The mapping artifact gives the operator a one-glance audit surface in every spec PR.
- No new model dependency at the land boundary; offline land still works.

### Negative
- A same-session semantic mislabel can still pass land (caught later by prd-audit);
  accepted as the cost of keeping land deterministic.
- One more DECIDE step and committed artifact class to maintain; S-tier specs pay a
  small authoring cost (but zero operator ceremony when coherent).
- `land-spec.ts` is a high-contention file (29 unmerged branches touch it) — rebase
  risk during build.

### Follow-up Actions
- [ ] New skill `skills/coherence-check/SKILL.md` (+ model-table entry, integrity tests 5/5a/5b)
- [ ] `CoherenceValidator` rung in `landSpec` after the existing tier/artifact checks
- [ ] Engineer SKILL.md + HARNESS.md DECIDE order updated to include the step

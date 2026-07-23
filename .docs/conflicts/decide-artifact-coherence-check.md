# Conflict Check: DECIDE artifact coherence check

**Date:** 2026-07-22 · Tier M · intake jstoup111/ai-conductor#539
**New stories:** `.docs/stories/decide-artifact-coherence-check.md` (14 stories)
**Result:** PASSED after resolution — 2 blocking resolved, 2 degrading accepted (one
amended by operator ruling), 0 remaining.

## Scope of the scan

All 179 existing `.docs/stories/` files inventoried; 16 highest-adjacency files read in
full (land validation, intake markers, dedup, DECIDE ordering, tier knobs, FR
coverage); corpus-wide grep for `.docs/intake/`, `.docs/coherence`, `Source-Ref`,
coverage semantics. Each asserted conflict below is grounded in quoted text
(~95% confidence, verified reads); pairs examined and judged clean are listed at the end.

## Conflict 1: Intake-marker keying & timing — RESOLVED

**Stories involved:** New Story 1 (outcomes travel) vs `2026-07-03-intake-marker-plan-stem-keying`, `multi-operator-ownership-slice-b` (Story 3), `2026-07-22-idea-scoped-land-artifact-resolution` (TS-4)
**Type:** contradiction · **Severity:** blocking (resolved)

Existing pinned contracts: marker is `.docs/intake/<plan-stem>.md`, written at land, "no
`.docs/intake/<idea-slug>.md` file is created", "no marker written before a plan exists
under any name" (contract-tested). Original Story 1 wrote a committed idea-slug marker
at claim time — impossible to plan-stem-key (no plan yet) and directly forbidden.

**Resolution (operator-selected):** early persistence is a gitignored `.pipeline/`
staging file; `land` commits the outcome bullets inside the existing plan-stem-keyed
marker (byte-preserved on rewrite). All pins hold unchanged. Story 1 and both ADRs
amended. Note: the corpus was already split on this filename
(`engineer-worktree-isolation` FR-3 and `intake-issue-pr-link-autoclose` say `<slug>`)
— this feature now takes no side at claim time; the land-time plan-stem convention is
the single committed truth.

## Conflict 2: Duplicate-claim scan key — RESOLVED

**Stories involved:** New Story 8 vs `content-aware-shipped-work-dedup-never-re-dispatch` (Story 2)
**Type:** state-conflict / resource-contention · **Severity:** blocking (resolved)

Story 8 scanned `.docs/shipped/*.md` for `Source-Ref`, but the shipped-record schema
persists only `slug/spec_hash/pr/shipped` — the scan key doesn't exist there, and two
dedup mechanisms with different keys would share the dir.

**Resolution (operator-selected):** blocking scan reads default-branch
`.docs/intake/*.md` only (carries `Source-Ref`, merges with the spec, earlier than the
shipped record). `.docs/shipped/` excluded; shipped-record schema untouched. Story 8
and ADR 2 amended. The intake ledger's "sole dedup authority"
(`phase-9.3b-github-intake-writeback` Story 8) is capture-time scope; the land-time
claim check is a different enforcement point — wording noted, no mechanism collision.

## Conflict 3: Pinned DECIDE order & S-tier pins — ACCEPTED (amended by operator ruling)

**Stories involved:** New Stories 2/13 vs `decide-pipeline-restructure` (S5), `s-tier-pipeline-knobs` (Story 3)
**Type:** sequencing · **Severity:** degrading (accepted)

The canonical chain pins end at `plan`; `/coherence-check` extends the tail. Operator
ruling additionally exempts S-tier entirely, so the new step registers as
`skippableForTiers: ['S']` — which changes `getSkippableSteps('S')`'s pinned "exactly
this set" output. **Compromise accepted:** the plan carries explicit tasks updating the
canonical order (engineer SKILL.md, HARNESS.md, step registry, model table) and the
pinned-set test **in the same diff** that registers the step. Existing step definitions
gain/lose nothing (diff guard holds).

## Conflict 4: Double story→task coverage gate — ACCEPTED

**Stories involved:** New Story 5 vs `decide-pipeline-restructure` (S9), `features/plan/ST-015`, `features/conduct/ST-006`
**Type:** overlap · **Severity:** degrading (accepted)

Plan-time gate (criterion-level, self-attested, authoring session) and land-time
validator (story-level, mechanical, boundary) overlap. Accepted as intentional
defense-in-depth: they can only diverge when self-attestation is wrong, which is the
defect class this feature exists to catch; the validator wins. No gate removed.

## Pairs examined and judged clean

- **`intake-convention-issues-state-what-and-desired-ou.md`:** supporting dependency —
  Story 1's staging parses the `## Desired outcome` section this convention requires
  (coupling to the heading name noted for the plan).
- **`intake-only-enforcement.md`:** its "no downstream enforcement" scope is
  priority/size/linking on claim/poll/daemon/CI surfaces — disjoint from land coherence.
- **`writing-system-tests-fr-coverage.md` / `prd-audit-*`:** BUILD-phase (gitignored
  disposition table) and SHIP-phase (FR-vs-code) FR layers are complementary to the
  DECIDE-phase committed mapping; three phases, three evidence bases, no contradiction.
- **`spec-authoring-is-blind-to-unmerged-dependent-work.md`:** same advisory stance;
  ADR 2 amended to REUSE its `overlap-scan` machinery for the open-PR warn (no second
  scanner).
- **`owner-stamped-at-authoring.md`:** shared `writeIntakeMarker` writer; chat-origin
  no-op-returns-null path loses nothing (chat ideas have no outcomes to stage).
- **`handoff-push-spec-branch.md`, `engineer-worktree-isolation.md` (FR-9),
  `intake-issue-pr-link-autoclose.md`, `2026-07-08-gate-writeback-skip-notice-dedup.md`,
  `dependency-ordered-intake-and-dispatch.md`:** disjoint surfaces or consistent
  conventions; no conflicting text found.

## Artifacts amended by this check

- `.docs/stories/decide-artifact-coherence-check.md` — Stories 1, 8, 13, 14
- `.docs/specs/2026-07-22-decide-artifact-coherence-check.md` — FR-12, FR-13, acceptance criteria
- `adr-2026-07-22-coherence-gate-placement-and-validation-split` — staging, S exemption, L-tier opus step-up (in-place amendment; ADR authored and unlanded in this same session, no supersede chain needed)
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim` — intake-markers-only scan, overlap-scan reuse
- Both architecture diagrams — staging node, tier annotations, dup-scan wording

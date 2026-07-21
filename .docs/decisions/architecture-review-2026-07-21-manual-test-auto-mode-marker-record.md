# Architecture Review: manual_test auto-mode marker record

**Date:** 2026-07-21
**Mode:** Lightweight (Tier M) — Sections 2 (Feasibility) + 4 (Alignment)
**Reviewed:** intake #385, track marker (technical), complexity marker (M), sequence diagram
`manual-test-completion.md`, ADR `adr-2026-07-21-manual-test-auto-mode-marker-record`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new deps. New TS module + a predicate branch + skill/doc edits, all within the existing `src/conductor` + `skills/` surface. **Feasible.** |
| Prerequisites | None. The `.pipeline` dir and the step's absolute-pipeline-dir system-prompt channel already exist (used by finish-record). |
| Integration surface | Three surfaces: `manual-test-record` CLI (new), `CUSTOM_COMPLETION_PREDICATES.manual_test` (extended), `buildRetryHint` (extended), plus the skill contract. Bounded and named in the ADR Wiring Surface. |
| Data implications | None. Appends an attempt section to a gitignored run-evidence file; no schema, no migration. |
| Performance risk | None. One extra file append + parse per step; negligible. |
| Worktree isolation | Writes to the worktree's own absolute `.pipeline` path (the finish-record fix's lesson: never a relative write from a `cd`'d main checkout). No shared resource, no port/db. |

Direct feasibility evidence: the `finish-record` trio
(`detectFinishRecordCommand`/`dispatchFinishRecord`/`makeProductionFinishRecordRunners`,
wired at `index.ts:350-352`) is the working template this reuses verbatim.

## Alignment

- **Design Principle (deterministic where possible).** Approach C moves the *write* to
  engine machinery (a fail-closed CLID) while leaving *evidence* with the agent — the correct
  split, identical to how #281 handled `finish-choice`. Aligned.
- **Precedent consistency.** Mirrors adr-2026-07-11 (finish-record) and the #297
  acceptance-specs gate: marker is the commit point, append-only attempt sections, retry hint
  points at the command. Aligned; no new pattern introduced.
- **#367 whitewash guard.** Preserved: SKIP is valid only when the latest attempt has no FAIL
  rows; FAIL-row recording and the FAIL→PASS-requires-HEAD-movement rule are untouched. The
  SKIP sentinel is a *recorded, reasoned* completion, not a silent auto-skip — explicitly
  avoiding the hazard `steps.ts:183` guards against.
- **Parallel-validation fan-out group.** The record CLI keeps the existing file shape
  (append `## Attempt N`), so the SHIP group members that read status/results are unaffected;
  only a new recognized SKIP section is added. Aligned (conflict-check will verify this seam).
- **State management.** No boolean-flag smell; the SKIP sentinel is an explicit recognized
  section, not an implicit flag. Completion stays a pure function of the file's latest attempt.
- **Security boundaries.** No new endpoints, inputs, or auth surface. N/A.

## Wiring Surface

See the ADR's **Wiring Surface (design-time)** section — every new production surface
(`manual-test-record` subcommand, SKIP-sentinel predicate branch, retry hint, skill call)
names where it is invoked in production. Reproduced by reference here to satisfy the
Medium-tier requirement.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| SKIP sentinel format collides with #367 FAIL-row parsing or the parallel-validation reader | Integration | Low | Medium | Choose a sentinel that adds a distinct section and no FAIL/PASS rows; conflict-check verifies the seam; unit tests assert the guard still fires on FAIL. |
| Skill drift — an exit path forgets the CLI call | Knowledge | Low | Medium | Retry hint (D4) points at the exact command; engine writer means a single call site per branch; verification-checklist line added. |

No High-impact risks.

## D5 — manual_test S-tier skippable (added at operator request)

**Feasibility.** One-line change: `skippableForTiers: [] → ['S']` on the `manual_test` step def
(`steps.ts:169-188`), consumed by the existing selector tier-skip check (`selector.ts:71`). No
new code path. **Feasible, verified.**

**Alignment.** Established pattern — `conflict_check` (gating, `['S']`) and `acceptance_specs`
(gating, `['S']`) already pair `enforcement: gating` with S-tier skip. D5 changes tier policy
only; enforcement stays `gating` and locked (`ENFORCEMENT_LOCKED_STEPS`, `skill-resolver.ts`), so
it does not violate fail-routing #367's "auto-skip closed" (which governs skipping a *failing*
manual_test, not a pre-run tier policy). A `skipped` step satisfies `prd_audit`'s prerequisite
(`state.ts:101`). Aligned; no new pattern.

**Risk.** Low — an S-tier feature no longer manually tested. Accepted policy: S-tier is trivial
work already exempt from architecture_review/conflict_check/acceptance_specs. No High-impact risk.

## ADRs Created

- `adr-2026-07-21-manual-test-auto-mode-marker-record` — **APPROVED** (operator-confirmed in
  this engineer session; Approach C + Decision D5 S-tier skip).

## Conditions

None. Clean APPROVED. (A review marker is still written because a new ADR was created — the
skill requires the ADR to be surfaced for confirmation.)

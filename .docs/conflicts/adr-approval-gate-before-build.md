# Conflict Check: ADR approval enforced before build

**Date:** 2026-08-08
**Feature:** adr-approval-gate-before-build
**Issue:** jstoup111/ai-conductor#662
**Stories scanned:** `.docs/stories/adr-approval-gate-before-build.md` (Stories 1–7), plus a sweep
of `.docs/stories/` and `.docs/plans/` for overlapping ADR-gate or discovery-eligibility behavior
**Result:** **PASS — zero blocking conflicts.** Two degrading items accepted, one accepted-artifact
amendment applied.

## Scope of the scan

All five conflict types were checked pairwise across Stories 1–7. The seven stories are
sequentially dependent (parser → migration → rung 1 → interface → rung 2 → backstop → vocabulary)
and none asserts behavior that contradicts another. In particular:

- **Story 1 vs Story 6** — Story 1 replaces the approval signal; Story 6 requires the as-built
  backstop be unchanged. **Not a conflict (verified, 95%):** the as-built path reaches its verdict
  by parsing a `Verdict:` line in a review artifact (`artifacts.ts` ~2323-2410), and never calls
  `hasDraftAdr`. The two systems are already decoupled, which is exactly what Story 6 asserts.
- **Story 3 vs Story 5** — both reject on the same condition at different rungs. **Overlap by
  design, not contention:** they act on disjoint triggers (a land invocation vs a discovery pass)
  and disjoint state (worktree files vs base-branch tree). ADR-1 makes the shared definition the
  point rather than a hazard.
- **Story 4 vs Story 5** — sequencing: Story 5 cannot be implemented before Story 4's interface
  extension exists. This is an ordering constraint for `/plan`, not a circular dependency.
- **Story 7 vs Story 1** — the vocabulary fix must name exactly the allowlist Story 1 implements.
  Consistent; Story 7's Done When references the same two terminal states.

No other feature in `.docs/stories/` or `.docs/plans/` specifies behavior on the ADR gate or on
daemon discovery eligibility. **Verified (90%)** by content search; a same-file textual overlap is
recorded separately below.

## Degrading item 1: test-fake breakage from the interface extension

**Type:** resource-contention (shared type contract)
**Severity:** degrading — compile-time, caught immediately, no runtime risk

**Description.** Story 4 adds `listAdrFiles()` to `BacklogTreeSource`. **Verified (100%):** the
interface is explicitly named by test doubles in 5 files with **13 fake literals** total —
`daemon-backlog.test.ts` (8), `blocked-specs-daemon-status.acceptance.test.ts` (2),
`shipped-record.test.ts` (1), `dependency-ordered-intake-and-dispatch.test.ts` (1),
`daemon-issue-priority-scheduling.test.ts` (1). Adding a **required** member fails the TypeScript
build in all of them until each is updated.

**Resolution Options.**
1. Declare the member **optional** (`listAdrFiles?()`), defaulting a missing implementation to `[]`.
   No test churn; but a fake silently defaulting to "no ADRs" reads as a pass, which hides the new
   gate from every existing daemon test.
2. Declare it **required** and update all 13 literals. Compile errors act as a forcing function so
   each fake states its intent explicitly.
3. Introduce a base/default implementation object that fakes spread over.

**Recommendation: Option 2.** The compile error is the feature here — it guarantees no discovery
test silently bypasses rung 2. Option 1 conflicts with the fail-closed posture of both ADRs by
making absence indistinguishable from conformance in exactly the tests that should prove the gate.
This is a `/plan` sequencing obligation: Story 4's task must update all 13 literals in the same
task that changes the interface, or the build is red between tasks.

## Degrading item 2: documentation-file overlap with open PR #1359

**Type:** overlap (same files, different sections)
**Severity:** degrading — textual merge, no semantic contradiction

**Description.** **Verified (100%)** by diffing open PRs against this feature's touched paths: of
8 open PRs, only **#1359** (`feat/daemon-daemon-autonomous-runs-must-fail-closed-on-any-amb`)
overlaps, and only on `docs/explanation/gates.md` and `docs/runbooks/stalled-or-stuck-feature.md`.
**No open PR touches any source file this feature changes** — not `daemon-backlog.ts`,
`artifacts.ts`, `backlog-tree-source.ts`, `land-spec.ts`, or `authoring.ts`.

Notably #1359 is thematically adjacent (autonomous runs failing closed on ambiguity), so the two
docs edits should read coherently rather than merely merge cleanly.

**Recommendation:** proceed. Whichever lands second rebases the docs hunks. No story changes.

## Cross-feature interaction (not a conflict — recorded deliberately)

Repo-wide ADR conformance becomes a **new global precondition the moment this merges**. Any
in-flight branch that authors an ADR with a non-allowlisted status will be blocked at both land and
dispatch, even though nothing about that branch changed.

**Verified (100%):** the corpus on this spec branch is **240/240 conforming** after the three
legacy 2026-07-13 ADRs were stamped, so nothing on the default branch is blocked today. The residual
exposure is limited to unmerged branches authoring new ADRs. Open spec PR **#1357** was checked and
touches none of this feature's files.

This is an accepted consequence of the operator's repo-wide scope decision, documented in
`adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition` under Negative Consequences,
and mitigated by Story 5's requirement that the remedy name the offending file and its status.

## Accepted-artifact amendment applied

Story 2's negative path asserted that the existing `hasDraftAdr` test suite must be migrated rather
than deleted. **Verified (100%):** no such suite exists — across **733 test files, zero** reference
`hasDraftAdr`. The signal has always been untested, which is part of why the vocabulary defect
survived undetected.

An additive amendment note was placed beside the original assertion in
`.docs/stories/adr-approval-gate-before-build.md` per the append-only convention; the original text
is retained. Consequence for `/plan`: Story 1's fixture matrix is **first-time** coverage, not a
port, so no task should be scheduled to "migrate existing tests".

## Verdict

**Conflict check PASSED.** Zero blocking conflicts. Two degrading items accepted with
recommendations carried into `/plan`. One accepted-artifact amendment applied during this DECIDE
pass. Proceed to `/plan`.

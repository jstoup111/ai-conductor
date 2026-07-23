# Architecture Review (lightweight, Tier M): build_review fresh-base + disposition

**Feature:** `build-review-grades-plan-vs-diff-against-a-stale-o`
**Date:** 2026-07-23
**Verdict: APPROVED** — proceed to stories.

## Feasibility

- The fetch/default-branch derivation already exists in `rebase.ts#resolveBase`
  (fetches `origin <default>`, falls back local). Mechanism A is a refactor-and-reuse,
  not new git machinery. Confidence: verified against source.
- The disposition layer hooks the existing build_review FAIL branch in the
  conductor's retry loop — the same seam #569's stall-remediation routing used, so
  the wiring pattern is proven.
- The regrade-once counter follows existing `.pipeline/` run-evidence conventions
  (cf. no-evidence attempts counter in `task-evidence.ts`).

## Alignment

- **Deterministic where possible (CLAUDE.md design principle):** staleness detection
  (`ls-remote` vs tracking ref) and content-persistence (recomputed diff) are both
  mechanical; no LLM in the loop. The grader stays the only judgement component.
- **#773 completion authority preserved:** build_review remains the completeness
  judge; this spec only guarantees the judge sees a truthful diff and that its FAIL
  routes deterministically.
- **Non-overlap with in-flight #859 spec (trailer-union build completion):** that
  spec changes the *build step's* completion predicate; this one changes the
  *build_review step's* inputs and failure routing. Shared files possible in
  `conductor.ts` — flagged to conflict-check.

## Risks

- A fetch inside grading mutates shared worktree refs; benign (fetch is additive)
  but noted for the conflict check with concurrent daemon fetches — git handles
  concurrent fetch/ref update with its own locking; failure degrades to advisory.
- Offline/dev repos with no origin must keep today's behavior — covered by an
  explicit degrade story with a pinned test.
- HALT-on-second-stale must carry actionable evidence or it trades a silent bug for
  an opaque halt — the HALT body schema is specified in the plan.

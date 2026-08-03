# Architecture Review: Plan-scope containment at the commit boundary

**Date:** 2026-08-02
**Tier:** M — lightweight review
**Verdict:** APPROVED, with three binding constraints carried into the plan
**ADR:** `.docs/decisions/adr-2026-08-02-plan-scope-containment-at-commit-boundary.md`

## Scope of review

Technical feasibility and architectural alignment of adding a deterministic plan-scope
containment check at the git commit boundary, plus an engine-side backstop.

## Feasibility

**Confirmed feasible with no new infrastructure.** Every required primitive exists in
production use:

| Need | Existing component | Status |
| --- | --- | --- |
| Per-task declared paths from the plan | `parsePlanTaskPaths` (`plan-task-parse.ts:70`) | in use by 4 modules |
| Path matching rule | `fileMatchesPlanPath` (`autoheal.ts:41`) | in use, incident-hardened |
| Active task id at commit time | `Task:` trailer stamped by `prepare-commit-msg` from `.pipeline/current-task` | live |
| Enforcement point | `COMMIT_MSG_HOOK` guarded block (`git-hook-assets.ts:90+`) | live, already rejects malformed trailers |
| Row seeding with plan access | `seedTaskStatus(projectRoot, planPath)` (`task-seed.ts:153`) | live, already parses the plan |
| Machinery path exclusions | `MACHINERY_AUTHORED_PATHS` (`build-review-inputs.ts:60`) | live |
| In-diff, BUILD-writable gate record | `DOCS_WRITE_ALWAYS_ALLOWED` (`phase-marker.ts:72`) | live, holds `.docs/release-waivers/` |
| Backstop gate pattern | `runPerTaskCommitFloor` (`per-task-commit-floor.ts:28`) | live |

The work is composition, not invention. That is the main reason this stays M rather than L.

## Alignment

**Design Principle — deterministic where possible.** Directly on target. This replaces an
LLM-judged, end-of-build detection with a mechanical check that fires at the point of
violation, token-free. The repository's stated remedy for a repeatedly violated rule is
"machinery that stamps/validates/rejects at the moment of the mistake — not a stronger
prompt." This is exactly that.

**Consistency with #989.** The review specifically checked that the new gate does not
reintroduce the harm recorded in `build-review-disposition.ts:255-274`, where the scope
repair on commit `0bf9d809b` deleted a legitimately needed engine fix. It does not: the hook
refuses a commit and leaves the working tree intact, and the ADR forbids naming deletion as
the remedy. Scope failures still route to `remediate` as a plan-level decision.

**No authority creep.** `build_review` remains the completion authority. Nothing here marks a
task `completed` or changes routing.

## Findings

### F1 — Dead code must be replaced, not merely fixed (accepted, drives Task ordering)

The existing hook block is dead in two independent ways: an unpopulated data source and the
wrong question (multi-task bundling rather than out-of-plan containment). Fixing only the
data source would leave a check that still cannot detect the #1074 case. The plan must
replace the block, and a regression test must prove the *containment* question is asked.

### F2 — Fail-open surface is large and must be enumerated, not assumed (binding)

A commit-blocking hook on the daemon's critical path is the highest-risk element here. Every
abstention condition must be individually tested, not covered by one "happy path plus one
negative" pair. Required abstentions: legacy plan with no `Files:` block anywhere; missing,
malformed, or unparseable `task-status.json`; no row for the stamped id; row with absent or
empty `files`; no `Task:` trailer; machinery-allowlisted paths; and every inherited exemption
(merge, `--amend`, rebase replay, `CONDUCT_ENGINE_COMMIT=1`). This is why the story set is 6
and not 2.

### F3 — Matching rule must not be duplicated in shell (binding)

`parsePlanTaskPaths` and `fileMatchesPlanPath` encode grammar hardened by three recorded
incidents (#548 phantom inline-prose paths, #578 and #620 phantom task headers). A bash or
inline-`node` re-implementation would fork that grammar with no test coverage. The hook must
call into the built engine; the TypeScript function stays the single source of truth. This
also means the check inherits the #625 stale-`dist` risk — a further argument for the
backstop.

### F4 — Breaking-surface classification must be resolved in the plan (binding)

The change edits `hook wiring` and the `commit-msg` asset, a canonical breaking surface for
the self-host release gate. Because it changes real hook *behavior* (a new rejection path),
the migration-gate waiver is **not** appropriate — the ADR waiver carve-out covers
internal-only edits, and this is not one. The plan must carry a real `## Migration` block
with a runnable `bash migration` fence that re-wires hooks in existing worktrees. Consumers
with provisioned worktrees will otherwise run the old asset.

### F5 — Disposition placement was the one genuine design fork (resolved)

`.pipeline/` fails the "reviewable" requirement (excluded from the graded diff as
machinery-authored); amending the plan's `Files:` block fails because `.docs/plans/` is frozen
during BUILD and is itself a Scope failure when modified mid-build. `.docs/scope-dispositions/`
added to `DOCS_WRITE_ALWAYS_ALLOWED` satisfies both constraints and reuses the release-waiver
pattern verbatim. Resolved; no open question remains.

## Risks accepted

| Risk | Severity | Mitigation |
| --- | --- | --- |
| False positive blocks a live daemon build | High | Blanket fail-open on all F2 conditions; inherited exemption ladder; machinery allowlist |
| Hook not wired (fail-open provisioning, #625 stale dist) | Medium | Engine-side containment backstop at the build-step boundary |
| Disposition used as a rubber stamp | Low | Committed and in-diff; `build_review`'s semantic rubric still judges the widened work |
| Under-declared plans cause friction | Low | Intended signal; resolved by a recorded disposition, never by deleting work |

## Binding constraints on the plan

1. Replace the dead hook block outright; regression-test the containment question against the
   #1074 shape (F1).
2. Enumerate and individually test every abstention condition in F2.
3. No re-implementation of path parsing or matching in shell (F3).
4. Include a real runnable `## Migration` block; a waiver is not acceptable here (F4).
5. Ship the engine-side backstop in the same feature, not a follow-up — it is the only
   coverage when hook wiring fails open.

## Verdict

**APPROVED.** The approach is well-grounded in existing machinery, aligns with the
repository's core design principle, and avoids reintroducing a known harm. The risk is
concentrated in false positives on the daemon's critical path, and is adequately controlled by
comprehensive fail-open plus the backstop. All ADRs for this feature are APPROVED.

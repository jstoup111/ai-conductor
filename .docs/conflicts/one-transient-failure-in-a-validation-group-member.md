# Conflict Report: One transient failure in a validation-group member discards its siblings (#1425)

**Date:** 2026-09-06
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`). Examined: all 305 `adr-*.md` under `.docs/decisions/` (full pass, delegated; see the 2026-09-06 architecture review's Alignment section for the narrowed set — 22 ADRs with subject overlap — and its reconciliation of the one genuine tension, adr-2026-08-03). Narrowed-out: every ADR whose subject is outside concurrent groups, retry budgets, state persistence, halts, resume/re-dispatch, verdict identity, kickback budgets, or signals. Supersession parsing at this scope excluded no ADR as fully superseded; adr-2026-07-13-session-fresh-verdict-artifacts (partially superseded by adr-2026-08-25) was retained and found non-conflicting.
**Stories scanned:** all of `.docs/stories/` (pairwise against this feature's stories where a behavior, gate, or state key is shared); 20 files touch the validation group, no-verdict, or `done`/`stale` reuse and were read in full.
**Result after resolution:** 0 blocking, 0 degrading.

## Conflict: Retry-budget story duplicates an accepted, already-built #2190 story

**Stories involved:** Story 1 "A validation-group branch gets the same retry budget as the serial walk" (this spec, original numbering) vs Story 1 "Validation-group members get the same attempt budget as the serial path" (#2190)
**Files:** `.docs/stories/one-transient-failure-in-a-validation-group-member.md` vs `.docs/stories/a-halted-feature-only-re-runs-when-a-human-clears-.md`
**Type:** overlap (behavioral overlap + resource contention on the same `conductor.ts` call site)
**Severity:** blocking

**Description:** #2190's accepted Story 1 Done-When reads "Both validation-group member dispatch sites pass the resolved serial attempt budget instead of the literal `1`". PR #2206 (draft, build complete through `build_review`, parked at a SHIP as-built halt) already carries `runGroupBranch(…, resolved.max_retries)`. Two merged specs would each claim the same delivery, and the second build to land would rebase onto an identical edit of the same line. Both directions checked: satisfying #2190 fully leaves nothing for this story to deliver; satisfying this story fully makes #2190's Story 1 a no-op — an overlap, not an oscillation.

**Resolution Options:**
1. Drop the story from this spec; scope this spec to sibling retention; link #1425 as blocked by #2190 so the daemon gate sequences the build after PR #2206 merges.
2. Keep both; accept duplicate delivery and the rebase collision.
3. Remove the story from #2190 — already built there.

**Recommendation:** Option 1 — no wasted build, one owner per behavior, and the retention half genuinely depends on a real budget existing.

**Resolution chosen (operator, 2026-09-06):** Option 1. Story removed and the remaining stories renumbered 1–3; track marker, architecture review, ADR amendment, and sequence diagram amended additively to attribute the budget to #2190; GitHub dependency link #1425 ← blocked by #2190 added.

## Examined and found compatible

- `ship-tail-parallel-validation-serial-publication-922` ST-922-1: "only those members are marked stale and the existing validation group may rerun them in parallel while preserving green siblings" — same direction as Story 3 here.
- `a-gate-halt-marks-a-completed-build-failed-and-the` Story 3: "completed sibling steps keep their own verdicts unchanged" at a group halt; "a validation step's runner itself crashes → recorded `failed`, not `refused`" — consistent with Stories 1–2 here (retention writes `done` for satisfied siblings only and leaves the failed member's stamping as today).
- `a-kickback-restages-a-skipped-manual-test-as-stale` Stories 1–2: `done → stale` on kickback succeeds; `skipped` is never restaged — Story 3's kickback negative relies on exactly this.
- `gate-step-completion-validates-against-code-state-` Stories 2–5 and `post-rebase-build-invalidation-dispatches-a-full-b` Story 3: non-tree-attesting gates are always invalidated by a file-changing rebase — Story 3's rebase negative relies on this.
- `parallel-validation-phase-fan-out-manual-test-prd-` (#469) "no partial join" criterion forbids remediating around a broken sibling; retention records, it does not remediate. Its "a resumed run does not re-dispatch already-`done` members" criterion is the mechanism Story 3 depends on.
- `retry-classify-rerun-vs-route`, `retry-as-escalation`: govern the budget behavior now owned by #2190; no interaction with retention.

# Conflict Report: Deferred Feature-Worktree Reap (#1091)

**Date:** 2026-07-29
**Stories checked:** `.docs/stories/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` (S1-S6)
against all accepted stories touching worktree teardown, the mergeable-watch registry, resolution
eligibility, parked-feature reconciliation, and `.pipeline` lifecycle.
**Result:** 0 blocking conflicts remaining · 2 degrading conflicts accepted · 1 resolution applied

## Scope of the scan

Candidate story files were selected by grepping `.docs/stories/` for `teardownWorktree`,
`worktree remove`, `reap`, `mergeable-watch`, and `.worktrees/<slug>` path forms, then each hit was
read and reasoned against S1-S6 pairwise. Files examined in full:
`auto-resolve-open-pr-conflicts.md`, `mergeable-watch-registry-size-cap.md`,
`mid-loop-pipeline-wipe-549.md`, `parked-feature-reconciliation-1060.md`,
`durable-shipped-record-enforcement-and-backfill-916-936.md`, `daemon-false-ship-guard.md`,
`features/conduct/ST-007-worktree-isolation.md`, `features/conduct/ST-010-feature-completion.md`.
Files matching only on incidental mentions (`condense-readme-relocate-docs.md`,
`tmux-leak-guard-…`, `reenable-bin-setup-worktree-smoke.md`) were checked and dismissed as
non-interacting.

---

## Conflict 1: The sweep reap can remove a worktree whose run is in flight

**Stories involved:** S2 (sweep reaps a merged feature) vs `mid-loop-pipeline-wipe-549` Story 5
("No cleanup removes the shared `.pipeline` root")
**Files:** this feature's stories vs `.docs/stories/mid-loop-pipeline-wipe-549.md`
**Type:** state-conflict
**Severity:** degrading — **accepted by the operator, 2026-07-29**

**Description:**
Story 5 of `mid-loop-pipeline-wipe-549` is accepted and carries an explicit Done-When: *"A
grep/audit test confirms no cleanup path issues `rm -rf` (or `worktree remove`) on a `.pipeline` root
belonging to an in-progress run."* S2's reap is a `worktree remove` and, as designed, carries no
in-flight guard — only S5's operator reclaim verb does. The live incident that motivated #1091
(`step-completion-globs-are-feature-unscoped-so-anot`, 2026-07-29) was exactly this shape: the
shipped record was committed, the worktree was removed under a still-running session, and the next
dispatch died on `Path ... does not exist`.

**Resolution options presented:**
1. Add an in-flight run guard to the sweep reap, mirroring
   `adr-2026-07-27-ancestry-proven-park-reconciliation` rule 5.
2. Accept the conflict on the grounds that the underlying cause is being removed elsewhere.
3. Kick back to architecture-review in amendment mode.

**Operator decision:** option 2 — accept. Rationale: **#564** (OPEN, priority critical, size L,
milestone v1.0 — "Pipeline run-state lives inside the worktree…") relocates run-state out of the
worktree, and its first desired outcome is verbatim *"A feature's run-state survives worktree
removal … observable by removing the worktree and confirming the run can still resume from its
state."* Once #564 lands, removing a worktree is no longer a `.pipeline` destruction event and the
Story 5 audit is satisfied structurally rather than by a per-caller guard.

**Accepted residual risk (recorded, not resolved):** #564 makes the *state* survive; it does not make
a live session survive having its working directory removed underneath it. `git worktree remove
--force` against a directory a running session holds as its cwd still breaks that session — this is
the same reasoning that led the ADR to reject #564 as a substitute for #1091 (option B). Until either
a lease interlock (the ADR's rejected option C) or #1150-class work exists, a merge that lands while
a session is still running in the feature worktree can still interrupt that session. #1091 narrows
the window substantially — the reap now requires the record to be on main, which is strictly later
than PR-open — but does not close it.

**Sequencing note for `/plan`:** #1091 and #564 are both v1.0. If #1091 ships first, this residual is
live in the interim.

---

## Conflict 2: A registry-capped entry loses its reap and would be invisible

**Stories involved:** S2/S5 vs `mergeable-watch-registry-size-cap` Stories 1-3
**Files:** this feature's stories vs `.docs/stories/mergeable-watch-registry-size-cap.md`
**Type:** resource-contention
**Severity:** blocking — **resolved**

**Description:**
The registry cap drops over-cap survivors from `.daemon/mergeable-watch.jsonl` after the normal
state-based prune. Before #1091 a dropped entry lost only its label management. After #1091 the
registry is also the trigger for the reap, so a dropped entry's worktree is never reaped by any
sweep. If S5's retained-worktree dashboard category were derived from the registry, that worktree
would additionally be invisible — an unbounded, unlistable leak, which is precisely what issue
#1091's outcome 6 forbids.

**Resolution options presented:**
1. Enumerate the retained-worktree dashboard category from disk (`.worktrees/*`), not from the watch
   registry, so registry membership never determines visibility.
2. Accept the invisibility as degrading.

**Operator decision:** option 1 — enumerate worktrees from disk.

**Applied to the stories:**
- **S5** now specifies that the retained-worktree category is enumerated from the `.worktrees/`
  directory and is therefore independent of watch-registry membership, with a negative path asserting
  a slug whose registry entry was dropped by the cap still appears and is still reclaimable.
- **S2** now carries a negative path noting that an entry dropped by the cap receives no
  sweep-driven reap and falls to the reclaim path — no silent loss of the disposition.

The registry cap's own accepted behavior is unchanged; nothing in `mergeable-watch-registry-size-cap`
needed modification.

---

## Conflict 3: Rebase-resolution eligibility skips every retained feature

**Stories involved:** S6 vs `auto-resolve-open-pr-conflicts` — "Resolution runs in a dedicated
transient worktree"
**Files:** this feature's stories vs `.docs/stories/auto-resolve-open-pr-conflicts.md`
**Type:** behavioral overlap
**Severity:** degrading — **accepted by the operator, 2026-07-29 (pre-existing decision)**

**Description:**
The accepted story asserts, as a negative path: *"Given the feature's build worktree
`.worktrees/<slug>` currently exists (mid-build, halted, …) when eligibility is evaluated, then
resolution is skipped with a logged reason and no `resolve-<slug>` worktree is created (daemon-owned
precedence)."* Retention makes that precondition true for every open implementation PR, so automatic
rebase-resolution is suppressed wholesale.

**Not a contradiction:** S6's negative path asserts exactly the same observable behavior as the
accepted story, so the two are consistent at the story level. The conflict is at the *outcome*
level — issue #1091's DO-5 is only partially met.

**Resolution:** already settled during `/architecture-review`. Descoped to **#1150** (milestone
v1.1, unassigned), recorded as Condition 1 of
`architecture-review-2026-07-29-daemon-reaps-a-feature-worktree-at-pr-open-before-`. S6 scopes DO-5
to CI-fix and requires the rebase-resolution skip to be logged with a reason naming the retained
worktree, so the suppression is observable rather than silent. No story text changed.

---

## Non-conflicts examined and dismissed

- **`parked-feature-reconciliation-1060`** — its guarded helper deletes worktrees, but only for slugs
  carrying a `.daemon/parked/<slug>` marker, and only on an ancestry proof plus record-on-main. A
  shipped-but-unmerged feature is not parked unless an operator parks it, and the ancestry predicate
  cannot be satisfied by a squash-merged branch. No overlap in practice. **Alignment note:** S5's
  in-flight guard should reuse that ADR's rule-5 predicate rather than inventing a second one.
- **`durable-shipped-record-enforcement-and-backfill-916-936`** — reserves `.docs/shipped/` record
  *creation* to a record-only repair PR. S2 only *reads* the record and never writes one; the reap
  gate falls through to retain when the record is absent, so no invented record is ever needed.
- **`daemon-false-ship-guard`** — guards what counts as a verified ship. S1 leaves
  `shipmentFailureReason` and the entire ship-verification path untouched; only the teardown call is
  removed.
- **`features/conduct/ST-007-worktree-isolation`, `ST-010-feature-completion`** — describe per-feature
  worktree isolation and completion semantics; retention does not alter isolation boundaries and
  `resolve-`/`engineer-` prefixes keep the namespaces disjoint.

## Re-check

Re-run after applying the Conflict 2 resolution: **0 blocking conflicts.** Two degrading conflicts
remain, both explicitly accepted by the operator with their residual risk recorded above.

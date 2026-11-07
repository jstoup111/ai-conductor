# Conflict Check: Accept an operator-recorded resolution for a stacked restack conflict above the repaired child (#3421)

**Date:** 2026-10-25
**Stories checked:** `.docs/stories/stacked-repair-restack-conflict-above-the-repaired.md` (Stories
1–7). They were checked against every story file touching restack, journals, conflicts, resolvers,
HALT clearing, halt records, routed exits, closed children, ref teardown, the `stack` CLI,
daemon-session refusals, FR-8/FR-9, and post-rebase evidence translation.
- Read in full: in-flight #3203 (`manual-reviewer-edits-cannot-be-landed-safely-in-t`) and #3365
  (`multi-child-feature-cannot-resume-after-an-operato`).
- Narrowed by keyword, then read wherever they overlapped: the other story files (list below).

**Result:** clean after resolution. No blocking conflicts. Four degrading conflicts were found, and
each was resolved by revising this spec's own draft artifacts (the new ADR and stories) and adding
one additive amendment note to an on-main ADR. No compromise remains accepted.

## ADR corpus

- **Examined:**
  - `adr-2026-10-10-stacked-restack-journaled-replay` (decisions 2, 4, 6, 12, 13);
  - `adr-2026-10-12-routed-whole-feature-repair`;
  - `adr-2026-10-24-operator-route-round-for-closed-stacked-children` (decisions 2, 4, 6, 7, 8, 10);
  - `adr-2026-10-23-slice-topology-from-sealed-plan`;
  - `adr-2026-08-23-committed-halt-record` (decision 7);
  - `adr-2026-06-29-rebase-conflict-resolution-dispatch` (FR-8, FR-9);
  - `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` (decision 8);
  - `adr-2026-10-17-stacked-feature-publication-as-native-stack` (decision 11);
  - `adr-2026-10-07-per-child-build-region`;
  - `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history` (decision 3).
- **Narrowed out (no overlap with conflict refs, the resolve command or the routed exit):** the
  remaining approved ADRs. That includes build-review, prd-audit, model-policy, release, OTEL,
  tmux, intake and dashboard decisions.
- **Excluded as fully superseded:** none.

## Degrading (resolved)

### Conflict: The closed `restack_refused` reason list has no room for the stale reason
**Stories involved:** Story 3 vs `a-change-to-one-stacked-child-cannot-be-carried-in` Story 15; ADR
`adr-2026-10-10-stacked-restack-journaled-replay` decision 12.
**Type:** resource-contention. **Severity:** degrading.
**ADR filename stem:** adr-2026-10-10-stacked-restack-journaled-replay
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "The reason is one of `cascade-cap`, `dirty-overlap`, `sync-collision`, `checked-out-elsewhere`, `stack-ref-changed`, `lock-unavailable`, `verification-failed`, `replay-mismatch`, `range-not-ancestor`, `closed-child-rewritten`, `flatten_refused`, `restack-outstanding`, `published-stack` or `deferred-base-refresh`."
**Story opposing sentence (verbatim):** "then the restack moves no ref, halts needs-human with reason `restack-resolution-stale` naming the parent tree mismatch, emits `restack_refused` with that reason, and keeps both the resolution and the conflict record."
**Resolution:** An additive amendment note on restack ADR decision 12 extends the reason list and
names the new `restack_resolution` variant. The new ADR's decision 8 and its amendments list record
it.

### Conflict: The command clears a HALT outside the audited `halt clear` contract
**Stories involved:** Story 2 vs `needs-human-halt-auto-resumed-at-dispatch-rewind-c` Story 1 and
`a-halt-leaves-no-committed-pushed-record-for-the-o` Story 3.
**Type:** overlap. **Severity:** degrading.
**Description:** `halt clear` requires a TTY and a rationale, and emits `halt_clear_authorized`.
Story 2 cleared the HALT with no audit trail and no stated record supersession.
**Resolution:**
- Follow #3203's precedent (its decision 4: operator commands need no TTY, and keep the machine
  operator's identity).
- The `restack_resolution recorded` event carries the tip and the resolved operator identity.
- The command writes the ref, then appends the event, then clears the HALT.
- Story 2 and ADR decision 8 state that the command is not `halt clear`, emits no
  `halt_clear_authorized`, and leaves the committed record to the shipped resume supersession.

### Conflict: The `flatten_refused` recovery text sits inside Story 1's prohibition
**Stories involved:** Story 1 vs `a-change-to-one-stacked-child-cannot-be-carried-in` Story 2.
**Type:** contradiction (if in scope). **Severity:** degrading.
**Description:** #2943 Story 2's merge-bearing halt tells the operator to resolve on the child
branch. Story 1 bans that instruction for conflict halts, and its wording did not exclude a
merge-bearing child.
**Resolution:** Story 1 gains a negative path: a merge-bearing child keeps the shipped
`flatten_refused` halt and text and writes no conflict ref. ADR decision 8 states merge-bearing
children are out of scope. A follow-up intake remains listed in the ADR.

### Conflict: "No ref moves" when the `rem-*` mismatch halt now writes conflict refs
**Stories involved:** Story 1 vs `a-routed-fix-is-never-carried-up-the-stack-or-foll` Story 4.
**Type:** state-conflict (wording). **Severity:** degrading.
**Resolution:** ADR decision 8 states that "nothing moved" means no branch or closure ref moved.
Story 1 gains a `rem-*` mismatch negative path asserting the record is written and no branch or
closure ref moves. #2943 Story 6 already uses this reading.

## Clean pairs (checked in both directions)

- **#3203:**
  - its commit guard refuses only commits on feature branches, and the recipe's scratch branch is
    outside `feat/`;
  - `operator-round-branch-moved` is unaffected because no branch moves;
  - `stack land` refuses only a non-terminal journal, and an aborted one is terminal;
  - its halt-clearing commands clear only their own reasons, and this command clears only
    `Restack-Conflict`;
  - `unlanded-closed-child-commits` is not triggered because consumption moves the branch and the
    closure together.
- **#3365:** its unresolvable-cursor halts happen before any restack. This spec never reads slice
  topology.
- **Other files:** `a-change-to-one-stacked-child` (other stories), `a-routed-fix-is-never-carried`
  (other stories), `admitted-whole-feature-fixes`, `a-routed-fix-cannot-be-built`,
  `whole-feature-audit-fixes`, `stacked-features-cannot-be-published`, `build-loop-cannot-complete`,
  `engine-cannot-represent`, `2026-07-05-rekick-gated-rebase-resolution`,
  `rebase-full-replay-intent-validation`, `rebase-resolution-skill`,
  `automatic-rebase-preserves-merges`, `rebase-orphans`, `rebase-reopens`,
  `main-advance-re-kick-sweep`, `audit-trail-write-completeness`, `halt-records-never-reach-origin`,
  `engine-prompts-direct-daemon-sessions`, `bin-conduct-unknown-subcommand-guard`.
- **Oscillation check:** none. Each pair sharing a gate or ref was tested in both directions.

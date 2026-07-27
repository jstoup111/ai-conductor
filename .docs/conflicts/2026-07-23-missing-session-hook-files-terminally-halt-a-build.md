# Conflict Check: missing-session-hook-files-terminally-halt-a-build (#896)

**Date:** 2026-07-23
**Verdict:** CLEAN with three documented adjacencies. No blocking contradiction, overlap, or
resource contention. No story rewrite required.

## Scope of this feature's writes

- `src/conductor/src/engine/worktree-prepare.ts` — export + outcome type on the existing private
  `writeSessionHooks` / `wireSessionHookSettings` pair.
- `src/conductor/src/engine/conductor.ts` — the session-hooks branch of
  `checkAttributionMachineryIntact` (`:727-746`) only.
- Tests, `docs/daemon-operations.md`, `src/conductor/README.md`, `CHANGELOG.md`.

It writes **no** hook script content, **no** settings schema, **no** CLI surface.

## Adjacency 1 — PR #770 (spec, open): relocate `.pipeline` run-state out of the worktree

**Relationship: complementary, not conflicting. Same root cause, different layer.**

#770 proposes moving pipeline run-state to a stable per-feature location so it survives worktree
removal and cwd-relative deletes. That attacks *why* `.pipeline/session-hooks/` disappeared
mid-loop; this feature attacks *what the build does when it has*. Neither depends on the other:

- If #770 lands first, this feature's repair path becomes rarer but not dead — it still covers a
  hook file deleted or corrupted by any other means, and the ordering invariant (TI-3) is
  independently valuable.
- If this lands first, #770 changes the *paths* the repair writes to. That is a mechanical
  follow-on inside `worktree-prepare.ts`, which already derives every path from `worktreePath`.

**Action:** none now. Whichever lands second should re-point paths, not re-litigate the design.

## Adjacency 2 — PR #629 (open since 2026-07-13): mutation-gate Bash + stamped-write hardening

**Relationship: same file, disjoint regions.**

#629 edits `MUTATION_GATE_HOOK`'s *content* in `session-hook-assets.ts`. This feature never edits
that constant — it only causes it to be written to disk more often. A textual merge conflict is
impossible (different file); a semantic one is impossible (the repair writes whatever the constant
says at build time).

One positive interaction worth noting: if #629 lands, worktrees provisioned before it carry the old
gate script. This feature's repair *rewrites* the script from the current constant whenever it
runs, so a repaired worktree picks up the newer gate. That is a benign side effect, not a
requirement — do not build a version-check on it.

**Action:** none.

## Adjacency 3 — #897 (concurrent DECIDE): wiring-evidence staleness, `artifacts.ts:895-901`

**Relationship: no overlap. Naming collision only.**

#897 concerns *wiring evidence* freshness in the SHIP-tail verdict-artifact machinery
(`artifacts.ts`). This feature concerns *session-hook wiring* in
`.claude/settings.local.json` (`worktree-prepare.ts`). The two senses of "wiring" are unrelated:
different files, different phases (SHIP vs BUILD preflight), different artifacts. Neither reads or
writes the other's state.

**Action:** none. Recorded so a later reader does not conflate the two.

## Contradiction scan against merged decisions

- **#773 / CLAUDE.md "`Task:` trailers are telemetry only".** No contradiction. This feature does
  not restore any gating meaning to trailers; it keeps a *separate* live gate (#505 Surface B) and
  the `countResolvedTasks` stall breaker working as they already do. The ADR states the boundary
  explicitly.
- **#676 (guard introduced).** Extended, not reversed — the guard still HALTs on every condition it
  HALTs on today except a repairable absence.
- **`.docs/stories/fresh-build-dispatch-halts-immediately-with-attrib.md`** contains an acceptance
  criterion asserting that a missing session-hook script "still HALTs with the specific
  `session-hooks/ is missing expected script(s): …` diagnostic — the seed change does not suppress
  this branch." **This feature deliberately supersedes that criterion.** That story's intent was
  scoping (its own change must not suppress the branch), not a standing guarantee that the branch
  must halt forever; the ADR is the newer decision. Its test will need updating — flagged for the
  plan as an expected, intentional test change, not a regression.
- **#788 (docs-guard).** Additive only: `docs-guard.sh` joins the repair set, never the halt-check
  set.

## Resource contention

None. No shared mutable state beyond the worktree's own `.pipeline/` and
`.claude/settings.local.json`, both already written by `prepareWorktree` on the same thread of
control, and the repair is idempotent.

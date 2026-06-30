# PRD: Gated rebase-conflict resolution skill

**Date:** 2026-06-29
**Status:** Approved

## Problem / Background

The daemon's finish-time `rebase` step (Phase 9.0, engine-native `loopGate`) rebases a feature
branch onto the latest base before `finish`. Today, when `performRebase`
(`src/conductor/src/engine/rebase.ts`) hits any conflict that is **not** a CHANGELOG-only
auto-resolve, it returns `conflict_halt` and the conductor immediately writes `.pipeline/HALT`
(`conductor.ts:1523`), parking the feature for a human.

That is correct but blunt. Many rebase conflicts a competent agent could resolve safely (and the
suite would then re-verify). Parking on every non-CHANGELOG conflict drives avoidable human
intervention, working against harness optimization target #3 ("minimal user intervention during
implementation") — without buying additional correctness, because the existing kickback machinery
already re-runs `build` + `manual_test` after any code-changing rebase.

ADR-001 (APPROVED) deliberately made the rebase step engine-native and prompt-free: *"the rebase
is deterministic git work, not a Claude skill — it must not dispatch a prompt."* That holds for
**detecting** staleness and for the deterministic CHANGELOG path. This feature carves out one
narrow, additive exception: **conflict resolution** — a genuinely judgement-bearing task — may
dispatch a skill, gated and bounded, strictly on the `conflict_halt` path, before the HALT lands.
The satisfied predicate and every other engine-native property are untouched. This requires an
amending ADR (handled at architecture-review), not a reversal of ADR-001.

## Goals & Non-Goals

**Goals**
- Insert a **bounded, Claude-skill-driven resolution attempt** between a `conflict_halt` outcome
  and the `writeHalt` that exists today.
- Retry the resolution up to **N attempts (default 3, configurable)**; only HALT when all attempts
  fail to land a branch that is genuinely current with the base.
- Preserve every existing correctness property: the `satisfied` verdict still means "branch
  current with base," and a code/test-changing resolution still kicks back `build` + `manual_test`.
- Reduce unnecessary daemon HALTs without weakening the gate.

**Non-Goals**
- Changing the `satisfied` predicate, base discovery, path classification, or the CHANGELOG-only
  auto-resolver — all unchanged.
- Changing interactive (non-daemon) behavior — the rebase step remains a no-op there and humans
  rebase manually.
- Removing the HALT — it remains the final, unchanged fallback when resolution can't safely finish.
- Resolving conflicts "smartly" by restricting which conflicts are eligible — per decision, the
  skill may attempt **any** conflict and the test suite is the net (see Key Decisions).

## Users / Personas

- **The daemon (autonomous builder).** Reaches the rebase step at finish-time; today it parks on
  conflict. With this feature it gets a bounded self-resolution attempt first.
- **The operator (James, often phone-driven).** Wants fewer "rebase conflict — parked for human"
  HALTs in the dashboard, but only when resolution is genuinely safe and re-verified. Still gets a
  clean, informative HALT when the skill cannot finish.

## Functional Requirements

- **FR-1:** In a **daemon** run, when `performRebase` returns `conflict_halt`, the conductor
  dispatches the new `rebase` resolution skill **instead of** immediately calling `writeHalt`.
- **FR-2:** The resolution skill operates on the in-progress paused rebase (left paused by
  `performRebase`), resolves the conflicted files, stages them, and runs `git rebase --continue`
  to completion (driving any subsequent conflict hunks in the same rebase to completion too).
- **FR-3:** Resolution is attempted up to **N times**, where N is read from config and defaults to
  **3**. Each attempt that fails to fully complete the rebase counts against the bound.
- **FR-4:** After a resolution attempt that completes the rebase, the outcome is **re-classified**
  through the existing model (`noop` / `changed` / `changelog_resolved`) and
  `applyRebaseVerdicts` runs unchanged — so a code/test-changing resolution kicks back `build`
  (and `manual_test` when it ran) exactly as a clean code-changing rebase does today.
- **FR-5 (negative):** If all N attempts are exhausted without completing the rebase, the
  conductor writes `.pipeline/HALT` exactly as today (rebase left paused, conflicted files listed)
  and the HALT note records that N resolution attempts were made and failed.
- **FR-6 (negative):** If the skill determines mid-attempt that it cannot safely resolve (e.g. it
  judges a conflict it should not guess at), it may **short-circuit to HALT** before exhausting N —
  reporting the reason, which is recorded in the HALT note.
- **FR-7 (config / negative):** The attempt count resolves from a dedicated config key (default 3).
  Setting it to **0 disables resolution entirely**, restoring today's immediate-HALT behavior —
  the engine-native escape hatch is preserved.
- **FR-8 (correctness):** A resolution is only accepted when `isBranchCurrent(git, base.ref)` holds
  afterward. A branch that is not genuinely current with the base is **never** reported satisfied —
  ADR-001's critical property is carried forward verbatim across the new path.
- **FR-9 (negative):** After `git rebase --continue` completes, the conductor asserts no feature
  commits were silently dropped (post-rebase the branch must still contain the feature's commits
  ahead of the base). If commits were lost, the resolution is rejected → HALT. (Guards the known
  "git silently drops commits on rebase --continue" failure.)
- **FR-10 (interactive):** In **non-daemon** runs the rebase step is unchanged — no dispatch, the
  step is a self-satisfying no-op. The new skill is additionally invokable on demand by a human
  (`/rebase`) for manual conflict resolution, independent of the daemon loop.
- **FR-11 (observability):** The conductor emits structured events for resolution lifecycle —
  attempt-started (with attempt index / N), attempt-succeeded, attempt-failed, and
  resolution-exhausted-halt — so the dashboard and telemetry reflect the gated loop rather than a
  silent jump from conflict to HALT.
- **FR-12:** The resolution skill is authored as `skills/rebase/SKILL.md` with valid YAML
  frontmatter (`name`, `description`, `enforcement`, `phase`) and a corresponding agent persona if
  one is needed, such that `test/test_harness_integrity.sh` passes (frontmatter, model-table entry,
  agent/template references, cross-skill references, section numbering).

## Non-Functional Requirements

- **Correctness over capability.** The post-resolution `satisfied` verdict must be impossible to
  reach for a non-current branch (FR-8) and impossible to reach having dropped feature commits
  (FR-9). These are the load-bearing invariants; the suite-as-net argument only applies *after*
  the branch is provably current with its real history intact.
- **Bounded, deterministic termination.** The loop always terminates: success → proceed, or N
  exhausted / short-circuit → the existing HALT. No unbounded retry.
- **Token efficiency.** The skill is dispatched **only** on an actual `conflict_halt` (never on
  `noop` / clean / CHANGELOG-resolved), in a scoped subagent context limited to the conflicted
  files and the rebase state — consistent with the harness's per-dispatch context discipline.
- **Daemon-gated execution.** Resolution runs only where the rebase step itself runs (daemon
  finish-time), mirroring the existing `!daemon` no-op guard — never against an interactive
  worktree.

## Acceptance Criteria / Success Metrics

- All FRs covered by passing tests in `src/conductor/test/engine/` (rebase-resolution suite),
  using `daemon: true` against an isolated fixture repo (never the live checkout).
- A seeded code conflict that a resolver can safely merge: rebase completes, `build`/`manual_test`
  are kicked back, no HALT written.
- A seeded unresolvable conflict: exactly N attempts are made, then `.pipeline/HALT` is written
  with the attempt count recorded; rebase left paused.
- A stale branch where a resolution would *not* leave it current: never reported satisfied (FR-8).
- A resolution that drops a feature commit: rejected → HALT (FR-9).
- `attempts = 0`: behavior byte-for-byte identical to today (immediate HALT).
- `test/test_harness_integrity.sh` passes with the new skill in place.

## Scope

### In Scope
- New `skills/rebase/SKILL.md` (+ agent persona if required) — the resolution playbook.
- Gated resolution loop wired into `runRebaseStep` (`conductor.ts`) on the `conflict_halt` path.
- A dedicated, configurable attempt-count setting (default 3, `0` disables) in resolved-config.
- New resolution lifecycle events + their types.
- An amending ADR recording the narrow ADR-001 exception (produced at architecture-review).
- Docs: `README.md` / `src/conductor/README.md` daemon section, HARNESS.md model-table row,
  CHANGELOG `[Unreleased]`.

### Out of Scope
- Interactive-mode auto-rebase (still human-driven).
- Any change to base discovery, the satisfied predicate, path classification, or CHANGELOG
  auto-resolve internals.
- Restricting eligible conflict classes (explicitly decided against — any conflict is attemptable).
- VERSION strategy beyond staying on the 0.99.x line (CI auto-patches; bump presented at PR time).

## Key Decisions & Rationale

- **Resolve via a Claude skill, not engine heuristics.** Conflict resolution is judgement-bearing;
  a frontmatter skill is the harness-idiomatic home for judgement. Engine heuristics can't handle
  arbitrary code conflicts.
- **Gate = 3 attempts, configurable; `0` disables.** Bounded persistence before parking a human,
  with a clean escape hatch back to pure-ADR-001 behavior.
- **Any conflict is attemptable; the test suite is the safety net.** The existing kickback re-runs
  `build` + `manual_test` after a code-changing rebase, so a semantically wrong auto-merge that
  breaks behavior is caught downstream — *provided* the branch is provably current (FR-8) with
  feature history intact (FR-9). Those two invariants are the price of trusting the net.
- **Narrow ADR-001 amendment, not reversal.** Only the conflict-resolution sub-path gains a
  dispatch; detection and the satisfied predicate stay engine-native and prompt-free.

## Dependencies

- ADR-001 (`adr-001-rebase-insertion-mechanism.md`) — this feature amends it; the architecture-
  review step must produce the amending ADR before BUILD.
- Existing rebase engine (`src/conductor/src/engine/rebase.ts`) — `conflict_halt` outcome,
  `conflictedFiles`, `rebaseStateActive`, `isBranchCurrent`, `applyRebaseVerdicts`, `writeHalt`.
- resolved-config (`src/conductor/src/engine/resolved-config.ts`) — new attempt-count key.
- The conductor's skill-dispatch seam (the mechanism other dispatched steps use).

## Open Questions

- Does resolution warrant a distinct agent persona under `agents/`, or can the SKILL.md carry the
  full playbook inline? (Decide at stories/plan.)
- Should the attempt-count key be a brand-new config field or reuse the per-step `max_retries`
  slot for `rebase` (currently 1)? Leaning new dedicated field to avoid conflating "re-run the
  step" with "resolution attempts within one step run." (Decide at plan/architecture-review.)
- Exact event names/shape to fit the existing `events.ts` rebase event family (FR-11). (Decide at
  plan.)

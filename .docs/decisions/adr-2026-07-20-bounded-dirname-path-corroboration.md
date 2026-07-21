# ADR: Bounded dirname/subsystem pass in autoheal path-corroboration

**Date:** 2026-07-20
**Status:** APPROVED
**Deciders:** Operator (James Stoup) + engineer (#707 DECIDE)

<!-- Filename stem is this ADR's identifier: adr-2026-07-20-bounded-dirname-path-corroboration -->

## Context

`deriveCompletion` (`src/conductor/src/engine/autoheal.ts`) credits a plan task as complete
when a commit carries that task's `Task: N` trailer **and** at least one of the commit's files
corroborates a plan-declared path. Corroboration today is `fileMatchesPlanPath`: exact match
(`f === p`) or suffix match (`f.endsWith('/' + p)`) — nothing else.

When a genuinely-implementing commit lands files in the correct subsystem but not at a
plan-declared path (the plan couldn't foresee every file a change touches), corroboration
misses. The task is left uncredited → completion check fails (conductor.ts:3344) →
`no_task_progress` stall (conductor.ts:3482) → retries → auto-park. Observed recurring across
unrelated features (#677, #688, finish-staleness); daemon logs show `Path corroboration failed
for task N: trailer <sha> has no overlap with plan paths` paired with `no_task_progress (N → N)`.

Forces:
- The `Task: N` trailer already encodes author intent; path-overlap is a *secondary* guard
  against mis-trailered / inherited-residue commits (#445, #570).
- A semantic attribution judge (`runAttributionLane`, gated by `attribution_judge_cutover`,
  armed `2026-07-11`) **already** provides an LLM fallback on residue, with a same-attempt
  re-derive (conductor.ts:3326); its resume/inherited-residue dispatch gap was closed by
  **PR #700 (#570)**, merged 2026-07-20. So the LLM fallback is complete and must not be
  re-implemented or duplicated here.
- The repo's design principle: deterministic where possible; LLM only where necessary. The
  common "right subsystem, wrong exact file" case should be caught deterministically, before
  any judge dispatch.
- #445 ("same as Task N" inheritance) closed a false-positive where a task inherited another
  task's declared Files. Any loosening of path-overlap must not reopen it.

## Options Considered

### Option A: Bounded deterministic dirname/subsystem pass (CHOSEN)
- **Pros:** Deterministic, token-free, always runs (no cutover/judge/resume dependency).
  Catches the dominant false-reject class. Complements — does not overlap — the existing judge.
- **Cons:** Coarser than a per-file match; must be bounded to avoid over-crediting.

### Option B: Dispatch the semantic judge on the corroboration miss
- **Pros:** Reads the real diff vs intent.
- **Cons:** **Already implemented and armed**; resume-dispatch gap already fixed by #700.
  Re-doing it here is redundant and collides with #700. Rejected as out-of-scope.

### Option C: Fix plan-path declaration drift at the source (+ normalization)
- **Pros:** Addresses drift where it originates.
- **Cons:** A plan cannot predict every file a legitimate change touches; leaves a residual
  false-reject tail. Orthogonal to #707; not needed.

### Option A′: Unbounded dirname / ancestor-prefix match
- **Cons:** Reopens #445 — an ancestor or repo-root match lets a mis-trailered/inherited
  commit corroborate an unrelated task. Rejected.

## Decision

Add a **bounded** dirname/subsystem branch to path-corroboration: a commit file corroborates a
task iff its **immediate parent directory equals the immediate parent directory of a
plan-declared path** for that task — in addition to today's exact/suffix match. The `Task: N`
trailer must still be a real, unambiguous match (existing `taskTrailerMatches` guard unchanged).

The bound is deliberately the *immediate* parent directory only — **never any ancestor, never
repo-root** — because that is the property that keeps #445 closed: an inherited/mis-declared
path that merely shares a distant ancestor with the commit's files does not corroborate.

The semantic judge fallback and its gating are **left byte-for-byte unchanged**; #707 is the
deterministic complement that runs first. When the dirname pass also misses, behavior is
exactly as today (judge-if-armed, else reject) — no new reject-path behavior, no regression
when the judge is off.

Rationale: the trailer proves intent; the file-path check is corroboration, not the authority.
Widening corroboration by one deterministic, tightly-bounded step credits legitimate
subsystem-local work without granting the LLM more authority or reopening #445.

## Consequences

### Positive
- Legitimate Task:-trailered commits that land in the right directory are credited
  deterministically → the recurring `no_task_progress` 0/N stall class is eliminated for this
  cause without any LLM cost or cutover dependency.
- No overlap or conflict with #700 (judge dispatch); the two fixes are independent layers.

### Negative
- Corroboration is now directory-granular for the fallback branch: two tasks whose
  plan-declared paths share an immediate parent directory are less distinguishable by the
  deterministic pass alone. Mitigated because the `Task: N` trailer must still match, and the
  judge remains the arbiter on genuine ambiguity. Negative-path stories must cover this.

### Follow-up Actions
- [ ] Implement the bounded dirname branch in `fileMatchesPlanPath` / `filesOverlappingTaskPaths`.
- [ ] Stamp form distinguishes dirname corroboration (`trailer-dirname`) from exact (`trailer`).
- [ ] Negative-path tests: mis-trailered sibling-dir commit is NOT credited; ancestor/repo-root
      match does NOT corroborate (#445 non-regression); judge path unchanged when dirname misses.

## Wiring Surface (design-time, Medium tier)

- **`fileMatchesPlanPath` (modified export in `autoheal.ts`)** — called from
  `filesOverlappingTaskPaths`, which is invoked inside `deriveCompletion`'s per-task loop; that
  function is already wired into production at `conductor.ts:3219` (`await deriveCompletion(...)`)
  and via the evidence gate. No new call site — the change is inside an already-reachable rung.
- **`trailer-dirname` stamp form** — written to the existing evidence sidecar alongside
  `trailer`/`semantic-verified`; consumed by the same completion-derivation and
  `task-status.json` sync that read the sidecar today. No new consumer.
- No new CLI subcommand, hook, config key, or emitted event.

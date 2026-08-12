# ADR: A step whose machinery is removed is retained as a deprecated no-op

**Date:** 2026-08-11
**Status:** APPROVED
**Deciders:** James Stoup (operator), architecture-review for #1496

## Context

`adr-2026-08-11-wiring-judged-in-build-review` deletes the wiring machinery and moves the judgement
into `build_review`. That leaves the question of the `wiring_check` step name itself, which is
referenced by four surfaces that outlive any single release:

1. **`build_review`'s prerequisites.** `steps.ts:184` declares
   `prerequisites: ['wiring_check', 'test_suite']`. A step cannot depend on a name that no longer
   exists.
2. **In-flight `conduct-state.json`.** Every feature mid-run records a status per step, so live
   worktrees carry `wiring_check`. `getStepDefinition` throws `Unknown step: <name>`
   (`steps.ts:435`), and `steps.ts:411` records that precisely this throw *"killed the run with
   `Unknown step: <name>` mid-flight"* before.
3. **Consumer `settings.json`.** `resolved-config.ts` keys retries (`:46`) and autonomy (`:77`) by
   step name, and `:397` notes that *"unknown step still throws."* A consumer who pinned
   `wiring_check` retries breaks on upgrade.
4. **Historical `.pipeline/` artifacts** — `gates/wiring_check.json`, `wiring-evidence.json` — and the
   `parallel_started` events whose `branches` array names the step.

There is no existing convention for removing a step. `remediate` was *added* outside the ordered list
(`steps.ts:301`) and the comments there show the same `Unknown step` throw was the hazard; nothing
covers deletion.

## Options Considered

### Option A: Delete the step name; migration-only compatibility
`bin/migrate` strips the config keys; the throw stays as a typo guard.
- **Pros:** no residue in the registry.
- **Cons:** fails closed on the population that cannot run a migration first — a worktree mid-build
  has state on disk before any migration runs, and the daemon re-dispatches it. Requires rewriting
  `build_review`'s prerequisites in the same breath. Consumers who skip or decline the migration
  hard-fail on a change they did not author.

### Option B: Delete the step name; add a retired-step set that drops known-removed names
- **Pros:** keeps the typo guard for genuinely unknown names while making removal safe.
- **Cons:** a permanent registry that only grows; every read path that touches step names must learn
  about it; a future removal that forgets to add its name reintroduces the mid-flight throw. Solves a
  problem Option C does not have.

### Option C: Retain the step as a deprecated no-op
The step definition stays in the registry. Its completion predicate always reports done, it never
fails, it dispatches nothing, and it emits a deprecation notice when it runs.
- **Pros:** every one of the four surfaces above keeps working untouched — prerequisites resolve,
  in-flight state parses, consumer config resolves, historical artifacts stay interpretable. No
  `Unknown step` hazard exists to mitigate, so no new registry and no migration is load-bearing for
  correctness. The deprecation notice gives operators a visible, dated signal before any future
  hard removal.
- **Cons:** a vestigial step remains in the pipeline and in every step listing, costing a (trivial)
  dispatch slot and some reader confusion until it is removed for real. Defers rather than resolves
  the eventual deletion.

## Decision

**Option C.** `wiring_check` is retained as a **deprecated no-op step**: it always completes
successfully, never produces a gap, never kicks back, and dispatches no agent. All of its machinery —
`wiring-probe.ts`, `wired-into.ts`, `validate-wired-into.ts`, the completion predicate's evidence
handling, and the `WIRING_EVIDENCE` artifact — is deleted.

This establishes the contract for retiring any engine step: **remove the machinery first and leave
the step as a deprecated no-op; delete the name only in a later, separate change, once no live state
or consumer config can still reference it.** Deletion of the name remains available later and is
then a genuinely safe change, because by that point nothing in flight names it.

**The deprecation notice rides the event spine.** Per `.agents/skills/event-spine/SKILL.md`, a
deprecated step running is an *occurrence in time* that consumers need to see: an operator asking why
a step does nothing reads the daemon log, which renders from the bus, and a bare `log()` call would be
invisible to the daemon CLI renderer, the UI subscriber, and the OTel exporter alike. A variant is
therefore added to the `ConductorEvent` union carrying the deprecated step name and a short reason
pointing at `adr-2026-08-11-wiring-judged-in-build-review`.

```
Event spine
  Channel?    yes                    — a report that a deprecated step ran and did nothing
  Concern:    occurrence             — "this ran, just now", not "what is true now"
  Verdict:    extend the union       — new ConductorEvent variant
  Exception:  none                   — the step runs in-process with the emitter reachable
```

Narrowing the parallel-member unions at `types/events.ts:489,500` is **not** required under this
decision: `wiring_check` remains a valid member, and the BUILD parallel group keeps both branches.
That is a further simplification available whenever the name is finally deleted.

## Consequences

### Positive
- In-flight features, consumer config, and `build_review`'s prerequisites all survive the change
  untouched. The highest-severity risk in the review register is eliminated rather than mitigated.
- The migration block becomes a convenience (tidying dead config keys), not a correctness
  requirement — a materially smaller blast radius for consumers.
- Operators get a dated deprecation signal on the spine before any hard removal.
- Establishes a reusable two-phase retirement contract for future step removals.

### Negative
- A no-op step remains in the pipeline, visible in step listings and dashboards, doing nothing. This
  is reader-confusing until cleaned up, and the cleanup is not scheduled by this ADR.
- The `.pipeline/gates/wiring_check.json` verdicts written from now on record a pass that means
  "not evaluated", which is indistinguishable from a real pass in historical data without this ADR.
- Two steps in the BUILD parallel group where one now does work.

### Follow-up Actions
- [ ] File a follow-up issue for the eventual hard deletion of the `wiring_check` name, gated on no
      live state referencing it.
- [ ] Document the two-phase step-retirement contract in `docs/reference/steps.md` so future removals
      follow it.

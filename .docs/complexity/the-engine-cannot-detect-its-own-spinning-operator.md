# Complexity: The engine cannot detect its own spinning

Tier: M

## Rationale

Signals weighed against the standard set (models, integrations, auth, state machines, story count):

- **Data models:** one, additive and backward-tolerant. `KickbackGateEntry` gains a bounded
  per-rubric failure tally alongside `cumulative`. The precedent is exact: `adr-2026-08-12` D1
  added `cumulative` to the same type, and its read tolerance ("`isKickbackGateEntry` treats a
  missing field as legacy and folds it to `0` rather than rejecting the ledger") is load-bearing
  and must be repeated here so an in-flight feature gets a fresh budget rather than a spurious
  halt. No new store, no new file, no schema version bump — the tally is state on a ledger that
  already exists, which is what `adr-2026-08-12`'s rejected "derive it from `events.jsonl`"
  alternative requires. Bounding is free: the tally is keyed by rubric and the registry holds four,
  so no capacity or eviction rule is needed — a simplification the withdrawn per-site key did not
  have, since sites are unbounded in principle.
- **Integrations:** none added. No new provider dispatch, no new boundary, no LLM anywhere in the
  decision path — a preserved property `adr-2026-08-12`'s consequences state explicitly and this
  change must not break.
- **Auth:** untouched.
- **State machines:** two, and this is where the tier is set. First, the `build_review` FAIL block
  gains a terminal exit. `adr-2026-08-16` D6 governs that block and requires the exit set be
  **grep-derived at implementation time** (it names seven), the effective-verdict predicate be
  consulted **at** each exit rather than hoisted, cap-first ordering be preserved, and every HALT
  keep a distinct reason and its class argument. Placement is also constrained from the other side
  by `adr-2026-07-23` (the fresh-base disposition must run first, or findings graded on a stale base
  get counted as repeats) and by `adr-2026-08-12`'s own recorded slot ("immediately after the D2
  escalation check and before the per-tree `exhausted` branch"). Getting the order wrong either
  masks the ping-pong reason or converts a recoverable lap into a wrong terminal halt. Second, the
  tally's lifecycle: it must reset on a `build_review` PASS exactly as `cumulative` does (D2), and
  must not tick on a lap the fresh-base disposition discarded.
- **Story count:** 6.
- **Blast radius:** three engine modules (`kickback-ledger.ts`, `conductor.ts`'s FAIL block, a new
  pure repetition predicate) plus the `ConductorEvent` union and its sink registry. The diff is
  moderate; the reasoning radius is not, and it concentrated in one place: **choosing the key and
  its threshold**. Two keys were authored and withdrawn before one measured cleanly — the first
  against a contaminated count (`lap-*` directories are mostly cache re-stamps per `adr-2026-08-13`
  D7), the second against an 11-feature replay in which per-site repetition fired on 2 of the 5
  features that spun and missed the filed incident. The surviving key separates 5 of 5 spin from 0
  of 6 healthy at threshold 4, so the number is verified rather than inferred — but establishing
  that took reconstructing every feature's kickback sequence from persisted event ledgers. That is
  genuine architectural work and needs an ADR, not a plan-task footnote.
- **Test surface:** well established at every tier — `test/engine/kickback-ledger.test.ts` (9
  existing tests pin the reset semantics this must not disturb),
  `test/engine/build-review-aggregate.test.ts`, `test/engine/build-review-dispositions.test.ts`,
  and the conductor FAIL-routing integration suites. The re-stamp trap needs its own regression:
  a fixture where repeated cache-hit laps must **not** advance the tally.
- **Documentation:** `docs/explanation/gates.md` (kickback cap and rubric sections) and
  `docs/reference/configuration.md` (the new gate's config block, beside
  `cumulative_kickback_bound`) both carry contracts this changes.
  `docs/runbooks/stalled-or-stuck-feature.md` gains the new halt's recovery, and its recorded
  "Known limitation — `--report` renders neither halt nor kickback tables" is adjacent.
- **Event spine:** additive only. The occurrence rides the existing `kickback` event's field set
  (the shape `adr-2026-08-12` D5 established for `cumulativeCount`) plus the central `loop_halt`;
  `adr-2026-08-11-halt-events-ride-the-persisted-spine` forbids a per-site halt payload variant, and
  `adr-2026-07-26-event-sink-registry-exhaustiveness` requires an explicit per-sink decision for
  anything new. No new channel, no new ledger, no sidecar file.

Not Large: no new subsystem, no new integration, no new store, and no consumer-visible CLI, hook, or
`settings.json` surface. The bound composes with `adr-2026-08-12` rather than replacing it — that
ADR named rubric-item identity as "the strongest candidate for a future refinement" and said it
"composes with this bound rather than replacing it", so the topology is already decided.

Not Small: it adds a terminal exit to a live state machine whose ordering three separate APPROVED
ADRs constrain, and its central choice — the key — took two withdrawn designs and a corpus replay to
settle. Tiering this S would skip the conflict sweep and the architecture review; the sweep caught
that the first measurement was counting cache re-stamps and that the first key was a field the engine
never verifies, and the replay caught that the second key did not measure spinning at all.

**Agreement with the intake label.** jstoup111/ai-conductor#1652 carries `size: M`, which matches.

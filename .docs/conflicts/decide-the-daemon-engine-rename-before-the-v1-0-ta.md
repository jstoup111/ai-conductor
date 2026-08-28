# Conflict Check: implement the daemon→Player and engineer→Composer rename

**Date:** 2026-08-26
**ADR corpus:** `change_set` (config `conflict_check.adr_corpus` unset) —
adr-2026-08-26-music-vocabulary-player-composer-rename, including its operator amendment
**Stories scanned:** all four feature stories against the full `.docs/stories/` inventory; exact
legacy CLI/config/state/skill terms matched 86 existing story files

**Result: PASSED — zero blocking conflicts; one intentional vocabulary supersession is resolved by
the governing ADR and compatibility boundary.**

## Six conflict classes checked in both directions

| Class | Finding | Resolution |
|---|---|---|
| Logical contradiction | Existing stories name `conduct daemon`, `conduct-ts engineer`, and `.daemon/` as the then-current canonical surfaces, while this feature makes Player/Composer and `.player/` canonical. Exact new-write assertions for `.daemon/` cannot remain canonical simultaneously. | Intentional supersession, not an unresolved product conflict: approved ADR decisions 1–3 rename those boundaries. Legacy command aliases preserve old invocations; state migration preserves the data and the implementation updates path-bound tests with their owning code. |
| Resource contention | Player and Composer changes converge on `cli.ts`/`index.ts`; the overlap scan also reports broad open-spec overlap on those central files, including #226/#552 work. | Integration sequencing/rebase risk only. One command tree and one dispatch normalization boundary remain; no parallel registry is introduced. |
| State conflict | Old-only `.daemon/`, canonical `.player/`, and both-present states could otherwise select competing writers. | Story 4 defines mutually exclusive resolver states: migrate old-only for writers, observe old-only read-only, use canonical-only, reject both-present without writes. No state has two legal write owners. |
| Temporal conflict | A read-only observer could trigger migration while a Player is running, or a legacy alias could normalize after command dispatch. | Observers never migrate; mutating entrypoints resolve state before writes; vocabulary aliases normalize before typed dispatch. Ordering is explicit and non-oscillating. |
| Ownership conflict | A copied Engineer skill or alternate Composer store could create two owners for one workflow/ledger. | Composer is the sole implementation and uses existing stores; Engineer is a compatibility delegate. No new store or ledger is created. |
| Oscillation | Alias forwarding, config fallback, or repeated state migration could bounce between old and new vocabulary. | All transitions are one-way: legacy CLI/skill→canonical behavior, legacy config→canonical in-memory value, old-only state→canonical state. Canonical paths never regenerate legacy state. |

## Naming-adjacent pairs examined

- **Story 1 ↔ daemon lifecycle/help/park/reclaim stories:** old CLI invocations remain accepted and
  keep the same typed runtime operations. `conduct-daemon-help-omits-the-supported-pause-and-.md`
  and `expose-daemon-pause-resume-verbs.md` still require pause/resume reachability; canonical Player
  adds the same verbs and the Daemon alias preserves them.
- **Story 2 ↔ `engineer-cli-subcommand-help-executes-the-command.md`:** that story explicitly says
  its Engineer wording applies until #227 lands and must survive either outcome. #227 now lands via
  a shared Composer parser plus Engineer alias, so its no-side-effect help invariant remains true.
- **Story 3 ↔ `2026-07-03-daemon-auto-restart-stale-engine.md`:** the behavior still watches the
  internal engine identity. Only the owning Player config key changes; legacy normalization keeps
  existing settings effective.
- **Story 4 ↔ daemon state-path stories:** exact `.daemon/` write destinations are intentionally
  superseded, while lock exclusivity, marker provenance, park ownership, processed ledgers,
  restart recovery, and log semantics remain requirements under the resolved `.player/` root.
- **Feature stories ↔ ADR:** no internal contradiction. Canonical precedence, temporary aliases,
  event-spine reuse, state ambiguity rejection, unchanged entrypoints, and retained internal
  `engine` terminology match the amendment in both directions.

## Accepted degrading conflicts

None. The path/name supersession is an authorized replacement with compatibility behavior and data
migration, not a waiver of the underlying lifecycle or durability requirements.

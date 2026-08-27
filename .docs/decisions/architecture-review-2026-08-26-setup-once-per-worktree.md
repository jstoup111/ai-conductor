# Architecture Review: Setup once per worktree + per-dispatch lifecycle script (#1930)
**Date:** 2026-08-26
**Stories reviewed:** none yet — pre-stories DECIDE review (technical track, tier M, lightweight mode)
**Verdict:** APPROVED WITH CONDITIONS

Scope boundary (binding, from `.docs/track/`): gate + hook — marker-gated setup skip with named
invalidation, plus a distinct optional per-dispatch lifecycle script, documented;
`runSetupTriage` preserved.

## Feasibility

- **Seam exists and is narrow** (verified, 95%): `runProjectSetup` is module-private, reachable
  only via `prepareWorktree` (`worktree-prepare.ts:138-150`); production callers are the daemon
  dispatch dep (`daemon-deps.ts:121`), the triage `runPrepare` injection (`daemon-cli.ts:1172`),
  and autoresolve's always-cold transient worktree (`autoresolve.ts:325`). Gating inside
  `runProjectSetup`/`prepareWorktree` covers all paths with one mechanism.
- **Invalidation inputs are already computable** (verified, 90%): script bytes/mode hashing has
  an in-repo precedent (`sessionHookNeedsRepair`, `worktree-prepare.ts:400-407`); base
  resolution and rebase outcomes exist (`rebase.ts` — `RebaseOutcome.changed`, `resolveBase`);
  the base-SHA comparison needs no new git machinery.
- **Triage preservation is the one real hazard** (verified): triage verifies fixes by
  re-running `prepareWorktree` (`setup-triage.ts:446`, `:598`). Without a force path both
  verifications become vacuous marker-skips. Resolved by ADR sub-decision 4 (`opts.force`).
- **Event surface**: no setup/provisioning event exists in `types/events.ts`; adding one forces
  an `EVENT_SINKS` declaration (compile-time exhaustive). `beginFeatureRun` starts the
  per-worktree persister before `prepareWorktree` runs, so the event lands in the feature's own
  ledger; only the dep signature needs widening.

## Alignment

Full ADR sweep run (~280 ADRs). The design is expressed inside existing decisions rather than
against them:

- Reuse keyed on code-state validity, content-addressed identity, commit SHA as provenance only
  — per adr-2026-07-22-gate-evidence-code-validity-on-redispatch and
  adr-2026-07-25-content-addressed-full-suite-proof (D4–D7).
- Persisted "done" honored only after a read-only re-check, fail-closed toward re-running —
  per adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.
- Marker placed at `«worktree»/.daemon/setup-ok.json` per
  adr-2026-08-09-worktree-local-provider-scratch (on `LIVE_CHECKOUT_VOLATILE`; robust to the
  live `.pipeline/`-relocation design in #564); atomic write per
  adr-2026-08-05-build-settle-outcome-stamp D7; `info/exclude` gains `.daemon/` so the marker
  never trips the uncommitted-work floor (adr-2026-08-03) or the triage tree classifier.
- Skip/run reasons are spine events with a closed reason union
  (event-spine skill, adr-2026-07-26-event-sink-registry-exhaustiveness,
  adr-2026-08-05-worktree-classification-evidence-derived-reasons) — not raw log lines and not
  fields interpreted out of the marker file.
- Two governing ADRs amended in place (adr-2026-08-04-decide-owned-amendment pattern):
  setup-failure-triage (when setup runs + force path) and the teardown-contract ADR
  (no-persisted-state clause scoped; third script member added).

## Wiring Surface

| New surface | Called from (design-time commitment) |
|---|---|
| Setup gate + marker read/write in `prepareWorktree` | existing daemon dispatch path — `makeRunFeature` (`daemon-runner.ts:333`) via `daemon-deps.ts:121`; triage `runPrepare` (`daemon-cli.ts:1172`) with `force: true` |
| `prepareWorktree` `opts.force` | setup-triage's two `runPrepare` verification sites (`setup-triage.ts:446`, `:598`) |
| `project_setup` ConductorEvent | emitted from `prepareWorktree` via the widened dep signature; rendered by `renderDaemonEvent` (`daemon-cli.ts`), persisted to the feature's `events.jsonl` via `EVENT_SINKS` |
| `bin/dispatch-start` runner | invoked from `prepareWorktree` on every dispatch, after the setup gate |
| `dispatch_start_timeout_seconds` config key | resolved in `resolved-config.ts` alongside the existing `*_timeout_*` resolvers; consumed by the dispatch-start runner |
| `.daemon/` entry in `info/exclude` | written by `excludeEngineArtifacts` (`worktree-prepare.ts:163-196`), already on the provisioning path |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Triage verify short-circuited by marker → false `fixed-pass` | Technical | High (without force path) | High | ADR sub-decision 4: `opts.force` on both `runPrepare` sites; acceptance test asserting a forced re-run executes real setup |
| Setup stale despite valid marker (inputs outside script+base, e.g. decayed external resource) | Technical | Low | Medium | Fail-closed predicate covers script+base; operator lever = delete marker / recreate worktree; every skip named on the spine |
| Marker surfaces as untracked file in consumer repos → wedges build completion / triage classifier | Integration | Medium (without exclude) | High | `info/exclude` gains `.daemon/` at provisioning (mechanical, per-worktree, gitignore-independent) |
| `bin/dispatch-start` reintroduces per-dispatch cost | Technical | Low | Low | Optional, contained, time-bound (default 120s); documented as the *only* per-dispatch vehicle |
| #564 relocates `.pipeline/` (unapproved live design) | Integration | Medium | Low | Marker deliberately placed under `.daemon/`, unaffected either way |

## Domain Integrity

Skipped (lightweight mode, tier M) — handled per-cycle by TDD domain review. Note for stories:
the event `reason` field is a closed union, not a free string.

## ADRs Created

- `adr-2026-08-26-setup-once-per-worktree-marker.md` — DRAFT, pending operator approval.
- Amendments (in place, additive): `adr-2026-07-09-setup-failure-triage.md`,
  `adr-2026-08-07-project-teardown-hook-contract-and-containment.md`.

## Conditions

1. The new ADR must reach APPROVED before `/stories` (hard gate).
2. Stories must include the triage-force negative path (a triage verify re-run executes real
   setup) and the failed-setup-writes-no-marker negative path.
3. Documentation in the same implementation PR: `bin/dispatch-start` + `dispatch_start_timeout_seconds`
   in `docs/guides/running-the-daemon.md` and `docs/reference/configuration.md`; new event in the
   relevant reference page.

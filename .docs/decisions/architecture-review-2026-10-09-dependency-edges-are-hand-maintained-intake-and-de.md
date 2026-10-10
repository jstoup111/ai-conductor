# Architecture Review: Machine-Authored and Machine-Verified Issue Dependency Edges (#536)
**Date:** 2026-10-09
**Mode:** Pre-stories, lightweight (Tier M). Sections 2 and 4 only.
**Input reviewed:** PRD `.docs/specs/2026-10-09-dependency-edges-are-hand-maintained-intake-and-de.md` (FR-1..FR-18)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new packages. Every primitive exists: `parseDependencyProse`, `createDependencyLinks`, `BlockerResolver`, `TrackerClient.getBlockedBy`, `overlap-suggestions`/`overlap-sources`, `EventPersister`. (verified) |
| Prerequisites | None. The intake workflow already has the token scope to write `blocked_by`, because it does so today for form fields. (verified) |
| Integration surface | One external API that is already used in production. `blocked_by` returns blocker `state` + `state_reason`, live-checked on #474. No `blocking`-list read is needed: direction contradictions are detectable from the issue's own `blocked_by`. (verified) |
| Data implications | No schema or persisted state. Writes are additive GitHub links only. |
| Performance | The drift sweep makes at most one call per open issue per repository per hour. Rate-limit responses degrade to indeterminate. (inferred, ~85%; budget of 5000 req/h vs current repo open-issue count in the hundreds) |
| Worktree isolation | No ports, databases or shared files. Land events go to the existing `composer-events.jsonl`. |

## Alignment

- **Event spine.** Two new `ConductorEvent` variants (`land_dependency_decided`,
  `dependency_drift_swept`) registered in `event-sinks.ts`. No sidecar files, no new poller: the
  sweep composes into the existing `intakeTick` `reconcile` hook. This complies with
  `.agents/skills/event-spine/SKILL.md` (steps 2 and 3).
- **Machinery over prompt discipline.** The land gate refuses until every proposal is decided,
  mirroring `intake-file`'s `runOverlapPreflight` refused/proceed model. Decisions are not left to
  prompt adherence.
- **Prior ADRs applied, none superseded.**
  - adr-2026-07-03-issue-dependencies-api-surface: same-repo-only creation, idempotent writes.
  - adr-2026-07-03-prose-to-link-migration: additive only. The migration command itself is
    unchanged; its parser is now also used by standing paths through the reconciler.
  - adr-2026-07-03-dependency-fail-closed-and-cache: errors become indeterminate, never clean.
  - adr-2026-07-21-decide-time-unmerged-overlap-scan: reused as a proposal source.
- **Domain integrity.** Proposal decisions and drift categories are closed unions, with no
  booleans: `accepted | declined | undecided | already-linked`, and
  `unlinked | stale | cycle | contradiction | indeterminate`.
- **Security.** Writes go through the existing guarded GitHub operation runner. Issue bodies are
  untrusted input and are only regex-parsed for `#N` lists.
- **Diagrams.** `.docs/architecture/dependency-edges-are-hand-maintained-intake-and-de.md` and its
  sequences match this design. The `blocking` read was removed from the diagrams during review.

## Conflict-Check Resolutions (folded in 2026-10-09)

- **Offline land:** a narrow, recorded exception to adr-2026-07-22-coherence-waiver-and-duplicate-claim
  that applies to `--source-ref` land only, with an explicit skip escape. That ADR carries an
  amendment note; see ADR decision 6.
- **Overlap:** only linkable overlaps become proposals. The DECIDE-time scan stays advisory.
- **Migration ADR:** the "ignored by design" non-goal is reversed for the three recognized patterns.
  That ADR carries an amendment note.
- **Ownership:** edge writes stay under adr-2026-09-11-github-operation-ownership D2/D3. Issues not
  owned by the operator are reported as refused, never forced.
- **Land refusals:** recorded once, as `land_gate_rejected`, under three new gate identifiers.
  `land_dependency_decided` is emitted on success only.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| Reconciler module (`declaredEdges`, compare, sweep) | Called by the Action script, the land path in `engineer-cli.ts`, the `dep-audit` verb, and the `intake-loop-cli.ts` reconcile hook |
| Prose linking on every issue body | `src/conductor/scripts/intake-label-sync-apply.mts`, run by `.github/workflows/intake-label-sync.yml` on `issues: opened, edited` |
| Land proposal gate + `--depends-on` / `--decline-dependency` / `--skip-dependency-check` | `ai-conductor compose land` (land case in `engineer-cli.ts` → `landSpec`) |
| `land_dependency_decided` event | Emitted by the land path into the existing `composer-events.jsonl` persister; sink registered in `event-sinks.ts` |
| `compose dep-audit` verb | Registered in `ENGINEER_SUBCOMMANDS` / compose dispatch in `engineer-cli.ts` |
| Interval-gated drift sweep + `dependency_drift_swept` event | Composed into the `reconcile` closure in `intake-loop-cli.ts`, which is already invoked by `intakeTick`; emitted on the loop's `IntakeEventEmitter` |
| Composer skill text for land flags | `skills/composer/SKILL.md`, read by the session that drives `compose land` |

**Early overlap scan:** `ai-conductor overlap-scan` over the wiring paths reported no overlap and
no open blockers (2026-10-09).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Prose grammar creates a wrong edge | Data | Low | Medium | Only the three existing forward patterns. FR-4 negative cases tested. Additive only, so a wrong edge is removable and surfaced by drift. |
| Sweep exhausts the API budget alongside polling | Performance | Low | Medium | Hourly gate; one call per issue; indeterminate on rate limit with no retry. |
| Land gate friction makes operators reach for `--skip-dependency-check` habitually | Integration | Medium | Low | The skip requires a reason, and every skip is recorded on the spine. |
| Repos without the intake workflow get no creation-time linking | Integration | Medium | Low | Drift report lists their unlinked declarations. |

## ADRs Created

- `adr-2026-10-09-dependency-reconciler-and-edge-write-ownership`: one reconciler; the Action
  writes prose edges; land owns the refuse-until-decided proposal gate and accepted-edge writes;
  `land_dependency_decided` event.
- `adr-2026-10-09-dependency-drift-sweep-on-intake-tick`: read-only sweep, shared by `dep-audit`
  and the hourly-gated reconcile hook; `dependency_drift_swept` event.

## Conditions

1. Both ADRs reach APPROVED before stories.
2. Land writes accepted edges only after the spec commit succeeds; a failed commit writes nothing.
3. The composer skill documents the land dependency flags in the same feature, so the gate is
   answerable by the driving session.

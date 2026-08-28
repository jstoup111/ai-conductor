# Architecture Review: decide the daemon→engine rename before the v1.0 tag

**Date:** 2026-08-26
**Mode:** lightweight (Medium tier, technical track; DECIDE pass — stories do not exist yet)
**Input:** `.docs/track/decide-the-daemon-engine-rename-before-the-v1-0-ta.md` scope boundary,
`.docs/architecture/2026-08-26-music-vocabulary-rename-surfaces.md` (approved),
`.memory/decisions/music-vocabulary-rename-scope.md`, #227 + comments
**Verdict:** APPROVED

## Feasibility

The feature delivers decision + scoping artifacts only (ADR, rename-scope enumeration,
migration scoping) — no runtime code. Feasibility questions therefore attach to the *scoped*
rename, and were checked so the scope is honest:

- **Surface size verified:** 1,532 `daemon` / 422 `engineer` occurrences (src), 414 test files,
  49 docs files, 111 `.daemon/` path literals. Large but mechanical; the alias shim and
  migration block bound the operator-visible break.
- **Event spine unaffected:** `ConductorEvent` union (`src/conductor/src/ui/types.ts`) has zero
  daemon-named identifiers (grep-verified) — the persisted event schema is out of the breaking
  surface. Resolves the diagram's open question: EVENTS does not rename.
- **Precedent exists:** adr-2026-06-29-brainstorm-rename-migration shows the state-key-safe
  rename shape (migrate on load, boundary-only shim, no retroactive reshuffle).
- **Overlap scan (advisory):** `src/conductor/src/cli.ts` overlaps many open spec branches,
  notably `lock-474-s-breaking-surfaces-before-v1` (#552) — the rename feature must sequence
  with #552/#226 rather than land independently. Recorded as a scoping constraint, not a block.

## Alignment

- **Governing-ADR reuse check:** no existing ADR governs the daemon/engineer vocabulary.
  adr-2026-06-29-brainstorm-rename-migration governs a different rename (step name) and is cited
  as precedent, not amended — its decision (brainstorm→explore/prd migration) is unchanged by
  this one, so an amendment would attach unrelated content to it. A new ADR is warranted: the
  decision revises the CLI surface and durable state-path architecture (structural prerequisite
  met).
- Scope boundary honored: two renames only; repo name, entrypoints, event schema, and verdict
  vocabulary (deferred to #1918) excluded. No expansion beyond the operator-confirmed boundary.
- Consistent with the machinery-by-default principle: the alias shim and migration block are
  mechanical enforcement of the transition, not prompt discipline.

## Wiring Surface

This spec ships no production surface. The *scoped rename feature* (future work, bound to
#226) will wire:

- `conduct player …` subcommand — wired into the existing command table in
  `src/conductor/src/cli.ts` where `daemon` registers today; old name forwards via the alias shim
  at the same dispatch point (`detectDaemonCommand` seam in `engine/daemon-command.ts`).
- `conduct-ts composer …` / `/composer` skill — same dispatch seam as today's `engineer`
  commands and the `skills/` catalog symlink surface.
- Config-key aliases (e.g. `auto_restart_on_stale_engine` → player-named key) — resolved in the
  config loader, old key accepted with deprecation warning.
- `.daemon/`→ new state dir — migrated/dual-read at daemon startup (the load boundary, per the
  brainstorm-rename precedent).
- `## Migration` block — travels in the #226-major PR body per the release-gate contract.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Rename feature drifts from this scope when built later | Knowledge | Medium | Medium | ADR enumerates the exact surfaces; plan tasks reference it |
| Live `.daemon/` state (pid, grants, parked lists) breaks mid-transition | Data | Medium | Medium | Dual-read/migrate-on-load scoped as a mandatory task; precedent ADR cited |
| cli.ts collisions with #552/#226 branches | Integration | High | Low | Sequencing constraint recorded; rename lands inside the #226 major train |

## ADRs Created

- `adr-2026-08-26-music-vocabulary-player-composer-rename.md` (DRAFT → pending operator
  approval; becomes the sole authority for the vocabulary)

## Conditions

None. Verdict is APPROVED contingent only on the ADR reaching APPROVED status (lifecycle gate,
not a review condition).

## Amendment — complete implementation review (2026-08-26)

**Mode:** full (Large tier, technical track; stories replaced after operator scope correction)
**Inputs:** approved ADR plus operator amendment, amended component diagram, verified production
parsers/dispatch/config/state seams, and the accepted implementation stories
**Verdict:** APPROVED — human architecture review required before BUILD because state migration has
High data impact

The original review above is retained as the accepted history of the scoping-only proposal. The
operator changed the deliverable in PR #1921: this spec now owns the implementation. This amendment
is the governing architecture review for the current stories and plan.

### Feasibility and alignment

- `src/conductor/src/engine/daemon-command.ts`, `daemon-observe-cli.ts`, and
  `daemon-park-cli.ts` expose separable typed parser families for the bare worker, supervisor,
  observer, park, and reclaim commands. `src/conductor/src/index.ts` is their single dispatch seam,
  while `src/conductor/src/cli.ts` owns the Commander tree and rendered help. Canonical `player`
  parsing can therefore reuse the existing runtime descriptors without duplicating the worker.
- `src/conductor/src/engine/engineer-cli.ts` owns the complete deterministic idea-to-spec parser
  (`projects`, `worktree`, `land`, `handoff`, `poll`, `claim`, `forget`, `unclaim`, `requeue`,
  `resolve`, `migrate-issue-deps`) and the bare interactive launcher. Canonical `composer` parsing
  can reuse these stores and dispatch descriptors; the launcher changes its workflow name to
  `/composer` only on the already-supported host.
- The shipped `skills/engineer/` package already carries Claude and Codex discovery metadata.
  `skills/composer/` becomes the canonical implementation and the retained Engineer entrypoint is
  a small compatibility delegate, preventing behavior drift between two copied skills.
- Config loading already owns legacy-key normalization and the persisted
  `config_deprecated_key` event. `player_verbose` and
  `player_auto_restart_on_stale_engine` fit that boundary; no new telemetry schema or channel is
  needed. The remaining word `engine` correctly identifies the Conductor runtime being watched.
- Production has many direct `.daemon/` path constructions, so compatibility cannot be correct as
  scattered string substitutions. A central Player-state resolver chooses read-only or mutating
  mode, makes `.player/` the sole write root, adopts an old-only legacy tree, and rejects ambiguous
  old+new state. Existing modules may retain internal daemon-oriented symbol names while consuming
  resolved paths.
- The amended ADR already governs the public boundary, compatibility lifetime, config precedence,
  state-resolution rules, unchanged entrypoints, event-spine reuse, and retained internal engine
  terminology. No second ADR is warranted.

### Wiring surface

| Boundary | Existing owner | Required wiring | Verification seam |
|---|---|---|---|
| Player parsers | `daemon-command.ts`, `daemon-observe-cli.ts`, `daemon-park-cli.ts` | Accept canonical `player`; normalize deprecated `daemon` once; preserve typed dispatches | parser and alias-parity unit tests |
| Player command tree | `cli.ts`, `index.ts` | Register/dispatch the full canonical tree, preboot help, and one stderr warning for aliases | CLI help/dispatch acceptance tests |
| Composer parsers | `engineer-cli.ts`, `cli.ts`, `index.ts` | Accept `composer`, retain warning `engineer` alias, expose every runtime subcommand, launch `/composer` | parser, shared-store, launcher, and help tests |
| Composer skills | `skills/composer/`, `skills/engineer/`, model-table metadata and provider installers | Install Composer canonically for Claude/Codex; retain one delegating Engineer compatibility entry | harness-integrity and provider-discovery tests |
| Player config | `engine/config.ts`, `types/config.ts`, runtime option wiring | Type/validate canonical keys; normalize legacy keys; canonical wins; reuse `config_deprecated_key` | config normalization/event tests |
| Player state | new `engine/player-state-paths.ts`, daemon startup/observer/park/state consumers, registry scaffold | Resolve every durable path through one boundary; migrate old-only writers; dual-read old-only observers; reject ambiguity | resolver unit tests plus command integration tests |

No new service, third-party dependency, process, or event transport is introduced. Existing tests
must continue to use fakes at third-party boundaries.

### Risk register

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Old and new state trees are merged or overwritten | Data | Medium | High | Single resolver, explicit read/write modes, old-only precondition, atomic rename, no-overwrite ambiguity error, preservation/idempotence tests |
| Partial pid/log inner-name migration loses a live process reference | Data | Low | High | Finalize inner names before writes; reject conflicting old/new filenames and preserve both |
| Alias paths drift from canonical parsing or warn multiple times | Integration | Medium | Medium | Normalize vocabulary once at each CLI root and assert descriptor/output parity |
| Composer skill copies diverge across providers | Integration | Medium | Medium | One canonical Composer implementation; Engineer is a compatibility delegate; provider discovery tests |
| Central CLI/config files collide with open branches | Integration | High | Medium | Rebase/sequence with the #226/#552 major-boundary work and rerun focused suites after resolution |

### Assumption ledger

| Claim | Confidence | Grounding | Consequence if wrong |
|---|---|---|---|
| This PR must specify the complete rename implementation | Confirmed | Operator correction and explicit selection of the comprehensive approach on 2026-08-26 | Revert to scoping-only stories/plan |
| Canonical auto-restart key is `player_auto_restart_on_stale_engine` | Confirmed choice | Operator delegated the exact spelling; existing code proves `engine` names the watched Conductor engine | Adjust the boundary spelling before BUILD |
| Canonical config wins when both key forms exist | High | Approved ADR amendment and existing normalization-boundary precedent | Migration becomes order-dependent |
| Old+new state is ambiguous and must never be merged automatically | High | Approved ADR amendment plus repository no-data-loss operating rules | A manual reconciliation design would be required |
| Internal `engine` modules need no vocabulary rename | High | ADR exclusions and verified semantic distinction between Player and Conductor engine | Scope would expand substantially and require a new architecture pass |

No load-bearing assumption remains unconfirmed. The High-impact state risks are why
`.pipeline/review-required-architecture_review` is present for operator review.

**Status:** Accepted

# Stories: Phase-Scoped .docs Write-Guard (#788)

Track: technical — stories derive from the technical intent + APPROVED
`adr-2026-07-22-phase-scoped-docs-write-guard` (cited per story as the requirement
source). Marker file format referenced throughout (line-oriented, bash-readable, defined
by the ADR): `step: «name»` / `phase: «BUILD|SHIP»` / `written: «ISO-8601»` / zero or
more `allow: «.docs/ prefix»` lines.

## Story: Phase-keyed marker written on BUILD/SHIP step entry, cleared on exit

**Requirement:** adr-2026-07-22-phase-scoped-docs-write-guard §Decision 1

As the conductor engine, I want a `.pipeline/phase-active` marker present exactly while
a BUILD- or SHIP-phase step runs so that the docs-guard hook has a deterministic phase
signal.

### Acceptance Criteria

#### Happy Path
- Given a feature entering any step whose `steps.ts` entry has `phase: 'BUILD'` (e.g.
  `acceptance_specs`), when the step dispatch begins, then `.pipeline/phase-active`
  exists and contains `step: acceptance_specs` and `phase: BUILD` and a `written:` ISO
  timestamp.
- Given a feature entering any step with `phase: 'SHIP'` (e.g. `manual_test`), when the
  step dispatch begins, then the marker exists with `phase: SHIP`.
- Given a BUILD/SHIP step finishing (success OR failure OR thrown error), when the
  dispatch `finally` runs, then `.pipeline/phase-active` is absent.

#### Negative Paths
- Given a step whose phase is DECIDE (e.g. `stories`), when its dispatch begins, then
  `.pipeline/phase-active` is NOT created.
- Given the marker selection logic, when a NEW step is appended to `steps.ts` with
  `phase: 'SHIP'` in a test fixture, then the marker is written for it with no
  change to the marker module (phase-keyed, never name-enumerated — test asserts no
  step-name list exists in the writer's decision path).
- Given `.pipeline/` does not exist yet, when a BUILD step enters, then the directory is
  created and the marker written (no ENOENT crash).

### Done When
- [ ] Unit tests: marker present with correct `step:`/`phase:`/`written:` lines for one
  BUILD and one SHIP step; absent for a DECIDE step; removed in `finally` on success,
  failure, and throw.
- [ ] Writer keys off `step.phase` — asserted by a fixture step with a novel name.
- [ ] Marker write/clear call sites live beside the existing `writeBuildStepMarker` /
  `removeBuildStepMarker` sites in the conductor step dispatch loop.

## Story: Stale marker corrected at every step entry

**Requirement:** adr-2026-07-22-phase-scoped-docs-write-guard §Decision 2

As an operator whose previous run crashed mid-BUILD, I want the next conduct run to
correct a leaked marker so that `.docs/` authoring is not frozen indefinitely.

### Acceptance Criteria

#### Happy Path
- Given a leftover `.pipeline/phase-active` from a crashed run, when ANY step next
  enters (including a DECIDE step), then the leftover is removed before dispatch and —
  only if the entering step is BUILD/SHIP — rewritten for the entering step.

#### Negative Paths
- Given a leftover marker for step `build`, when a `stories` (DECIDE) step enters, then
  the marker is absent during the stories session (a `.docs/stories/` write passes).
- Given a leftover marker and NO subsequent conduct run (pure manual authoring), when a
  write to `.docs/specs/x.md` is attempted in a session, then the rejection message
  names the writing step from the marker's `step:` line, the marker path
  `.pipeline/phase-active`, and the remedy (`rm .pipeline/phase-active` when no
  build/ship step is running) — verified by string assertion on hook stderr.

### Done When
- [ ] Unit test: step entry unconditionally clears any existing marker before the
  phase-keyed rewrite decision.
- [ ] Hook test: block message contains the step name, the marker path, and the `rm`
  remedy text.

## Story: Docs-guard blocks .docs writes during BUILD/SHIP with default-deny

**Requirement:** adr-2026-07-22-phase-scoped-docs-write-guard §Decision 3–4

As the harness, I want write-tool mutations under `.docs/` mechanically rejected while
a BUILD/SHIP step is active so that spec artifacts cannot drift to match agent output.

### Acceptance Criteria

#### Happy Path
- Given an active marker (`step: build`, `phase: BUILD`, no `allow:` lines), when a
  PreToolUse event for Edit targets `.docs/plans/«slug».md`, then the hook exits 2 and
  stderr states the spec-artifact freeze, the blocking phase, and the redirect.
- Given the same marker, when Write targets `.docs/stories/x.md`, `.docs/specs/x.md`,
  or `.docs/decisions/adr-x.md`, then each is rejected with exit 2.
- Given any BUILD or SHIP marker, when Write targets
  `.docs/release-waivers/«plan-stem».md`, then the hook exits 0 (always-allowed
  prefix — waivers must land inside the feature's own diff per
  adr-2026-07-06-migration-gate-waiver; self-host-only artifact).

#### Negative Paths
- Given the same marker, when Edit targets a path in a NEW, unlisted `.docs/`
  subdirectory (e.g. `.docs/future-artifact-type/x.md`), then it is rejected (prefix
  default-deny — protection needs no code change for new subdirs).
- Given the same marker, when a NotebookEdit event targets `.docs/plans/x.ipynb`, then
  it is rejected (matcher covers `Edit|Write|NotebookEdit`).
- Given a marker with `allow: .docs/retros/`, when Write targets
  `.docs/retros-evil/x.md`, then it is rejected (prefix match is
  directory-boundary-safe, not a bare string prefix); likewise
  `.docs/release-waivers-evil/x.md` is rejected despite the always-allowed
  `.docs/release-waivers/` prefix.
- Given a malformed/empty marker file, when a `.docs/` write is attempted, then the
  hook fails CLOSED for `.docs/` targets (blocks, with the generic freeze reason) —
  a corrupt marker must not silently disable the guard.

### Done When
- [ ] Hook tests cover: exit 2 for all four canonical `.docs` families, unlisted-subdir
  default-deny, NotebookEdit matcher coverage, boundary-safe prefix compare, malformed
  marker fail-closed.
- [ ] Rejection stderr includes phase, step, and redirect text (string-asserted).

## Story: Allowlisted retro writes pass during SHIP

**Requirement:** adr-2026-07-22-phase-scoped-docs-write-guard §Decision 3

As a non-daemon retro session, I want my legitimate `.docs/retros/` and
`.docs/stories/` writes to pass so that retro output still lands while the guard is
active.

### Acceptance Criteria

#### Happy Path
- Given the conductor entering the `retro` step, when it composes the marker, then the
  marker carries `allow: .docs/retros/` and `allow: .docs/stories/` resolved from the
  typed engine allowlist table (`retro` is the table's only entry today).
- Given that marker, when Write targets `.docs/retros/2026-07-22-«slug».md`, then the
  hook exits 0 and the file is written.
- Given that marker, when Write targets `.docs/stories/«new-story».md`, then it passes.

#### Negative Paths
- Given that same retro marker, when Edit targets `.docs/plans/«slug».md` (not an
  allowed prefix), then it is rejected with exit 2 (allowlist is per-prefix, not
  per-step-blanket).
- Given a step NOT in the per-step allowlist table (e.g. `manual_test`), when the
  marker is composed, then its only `allow:` line is the static always-allowed
  `.docs/release-waivers/` prefix (present in every BUILD/SHIP marker; per-step
  entries add to it — `retro`'s marker carries all three).

### Done When
- [ ] Engine test: marker content for `retro` carries its two per-step prefixes plus
  the always-allowed `.docs/release-waivers/`; marker for `manual_test` carries only
  the always-allowed prefix.
- [ ] Hook tests: allowed-prefix write passes; non-allowed write under the same marker
  still blocks.

## Story: Guard is inert outside BUILD/SHIP and for non-docs targets

**Requirement:** adr-2026-07-22-phase-scoped-docs-write-guard §Decision 4, 6

As a DECIDE-phase author (or any session doing normal source work), I want the guard to
impose nothing so that authoring and implementation are unaffected.

### Acceptance Criteria

#### Happy Path
- Given no `.pipeline/phase-active` marker, when Write targets `.docs/stories/x.md`,
  then the hook exits 0 immediately (marker-absent fast path, no payload parsing).
- Given an active BUILD marker, when Edit targets `src/conductor/src/engine/foo.ts`,
  then the hook exits 0 (non-`.docs/` pass-through).

#### Negative Paths
- Given no marker and a hook invocation with NO payload delivered on stdin, when the
  hook runs, then it exits 0 without hanging (bounded/absent stdin handling on the
  fast path).
- Given an active marker and an unparseable tool payload for a write-surface event,
  when the target path cannot be determined, then the hook fails CLOSED (exit 2 with
  the freeze reason) — write-surface events are matcher-proven mutations, matching
  MUTATION_GATE_HOOK's fail-closed write-surface posture.

### Done When
- [ ] Hook tests: marker-absent exit 0; non-docs target exit 0; no-stdin no-hang;
  undeterminable-path-under-marker fail-closed.

## Story: Daemon worktrees get the guard via worktree-prepare

**Requirement:** architecture-review Wiring Surface; ADR §Decision 5a

As the daemon, I want every prepared feature worktree to carry the wired docs-guard so
that unattended BUILD/SHIP sessions are governed without operator action.

### Acceptance Criteria

#### Happy Path
- Given `worktree-prepare` provisioning a feature worktree, when session hooks are
  written, then `.pipeline/session-hooks/docs-guard.sh` exists, is executable, and
  `.claude/settings.local.json` carries a PreToolUse entry with matcher
  `Edit|Write|NotebookEdit` invoking it — as its OWN entry, distinct from
  mutation-gate's.

#### Negative Paths
- Given a worktree whose `settings.local.json` already has a docs-guard entry from a
  prior prepare, when prepare runs again, then exactly one docs-guard entry remains
  (idempotent merge, no duplicates).
- Given hook provisioning fails (e.g. unwritable dir), when prepare continues, then the
  failure is logged and worktree setup proceeds (fail-open provisioning, matching
  existing writeSessionHooks behavior).
- Given the mutation-gate entry is absent (e.g. removed by a future change), when
  prepare wires docs-guard, then the docs-guard entry is still written and functional
  (no ordering/chaining dependency on the sibling hook).

### Done When
- [ ] worktree-prepare tests: script written + executable; own settings entry with
  correct matcher; idempotent re-run; independence from mutation-gate entry.

## Story: Primary checkouts get the guard via bin/install with a migration block

**Requirement:** ADR §Decision 5b; CLAUDE.md Release & Update Gates

As an operator running conduct manually in a primary checkout, I want the same
marker-gated hook wired at install/update time so that manual BUILD/SHIP runs are
covered too (scope 2).

### Acceptance Criteria

#### Happy Path
- Given a fresh `bin/install` run, when harness hooks are merged into settings, then a
  PreToolUse entry with matcher `Edit|Write|NotebookEdit` invokes the installed
  docs-guard script.
- Given a consumer updating past this version, when `bin/migrate` executes the
  CHANGELOG `## Migration` block, then the same wiring lands in their settings.
- Given the wired hook and NO `.pipeline/phase-active` in the project, when any write
  occurs, then the hook exits 0 (inert during normal work — wiring alone changes no
  behavior).

#### Negative Paths
- Given a settings file with existing user-defined PreToolUse hooks, when install
  merges, then user entries are preserved and exactly one docs-guard entry exists
  (idempotent, non-destructive merge).
- Given the CHANGELOG for this feature, when the release gate classifier inspects the
  diff, then the `## Migration` section with a runnable ```bash migration``` block is
  present (hook-wiring is a canonical breaking surface — absence fails the release
  gate).

### Done When
- [ ] install merge test (or scripted assertion): entry present, idempotent,
  user-preserving.
- [ ] CHANGELOG `[Unreleased]` entry + `## Migration` block exist in the same PR.
- [ ] README/docs updated for the new hook per Documentation Upkeep.

## Story: Single-source hook asset — no divergent copies

**Requirement:** ADR §Decision 5 (single source of truth)

As a harness maintainer, I want exactly one authoritative copy of the docs-guard script
so that worktree and primary-checkout wirings can never drift apart.

### Acceptance Criteria

#### Happy Path
- Given the repo, when the hook content is needed by worktree-prepare AND by
  bin/install, then both obtain it from the single source (`DOCS_GUARD_HOOK` in
  `session-hook-assets.ts`; the install-time copy is generated/emitted from it — exact
  mechanism per plan).
- Given the single source changes, when the derived copy is regenerated, then the two
  are byte-identical.

#### Negative Paths
- Given the derived install-time copy is hand-edited to diverge, when the integrity
  suite (`test/test_harness_integrity.sh`) runs, then it FAILS naming the drift
  (mirrors the existing model-table drift check pattern).

### Done When
- [ ] One authoritative definition; derived copy mechanically produced.
- [ ] Integrity-suite drift check added and passing; a deliberate divergence makes it
  fail in a test.

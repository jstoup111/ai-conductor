**Status:** Accepted

# Stories: harness-daemon-profile — daemon build-to-PR enablement (#174)

Technical track (no PRD). Requirements TR-1..TR-4 derive from
adr-2026-07-03-harness-daemon-profile and adr-2026-07-03-version-gate-semver-escalation
(both APPROVED). Tier M — per-criterion negative paths.

- **TR-1** — committed `bin/setup` prepares a daemon build worktree's `src/conductor` toolchain.
- **TR-2** — `classifyVersionSignal`: pure, deterministic, fail-closed semver-signal classifier.
- **TR-3** — `VersionApprovalGate` escalation wiring: marker path unchanged; no-marker path
  classifies; PATCH auto-passes with an audit record; everything else HALTs.
- **TR-4** — docs + CHANGELOG reconciliation.

---

## Story: bin/setup builds the worktree toolchain

**Requirement:** TR-1

As the daemon, I want each build worktree to have an installed, compiled `src/conductor` so that
build steps and vitest runs work without manual prep.

### Acceptance Criteria

#### Happy Path
- Given a freshly created daemon build worktree of the harness repo, when `prepareWorktree` runs,
  then the committed `bin/setup` executes with `CI=true` and `WORKTREE_NAMESPACE` set, runs
  `npm install` then `npm run build` inside the worktree's `src/conductor`, and exits 0.
- Given `bin/setup` completed, when the build step runs vitest in `src/conductor`, then
  `node_modules/` and `dist/` exist inside THIS worktree (worktree-local paths — the primary
  checkout's `src/conductor/dist` mtimes are unchanged).

#### Negative Paths
- Given a worktree where `npm install` fails (e.g. registry unreachable — simulate with an
  injected failing runner), when `bin/setup` runs, then it exits non-zero without running the
  build, `prepareWorktree` throws, the worktree is KEPT on disk, and the feature is marked
  errored (existing worktree-prepare.ts contract).
- Given a worktree where `npm install` succeeds but `npm run build` fails (inject a TypeScript
  error), when `bin/setup` runs, then it exits non-zero and the same keep-worktree/errored
  contract holds.
- Given a consumer repo (not the harness), when its daemon prepares a worktree, then the
  harness's `bin/setup` is not involved (script is repo-local; no cross-repo effect).

### Done When
- [ ] `bin/setup` exists at repo root, is executable, passes `bash -n`, and is covered by the
      integrity suite's bash-syntax section (it lives in `bin/`).
- [ ] Real-binary smoke: running `bin/setup` in a scratch worktree produces
      `src/conductor/node_modules/` and `src/conductor/dist/index.js` inside that worktree only.
- [ ] Failure test proves non-zero exit propagates: worktree kept + feature errored.

---

## Story: classifier flags MAJOR surfaces

**Requirement:** TR-2

As the version gate, I want breaking surfaces detected from the change set so that a breaking
change can never auto-pass as a patch.

### Acceptance Criteria

#### Happy Path
- Given a change set containing `M bin/conduct`, when classified, then the result is MAJOR with
  surface "bin/conduct CLI" and that file listed.
- Given a change set containing `R100 skills/tdd/SKILL.md → archive/tdd/SKILL.md` (renamed OUT of
  skills/), when classified, then the result is MAJOR (skill symlink targets) — the origin path
  is inspected, not just the destination.

#### Negative Paths (adversarial inputs)
- Given `D skills/finish/SKILL.md` (deleted skill), when classified, then MAJOR — not PATCH,
  even though no allow-listed path is touched.
- Given `M hooks/claude/block-default-branch.sh` (modified hook), when classified, then MAJOR
  (hook wiring modification).
- Given `M settings.json` nested as `templates/settings.json` (matches the existing
  `(^|/)settings(\.local)?\.json$` surface regex), when classified, then MAJOR — consistent with
  `classifyBreakingSurfaces`, no divergence between the two classifiers on shared surfaces.
- Given a change set with BOTH `A skills/new-skill/SKILL.md` (MINOR) and `D bin/install`
  (MAJOR), when classified, then the reported level is MAJOR and the HALT reason lists BOTH
  signals (precedence rule, nothing swallowed).

### Done When
- [ ] Unit tests cover every MAJOR surface with A/M/D/R statuses including origPath cases.
- [ ] Mixed-signal precedence test passes (MAJOR wins, all signals reported).

---

## Story: classifier flags MINOR signals

**Requirement:** TR-2

As the version gate, I want additive skill/hook/gate surface detected so that a MINOR-worthy
change halts for a human semver decision instead of auto-passing.

### Acceptance Criteria

#### Happy Path
- Given `A skills/new-thing/SKILL.md`, when classified, then MINOR ("new skill") with the file
  listed.
- Given `A hooks/claude/new-hook.sh`, when classified, then MINOR ("new hook") — an ADDED hook
  is MINOR, distinct from a MODIFIED hook (MAJOR).

#### Negative Paths (adversarial inputs)
- Given `M HARNESS.md` with a one-line wording diff, when classified, then MINOR-or-higher HALT
  ("HARNESS.md edit — additivity not machine-decidable"), never PATCH.
- Given `A src/conductor/src/engine/self-host/new-gate.ts` (new engine gate file), when
  classified, then MINOR HALT — an ADDED file under the engine gate paths is a new-gate signal,
  while `M src/conductor/src/engine/self-host/version-gate.ts` alone remains PATCH-classifiable.
- Given `A skills/new-thing/reference.md` WITHOUT a SKILL.md (supporting file only), when
  classified, then it does NOT match the new-skill signal — it falls to the allow-list rule
  (and HALTs if not allow-listed) rather than falsely reporting "new skill".

### Done When
- [ ] Unit tests cover each MINOR signal and each near-miss (supporting-file-only, modified vs
      added hook, engine modify vs add).
- [ ] HALT reasons name the signal kind and the exact triggering paths.

---

## Story: PATCH allow-list is fail-closed

**Requirement:** TR-2

As the version gate, I want auto-pass only when EVERY changed path is provably patch-safe so
that uncertainty always escalates to a human.

### Acceptance Criteria

#### Happy Path
- Given a change set of `M README.md`, `M .docs/plans/foo.md`, `M test/engine/x.test.ts`,
  `M src/conductor/src/engine/selector.ts`, when classified, then PATCH (auto-pass) with the
  full file list in the result.

#### Negative Paths (adversarial inputs)
- Given a null change set (unknown base branch or git failure), when classified, then HALT
  (undeterminable, fail-closed) — never PATCH.
- Given an empty change set (`[]`, zero changed files), when classified, then HALT
  (undeterminable — an empty self-build diff is anomalous, not patch-proof).
- Given a change set of `M README.md` plus `A some/new/top-level-dir/file.txt` (path outside
  every allow-list glob and every signal), when classified, then HALT naming the unclassified
  path — one unknown file poisons auto-pass.
- Given a mixed patch+minor set (`M README.md` + `A skills/x/SKILL.md`), when classified, then
  MINOR HALT — allow-listed neighbors never dilute a signal.

### Done When
- [ ] Boundary tests: null, empty, unknown-path, and mixed sets all HALT with distinct reasons.
- [ ] The allow-list is a single exported constant with a test asserting its exact contents
      (layout drift breaks loudly).

---

## Story: gate wiring — marker invariance and audited auto-pass

**Requirement:** TR-3

As the operator, I want the existing approval-marker workflow untouched and every auto-pass
auditable so that the escalation adds no new silent path.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/version-approval` whose first non-empty line equals `VERSION`, when the gate
  runs, then it passes WITHOUT invoking the classifier (marker short-circuit preserved).
- Given no marker and a PATCH-classified change set, when the gate runs, then it passes and
  writes `.pipeline/version-signal.json` containing the verdict, the classified level, and the
  file list.
- Given the real `runSelfHostFinishGates` path (not a unit harness), when a self-build with a
  docs-only diff reaches finish gates, then `versionGate` receives the same `changedFiles` thunk
  as `releaseGate` and auto-passes — proving the classifier is wired at the live call site, not
  an orphaned primitive (grep confirms no second, unwired classification entry point).

#### Negative Paths
- Given a marker whose content mismatches `VERSION`, when the gate runs, then HALT with the
  existing mismatch reason — classification does NOT rescue a mismatched marker.
- Given no marker and a MINOR/MAJOR-classified set, when the gate runs, then HALT whose reason
  states the level, the triggering files, and the resume procedure (set VERSION per CLAUDE.md
  rule 4 or write the marker) — and `.pipeline/version-signal.json` is NOT left claiming a pass.
- Given no marker and an auto-pass where writing `.pipeline/version-signal.json` fails (e.g.
  unwritable .pipeline — inject fs failure), when the gate runs, then the gate HALTs rather
  than passing unaudited (the audit record is part of the pass contract, an invariant
  side-effect that must not be skippable on any branch).
- Given `harness_self_host.version_approval_gate: false` (gate disabled via config), when finish
  gates run, then no classification occurs and no version-signal.json is written (existing
  config seam respected).

### Done When
- [ ] Gate tests cover marker-pass, marker-mismatch, patch-auto-pass, signal-HALT, audit-write
      failure, and gate-disabled paths.
- [ ] `wiring.ts` / `conductor.ts` thread `changedFiles` into `versionGate`; a test exercises
      the real `runSelfHostFinishGates` composition.
- [ ] Grep evidence in review: zero callers of the old always-HALT no-marker behavior remain.

---

## Story: docs and changelog reconciliation

**Requirement:** TR-4

As a harness consumer reading the docs, I want the README to match the committed configuration
so that the retired tribal rule can't be re-learned from stale guidance.

### Acceptance Criteria

#### Happy Path
- Given README.md, when reconciled, then the "MUST NOT be set on the harness self-host repo /
  Leave it unset on the harness" cutover guidance (~lines 434, 443-444) is replaced with the
  actual policy (committed cutover 2026-07-02T11:00:00Z, per adr-2026-07-03-harness-daemon-profile),
  and the self-host guardrails section documents the escalation table (PATCH auto-pass /
  MINOR HALT / MAJOR HALT / undeterminable HALT) and the `.pipeline/version-signal.json` audit
  record.
- Given src/conductor/README.md, when reconciled, then a daemon-on-harness note exists: the
  repo is daemon-registered build-to-PR, human merge, `bin/setup` preps worktrees, and
  `bin/setup` is worktree-prep only (primary-checkout rebuild hazard → issue #215).
- Given CHANGELOG.md, when the feature lands, then `## [Unreleased]` carries an Added entry for
  the daemon profile (bin/setup + semver escalation + docs reconciliation, refs #174).

#### Negative Paths
- Given the reconciled README, when grepped for "MUST NOT be set on the harness", then zero
  matches remain (no contradictory copy survives elsewhere in the file).
- Given the full docs diff, when `test/test_harness_integrity.sh` runs, then it passes — the
  CHANGELOG section and any doc-referenced paths stay valid.

### Done When
- [ ] Both READMEs updated in the same PR as the code (docs-track-features rule).
- [ ] Grep for the retired guidance returns nothing.
- [ ] CHANGELOG `[Unreleased]` entry present; integrity suite green.

# Stories: Harness Daemon Self-Host Guardrails

**Status:** Accepted

**Track:** Technical (no PRD — acceptance criteria live here, tagged `TR-N`)
**Design:** `.docs/specs/2026-06-30-harness-self-host-guardrails.md`
**Architecture:** `.docs/architecture/2026-06-30-harness-self-host-guardrails.md`
**Complexity:** Tier L → full per-criterion negative paths.

> Traceability note (technical track): stories are tagged `TR-N` (technical requirement) instead
> of `FR-N`; each maps to a component/decision in the design doc. Stories state observable
> behavior (WHAT), not mechanism — the *how* is the plan's job.

---

## Story: Auto-detect that the repo under build is the harness

**Requirement:** TR-1 (SelfHostDetector — auto-detect)

As the daemon, I want to recognize when the repo I am about to build IS the `james-stoup-agents`
harness so that I activate the self-host guardrail bundle only for harness self-builds and leave
every other repo's path untouched.

### Acceptance Criteria

#### Happy Path
- Given a build whose repo root resolves to the same path as `resolveHarnessRoot()`, when the
  daemon evaluates self-host mode, then the detector returns `isSelfHost = true` and the guardrail
  bundle is activated.
- Given a build whose repo root differs from `resolveHarnessRoot()`, when the daemon evaluates
  self-host mode, then the detector returns `isSelfHost = false` and no guardrail is activated.

#### Negative Paths
- Given `resolveHarnessRoot()` returns `null` (harness root unresolvable), when the detector runs
  with no config override, then it returns `isSelfHost = false` (fail toward the unchanged normal
  path — a self-build is only ever activated on a *positive* identification) and emits a single
  debug line "self-host detection: harness root unresolved".
- Given the harness root and the build repo root differ only by a trailing slash or a symlinked
  path segment, when the detector compares them, then it normalizes both (realpath + trailing-slash
  strip) and still returns `isSelfHost = true` — a cosmetic path difference never causes a
  false negative.
- Given a non-harness repo that happens to be named `james-stoup-agents` but lives at a different
  absolute path, when the detector runs, then it returns `isSelfHost = false` (identity is by
  resolved path, not by repo name) — no false positive.

### Done When
- [ ] A `SelfHostDetector` returns a boolean/typed result from (buildRepoRoot, resolveHarnessRoot()).
- [ ] Unit test: equal realpaths → true; different realpaths → false; `null` harness root → false.
- [ ] Unit test: trailing-slash / symlinked-segment equality → true (no false negative).
- [ ] Unit test: same basename, different path → false (no false positive).

---

## Story: Operator can force self-host mode on or off via config

**Requirement:** TR-2 (SelfHostDetector — config override)

As the operator, I want to override self-host auto-detection through `HarnessConfig` so that I can
force the guardrails on (e.g. testing) or off (e.g. an escape hatch) without editing code.

### Acceptance Criteria

#### Happy Path
- Given `harness_self_host.activation: "auto"` (or absent), when the detector runs, then it uses
  path-based auto-detection (TR-1).
- Given `activation: "force_on"`, when the detector runs against ANY repo, then it returns
  `isSelfHost = true`.
- Given `activation: "force_off"`, when the detector runs against the harness repo itself, then it
  returns `isSelfHost = false` and the normal build path is used.

#### Negative Paths
- Given `activation` set to an unrecognized string (e.g. `"yes"`), when config is validated, then
  `validateConfig()` rejects it with a message naming the key and the allowed values
  (`auto | force_on | force_off`) — not a silent fall-through to a default.
- Given `activation: "force_off"` on the harness repo, when a self-build runs, then NO sandbox and
  NO gates are applied (the operator has explicitly opted out) and a single warning line records
  that self-host guardrails are disabled by config.

### Done When
- [ ] `HarnessConfig` carries a `harness_self_host` block with an `activation` enum.
- [ ] `validateConfig()` rejects an invalid `activation` value with a keyed, actionable error.
- [ ] Unit test: each of `auto` / `force_on` / `force_off` produces the documented detector result.
- [ ] Unit test: invalid value → validation error (not a default).

---

## Story: Detection is a swappable seam for a future platform identity

**Requirement:** TR-3 (SelfHostDetector — swappable seam)

As a maintainer preparing for an isolated remote (EKS) deployment, I want the detector to be an
interface (like the owner-gate's `IdentityResolver`) so that a platform-provided identity can
replace path comparison later without changing what the guardrails do.

### Acceptance Criteria

#### Happy Path
- Given the guardrail bundle consumes the detector through an interface (not a hardcoded path
  compare), when a test substitutes a stub detector returning `true`, then the full guardrail
  bundle activates with no code change to the guardrails.
- Given the same substitution returning `false`, when the daemon runs, then the normal path is
  used unchanged.

#### Negative Paths
- Given a replacement detector implementation is wired in, when the guardrail bundle's build/skip
  behavior is observed, then it is byte-for-byte identical to the path-based detector for the same
  boolean result — the seam swap changes *how* identity is decided, never *what* the gates do.
- Given no detector is injected, when the daemon runs, then it defaults to the concrete
  path-comparison detector (no null-seam crash).

### Done When
- [ ] Detector is defined as an interface with a default path-comparison implementation.
- [ ] Guardrail activation code depends on the interface, not `resolveHarnessRoot` directly.
- [ ] Unit test: stub detector (true/false) drives activation without touching guardrail code.
- [ ] A structural/architecture note records the seam as the EKS-identity replacement point.

---

## Story: Relink skills before dispatching a harness self-build

**Requirement:** TR-4 (SkillRelinkPreflight)

As the daemon, I want to relink harness skill symlinks (via `bin/install`) before dispatching a
harness self-build so that a build which adds or renames a skill never HALTs on "Unknown command /
no parseable result" from a stale symlink.

### Acceptance Criteria

#### Happy Path
- Given a harness self-build is about to be dispatched and the merged spec adds a new skill, when
  `SkillRelinkPreflight` runs (extending `ensureInstallFresh`), then `bin/install` relinks skills
  and the new skill is invokable — the build dispatches without an unlinked-skill HALT.
- Given skills are already fresh, when the preflight runs, then relink is a no-op and dispatch
  proceeds (idempotent).

#### Negative Paths
- Given `bin/install` exits non-zero during relink, when the preflight runs, then it raises
  `InstallStaleError` (existing type) and the build is NOT dispatched into a known-stale state —
  the error surfaces instead of a downstream mid-build HALT.
- Given `resolveHarnessRoot()` returns `null`, when the preflight runs, then it does not attempt a
  relink (nothing to link against) and reports the unresolved root rather than crashing.
- Given the preflight runs for a NON-harness build, when dispatch occurs, then the existing
  `ensureInstallFresh` behavior is unchanged — relink-on-self-build is additive and never alters
  the normal-repo preflight.
- Given `bin/install` is missing or non-executable, when the preflight runs, then it fails with a
  clear message naming the missing installer path, not an opaque spawn error.

### Done When
- [ ] Self-host preflight relinks via the existing `InstallRunner` seam (no new install path).
- [ ] Test (injected runner): new-skill scenario → relink invoked → dispatch proceeds.
- [ ] Test: `bin/install` non-zero exit → `InstallStaleError`, no dispatch.
- [ ] Test: non-harness build → preflight behavior identical to today (regression guard).
- [ ] A real-binary smoke test confirms `bin/install --check`/relink actually runs (not just argv).

---

## Story: A harness self-build runs against a throwaway CLAUDE_CONFIG_DIR

**Requirement:** TR-5 (SandboxBuildEnv — isolation)

As the daemon, I want a harness self-build to run Claude Code with a throwaway
`CLAUDE_CONFIG_DIR` whose `skills/` and `hooks/` symlink into the build worktree so that the build
exercises its OWN edited harness, not the operator's global `~/.claude`.

### Acceptance Criteria

#### Happy Path
- Given a harness self-build reaches the build step, when `SandboxBuildEnv` provisions the sandbox,
  then a throwaway config dir is created whose `skills/` and `hooks/` point at the build worktree's
  edited copies, and Claude Code is launched with `CLAUDE_CONFIG_DIR` set to that dir.
- Given the worktree edits a skill, when the build runs, then the build invokes the EDITED skill
  from the worktree (verified by an edit-sensitive assertion), not the global one.

#### Negative Paths
- Given the sandbox provisions successfully, when the build step completes (pass OR fail), then the
  throwaway config dir is torn down and `~/.claude/skills` + `~/.claude/hooks` are byte-for-byte
  identical to their pre-build state — no leak, verified by comparison.
- Given the build subprocess crashes or is killed mid-run, when control returns, then teardown
  STILL runs (try/finally-style guarantee) and no orphaned throwaway config dir remains — the
  cleanup side effect is asserted on the error branch, not assumed from the happy path.
- Given creating the sandbox dir or a symlink fails (e.g. disk full, EACCES), when provisioning
  runs, then the build is NOT launched with a partially-built sandbox; it HALTs (or errors) with a
  message naming the failed path, and any partial sandbox is removed.
- Given `CLAUDE_CONFIG_DIR` was already set in the daemon's environment, when the sandbox is
  provisioned, then the sandbox value is used for the child build only and the daemon's own
  environment is restored afterward (no ambient-env bleed).

### Done When
- [ ] Self-build launches Claude Code with `CLAUDE_CONFIG_DIR` → throwaway dir linked to worktree.
- [ ] Test: an edited-skill worktree causes the build to resolve the edited skill (edit-sensitive).
- [ ] Test: after pass AND after fail, global `~/.claude/skills`+`hooks` are unchanged (diff-clean).
- [ ] Test: forced mid-build crash → teardown runs, no orphaned sandbox dir.
- [ ] Test: symlink/mkdir failure → no build launch, partial sandbox removed, keyed error.

---

## Story: Concurrent operator sessions are never disturbed by a self-build

**Requirement:** TR-6 (SandboxBuildEnv — no-leak under concurrency, safety-critical)

As the operator running ~20 concurrent live Claude sessions off global `~/.claude/skills`, I want a
harness self-build to be fully isolated so that a mid-build edit to a broken intermediate state
never breaks my running sessions.

### Acceptance Criteria

#### Happy Path
- Given operator sessions are reading global `~/.claude/skills` while a harness self-build is in
  progress, when the self-build edits skills inside its worktree/sandbox, then the global symlink
  targets the operator's sessions read are unmodified throughout the build.

#### Negative Paths
- Given the self-build writes a syntactically broken intermediate skill file in the worktree, when
  a concurrent operator session loads a skill, then the operator session is unaffected because it
  reads global targets, not the sandbox — the broken intermediate is confined to the sandbox.
- Given two builds could conceivably target the harness at once, when a self-build holds the
  single-daemon lock (ADR-010), then only one self-build proceeds per repo — the sandbox is not
  shared or clobbered by a second concurrent self-build.
- Given the sandbox teardown races with the daemon exiting, when the daemon is killed, then teardown
  either completes or leaves only an inert throwaway dir that never points into global config (no
  path from an abandoned sandbox back to `~/.claude`).

### Done When
- [ ] Test: global skill targets are unchanged (hash/inode-stable) across a full self-build run.
- [ ] Test: a broken intermediate skill in the sandbox does not resolve into global config.
- [ ] Test: single-daemon lock prevents a second concurrent harness self-build.
- [ ] Documented invariant: no sandbox symlink ever has a global-config target.

---

## Story: HALT for VERSION-bump approval before opening a self-build PR

**Requirement:** TR-7 (VersionApprovalGate)

As the operator, I want a harness self-build to HALT for my semver-bump approval before it opens a
PR so that `CLAUDE.md`'s "present the VERSION bump for approval" rule is enforced in `auto` mode
instead of silently skipped or guessed.

### Acceptance Criteria

#### Happy Path
- Given a harness self-build reaches finish and an operator VERSION-bump approval marker is present,
  when the `VersionApprovalGate` runs, then it passes and the finish flow proceeds to the release
  gate.
- Given the approval marker records the approved new VERSION, when the gate passes, then the PR is
  opened with that VERSION (the daemon does not invent a bump).

#### Negative Paths
- Given no approval marker exists, when the gate runs in `auto` mode, then it calls `writeHalt()`
  with a gate-specific reason (e.g. "VERSION-bump approval required — record approved bump, then
  resume") — distinct from a rebase HALT — and the PR is NOT opened.
- Given the approval marker exists but records a VERSION that does not match the repo's `VERSION`
  file after the bump, when the gate runs, then it HALTs naming the mismatch rather than opening a
  PR with an unapproved version.
- Given the build is a NON-harness build, when finish runs, then the VERSION gate does not apply
  (no HALT) — the gate is scoped to self-builds only.

### Done When
- [ ] Finish step for a self-build checks for a VERSION-bump approval marker before opening a PR.
- [ ] Missing marker → `writeHalt()` with a distinct, gate-named reason; no PR opened.
- [ ] Test: marker present + matching VERSION → gate passes.
- [ ] Test: marker absent → HALT written, PR not opened.
- [ ] Test: non-harness finish → gate not applied.

---

## Story: HALT when the integrity suite fails on a self-build

**Requirement:** TR-8 (ReleaseArtifactGate — integrity suite)

As the operator, I want a harness self-build to run `test/test_harness_integrity.sh` at finish and
HALT on failure so that a self-build can never open a PR that breaks harness integrity.

### Acceptance Criteria

#### Happy Path
- Given a harness self-build at finish, when `ReleaseArtifactGate` runs `test_harness_integrity.sh`
  and it exits 0, then the integrity check passes and finish proceeds.

#### Negative Paths
- Given the integrity script exits non-zero, when the gate runs, then it calls `writeHalt()` with a
  reason naming "harness integrity suite failed" (and, when the script surfaces them, the failing
  check) and the PR is NOT opened.
- Given `test/test_harness_integrity.sh` is missing or non-executable, when the gate runs, then it
  HALTs with a clear "integrity suite not found/executable" message rather than treating an absent
  script as a pass (fail-closed on the release gate).
- Given the integrity script hangs, when the gate runs, then it is bounded by a timeout and a
  timeout is treated as a failure (HALT), not an indefinite block on the daemon.

### Done When
- [ ] Self-build finish invokes `test_harness_integrity.sh` and reads its exit code.
- [ ] Non-zero exit → `writeHalt()` naming the failing gate; no PR.
- [ ] Missing/non-executable script → fail-closed HALT (not a silent pass).
- [ ] Test: exit 0 → pass; exit non-zero → HALT; missing script → HALT.

---

## Story: HALT when CHANGELOG [Unreleased] is empty on a self-build

**Requirement:** TR-9 (ReleaseArtifactGate — CHANGELOG)

As the operator, I want a harness self-build to HALT unless `CHANGELOG.md` has a non-empty
`## [Unreleased]` section so that the repo's "changelog on every PR" gate holds for autonomous
self-builds too.

### Acceptance Criteria

#### Happy Path
- Given a self-build whose `CHANGELOG.md` has a `## [Unreleased]` section with at least one entry
  under Added/Changed/Fixed/Removed, when the gate runs, then the CHANGELOG check passes.

#### Negative Paths
- Given `## [Unreleased]` exists but is empty (no entries), when the gate runs, then it HALTs with
  a reason naming the empty `[Unreleased]` section and no PR is opened.
- Given `CHANGELOG.md` has no `## [Unreleased]` section at all, when the gate runs, then it HALTs
  naming the missing section (consistent with the integrity suite's own CHANGELOG assertion), not a
  silent pass.
- Given only whitespace/comments sit under `[Unreleased]`, when the gate runs, then it is treated
  as empty and HALTs — presence of the header alone does not satisfy the gate.

### Done When
- [ ] Gate parses `CHANGELOG.md` and asserts a non-empty `## [Unreleased]` with ≥1 real entry.
- [ ] Empty or missing `[Unreleased]` → `writeHalt()`; no PR.
- [ ] Test: populated section → pass; empty/missing/whitespace-only → HALT.

---

## Story: HALT when a breaking self-build lacks a Migration block

**Requirement:** TR-10 (ReleaseArtifactGate — migration block)

As the operator, I want a harness self-build that makes a breaking change (settings.json schema,
hook wiring, skill symlink targets, or `bin/conduct` CLI) to HALT unless `CHANGELOG.md` includes a
runnable `## Migration` block so that `bin/migrate` can carry consumers past the breaking version.

### Acceptance Criteria

#### Happy Path
- Given a self-build that changes a breaking surface AND includes a `## Migration` section with a
  fenced ```bash migration block, when the gate runs, then the migration check passes.
- Given a self-build that changes NO breaking surface, when the gate runs, then the migration check
  is not required and passes.

#### Negative Paths
- Given a self-build touches a breaking surface but has NO `## Migration` block, when the gate runs,
  then it HALTs naming the breaking surface detected and the missing migration block; no PR.
- Given a `## Migration` section exists but contains no runnable ```bash fenced block, when the
  gate runs, then it HALTs — a prose-only migration note does not satisfy `bin/migrate`'s
  executable-block contract.
- Given the breaking-surface detection is uncertain, when the gate cannot confirm the change is
  non-breaking, then it errs toward requiring the block (fail-closed) rather than skipping it.

### Done When
- [ ] Gate detects breaking-surface changes and conditionally requires a `## Migration` block.
- [ ] Breaking change w/o runnable migration block → `writeHalt()`; no PR.
- [ ] Non-breaking change → migration not required.
- [ ] Test: breaking+block → pass; breaking+no-block → HALT; non-breaking → pass.

---

## Story: New self-host config is validated and defaults safe

**Requirement:** TR-11 (HarnessConfig extension + validateConfig)

As the operator, I want the new self-host config keys validated by `validateConfig()` and to
default to the safe behavior so that a missing or partial config never disables the guardrails
silently.

### Acceptance Criteria

#### Happy Path
- Given no `harness_self_host` block in config, when config loads, then self-host mode auto-detects
  and ALL gates are on (safe default).
- Given a well-formed `harness_self_host` block with per-gate toggles, when config loads, then the
  toggles are honored and validation passes.

#### Negative Paths
- Given a malformed value for a gate toggle (e.g. a string where a boolean is expected), when
  `validateConfig()` runs, then it rejects the config with a keyed, actionable error naming the
  offending key — consistent with existing config validation.
- Given a partial config that sets `activation` but omits gate toggles, when config loads, then the
  omitted gates default to enabled (a partial config never silently disables a gate).
- Given an unknown key under `harness_self_host`, when validation runs, then it is reported per the
  existing config-validation convention (reject or warn, matching sibling blocks like `otel`) — not
  silently ignored in a way that hides a typo'd gate name.

### Done When
- [ ] `HarnessConfig` gains a typed `harness_self_host` block (activation + gate toggles).
- [ ] `validateConfig()` validates the block; malformed values → keyed errors.
- [ ] Absent/partial config → all guardrails default ON.
- [ ] Test: valid block honored; malformed value rejected; omitted toggle defaults ON.

---

## Story: The daemon never merges a harness self-build

**Requirement:** TR-12 (ADR-005/ADR-010 invariant preserved)

As the operator, I want every harness self-build to end at a HALT for me to re-install, `/verify`,
and merge so that the ADR-005 human-merge invariant holds — the daemon proposes, I merge.

### Acceptance Criteria

#### Happy Path
- Given a self-build passes the version and release-artifact gates, when finish completes, then it
  ends at a HALT (re-install → verify → merge) and the daemon does NOT call any merge entry point.
- Given a merged spec drives the self-build, when finish completes, then the output is a PR the
  operator merges — never an autonomous merge.

#### Negative Paths
- Given any self-host gate fails, when finish runs, then the flow HALTs at that gate and never
  reaches a PR/merge — a failing gate cannot be bypassed into a merge.
- Given a structural test inspects the self-host finish path, when it checks call sites, then no
  `gh pr merge` / merge-API call is reachable from the self-build finish flow (structural
  guarantee, per ADR-005 non-autonomy-by-construction).
- Given the operator has NOT approved the version (TR-7 HALT active), when the daemon loop
  continues, then it does not re-attempt the build into a merge — the HALT parks the feature until
  the operator resumes.

### Done When
- [ ] Self-build finish always terminates at a HALT for manual re-install/verify/merge.
- [ ] No merge entry point is reachable from the self-build finish path (structural test).
- [ ] Test: any gate failure → HALT, PR/merge unreachable.

---

## Story: Non-harness builds are byte-for-byte unchanged

**Requirement:** TR-13 (Regression guard — normal path untouched)

As the operator with ~20 other registered repos, I want self-host mode to change NOTHING for a
non-harness build so that this feature adds zero risk to every other repo's daemon.

### Acceptance Criteria

#### Happy Path
- Given a build whose repo is not the harness, when the daemon runs discovery → build → finish,
  then no preflight relink-for-self-build, no sandbox, no version gate, and no release-artifact gate
  are applied — the path is identical to today.

#### Negative Paths
- Given `activation: "force_off"` on the harness repo, when a build runs, then it behaves exactly
  like a non-harness build (explicit opt-out equals the normal path).
- Given the detector is present but returns false, when the daemon runs, then no self-host code
  executes on the hot path beyond the single boolean check — no measurable behavior change for
  other repos.

### Done When
- [ ] Test: a representative non-harness build exercises the unchanged normal path (no gate/sandbox).
- [ ] Test: existing daemon/finish tests pass unchanged (no regression).
- [ ] The only added hot-path cost on a non-harness build is one detector boolean check.

---

## Coverage Map (TR → component)

| TR | Component / Decision |
|----|----------------------|
| TR-1, TR-2, TR-3 | `SelfHostDetector` (auto-detect, config override, swappable seam) |
| TR-4 | `SkillRelinkPreflight` (extends `ensureInstallFresh`) |
| TR-5, TR-6 | `SandboxBuildEnv` (throwaway `CLAUDE_CONFIG_DIR`, no-leak/teardown, concurrency) |
| TR-7 | `VersionApprovalGate` |
| TR-8, TR-9, TR-10 | `ReleaseArtifactGate` (integrity / CHANGELOG / migration) |
| TR-11 | `HarnessConfig` extension + `validateConfig()` |
| TR-12 | ADR-005/ADR-010 human-merge invariant |
| TR-13 | Regression guard — normal path unchanged |

## Next Step
Run `/conflict-check` to verify these stories do not conflict with existing stories (notably
`daemon-owner-gate.md`, `daemon-supervised-hosting.md`, and `rebase-resolution-skill.md`, which
share the daemon discovery / finish / HALT surfaces).

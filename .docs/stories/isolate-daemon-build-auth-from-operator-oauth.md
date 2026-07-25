**Status:** Accepted

# Stories: Isolate Daemon Build Auth from Operator OAuth

**Feature:** isolate-daemon-build-auth-from-operator-oauth (jstoup111/ai-conductor#351)
**Track:** technical (no PRD)
**Authority:** adr-2026-07-07-daemon-owned-build-credential (APPROVED);
architecture-review-2026-07-07-isolate-daemon-build-auth (APPROVED WITH CONDITIONS)

Requirement tags TR-1…TR-6 map to the ADR's decision points; every architecture-review
condition is covered by at least one story (smoke gate → TR-5 story; no-silent-fallback →
TR-3 story; Migration block → TR-6 story; negative-path specs → per-criterion negatives
throughout).

---

## Story: Build-auth config resolves modes fail-closed

**Requirement:** TR-1 (BuildAuthProvider seam + config surface)

As the daemon operator, I want the build-auth mode resolved from `harness_self_host`
config with safe defaults so that a partial or invalid config can never silently select
the wrong identity or billing.

### Acceptance Criteria

#### Happy Path
- Given no `harness_self_host.build_auth` block in `.ai-conductor/config.yml`, when
  `resolveSelfHostConfig` runs, then the resolved mode is `daemon-token` with token path
  `~/.ai-conductor/build-auth` (default-secure, like every other self-host field).
- Given `build_auth: { mode: api-key }`, when config resolves, then the resolved mode is
  `api-key` and no token path is required.
- Given `build_auth: { mode: daemon-token, token_path: /custom/path }`, when config
  resolves, then the resolved token path is `/custom/path`.

#### Negative Paths
- Given `build_auth: { mode: operator-oauth }` (or any unknown mode string), when config
  validation runs, then validation fails with an error naming the invalid mode and the
  allowed values `daemon-token | api-key` — it is never coerced to a default.
- Given `build_auth: { mode: "" }` or `mode: 42`, when config validation runs, then
  validation fails with a type/value error; resolution is never reached with the bad value.
- Given `build_auth: { token_path: "" }` (blank/whitespace), when config resolves, then
  the blank normalizes to the default path (never an empty string that would read CWD).

### Done When
- [ ] `resolveSelfHostConfig` returns `{ buildAuthMode: 'daemon-token', buildAuthTokenPath: <default> }` for an absent block (unit test).
- [ ] `validateConfig` rejects unknown/empty/non-string modes with a message listing allowed values (unit tests, one per bad shape).
- [ ] Config docs in `src/conductor/README.md` document the new fields and defaults.

---

## Story: Sandbox authenticates from the daemon token — operator credentials never read

**Requirement:** TR-2 (sever the copy)

As the daemon operator, I want self-host sandbox builds to authenticate from the
daemon-owned token so that my interactive OAuth credential is never copied, read, or
rotated by a build.

### Acceptance Criteria

#### Happy Path
- Given daemon-token mode and a non-empty token file, when the sandbox is provisioned,
  then `childEnv()` contains `CLAUDE_CODE_OAUTH_TOKEN=<token>` and the sandbox config dir
  contains NO `.credentials.json`.
- Given a provisioned sandbox, when its contents are enumerated, then the only symlinks
  are `skills/` and `hooks/` resolving into the worktree (TR-6 invariant unchanged) and
  no file under the sandbox derives from `<globalConfigDir>/.credentials.json`.
- Given the daemon's parent env, when `childEnv()` is called, then the parent env object
  is not mutated (existing no-bleed contract holds with the new variable).

#### Negative Paths
- Given daemon-token mode, when provisioning runs with an instrumented fs seam, then
  zero reads of `<globalConfigDir>/.credentials.json` are recorded — on the happy path
  AND on every provisioning-failure branch (missing skills/, fs error).
- Given a token value, when any provisioning/HALT/log output is produced, then the token
  string never appears in it (assert on captured output; leak = fail).
- Given a mid-build auth park that resolves (token re-minted), when the build resumes,
  then `refreshSandboxCredentials` no longer exists as an export and no re-copy of any
  operator file occurs (compile-time removal + grep gate: zero callers).
- Given a worktree missing `skills/`, when provisioning fails, then the partial sandbox
  is removed and no env carrying the token has been handed to any child (fail-closed
  ordering: token injection only on fully-provisioned sandboxes).

### Done When
- [ ] `provisionSandboxBuildEnv` no longer references `CREDENTIALS_FILE`; the constant and `refreshSandboxCredentials` are deleted; `grep -rn refreshSandboxCredentials src/` returns nothing.
- [ ] Unit tests assert `childEnv()` carries the token and the sandbox dir has no `.credentials.json`.
- [ ] Instrumented-fs test proves zero operator-credential reads on happy and failure branches.
- [ ] Token value asserted absent from all captured provisioning output.

---

## Story: Missing daemon token HALTs with mint instructions — never a silent fallback

**Requirement:** TR-3 (no silent fallback)

As the daemon operator, I want a missing/empty daemon token to stop the build with the
exact one-time fix so that the daemon never silently reverts to copying my OAuth
credential or switching my billing.

### Acceptance Criteria

#### Happy Path
- Given daemon-token mode and no file at the token path, when pre-flight runs before
  dispatch, then the feature HALTs (no sandbox provisioned, no `claude` spawned) with a
  reason containing: the token path, `claude setup-token`, and the config key for
  choosing a different mode.
  > **Front-run note (2026-07-22, conflict-check for #498):** in daemon dispatch, the
  > daemon-level missing-credential gate
  > (adr-2026-07-22-daemon-level-missing-credential-gate) now parks the whole cycle
  > BEFORE any feature dispatches, so this per-feature pre-flight normally never fires
  > on a globally-missing token. Its semantics are unchanged and it remains the
  > fail-closed backstop whenever it IS reached (races, mid-cycle deletion,
  > non-daemon runs).

#### Negative Paths
- Given an empty or whitespace-only token file, when pre-flight runs, then it is treated
  exactly as missing (HALT with mint instructions), never injected as an empty
  `CLAUDE_CODE_OAUTH_TOKEN`.
- Given a token file unreadable due to EACCES, when pre-flight runs, then the HALT
  reason names the path and the permission problem — it does not fail open into a spawn
  that would burn retry budget.
- Given a missing daemon token, when the HALT reason is written, then it contains no
  reference to `~/.claude/.credentials.json` or the operator's OAuth (the operator must
  never be sent to re-login as remediation for a daemon-side gap).
- Given an existing HALT marker from a prior failure, when the credentials pre-flight
  HALTs again, then the original marker is preserved (existing don't-overwrite contract
  carries over to the new reason).

### Done When
- [ ] Pre-flight unit tests: missing file, empty file, EACCES → HALT with path + `claude setup-token` in the reason; zero sandbox provisions and zero spawns recorded.
- [ ] Assertion that the HALT text never mentions the operator credentials path.
- [ ] Retry budget observed byte-identical across the HALT (no attempts consumed).

---

## Story: Auth failures park on the daemon token source and resume on re-mint

**Requirement:** TR-4 (park retarget)

As the daemon operator, I want a rejected/expired daemon token to park the build and
watch the daemon token file so that re-minting the token resumes the build in place,
and a timeout HALTs with daemon-token remediation.

### Acceptance Criteria

#### Happy Path
- Given a build failing with the auth-failure signature ("Not logged in"), when the
  park engages, then it polls the DAEMON token path (presence + mtime), and when the
  file's mtime advances with non-empty content, the same attempt retries with the retry
  budget intact and the new token injected into the (still-provisioned) sandbox env.
- Given a park that times out (`auth_park_timeout_minutes`), when the HALT is written,
  then the reason names the daemon token path and re-mint instructions — never the
  operator OAuth file or its `expiresAt`.

#### Negative Paths
- Given a SUCCESSFUL build whose output happens to contain "Not logged in", when the
  run completes, then no park engages (signature matched only on non-zero exit —
  adr-2026-07-04 contract preserved).
- Given a park in progress, when the token file is touched but left empty, then the
  park continues (content check, not mtime alone) until timeout.
- Given a park that resolves by re-mint, when the model ladder and retry budget are
  inspected, then both are byte-identical to their pre-park state (auth never leaks
  into retry/escalation semantics).
- Given api-key mode, when an auth failure occurs, then the park does NOT poll the
  daemon token path; the HALT names `ANTHROPIC_API_KEY` as the credential to fix
  (mode-appropriate remediation, no cross-mode message).
- Given concurrent operator activity in `~/.claude` (interactive refreshes rewriting
  `.credentials.json`), when a daemon build runs or parks, then those rewrites are
  never observed by the daemon (no watcher, no reads on that path) — asserted via
  instrumented fs.

### Done When
- [ ] Park tests: refresh-resume (budget intact, new token in env), timeout-HALT (daemon-token reason), empty-touch keeps parking.
- [ ] Success-with-signature-text test proves no false park.
- [ ] api-key-mode auth failure produces mode-appropriate messaging.
- [ ] `waitForCredentialsChange`/pre-flight readers take the daemon token source; no call site passes the operator credentials path for build auth anymore (grep gate).

---

## Story: Real-binary smoke proves headless token auth before the copy path dies

**Requirement:** TR-5 (smoke gate — architecture-review Condition 1)

As the harness maintainer, I want an integration smoke against the actual installed
`claude` binary proving `CLAUDE_CODE_OAUTH_TOKEN` authenticates a headless run from a
fresh CLAUDE_CONFIG_DIR so that the operator-credential copy is deleted only on verified
behavior, not an inferred flag.

### Acceptance Criteria

#### Happy Path
- Given the real `claude` binary and a fresh empty CLAUDE_CONFIG_DIR with
  `CLAUDE_CODE_OAUTH_TOKEN` set from a valid token, when a minimal `claude -p` runs,
  then it exits 0 having authenticated (no "Not logged in") — recorded as the smoke
  gate for this feature.

#### Negative Paths
- Given the same fresh config dir with the variable unset, when `claude -p` runs, then
  it fails with the auth-failure signature — proving the sandbox carries no ambient
  auth and the env var is the operative mechanism (not some leaked state).
- Given an intentionally corrupted token value, when `claude -p` runs, then the failure
  output matches `AUTH_FAILURE_RE` — proving the existing signature classifies
  token-mode failures (backstop validity).
  > **FALSIFIED (2026-07-22, verified live):** a corrupted token actually produces
  > `Failed to authenticate. API Error: 401 Invalid bearer token`, which the current
  > `AUTH_FAILURE_RE` does NOT match — this is the #484 retry-ladder burn. Superseded
  > by FR-4 of `.docs/stories/build-auth-token-check-and-classify.md` and
  > adr-2026-07-22-auth-failure-classification-observed-401-patterns, which extend the
  > classification to the observed patterns.
- Given an environment without a valid token available (CI without secrets), when the
  smoke suite runs, then the smoke SKIPS explicitly with a named reason — it never
  false-greens by asserting nothing (guarded-skip, mirrors the render-check pattern).

### Done When
- [ ] Smoke test exists beside the existing real-binary smokes, env-kill-switch guarded (feedback_tests_leak_real_processes) and skip-guarded for token absence.
- [ ] Smoke passes on the self-host host with a minted token before the PR that deletes the copy path merges (ordering enforced in the plan).
- [ ] `AUTH_FAILURE_RE` verified against real token-mode failure output.

---

## Story: Migration and docs carry the one-time onboarding

**Requirement:** TR-6 (rollout — architecture-review Conditions 2/3)

As a self-host operator updating past this change, I want the CHANGELOG Migration block
and docs to hand me the exact one-time setup so that the first post-update build HALT
(if I skip it) is a documented, self-explanatory step — not a mystery regression.

### Acceptance Criteria

#### Happy Path
- Given the PR, when CHANGELOG.md is read, then `## [Unreleased]` carries the feature
  entry AND a `## Migration` section with a runnable ```bash migration``` block:
  `claude setup-token` + writing the token to `~/.ai-conductor/build-auth` with 0600
  perms + a pointer to the `build_auth` config keys.
- Given the docs, when README.md / src/conductor/README.md are read, then the
  build-auth modes, default token path, HALT remediation, and api-key alternative are
  documented (docs-track-features gate).

#### Negative Paths
- Given an operator who skips the migration, when the daemon dispatches its first
  self-host build, then the TR-3 HALT names exactly the same steps as the Migration
  block (one consistent remediation story — no divergent instructions).
- Given the migration block, when it is executed on a host where the token file already
  exists, then it does not clobber an existing token without prompting (idempotent-safe
  re-run).

### Done When
- [ ] CHANGELOG `[Unreleased]` + `## Migration` with runnable block present in the same PR.
- [ ] README.md and src/conductor/README.md updated in the same PR.
- [ ] HALT text and Migration block reference the identical command sequence.

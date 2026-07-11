# Implementation Plan: Isolate Daemon Build Auth from Operator OAuth

**Date:** 2026-07-07
**Design:** .docs/decisions/adr-2026-07-07-daemon-owned-build-credential.md (APPROVED);
architecture-review-2026-07-07-isolate-daemon-build-auth.md (APPROVED WITH CONDITIONS)
**Stories:** .docs/stories/isolate-daemon-build-auth-from-operator-oauth.md (TR-1…TR-6, Accepted)
**Conflict check:** Clean as of 2026-07-07 (supersession of sandbox-auth-expiry-park TR-2/3/4)
**Source:** jstoup111/ai-conductor#351

## Summary

Sever the self-host build path's dependence on the operator's `~/.claude/.credentials.json`
by introducing a daemon-owned build credential (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`)
behind a config-selected auth mode, retargeting pre-flight + park-and-poll to the daemon token,
and deleting the credential-copy machinery. 18 tasks.

## Technical Approach

- **Config (TR-1):** additive `harness_self_host.build_auth` block — `mode: daemon-token |
  api-key` (default `daemon-token`), `token_path` (default `~/.ai-conductor/build-auth`).
  Raw types in `src/types/config.ts`, validation beside the existing self-host checks
  (fail-closed on unknown/empty modes), resolution in `resolveSelfHostConfig`
  (safe-by-default, blank `token_path` → default).
- **Token source (TR-3):** new `daemon-build-token.ts` in `engine/self-host/` — a small
  reader returning `{ state: 'ok', token }` | `{ state: 'missing' }` | `{ state: 'error',
  detail }`. Empty/whitespace = missing. This is the BuildAuthProvider seam: the conductor
  consumes only this reader, so EKS/platform identity later swaps the reader.
- **Injection (TR-2):** the live sandbox wiring mutates `process.env.CLAUDE_CONFIG_DIR`
  around `stepRunner.run` (conductor.ts:869–877, verified) — `CLAUDE_CODE_OAUTH_TOKEN` is
  set/restored in that same block. `sandbox-build-env.ts` drops the `CREDENTIALS_FILE`
  copy and `refreshSandboxCredentials` entirely; `childEnv()` also carries the token so
  both env paths agree.
- **Pre-flight + park (TR-3/TR-4):** the conductor's dispatch pre-flight
  (`preflightCredentialsCheck`, conductor.ts:610–699) is replaced by a daemon-token
  pre-flight: missing/error → immediate credentials-specific HALT (fail closed — mint
  instructions); it no longer reads operator credentials for build auth. The `authFailure`
  retry branch (conductor.ts:1308–1375) parks on the daemon token path via the existing
  `waitForCredentialsChange` mtime poller (already path-parameterized) with a
  content-non-empty check replacing the `expiresAt` classification; on resume the fresh
  token is re-read and re-injected. `readOperatorCredentialsState` and the operator-file
  park path become unreferenced by build auth (kept only if other callers exist; grep gate).
- **Ordering (ADR Decision 5):** the real-binary smoke (Task 1) is committed and passing
  BEFORE the copy path is deleted (Tasks 8+). Smoke is guarded-skip (no token in env →
  explicit skip) and env-kill-switch guarded like existing `test/engine/*smoke*` tests.
- **Sequencing rationale:** smoke → config → reader → pre-flight (fail-closed is live
  before the copy is removed, so there is never a window where builds silently lack auth)
  → injection + copy deletion → park retarget → rollout docs.

## Prerequisites

- A valid setup-token minted on the self-host host for the smoke gate
  (`claude setup-token`), exported for the smoke run. CI without it: smoke skips by name.
- `src/conductor` deps installed in this worktree (`npm install`); vitest via
  `rtk proxy npx vitest run`.

## Tasks

### Task 1: Real-binary smoke — token auth from a fresh config dir
**Story:** TR-5 (all criteria)
**Type:** infrastructure

**Steps:**
1. Write `test/engine/build-token-auth.smoke.test.ts`: (a) with `CLAUDE_CODE_OAUTH_TOKEN`
   from the host token + fresh empty `CLAUDE_CONFIG_DIR` (mkdtemp), a minimal
   `claude -p 'say ok'` exits 0 with no auth-failure signature; (b) same dir with the
   variable unset fails matching `AUTH_FAILURE_RE`; (c) corrupted token value fails
   matching `AUTH_FAILURE_RE`. Guard: skip-with-reason when no token is available;
   respect the production-spawn env kill-switch (feedback_tests_leak_real_processes).
2. Verify (a)–(c) pass on the self-host host (RED first via a deliberately wrong env name,
   then GREEN).
3. Commit: "test(self-host): real-binary smoke for CLAUDE_CODE_OAUTH_TOKEN headless auth"

**Files likely touched:**
- `src/conductor/test/engine/build-token-auth.smoke.test.ts` — new

**Dependencies:** none. **GATE: Tasks 8–10 must not start until this passes on the host.**

### Task 2: Raw config types for `build_auth`
**Story:** TR-1 (config surface)
**Type:** infrastructure

**Steps:**
1. Write failing type-level/validation test: config accepts
   `harness_self_host.build_auth: { mode, token_path }` shapes.
2. Implement: extend `HarnessSelfHostConfig` in `src/types/config.ts` with optional
   `build_auth?: { mode?: string; token_path?: string }`.
3. Verify GREEN; commit: "feat(config): raw build_auth block on harness_self_host"

**Files likely touched:**
- `src/conductor/src/types/config.ts` — add block
- `src/conductor/test/engine/resolved-config.test.ts` — shapes

**Dependencies:** none

### Task 3: Validation rejects unknown/invalid build_auth modes
**Story:** TR-1 negative paths (unknown mode, empty mode, non-string)
**Type:** negative-path

**Steps:**
1. Write failing tests: `mode: 'operator-oauth'`, `mode: ''`, `mode: 42` each fail config
   validation with a message naming the value and listing `daemon-token | api-key`.
2. Implement validation beside the existing self-host config checks (same loud-at-startup
   path as `auth_park_timeout_minutes` non-numeric handling).
3. Verify GREEN; commit: "feat(config): fail-closed validation for build_auth.mode"

**Files likely touched:**
- `src/conductor/src/engine/config.ts` (validateConfig path) — mode checks
- tests as above

**Dependencies:** Task 2

### Task 4: `resolveSelfHostConfig` resolves build-auth defaults
**Story:** TR-1 happy paths + blank token_path negative
**Type:** happy-path

**Steps:**
1. Write failing tests: absent block → `{ buildAuthMode: 'daemon-token',
   buildAuthTokenPath: ~/.ai-conductor/build-auth }`; explicit api-key → mode only;
   custom token_path honored; blank/whitespace token_path → default (never '').
2. Implement in `resolveSelfHostConfig` (mirror the versionFreeze trim-normalize pattern).
3. Verify GREEN; commit: "feat(config): resolve build_auth with safe defaults"

**Files likely touched:**
- `src/conductor/src/engine/resolved-config.ts` — fields + resolution
- `src/conductor/test/engine/resolved-config.test.ts`

**Dependencies:** Task 2 (Task 3 parallel-safe)

### Task 5: Daemon token reader (BuildAuthProvider seam)
**Story:** TR-3 (classification of token source), TR-2 (token value hygiene)
**Type:** infrastructure

**Steps:**
1. Write failing tests for `readDaemonBuildToken(path)`: non-empty file → `{state:'ok',
   token}` (trimmed); missing file → `{state:'missing'}`; empty/whitespace file →
   `{state:'missing'}`; EACCES (chmod 000) → `{state:'error', detail}` naming the path.
2. Implement `src/engine/self-host/daemon-build-token.ts` (injectable fs seam like
   SandboxFs for the EACCES branch).
3. Verify GREEN; commit: "feat(self-host): daemon build-token reader seam"

**Files likely touched:**
- `src/conductor/src/engine/self-host/daemon-build-token.ts` — new
- `src/conductor/test/engine/daemon-build-token.test.ts` — new

**Dependencies:** none (parallel with 2–4)

### Task 6: Fail-closed pre-flight — missing token HALTs with mint instructions
**Story:** TR-3 happy path + "no operator mention" + "preserve existing HALT marker"
**Type:** happy-path

**Steps:**
1. Write failing tests: daemon-token mode + missing token at dispatch → StepRunResult
   failure; HALT reason contains token path, `claude setup-token`, and
   `harness_self_host.build_auth`; contains NO `.credentials.json` / operator-OAuth
   reference; zero sandbox provisions and zero spawns recorded; existing HALT marker not
   overwritten; retry budget untouched.
2. Implement: new `preflightBuildAuthCheck` in conductor.ts consuming Task 5's reader +
   Task 4's resolved config; replace the `preflightCredentialsCheck` call at
   conductor.ts:848 for build auth. api-key mode: skip token requirement (presence of
   env var is NOT checked here — the signature backstop covers it; fail-open per mode).
3. Verify GREEN; commit: "feat(self-host): fail-closed daemon-token pre-flight"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — new pre-flight + call-site swap
- `src/conductor/test/engine/conductor-selfhost-preflight.test.ts`

**Dependencies:** Tasks 4, 5

### Task 7: Pre-flight EACCES negative path
**Story:** TR-3 negative (unreadable token file)
**Type:** negative-path

**Steps:**
1. Write failing test: reader `{state:'error'}` → HALT naming path + permission problem;
   no spawn, no budget burn.
2. Implement branch in `preflightBuildAuthCheck`.
3. Verify GREEN; commit: "feat(self-host): pre-flight HALTs on unreadable daemon token"

**Files likely touched:** same as Task 6

**Dependencies:** Task 6

### Task 8: Sandbox provisioning stops copying operator credentials
**Story:** TR-2 (no `.credentials.json` in sandbox; TR-6 invariant unchanged)
**Type:** happy-path

**Steps:**
1. Write failing test: provisioned sandbox dir contains no `.credentials.json` even when
   `<globalConfigDir>/.credentials.json` exists; skills/hooks links unchanged.
2. Implement: delete the `CREDENTIALS_FILE` copy block (sandbox-build-env.ts:178–185) and
   the `CREDENTIALS_FILE` constant; update the header comment block (remove the COPIES
   credentials bullet, document env-token auth).
3. Verify GREEN + full sandbox-build-env suite; commit:
   "feat(self-host): sandbox no longer copies operator credentials"

**Files likely touched:**
- `src/conductor/src/engine/self-host/sandbox-build-env.ts`
- `src/conductor/test/engine/sandbox-build-env.test.ts`

**Dependencies:** Task 1 (smoke gate), Task 6 (fail-closed pre-flight live first)

### Task 9: Token injection around the step run (+ childEnv parity)
**Story:** TR-2 (childEnv carries token; parent env not mutated; token never in output)
**Type:** happy-path

**Steps:**
1. Write failing tests: with daemon-token mode, during `stepRunner.run` the env carries
   `CLAUDE_CODE_OAUTH_TOKEN=<token>`; after the run the parent value/absence is restored
   (both prior-set and prior-unset cases); `childEnv()` includes the token when the
   sandbox is constructed with one; captured provisioning/HALT/log output never contains
   the token string.
2. Implement: extend the set/restore block at conductor.ts:869–877 to also set/restore
   `CLAUDE_CODE_OAUTH_TOKEN` (token from the Task 5 reader, read at dispatch); thread an
   optional token into `ThrowawaySandbox.childEnv()`.
3. Verify GREEN; commit: "feat(self-host): inject daemon token into sandbox build env"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — set/restore block
- `src/conductor/src/engine/self-host/sandbox-build-env.ts` — childEnv token
- tests in both suites

**Dependencies:** Tasks 5, 8

### Task 10: Delete `refreshSandboxCredentials` + zero-callers gate
**Story:** TR-2 (retire re-copy; grep gate)
**Type:** refactor

**Steps:**
1. Write failing test asserting the park-resume path re-reads the daemon token (Task 11
   pairing) — placeholder assertion here: module no longer exports
   `refreshSandboxCredentials` (import test fails compile → RED by removal order).
2. Implement: delete `refreshSandboxCredentials` (sandbox-build-env.ts:369–376) and its
   conductor.ts import + call site (1338); `grep -rn refreshSandboxCredentials src/`
   returns nothing.
3. Verify GREEN (typecheck + suite); commit:
   "refactor(self-host): retire refreshSandboxCredentials"

**Files likely touched:**
- `src/conductor/src/engine/self-host/sandbox-build-env.ts`
- `src/conductor/src/engine/conductor.ts`

**Dependencies:** Tasks 1, 8 (Task 11 lands the replacement resume behavior)

### Task 11: Park retarget — authFailure parks on the daemon token source
**Story:** TR-4 happy path (mtime + non-empty resume, budget intact, token re-injected)
**Type:** happy-path

**Steps:**
1. Write failing tests: authFailure in daemon-token mode → `waitForCredentialsChange`
   invoked with the DAEMON token path; on mtime advance + non-empty content, the same
   attempt retries (attempt counter identical) with the NEW token value injected; the
   operator credentials path appears in no call (instrumented).
2. Implement: rewire the authFailure branch (conductor.ts:1308–1375) — credential source
   = resolved token path; freshness classification = non-empty content (replace
   `readOperatorCredentialsState` here); re-read token on resume for Task 9's injection.
3. Verify GREEN; commit: "feat(self-host): auth park watches daemon token source"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — authFailure branch
- `src/conductor/src/engine/self-host/operator-credentials.ts` — accept a
  content-classifier injection for `waitForCredentialsChange` (or a thin wrapper in
  daemon-build-token.ts)
- `src/conductor/test/engine/conductor-auth-park.test.ts`

**Dependencies:** Tasks 5, 9, 10

### Task 12: Park negatives — empty-touch keeps parking; success-text never parks
**Story:** TR-4 negatives (empty touch; "Not logged in" on success)
**Type:** negative-path

**Steps:**
1. Write failing tests: token file touched but empty → park continues to timeout;
   successful (exit 0) run whose output contains "Not logged in" → no park engaged
   (re-assert the adr-2026-07-04 contract against the retargeted branch).
2. Implement content check in the resume classifier if not already covered.
3. Verify GREEN; commit: "test(self-host): park negative paths for token mode"

**Files likely touched:** Task 11's test file; classifier if needed

**Dependencies:** Task 11

### Task 13: Park timeout HALT names the daemon token — never operator OAuth
**Story:** TR-4 (timeout HALT), TR-3 (message hygiene)
**Type:** negative-path

**Steps:**
1. Write failing tests: park timeout → HALT reason contains daemon token path + re-mint
   instructions (`claude setup-token`); asserts absence of `~/.claude/.credentials.json`,
   `expiresAt`, and "retries exhausted"; retry budget shows no consumption.
2. Implement the timeout HALT message in the retargeted branch (mirror the existing
   marker-preservation contract).
3. Verify GREEN; commit: "feat(self-host): daemon-token park timeout HALT"

**Files likely touched:** conductor.ts authFailure branch + its tests

**Dependencies:** Task 11

### Task 14: api-key mode — mode-appropriate auth handling
**Story:** TR-4 negative (api-key remediation), TR-2 (no operator reads in api-key mode)
**Type:** negative-path

**Steps:**
1. Write failing tests: api-key mode auth failure → no poll of the token path; HALT/park
   messaging names `ANTHROPIC_API_KEY`; instrumented fs shows zero operator-credential
   reads; pre-flight in api-key mode does not require the token file.
2. Implement mode branch in pre-flight + authFailure handling.
3. Verify GREEN; commit: "feat(self-host): api-key build-auth mode"

**Files likely touched:** conductor.ts; preflight/park tests

**Dependencies:** Tasks 6, 11

### Task 15: Zero-operator-reads instrumented sweep (happy + failure branches)
**Story:** TR-2 (instrumented-fs proof), TR-4 (concurrent operator rewrites unobserved)
**Type:** negative-path

**Steps:**
1. Write failing test: full dispatch cycle (pre-flight → provision → run → authFailure →
   park-resume) against an instrumented fs/reader records ZERO accesses to
   `<globalConfigDir>/.credentials.json` — including provisioning-failure branches
   (missing skills/) and while `.credentials.json` is being rewritten concurrently.
2. Fix any surviving read path it exposes (expected: none after Tasks 6–14).
3. Verify GREEN; commit: "test(self-host): zero operator-credential reads, all branches"

**Files likely touched:** integration-style test beside conductor self-host suites

**Dependencies:** Tasks 6–14

### Task 16: Grep gates in the integrity suite
**Story:** TR-2 Done-When (zero callers), TR-4 Done-When (no operator path for build auth)
**Type:** infrastructure

**Steps:**
1. Add to the validation path (or a vitest static test): assert
   `refreshSandboxCredentials` and `CREDENTIALS_FILE` do not appear in `src/conductor/src`,
   and no build-auth call site passes the operator credentials path (targeted grep of the
   dispatch/park modules).
2. Verify RED against a planted regression, then GREEN on real code.
3. Commit: "test: static gates for retired credential-copy machinery"

**Files likely touched:**
- `src/conductor/test/engine/no-operator-credential-coupling.test.ts` — new

**Dependencies:** Tasks 10, 11

### Task 17: CHANGELOG entry + Migration block
**Story:** TR-6 (Migration block; HALT/migration consistency; idempotent-safe)
**Type:** infrastructure

**Steps:**
1. Add `## [Unreleased]` → `### Changed` entry; add `## Migration` with a runnable
   ```bash migration``` block: guarded token mint (`[ -f ~/.ai-conductor/build-auth ] ||`
   prompt-and-write via `claude setup-token`, `chmod 600`), pointer to
   `harness_self_host.build_auth` keys. No clobber of an existing token file.
2. Assert (test from Task 6 reuse) the HALT text and the Migration block reference the
   identical command sequence — factor the command string into one constant used by both
   if drift is possible.
3. Commit: "docs(changelog): migration for daemon-owned build credential"

**Files likely touched:**
- `CHANGELOG.md`
- possibly a shared remediation-text constant in daemon-build-token.ts

**Dependencies:** Task 6 (HALT text final)

### Task 18: README + conductor README docs; full validation
**Story:** TR-6 (docs-track-features)
**Type:** infrastructure

**Steps:**
1. Document build-auth modes, default token path, HALT remediation, api-key alternative in
   `README.md` + `src/conductor/README.md`.
2. Run `test/test_harness_integrity.sh` and the full conductor suite
   (`rtk proxy npx vitest run`); fix fallout.
3. Commit: "docs: daemon build-auth modes and onboarding"

**Files likely touched:**
- `README.md`, `src/conductor/README.md`

**Dependencies:** Tasks 1–17

## Task Dependency Graph

```
T1 (smoke) ────────────────┐
T2 → T3                    │ (gate)
T2 → T4 ──┐                ▼
T5 ───────┼─→ T6 → T7      T8 → T9 → T10 → T11 → T12
          │      (T6 also gates T8)      ├─→ T13
          └──────────────────────────────┴─→ T14 → T15 → T16
T6 → T17;  T1–T17 → T18
```
(Acyclic; T8 requires T1 AND T6.)

## Integration Points

- After Task 6: a self-host dispatch with no token HALTs correctly end-to-end (fail-closed
  live while the copy path still exists — safe intermediate state).
- After Task 9: a real self-host build authenticates via the daemon token end-to-end.
- After Task 11: kill-and-re-mint drill — revoke/empty the token mid-build, watch park,
  re-mint, watch resume.
- After Task 18: full-suite + integrity green; migration drill on a scratch consumer.

## Coverage

| Story criterion | Task(s) |
|---|---|
| TR-1 happy (defaults/api-key/custom path) | 2, 4 |
| TR-1 negatives (unknown/empty/non-string mode; blank path) | 3, 4 |
| TR-2 happy (env token; no creds file; no parent-env mutation) | 8, 9 |
| TR-2 negatives (zero reads; token never printed; refresh deleted; fail-closed ordering) | 15, 9, 10, 8 |
| TR-3 happy (missing token HALT + instructions) | 6 |
| TR-3 negatives (empty file; EACCES; no operator mention; marker preserved) | 5, 7, 6, 6 |
| TR-4 happy (park on token; resume budget-intact; timeout HALT naming) | 11, 13 |
| TR-4 negatives (success-text; empty-touch; budget/ladder identity; api-key; operator rewrites unobserved) | 12, 12, 11, 14, 15 |
| TR-5 all (smoke + unset + corrupted + guarded skip) | 1 |
| TR-6 all (Migration; docs; HALT/migration consistency; idempotent) | 17, 18, 17, 17 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (explicit tasks 3, 7, 12–16)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] ADR ordering honored: smoke (T1) gates copy-path deletion (T8/T10)

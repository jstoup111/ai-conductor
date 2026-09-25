# Implementation Plan: Optional bot identity for harness GitHub writes (#158)

**Date:** 2026-09-23
**Stories:** .docs/stories/use-a-dedicated-bot-identity-for-daemon-github-act.md
**Conflict check:** Clean as of 2026-09-23

## Summary

This plan adds an optional, machine-scoped GitHub bot credential. When a bot is configured, every harness remote write (non-read guarded GitHub operations and authorized pushes) runs as the bot. Reads, operator identity, and `@me` intake stay on the operator's credential. An unambiguous bot auth failure falls back once to the operator with a warning event on the spine. The plan has 14 tasks. Operator setup documentation is delivered by the documentation step, not by a plan task.

## Technical Approach

- **Governing decisions:** adr-2026-09-11-github-operation-ownership D9 and adr-2026-07-22-canonical-tracker-client-seam item 3 (both amended 2026-09-23). The authorization actor is unchanged, and the bot is only the credential that performs an already-authorized write.
- **Config (Task 1):** `github_bot: { token_file }` is valid only in `~/.ai-conductor/config.yml`. `validateConfig` rejects it from a project source using the `spec_owner` guard pattern, and it is registered in the config-key consumer registry.
- **Resolver (Task 2):** `src/engine/github-bot-credential.ts` reads only the user config via `readUserConfig`, mirroring `owner-gate/machine-identity.ts`. It returns unconfigured, configured, or token-unavailable. It never throws with the path or contents.
- **Classification (Task 3):** `src/engine/github-bot-auth-refusal.ts` provides the typed `GithubBotAuthRefusalError` and conservative classifiers built from verbatim `gh` and `git` fixtures. Callers branch on the class, never on text (the `GhCapabilityError` precedent).
- **Transports (Tasks 4, 7):** a `credential?: 'operator' | 'write'` hint on `GhRunner` and `RemoteGitCommandRunner` options. Only the production transports (`makeProductionGh`, `makeProductionGit`, and the push path of `makeGitRunner`) act on it, injecting `GH_TOKEN` into that one child's `env`. Pushes also force the `gh auth git-credential` helper through `GIT_CONFIG_*` env entries. `process.env` is never written. Test fakes ignore the hint, which keeps the injected-runner seam.
- **Selection and fallback (Tasks 5, 8):** `createGuardedGithubOperationRunner.run()` maps `request.access` to the hint. `executeRemoteGit` uses the write hint for authorized HTTPS pushes and warns for SSH. On `GithubBotAuthRefusalError` only, it emits `github_write_credential_fallback` first, then re-invokes the transport once with the operator credential inside the same authorized call. A failed emit means no operator attempt.
- **Event (Task 6):** a closed variant on the `ConductorEvent` union, with an `EVENT_SINKS` row mirroring `github_operation_refused`, emitted through the emitter that call already carries.
- **Entry-point proofs (Tasks 9–13):** reads stay operator; CLI and skill-directed writes use the bot; marker edits fall back only as edits; the token stays confined; and unconfigured behavior is unchanged. Task 14 is the real-binary smoke required by D9.7.
- **Verified 2026-09-23:** with gh 2.96.0, `gh auth token` and `gh auth git-credential get` return a child `GH_TOKEN`. `git credential fill` with `GIT_CONFIG_COUNT`, where `GIT_CONFIG_VALUE_0` is empty and `GIT_CONFIG_VALUE_1` is `!gh auth git-credential`, overrides a globally configured `store` helper and returns the child token.

## Prerequisites

- None for BUILD. Operators who opt in provision a machine user with write access and a PAT in a mode-0600 token file.

## Tasks

### Task 1: User-only `github_bot` config block and anti-leak guard
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/config.test.ts`. Validating a user-sourced config with `github_bot: { token_file: '/x' }` succeeds. The same block from a project source fails with an error naming the file and `~/.ai-conductor/config.yml`. A missing or non-string `token_file` fails naming `github_bot.token_file`. Any other key in the block (for example `token`) fails with an error naming the key, and the message must not contain the key's value.
2. Verify RED.
3. Implement. Add `github_bot?: { token_file: string }` to the config type in `src/types/config.ts`, and add `github_bot` to `CONFIG_CONSUMER_KEY_SETS.top` in `src/engine/config.ts`. In `validateConfig`, add a project-source rejection that copies the `spec_owner` guard: it runs pre-merge on the project source, is a hard config error, and names the file and the fix. Also add shape validation for `github_bot`. Pattern: the `spec_owner` guard in `validateConfig` (search `spec_owner must not be set in a project config`). Preserve its traits: the rejection keys on `opts.source === 'project'`, and the merged path only type-checks because a merged value can only have come from user config. Allowed variation: this block carries a file reference, not an identity. Keep the existing `spec_owner` message byte-identical.
4. Declare the production consumer (the bot credential resolver from Task 2) for `github_bot` in `test/engine/config-consumer-registry.ts`.
5. Verify GREEN and commit.

**Done when:**
- `validateConfig` accepts `github_bot: { token_file: <string> }` from a user or merged source and rejects a `github_bot` key from a project source with an error naming the file and `~/.ai-conductor/config.yml`, as asserted in `test/engine/config.test.ts`.
- `validateConfig` rejects a `github_bot` block whose `token_file` is missing or not a string with an error naming `github_bot.token_file`, and rejects any other key in the block with an error naming the key and not containing its value.
- `CONFIG_CONSUMER_KEY_SETS.top` includes `github_bot`, `test/engine/config-consumer-registry.ts` declares its production consumer, and the existing `spec_owner` project-source rejection message is byte-identical.

**Files:** src/conductor/src/types/config.ts; src/conductor/src/engine/config.ts; src/conductor/test/engine/config.test.ts; src/conductor/test/engine/config-consumer-registry.ts

**Dependencies:** none

### Task 2: Machine-scoped bot credential resolver
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/github-bot-credential.test.ts`. `resolveGithubBotCredential(userConfig)` returns `{ kind: 'unconfigured' }` with no block, and `{ kind: 'configured', tokenFile }` with one (`~` expanded). `readGithubBotToken(tokenFile)` returns `{ kind: 'token', token }` (trimmed) for a readable file, and `{ kind: 'unavailable' }` for missing, unreadable, or empty files. The unavailable result carries neither the path nor the contents.
2. Verify RED.
3. Implement `src/engine/github-bot-credential.ts`. Model it on `readMachineOwnerConfig` / `resolveMachineSpecOwner` in `src/engine/owner-gate/machine-identity.ts`: the resolver takes only the user config object read through `readUserConfig`, and has no parameter through which project config could enter. Add `readGithubBotCredential(readUser = readUserConfig)`, which returns the resolved credential and token state for production callers.
4. Verify GREEN and commit.

**Done when:**
- `resolveGithubBotCredential` returns `{ kind: 'unconfigured' }` when the user config has no `github_bot` block and `{ kind: 'configured', tokenFile }` naming the configured path when it does, as asserted in `test/engine/github-bot-credential.test.ts`; the same test asserts that loading merged config for a user config with no `github_bot` block succeeds without error before the resolver reports `unconfigured`.
- `readGithubBotToken` returns the trimmed file contents for a readable token file and an `unavailable` result carrying neither the path nor the contents for a missing, unreadable, or empty file.
- `resolveGithubBotCredential` accepts only the user config read by `readUserConfig` and has no project-config parameter, so neither a project `github_bot` block nor a `tracker.credentials` reference can supply the bot token.

**Files:** src/conductor/src/engine/github-bot-credential.ts; src/conductor/test/engine/github-bot-credential.test.ts

**Dependencies:** 1

### Task 3: Typed bot-auth refusal classification from verbatim fixtures
**Story:** 4
**Type:** negative-path

**Steps:**
1. Capture verbatim fixtures under `test/fixtures/github-bot-auth/`: `gh` output for HTTP 401 `Bad credentials` (for example `GH_TOKEN=invalid gh api user`), an HTTP 403 `Resource not accessible by personal access token`, and a secondary-rate-limit 403. Capture `git push` output for `Authentication failed` and for `Permission to <repo> denied to <user>` (403), plus a non-fast-forward rejection, a stale-lease rejection, and a network error. Record each fixture's provenance in a comment header.
2. Write failing tests in `test/engine/github-bot-auth-refusal.test.ts` over those fixtures, following adr-2026-07-22-auth-failure-classification-observed-401-patterns D1: conservative patterns that require an authentication context, never a bare status number.
3. Verify RED.
4. Implement `src/engine/github-bot-auth-refusal.ts`: `classifyGhAuthRefusal(err)`, `classifyGitPushAuthRefusal(err)`, and `class GithubBotAuthRefusalError` with a closed `reason: 'token-unavailable' | 'auth-refused' | 'unsupported-remote-transport'`. Its message is a fixed string that never includes raw output, the token, or the token path. Callers branch on the class, never on text, following `GhCapabilityError` in `makeProductionGh`.
5. Verify GREEN and commit.

**Done when:**
- `classifyGhAuthRefusal` returns `auth-refused` for the verbatim `gh` fixtures of HTTP 401 `Bad credentials` and HTTP 403 `Resource not accessible by personal access token`, and returns `null` for a verbatim secondary-rate-limit 403 fixture, a timeout, and a not-found error, as asserted in `test/engine/github-bot-auth-refusal.test.ts`.
- `classifyGitPushAuthRefusal` returns `auth-refused` for the verbatim `git push` fixtures of `Authentication failed` and `Permission to <repo> denied to <user>`, and returns `null` for a non-fast-forward rejection, a stale-lease rejection, and a network error.
- `GithubBotAuthRefusalError` carries a closed `reason` of `token-unavailable`, `auth-refused`, or `unsupported-remote-transport`, and its `message` never contains raw command output, the token value, or the token file path.

**Files:** src/conductor/src/engine/github-bot-auth-refusal.ts; src/conductor/test/engine/github-bot-auth-refusal.test.ts; src/conductor/test/fixtures/github-bot-auth/

**Dependencies:** none

### Task 4: Write credential in the production `gh` transport
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/tracker-client.test.ts` with a mocked `execFile` boundary. Assert the production adapter reaches the mock before any other assertion, per the repository's process-isolation rule. Cover: a write hint with a configured bot; operator, absent, and unconfigured hints; an unavailable token; a classified auth failure; and `process.env` before and after.
2. Verify RED.
3. Implement. Extend the `GhRunner` options with `credential?: 'operator' | 'write'`. In `makeProductionGh`, when `credential === 'write'` and `readGithubBotCredential` reports a configured bot, spawn with `env: { ...process.env, GH_TOKEN: token }`. Throw `GithubBotAuthRefusalError('token-unavailable')` before spawning when the token is unavailable. Convert a failure that `classifyGhAuthRefusal` matches into `GithubBotAuthRefusalError('auth-refused')`. In every other case, pass exactly today's options (no `env`). Never assign to `process.env`. Keep `assertRealExecAllowed`, and keep the transport as the single admitted `gh` process call (`productionGhTransportCall`).
4. Verify GREEN and commit.

**Done when:**
- `makeProductionGh` called with `{ credential: 'write' }` and a configured bot spawns `gh` with `env` equal to `process.env` plus `GH_TOKEN` set to the token and every other variable unchanged, as asserted by a mocked `execFile` boundary in `test/engine/tracker-client.test.ts`.
- `makeProductionGh` called with `{ credential: 'operator' }`, with no credential, or with no bot configured passes no `env` option to `execFile`, so the child inherits the ambient environment including any operator `GH_TOKEN`.
- With `{ credential: 'write' }`, an unavailable token throws `GithubBotAuthRefusalError('token-unavailable')` before any spawn, and a bot spawn failure matched by `classifyGhAuthRefusal` throws `GithubBotAuthRefusalError('auth-refused')` whose message contains no token value.
- `process.env.GH_TOKEN` and `process.env.GITHUB_TOKEN` are identical before and after a bot write, `makeProductionGh` still calls `assertRealExecAllowed`, and the GitHub invocation audit reports no new finding.

**Files:** src/conductor/src/engine/tracker-client.ts; src/conductor/test/engine/tracker-client.test.ts

**Dependencies:** 2, 3

### Task 5: Access-class selection and loud one-time fallback in the guarded runner
**Story:** 2
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/github-bot-write-fallback.test.ts` with a recording fake transport and a recording event emitter. Cover: every access class; a transport throwing `GithubBotAuthRefusalError` for each reason; an emitter that throws; a timeout; an ownership-policy refusal; a request with no access class; and a second operation after a fallback.
2. Verify RED.
3. Implement in `createGuardedGithubOperationRunner.run()`. Pass `credential: 'write'` for `feature-write`, `intake-write`, `create`, and `shared-write`, and `credential: 'operator'` for `read`. Refuse a request that has no access class before any transport call. On `GithubBotAuthRefusalError` only, first emit `github_write_credential_fallback` (operation, target, reason) through `options.events`. If the emit throws, rethrow the refusal error without an operator attempt. Otherwise invoke the transport exactly once more with identical args and `credential: 'operator'`, and return that result or failure. The fallback lives inside this single authorized `run()`, so callers such as `upsertComment` see one outcome. The fallback writes no retry-budget or escalation state.
4. Verify GREEN and commit.

**Done when:**
- `createGuardedGithubOperationRunner` invokes its transport with `credential: 'write'` for access classes `feature-write`, `intake-write`, `create`, and `shared-write`, and with `credential: 'operator'` for `read`, as asserted in `test/engine/github-bot-write-fallback.test.ts`.
- On a `GithubBotAuthRefusalError` from the transport, the runner emits one `github_write_credential_fallback` event with the matching reason first and then invokes the transport exactly once more with `credential: 'operator'` and identical args, returning that attempt's result or failure with no third attempt.
- When emitting the fallback event throws, the runner makes no operator attempt and rethrows the `GithubBotAuthRefusalError`; a timeout or any non-`GithubBotAuthRefusalError` failure is returned unchanged with no operator attempt and no event.
- An ownership-policy refusal returns before any transport call and emits no fallback event, a `GithubBotAuthRefusalError` is never reported as `github_operation_refused`, and a request with no access class is refused without a transport call.
- A later operation after a fallback re-runs ownership authorization and invokes the transport with `credential: 'write'` again, and no retry-budget or escalation state is written by the fallback.

**Files:** src/conductor/src/engine/tracker-client.ts; src/conductor/test/engine/github-bot-write-fallback.test.ts

**Dependencies:** 4, 6

### Task 6: `github_write_credential_fallback` event on the spine
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `test/engine/event-sinks.test.ts`: a type-level assertion of the variant's exact field set, the `EVENT_SINKS` row parity with `github_operation_refused`, and a persisted-event assertion using a sentinel token and path.
2. Verify RED.
3. Implement. Add `GithubWriteCredentialFallbackEvent` to `src/types/events.ts` next to `GithubOperationRefusedEvent`, with a closed field set and `reason: 'token-unavailable' | 'auth-refused' | 'unsupported-remote-transport'`, and add it to the `ConductorEvent` union. Add its row to `EVENT_SINKS` in `src/engine/event-sinks.ts`, mirroring `github_operation_refused` (adr-2026-07-26-event-sink-registry-exhaustiveness).
4. Verify GREEN and commit.

**Done when:**
- `GithubWriteCredentialFallbackEvent` with `type: 'github_write_credential_fallback'` is a `ConductorEvent` member whose fields are exactly `operation`, `target`, and `reason` (`token-unavailable`, `auth-refused`, or `unsupported-remote-transport`), as asserted in `test/engine/event-sinks.test.ts`.
- `EVENT_SINKS.github_write_credential_fallback` declares the same `render`, `persist`, `audit`, and `otel` values as `EVENT_SINKS.github_operation_refused`.
- A fallback event persisted through `EventPersister` to `.pipeline/events.jsonl` contains only the operation, target, and reason, with no token value, no token file path, and no raw `gh` or `git` output.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/test/engine/event-sinks.test.ts

**Dependencies:** none

### Task 7: Write credential in the production push runners
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/engine/remote-git-credential.test.ts` with a mocked process boundary for both `execFileP` (in `makeProductionGit`) and `execa` (in `makeGitRunner`). Assert the adapters reach the mocks before any other assertion.
2. Verify RED.
3. Implement. Extend `RemoteGitCommandRunner` options with `credential?: 'operator' | 'write'` and `endpoint?: 'https' | 'ssh'`. With `credential: 'write'`, a configured bot, and `endpoint: 'ssh'`, throw `GithubBotAuthRefusalError('unsupported-remote-transport')` before spawn, because an SSH push cannot carry the token. In `makeProductionGit` (`src/engine/pr-labels.ts`) and the push path of `makeGitRunner` (`src/engine/rebase.ts`), when the hint is `'write'` and a bot is configured, spawn with `env: { ...process.env, GH_TOKEN, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_0: '', GIT_CONFIG_KEY_1: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_1: '!gh auth git-credential' }` and leave argv unchanged. The empty first value resets any operator helper, which was verified against git on 2026-09-23. On an unavailable token, throw `GithubBotAuthRefusalError('token-unavailable')` before spawning. Convert a `classifyGitPushAuthRefusal` match into `GithubBotAuthRefusalError('auth-refused')`. Otherwise keep today's options exactly, including `withEngineCommitEnv()` only for `git commit`. Forward the hint through the inline `runRemoteGit` closure in `src/engine/autoresolve.ts`.
4. Verify GREEN and commit.

**Done when:**
- `makeProductionGit` and the push path of `makeGitRunner` called with `{ credential: 'write' }` and a configured bot spawn `git` with argv unchanged and `env` equal to `process.env` plus `GH_TOKEN` and `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` entries that reset `credential.https://github.com.helper` and then set it to `!gh auth git-credential`, as asserted in `test/engine/remote-git-credential.test.ts`.
- With no credential hint or no bot configured, both runners spawn `git` with exactly the options they pass today: no `env` for `makeProductionGit`, and `env` only for `git commit` in `makeGitRunner`.
- An unavailable token throws `GithubBotAuthRefusalError('token-unavailable')` before spawn, a push failure matched by `classifyGitPushAuthRefusal` throws `GithubBotAuthRefusalError('auth-refused')`, and the inline remote runner in `src/engine/autoresolve.ts` forwards the credential hint unchanged.
- The remote URL in every spawned push argv is the configured remote unchanged and never contains an embedded credential.
- With `{ credential: 'write', endpoint: 'ssh' }` and a configured bot, both runners throw `GithubBotAuthRefusalError('unsupported-remote-transport')` before any spawn.

**Files:** src/conductor/src/engine/remote-git-operations.ts; src/conductor/src/engine/pr-labels.ts; src/conductor/src/engine/rebase.ts; src/conductor/src/engine/autoresolve.ts; src/conductor/test/engine/remote-git-credential.test.ts

**Dependencies:** 2, 3

### Task 8: Push credential selection, SSH detection, and fallback in `executeRemoteGit`
**Story:** 3
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/engine/remote-git-credential-fallback.test.ts` using a fake `runRemoteGit` and a recording emitter. Cover: HTTPS and SSH destinations; a refusal of each reason; an emitter that throws; an ownership-policy refusal; and a non-auth push failure.
2. Verify RED.
3. Implement. Extend the destination returned by `resolveRemoteGitTargets` (`src/engine/remote-git-targets.ts`) with the resolved endpoint scheme (`https` or `ssh`, derived in `repositoryFromRemoteUrl` from the `get-url --push` output). In `executeRemoteGit`, after every ref is authorized, invoke `runRemoteGit` with `credential: 'write'` and the destination's `endpoint`. Do not read bot config here. The production runner (Task 7) is the only reader, so existing tests with fake runners never depend on the operator's user config. On `GithubBotAuthRefusalError`, of any reason including `unsupported-remote-transport`, emit `github_write_credential_fallback` with the error's reason first. If the emit throws, return `failed` without an operator attempt. Otherwise invoke `runRemoteGit` exactly once more with identical args and `credential: 'operator'`. Refusal paths stay unchanged: no spawn and no fallback event.
4. Verify GREEN and commit.

**Done when:**
- `executeRemoteGit` invokes `runRemoteGit` with `credential: 'write'` and the destination's resolved `endpoint` for every authorized push, and reads no bot configuration itself, as asserted in `test/engine/remote-git-credential-fallback.test.ts`.
- When the runner throws `GithubBotAuthRefusalError('unsupported-remote-transport')` for an SSH destination, `executeRemoteGit` emits one `github_write_credential_fallback` event with reason `unsupported-remote-transport` and invokes `runRemoteGit` with `credential: 'operator'`.
- On a `GithubBotAuthRefusalError`, `executeRemoteGit` emits one fallback event with the error's reason first and then invokes `runRemoteGit` exactly once more with `credential: 'operator'` and identical args; if the emit throws, no operator attempt is made and the result is `failed`.
- A destination refused by the ownership policy returns `refused` with no `runRemoteGit` call and no fallback event, and a non-auth push failure returns `failed` with no operator attempt.

**Files:** src/conductor/src/engine/remote-git-operations.ts; src/conductor/src/engine/remote-git-targets.ts; src/conductor/test/engine/remote-git-credential-fallback.test.ts

**Dependencies:** 6, 7

### Task 9: Identity and `@me` intake reads stay on the operator credential
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write tests in `test/engine/github-bot-read-identity.test.ts` with a bot configured through an injected user config and a mocked `execFile` boundary reached by the production `makeProductionGh`. Drive `ghLoginOwner` (`src/engine/owner-gate/identity.ts`) and the GitHub intake adapter's poll (`src/engine/engineer/intake/github-issues.ts`). Set a distinct ambient `GH_TOKEN` in the test environment.
2. Verify RED against a transport that injects the bot token for every call. For example, temporarily force `credential: 'write'` in the fake, then revert.
3. Implement any missing read-path hint so that these entry points pass `credential: 'operator'` or no hint. No production read path may request the write credential.
4. Verify GREEN and commit.

**Done when:**
- With a bot configured, `ghLoginOwner` (`gh api user`) and the GitHub intake poll (`gh issue list --assignee @me`) reach the mocked `execFile` boundary with no `env` option and no bot token, as asserted in `test/engine/github-bot-read-identity.test.ts`.
- With an ambient operator `GH_TOKEN` set and a bot configured, those reads inherit the ambient value unchanged, and `ghLoginOwner` resolves the operator login rather than the bot login.

**Files:** src/conductor/test/engine/github-bot-read-identity.test.ts; src/conductor/src/engine/owner-gate/identity.ts; src/conductor/src/engine/engineer/intake/github-issues.ts

**Dependencies:** 5

### Task 10: Operator-run and skill-directed CLI writes use the bot credential
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/github-bot-cli-entry.test.ts` with a user config (under an isolated `HOME`) declaring `github_bot` and a readable token file, and mocked `execFile` and `execa` boundaries. Drive three entry points: `dispatchGithubOperationCommand` with an `issue.comment.create` request (the `github-operation` CLI that skills run inside provider sessions); the engineer handoff (`src/engine/engineer/handoff.ts`) for its push and `pull-request.create`; and the `intake file` issue creation (`src/intake-file-cli.ts`).
2. Verify RED before Tasks 5 and 8 are wired. Implement any missing production default so that these entry points construct their runners through `makeProductionGh` and `makeProductionGit`.
3. Verify GREEN and commit.

**Done when:**
- With a user config declaring `github_bot` and a mocked `execFile` boundary, `dispatchGithubOperationCommand` performing an `issue.comment.create` request spawns `gh` with the bot `GH_TOKEN`, as asserted in `test/engine/github-bot-cli-entry.test.ts`.
- With the same setup, the engineer handoff's `pull-request.create` and the `intake file` issue creation spawn `gh` with the bot `GH_TOKEN`, and the handoff push spawns `git` with the bot `GH_TOKEN`.
- The bot credential used by these entry points is resolved from the same `readUserConfig` source that `readMachineOwnerConfig` uses for `spec_owner`, asserted by pointing both at one isolated `HOME`.

**Files:** src/conductor/test/engine/github-bot-cli-entry.test.ts; src/conductor/src/engine/github-operations-cli.ts; src/conductor/src/engine/engineer/handoff.ts; src/conductor/src/intake-file-cli.ts

**Dependencies:** 5, 8

### Task 11: Marker-comment edit falls back only as an edit
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write tests in `test/engine/github-bot-marker-edit.test.ts` that drive `upsertComment` (`src/engine/pr-labels.ts`) over a guarded runner. Use a fake transport that rejects the bot `pull-request.comment.update` with a verbatim 403 fixture from Task 3, and a variant that also rejects the operator attempt.
2. Verify RED against a runner without the Task 5 fallback.
3. No production change is expected beyond Task 5. If `upsertComment` sees two outcomes, move the fallback fully inside `run()`.
4. Verify GREEN and commit.

**Done when:**
- Through `upsertComment` over a guarded runner with a bot configured, a bot 403 on the marker comment edit results in exactly one operator attempt of the same `pull-request.comment.update` for the same comment and zero `pull-request.comment.create` calls, as asserted in `test/engine/github-bot-marker-edit.test.ts`.
- When both the bot and operator edit attempts are refused, `upsertComment` logs the failure and resolves without creating a comment.

**Files:** src/conductor/test/engine/github-bot-marker-edit.test.ts

**Dependencies:** 5

### Task 12: Bot token confined to the `gh` and `git` children
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write tests in `test/engine/github-bot-token-confinement.test.ts` with a sentinel token in the token file. Run a bot write and a failing bot write whose fake stderr echoes the sentinel. Then build the provider child environment, the reviewer environment (`filterReviewChildEnvironment` in `src/execution/child-environment.ts`), and a build child environment, and inspect the spawned push argv.
2. Verify RED against a transport that assigns `process.env.GH_TOKEN`, then restore it.
3. Verify GREEN and commit.

**Done when:**
- With a bot configured and a sentinel token in the token file, the provider, reviewer (`filterReviewChildEnvironment`), and build child environments built after a bot write contain no sentinel value, as asserted in `test/engine/github-bot-token-confinement.test.ts`.
- A bot write failure whose `gh` stderr echoes the sentinel produces a thrown error message and emitted events that contain no sentinel value.
- The spawned push argv contains no sentinel and no `user:token@` remote URL form.

**Files:** src/conductor/test/engine/github-bot-token-confinement.test.ts

**Dependencies:** 5, 7

### Task 13: Unconfigured bot leaves every write and push unchanged
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write tests in `test/engine/github-bot-unconfigured.test.ts` with a user config that has no `github_bot` block. Run a guarded `feature-write`, an authorized push, and a write whose `gh` fake fails with the Task 3 verbatim 401 fixture.
2. Verify these pass. Confirm that any assertion this feature's diff changes in the existing suites listed in Done when differs only by the added `credential` runner option.
3. Commit.

**Done when:**
- With no `github_bot` in user config, a guarded `feature-write` and an authorized push reach the mocked process boundary with exactly the options passed before this feature (no `env` for `gh`, no injected `GH_TOKEN` or `GIT_CONFIG_*` for `git`) and emit no `github_write_credential_fallback` event, as asserted in `test/engine/github-bot-unconfigured.test.ts`.
- With no bot configured, a `gh` 401 on a write is returned to the caller unchanged with no operator retry.
- The existing `test/engine/tracker-client.test.ts`, `test/engine/pr-labels.test.ts`, `test/engine/ship-draft-pr.test.ts`, and `test/engine/github-ownership/` suites pass, and every assertion changed in this feature's diff differs only by the added `credential` runner option.

**Files:** src/conductor/test/engine/github-bot-unconfigured.test.ts

**Dependencies:** 5, 8

### Task 14: Real-binary smoke: `gh` and the forced credential helper honor the child token
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write `test/engine/github-bot-credential.smoke.test.ts` (picked up by `vitest.smoke.config.ts`). Use an isolated `HOME` and `GIT_CONFIG_GLOBAL` with `GIT_CONFIG_NOSYSTEM=1`, and a global `credential.helper = store` in that isolated config. Build the child env through the production write-path env builders from Tasks 4 and 7 with a probe token. Run `gh auth token` and `git credential fill` for `https://github.com`. Neither command contacts the network.
2. Skip with a named reason when `gh` or `git` is absent.
3. Verify GREEN and commit.

**Done when:**
- Running the installed `gh auth token` with the env built by the `makeProductionGh` write path prints the probe token rather than any stored credential, as asserted in `test/engine/github-bot-credential.smoke.test.ts`.
- Running the installed `git credential fill` for `https://github.com` with the env built by the push runner write path returns `password=<probe>` even when a different `credential.helper` is configured globally in the isolated `GIT_CONFIG_GLOBAL`.
- The smoke test makes no network request and skips with a named reason when `gh` or `git` is not installed.

**Files:** src/conductor/test/engine/github-bot-credential.smoke.test.ts

**Dependencies:** 4, 7

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- Task 1
Task 3 <- none
Task 4 <- Task 2, Task 3
Task 5 <- Task 4, Task 6
Task 6 <- none
Task 7 <- Task 2, Task 3
Task 8 <- Task 6, Task 7
Task 9 <- Task 5
Task 10 <- Task 5, Task 8
Task 11 <- Task 5
Task 12 <- Task 5, Task 7
Task 13 <- Task 5, Task 8
Task 14 <- Task 4, Task 7
```

## Integration Points

- After Task 5: every guarded GitHub write runs as the bot when configured, and the fallback is observable on the spine.
- After Task 8: authorized pushes run as the bot; SSH destinations warn.
- After Task 10: `github-operation`, `compose handoff`, and `intake file` writes are bot-authored end to end through their entry points.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: **Given** a user config with `github_bot.token_file` naming an existing file, **When** the harness loads merged config, **Then** the load succeeds and the bot credential resolver reports the bot as configured with that file path. | 1, 2 | "`{ kind: 'configured', tokenFile }` naming the configured path when it does" | diff-local |
| Story 1 happy: **Given** a user config with no `github_bot` block, **When** the harness loads merged config, **Then** the load succeeds and the resolver reports no bot configured. | 2 | "returns `{ kind: 'unconfigured' }` when the user config has no `github_bot` block" | diff-local |
| Story 1 negative: **Given** a committed project `.ai-conductor/config.yml` that contains a `github_bot` block, **When** the harness loads that project config, **Then** loading fails with a config error that names the file and says `github_bot` belongs only in `~/.ai-conductor/config.yml`. | 1 | "rejects a `github_bot` key from a project source with an error naming the file and `~/.ai-conductor/config.yml`" | diff-local |
| Story 1 negative: **Given** a user config whose `github_bot` block has no `token_file` or a non-string `token_file`, **When** the harness loads merged config, **Then** loading fails with a config error naming `github_bot.token_file`. | 1 | "with an error naming `github_bot.token_file`" | diff-local |
| Story 1 negative: **Given** a user config whose `github_bot` block carries an inline token value instead of a file reference, **When** the harness loads merged config, **Then** loading fails with a config error that names the unsupported key and does not echo its value. | 1 | "rejects any other key in the block with an error naming the key and not containing its value" | diff-local |
| Story 2 happy: **Given** a bot is configured, **When** a guarded GitHub operation of access class `feature-write`, `intake-write`, `create`, or `shared-write` runs, **Then** its `gh` child process receives `GH_TOKEN` equal to the token file's contents and every other environment variable is inherited unchanged. | 4, 5 | "spawns `gh` with `env` equal to `process.env` plus `GH_TOKEN` set to the token and every other variable unchanged" | diff-local |
| Story 2 happy: **Given** a bot is configured, **When** a guarded `read` operation, operator identity resolution (`gh api user`), or `--assignee @me` intake capture runs, **Then** its `gh` child receives no bot token and uses the operator's ambient credential. | 9 | "reach the mocked `execFile` boundary with no `env` option and no bot token" | diff-local |
| Story 2 happy: **Given** a bot is configured, **When** an operator-run CLI (`compose handoff`, `intake file`) performs a GitHub write, **Then** that write runs with the bot credential exactly as a daemon write does. | 10 | "the engineer handoff's `pull-request.create` and the `intake file` issue creation spawn `gh` with the bot `GH_TOKEN`" | diff-local |
| Story 2 happy: **Given** a bot is configured, **When** the `github-operation` CLI is invoked from inside a provider session and performs a write, **Then** it resolves the bot from the same user config that supplies `spec_owner` and runs the write with the bot credential. | 10 | "is resolved from the same `readUserConfig` source that `readMachineOwnerConfig` uses for `spec_owner`" | diff-local |
| Story 2 negative: **Given** a bot is configured, **When** a write completes, **Then** `process.env.GH_TOKEN` and `process.env.GITHUB_TOKEN` of the harness process are unchanged from before the write. | 4 | "`process.env.GH_TOKEN` and `process.env.GITHUB_TOKEN` are identical before and after a bot write" | diff-local |
| Story 2 negative: **Given** a bot is configured and a write is refused by the ownership policy, **When** the guarded runner returns that refusal, **Then** no `gh` child is spawned with either credential and no fallback warning is emitted. | 5 | "An ownership-policy refusal returns before any transport call and emits no fallback event" | diff-local |
| Story 2 negative: **Given** a bot is configured, **When** the operator's ambient environment already sets `GH_TOKEN`, **Then** reads still use the operator's ambient value and only writes carry the bot token. | 4, 9 | "those reads inherit the ambient value unchanged" | diff-local |
| Story 2 negative: **Given** a guarded GitHub request that carries no operation access class, **When** the guarded runner receives it, **Then** it is refused without spawning `gh` under either credential. | 5 | "a request with no access class is refused without a transport call" | diff-local |
| Story 3 happy: **Given** a bot is configured and an authorized push to an HTTPS github.com remote, **When** the remote Git adapter executes it, **Then** the `git` child receives the bot `GH_TOKEN` plus child-only git config that selects `gh auth git-credential` for github.com, and the push argv is unchanged. | 7, 8 | "spawn `git` with argv unchanged and `env` equal to `process.env` plus `GH_TOKEN`" | diff-local |
| Story 3 happy: **Given** no bot is configured, **When** an authorized push executes, **Then** the `git` child receives no injected token or credential-helper config. | 7 | "With no credential hint or no bot configured, both runners spawn `git` with exactly the options they pass today" | diff-local |
| Story 3 negative: **Given** a bot is configured and the operator's global git config names a different credential helper, **When** an authorized HTTPS push executes, **Then** the push still authenticates through `gh auth git-credential` with the bot token rather than the operator's helper. | 7, 14 | "even when a different `credential.helper` is configured globally in the isolated `GIT_CONFIG_GLOBAL`" | diff-local |
| Story 3 negative: **Given** a bot is configured and the push destination is an SSH remote, **When** the push executes, **Then** it runs with the operator's credential and a fallback warning with reason `unsupported-remote-transport` is emitted. | 7, 8 | "emits one `github_write_credential_fallback` event with reason `unsupported-remote-transport` and invokes `runRemoteGit` with `credential: 'operator'`" | diff-local |
| Story 3 negative: **Given** a bot is configured and the ownership policy refuses a destination ref, **When** the remote Git adapter evaluates the push, **Then** no `git` child is spawned and no fallback warning is emitted. | 8 | "A destination refused by the ownership policy returns `refused` with no `runRemoteGit` call and no fallback event" | diff-local |
| Story 4 happy: **Given** a bot is configured whose token file is missing or unreadable, **When** a write runs, **Then** it runs once with the operator's credential and one fallback warning with reason `token-unavailable` is emitted for that operation and target. | 4, 5 | "an unavailable token throws `GithubBotAuthRefusalError('token-unavailable')` before any spawn" | diff-local |
| Story 4 happy: **Given** a bot is configured and `gh` rejects the write with a verbatim 401, 403 permission, or bad-credentials response, **When** the guarded runner receives that typed auth refusal, **Then** one fallback warning with reason `auth-refused` is emitted first and then the same operation, target, and payload run exactly once more with the operator's credential inside the same authorized invocation. | 5 | "emits one `github_write_credential_fallback` event with the matching reason first and then invokes the transport exactly once more with `credential: 'operator'` and identical args" | diff-local |
| Story 4 happy: **Given** a bot is configured and `git push` fails with a verbatim authentication or permission-denied response, **When** the remote Git adapter receives that typed auth refusal, **Then** the same push runs exactly once more with the operator's credential and one fallback warning with reason `auth-refused` is emitted. | 7, 8 | "emits one fallback event with the error's reason first and then invokes `runRemoteGit` exactly once more with `credential: 'operator'` and identical args" | diff-local |
| Story 4 negative: **Given** a bot is configured and a write fails with a timeout, a network error, or a non-auth `gh` error, **When** the failure is classified, **Then** no operator retry happens, no fallback warning is emitted, and the caller receives the same failure it receives today. | 5, 8 | "a timeout or any non-`GithubBotAuthRefusalError` failure is returned unchanged with no operator attempt and no event" | diff-local |
| Story 4 negative: **Given** a bot is configured and both the bot attempt and the operator retry are refused, **When** the retry fails, **Then** no third attempt is made and the caller receives the operator attempt's failure. | 5 | "returning that attempt's result or failure with no third attempt" | diff-local |
| Story 4 negative: **Given** a bot is configured and a marker-comment edit is refused for the bot with 403, **When** the fallback runs, **Then** it retries the edit of the same comment with the operator's credential and never creates a new comment. | 11 | "results in exactly one operator attempt of the same `pull-request.comment.update` for the same comment and zero `pull-request.comment.create` calls" | diff-local |
| Story 4 negative: **Given** a `gh` 403 whose output is a secondary rate-limit message, **When** it is classified, **Then** it is not treated as an auth refusal. | 3 | "returns `null` for a verbatim secondary-rate-limit 403 fixture" | diff-local |
| Story 4 negative: **Given** a fallback occurs, **When** retry budgets and escalation state are inspected afterwards, **Then** no retry-budget entry was consumed and no escalation was triggered. | 5 | "no retry-budget or escalation state is written by the fallback" | diff-local |
| Story 4 negative: **Given** a bot-auth refusal and the fallback warning fails to emit, **When** the fallback is considered, **Then** no operator retry runs and the caller receives the typed bot-auth failure. | 5, 8 | "When emitting the fallback event throws, the runner makes no operator attempt and rethrows the `GithubBotAuthRefusalError`" | diff-local |
| Story 4 negative: **Given** a bot-auth refusal, **When** the caller inspects the failure, **Then** its type is distinct from an ownership-policy refusal and it is never reported as `github_operation_refused`. | 5 | "a `GithubBotAuthRefusalError` is never reported as `github_operation_refused`" | diff-local |
| Story 4 negative: **Given** an operator fallback ran for one operation, **When** a later operation or a caller-level retry of the same workflow runs, **Then** it re-runs ownership authorization and starts again with the bot credential. | 5 | "A later operation after a fallback re-runs ownership authorization and invokes the transport with `credential: 'write'` again" | diff-local |
| Story 5 happy: **Given** a fallback warning is emitted, **When** it is persisted to `.pipeline/events.jsonl` and rendered, **Then** it contains only the operation, target, and closed reason, with no token value, no token file path, and no raw `gh` or `git` output. | 6 | "contains only the operation, target, and reason, with no token value, no token file path, and no raw `gh` or `git` output" | diff-local |
| Story 5 negative: **Given** a bot is configured, **When** a provider, reviewer, or build child process is spawned, **Then** its environment contains no bot token. | 12 | "the provider, reviewer (`filterReviewChildEnvironment`), and build child environments built after a bot write contain no sentinel value" | diff-local |
| Story 5 negative: **Given** a bot write fails with an error whose output would echo the command environment, **When** the error propagates to logs or the caller, **Then** the error text contains no token value. | 12 | "produces a thrown error message and emitted events that contain no sentinel value" | diff-local |
| Story 5 negative: **Given** a bot is configured, **When** a push runs, **Then** the remote URL passed to `git` contains no embedded credential. | 7, 12 | "The spawned push argv contains no sentinel and no `user:token@` remote URL form" | diff-local |
| Story 6 happy: **Given** no `github_bot` block in user config, **When** any guarded GitHub write or authorized push runs, **Then** the `gh` or `git` child environment is identical to what the harness passes today, and no fallback warning is emitted. | 13 | "emit no `github_write_credential_fallback` event" | diff-local |
| Story 6 negative: **Given** no bot is configured and a write fails with a 401, **When** the failure is classified, **Then** no operator retry happens and the caller sees today's failure unchanged. | 13 | "a `gh` 401 on a write is returned to the caller unchanged with no operator retry" | diff-local |
| Story 6 negative: **Given** no bot is configured, **When** the existing guarded-runner, pr-labels, handoff, and push test suites run, **Then** they pass and the only assertion changes in this feature's diff are the added `credential` option on runner calls. | 13 | "every assertion changed in this feature's diff differs only by the added `credential` runner option" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-11-github-operation-ownership#D1 | task | task-5 | A later operation after a fallback re-runs ownership authorization |
| adr-2026-09-11-github-operation-ownership#D2 | no-change | none | The bot credential is never an authorization input; committed-ownership checks in the shared mutation policy are untouched and still bind the machine-resolved operator (D9.1). |
| adr-2026-09-11-github-operation-ownership#D3 | no-change | none | Pre-spec intake and creation authorization is unchanged; only the credential performing an already-authorized create or intake write changes (D9.1). |
| adr-2026-09-11-github-operation-ownership#D4 | no-change | none | Shared-resource writes still require explicit authorization before the transport runs; the bot credential cannot widen that permission (D9.1). |
| adr-2026-09-11-github-operation-ownership#D5 | task | task-8 | A destination refused by the ownership policy returns `refused` with no `runRemoteGit` call and no fallback event |
| adr-2026-09-11-github-operation-ownership#D6 | task | task-5 | a `GithubBotAuthRefusalError` is never reported as `github_operation_refused` |
| adr-2026-09-11-github-operation-ownership#D7 | task | task-4, task-5 | the GitHub invocation audit reports no new finding |
| adr-2026-09-11-github-operation-ownership#D8 | task | task-11 | zero `pull-request.comment.create` calls |
| adr-2026-09-11-github-operation-ownership#D9 | task | task-5 | invokes its transport with `credential: 'write'` for access classes `feature-write`, `intake-write`, `create`, and `shared-write` |
| adr-2026-07-22-canonical-tracker-client-seam#D1 | task | task-4 | `makeProductionGh` still calls `assertRealExecAllowed` |
| adr-2026-07-22-canonical-tracker-client-seam#D2 | no-change | none | No issue-side call site migration is involved; call sites keep injecting the canonical runner and gain the credential only inside the production transport. |
| adr-2026-07-22-canonical-tracker-client-seam#D3 | task | task-2 | neither a project `github_bot` block nor a `tracker.credentials` reference can supply the bot token |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks naming its mechanism
- [x] Dependencies are explicit and acyclic

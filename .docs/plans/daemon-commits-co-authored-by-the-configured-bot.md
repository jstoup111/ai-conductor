# Implementation Plan: Daemon commits co-authored by the configured bot (#2722)

**Date:** 2026-09-28
**Stories:** .docs/stories/daemon-commits-co-authored-by-the-configured-bot.md
**Conflict check:** Clean as of 2026-09-28

## Summary

When a GitHub bot is configured (`github_bot.token_file`, spec #158), every commit the daemon creates gains a `Co-authored-by:` trailer naming the bot by its GitHub no-reply address, so GitHub shows the operator and the bot as paired authors, and the trailer survives the operator's squash-merge. The operator stays the author. With no bot configured, nothing changes. The plan has 15 tasks. Operator documentation (`docs/reference/configuration.md` `## github_bot`, and the commit-trailer section of `docs/reference/artifacts.md`) is delivered by the documentation step, not by a plan task.

## Technical Approach

- **Governing decision:** adr-2026-09-11-github-operation-ownership D10 (amended 2026-09-28). The bot is credited as a co-author, never as author or actor. Its identity comes from one bot-credential read, the single exception to D9.3.
- **Identity read (Tasks 1, 3, 4).** A new closed ambient operation, `ambient.bot-identity.read`, admits only `gh api user`. `makeProductionGh` gains a `bot` credential value that requires a configured bot and never falls back to the operator. This keeps the read off the D9.5 write fallback, which would otherwise credit the operator's account. The resolver in the new `src/conductor/src/engine/bot-co-author.ts` returns a closed union (`unconfigured`, `resolved`, `unavailable` with a closed reason), so "no bot" and "bot but unresolved" stay distinct. It caches a resolved identity for the process, keyed by token file. It reads only from `prepare()`, which runs during daemon worktree preparation, never from a commit path.
- **Agent commits (Tasks 6, 7, 8, 9).** Daemon worktree preparation writes the trailer value to `.pipeline/co-author`, right after hooks install and before project setup. For any other result, it removes the file. The worktree `prepare-commit-msg` hook stamps the value with `git interpret-trailers --if-exists addIfDifferent`. The daemon installs the resolver once per process (`installDaemonBotCoAuthor` in `runDaemonMode`). Every caller of the default `prepareWorktree` then gets the value, which covers feature dispatch, rebase resolution, and CI fix. Operator CLI processes never install a resolver.
- **Engine commits (Tasks 10–13).** `withDaemonCoAuthorTrailer(message)` appends the trailer from the installed resolver's cached result. It covers the nine daemon bookkeeping commits: shipped record, shipped-record findings, halt record, halt resolution, remediation-plan append, the three setup-triage commits, and shipment repair. A static guard fails on any unwrapped commit invocation except the operator-run spec land commit.
- **Spine (Task 2).** A new closed `bot_co_author_skipped` event, with reasons `token-unavailable`, `identity-read-failed`, and `worktree-write-failed`, is declared in `EVENT_SINKS` like `github_write_credential_fallback`. The per-worktree value is hook input state (event-spine exception C), not a telemetry channel.
- **Focused pattern context.**
  - *Hook stamp:* follow the existing `Task:` stamp in `PREPARE_COMMIT_MSG_HOOK` (`src/conductor/src/engine/git-hook-assets.ts`), but independently of it, since automatic `Task:` injection is retired (adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation).
  - *Engine helper:* follow the single-owner shape of `withEngineCommitEnv` (`src/conductor/src/engine/engine-commit-env.ts`).
  - *Credential transport:* reuse the redacting child-env path in `makeProductionGh`.
  - Search hints: `PREPARE_COMMIT_MSG_HOOK`, `withEngineCommitEnv`, `runTrackerAmbientRead`, `GITHUB_AMBIENT_READ_REGISTRY`, `github_write_credential_fallback`.
- **Scope discipline.** Every task's **Files:** line is the complete set it may touch, tests included. A needed change outside that set is a plan gap to surface, not a silent expansion. The mechanical task-evidence lane stays frozen (adr-2026-07-11-semantic-attribution-verification-lane item 9): the co-author stamp is commit attribution only and never feeds task routing or evidence.

## Prerequisites

- Spec #158's bot credential is on main (PR #2734): `github-bot-credential.ts`, the credential-selecting `makeProductionGh`, and `github_write_credential_fallback`.

## Tasks

### Task 1: Bot-only credential and bot identity read operation in the gh transport
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/bot-identity-read-transport.test.ts` with an injected `gh` child-process seam, following the existing `github-bot-*` transport tests (search `test/engine/github-bot-token-confinement.test.ts` for how the production runner is exercised without real exec).
2. Verify RED.
3. Add `ambient.bot-identity.read` to `GITHUB_AMBIENT_READ_REGISTRY` in `src/conductor/src/engine/github-operations.ts`, admitting only the `api user` command shape. Extend the `makeProductionGh` credential option in `src/conductor/src/engine/tracker-client.ts` with a `bot` value: it requires a configured bot, reads the token with `readGithubBotToken`, sets `GH_TOKEN` only in that child environment, reuses the existing redaction of the token from errors, and throws `GithubBotAuthRefusalError('token-unavailable')` before spawning when no bot is configured or the token is unreadable. It never falls back to the operator credential. Add `runBotIdentityRead(runner, cwd)` next to `runTrackerAmbientRead`, decoding the argv against the registry and calling the runner with `credential: 'bot'`.
4. Verify GREEN and commit.

**Done when:**
- `GITHUB_AMBIENT_READ_REGISTRY` names an `ambient.bot-identity.read` operation admitting only the `api user` command shape, and `decodeGithubAmbientRead` refuses any other argv under that name, as asserted in `test/engine/bot-identity-read-transport.test.ts`.
- `makeProductionGh` called with `credential: 'bot'` and a configured, readable bot token spawns `gh` with `GH_TOKEN` set to that token only in the child environment, and `process.env.GH_TOKEN` is unchanged after the call.
- `makeProductionGh` called with `credential: 'bot'` when no bot is configured or the token file is unreadable throws `GithubBotAuthRefusalError` with reason `token-unavailable` without spawning `gh`, so the bot identity read never runs on the operator credential.
- While a bot is configured, `makeProductionGh` running `ambient.identity.read` with `credential: 'operator'` spawns `gh` with no bot `GH_TOKEN`, and `ghLoginOwner` returns the operator login from that read, because the bot identity read is a separate operation that shares no cache with it. After `runBotIdentityRead` has resolved the bot login `conductor-bot` in the same process, the same test drives ownership resolution through `ghLoginOwner` and `--assignee @me` intake capture through `listAssignedIssues`, and asserts each performs its own `gh` read with `credential: 'operator'` and no bot `GH_TOKEN`, `ghLoginOwner` still returns the operator login and never `conductor-bot`, and the `issue list --assignee @me` argv reaches `gh` unchanged.
- While a bot is configured, the guarded GitHub runner still sends every non-`read` access class with `credential: 'write'` and every `read` with `credential: 'operator'`, and a `GithubBotAuthRefusalError` on a write still reruns that same invocation once with `credential: 'operator'` and emits exactly one `github_write_credential_fallback` event, as asserted in `test/engine/bot-identity-read-transport.test.ts`, and the existing `test/engine/github-bot-write-fallback.test.ts`, `test/engine/tracker-client-bot-fallback.test.ts`, `test/engine/remote-git-credential.test.ts`, and `test/engine/remote-git-credential-fallback.test.ts` pass unchanged, so adding the `bot` credential value leaves write-credential selection for every authorized GitHub and remote-ref write, its typed auth-refusal fallback, and its warning event intact.
- This feature's D9 scope is only the new bot-only `credential: 'bot'` value used by the bot identity read; the rest of D9 (machine-scoped `github_bot` config validation, write-credential selection for every authorized GitHub and remote-ref write, the explicit `gh auth git-credential` push helper, and the typed bot-auth fallback with its warning event) was delivered by #158 and is not changed here, so the existing `github_bot machine credential config` suite in `test/engine/config.test.ts` (including rejection of `github_bot` from a project config), `test/engine/github-bot-credential.test.ts`, `test/engine/github-bot-unconfigured.test.ts`, `test/engine/remote-git-credential.test.ts` (including the child-only `credential.https://github.com.helper` reset to `!gh auth git-credential`), `test/engine/github-bot-write-fallback.test.ts`, and `test/engine/remote-git-credential-fallback.test.ts` pass unchanged.

**Files:** src/conductor/src/engine/github-operations.ts; src/conductor/src/engine/tracker-client.ts; src/conductor/test/engine/bot-identity-read-transport.test.ts

**Dependencies:** none

### Task 2: `bot_co_author_skipped` event on the spine
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/bot-co-author-event.test.ts`.
2. Verify RED.
3. Add the `BotCoAuthorSkippedEvent` variant to the `ConductorEvent` union in `src/conductor/src/types/events.ts` with only `type` and a closed `reason`. Declare it in `EVENT_SINKS` (`src/conductor/src/engine/event-sinks.ts`) exactly as `github_write_credential_fallback` is declared. Add `formatBotCoAuthorSkipped` to a new `src/conductor/src/engine/bot-co-author.ts`, and route the variant through it in `src/conductor/src/ui/terminal-renderer.ts` and the daemon log renderer in `src/conductor/src/daemon-cli.ts`, next to the existing `github_write_credential_fallback` cases.
4. Verify GREEN and commit.

**Done when:**
- The `ConductorEvent` union has a `bot_co_author_skipped` variant whose only field besides `type` is `reason`, typed as the closed set `token-unavailable`, `identity-read-failed`, `worktree-write-failed`.
- `EVENT_SINKS` declares `bot_co_author_skipped` with the same render, persist, audit, and otel flags as `github_write_credential_fallback`, as asserted in `test/engine/bot-co-author-event.test.ts`.
- `formatBotCoAuthorSkipped` renders each of the three reasons to a fixed sentence containing no path, and both the terminal renderer and the daemon log renderer route the variant through it.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/bot-co-author.ts; src/conductor/src/ui/terminal-renderer.ts; src/conductor/src/daemon-cli.ts; src/conductor/test/engine/bot-co-author-event.test.ts

**Dependencies:** none

### Task 3: Resolve the bot co-author identity from the bot token
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/bot-co-author.test.ts` with a fake runner and a fake bot credential reader.
2. Verify RED.
3. In `src/conductor/src/engine/bot-co-author.ts`, add `createBotCoAuthorResolver({ runner, events, readCredential })`. Its result is a closed union: `unconfigured`, `resolved` (login, id, trailer), or `unavailable` with a closed reason. `prepare(events?)` returns the cached resolved identity when one exists for the same token file; otherwise it reads the bot identity once through `runBotIdentityRead`. `current()` returns the last `prepare()` result and never reads. The trailer is `Co-authored-by: <login> <<id>+<login>@users.noreply.github.com>`.
4. Verify GREEN and commit.

**Done when:**
- `createBotCoAuthorResolver(...).prepare()` for a configured bot whose fake identity read returns login `conductor-bot` and id `4242` resolves to `{ kind: 'resolved' }` with trailer `Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>`, as asserted in `test/engine/bot-co-author.test.ts`.
- The same test asserts the identity read ran exactly once, as `ambient.bot-identity.read` with `credential: 'bot'` and never with `credential: 'operator'`.
- A second `prepare()` in the same process for the same token file returns the cached resolved identity and the fake runner records no second identity read.
- `current()` returns the last `prepare()` resolution and never invokes the identity read.

**Files:** src/conductor/src/engine/bot-co-author.ts; src/conductor/test/engine/bot-co-author.test.ts

**Dependencies:** 1, 2

### Task 4: Resolver refusals never produce a trailer or fall back to the operator
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add failing refusal cases to `src/conductor/test/engine/bot-co-author.test.ts`.
2. Verify RED.
3. In `src/conductor/src/engine/bot-co-author.ts`, map a missing or unreadable token to `unavailable`/`token-unavailable` before any read; map every identity-read failure (401, 403, timeout, transport error) and every malformed response (no login, a non-numeric id, or a login that is not 1 to 39 letters, digits, or single interior hyphens) to `unavailable`/`identity-read-failed`. Emit one `bot_co_author_skipped` event per failed `prepare()` on the emitter passed to it, falling back to the emitter the resolver was built with. Never retry on the operator credential. Treat a blank `token_file` as unconfigured.
4. Verify GREEN and commit.

**Done when:**
- For a configured bot whose token file is missing or unreadable, `prepare()` returns `{ kind: 'unavailable', reason: 'token-unavailable' }`, the fake runner records no identity read, and exactly one `bot_co_author_skipped` event with reason `token-unavailable` is emitted on the emitter passed to `prepare()`.
- For identity reads that fail with a 401, a 403, a timeout, or a transport error, `prepare()` returns `unavailable` with reason `identity-read-failed`, emits exactly one skip event, and the fake runner records no call with `credential: 'operator'`.
- For identity responses with no login, a non-numeric id, or a login that is not 1 to 39 letters, digits, or single interior hyphens, `prepare()` returns `unavailable` with reason `identity-read-failed` and `current()` yields no trailer.
- After a failed `prepare()`, calls to `current()` and to `withDaemonCoAuthorTrailer` perform no identity read and emit no further skip event, and only the next `prepare()` reads again.
- With no bot configured, `prepare()` returns `{ kind: 'unconfigured' }`, performs no identity read, and emits no event.

**Files:** src/conductor/src/engine/bot-co-author.ts; src/conductor/test/engine/bot-co-author.test.ts

**Dependencies:** 3

### Task 5: Bot token confined to the identity read child
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/bot-co-author-token-confinement.test.ts` that seed a distinctive token value, following `test/engine/github-bot-token-confinement.test.ts`.
2. Verify RED.
3. Close any leak found in `src/conductor/src/engine/bot-co-author.ts` or the `bot` credential path of `src/conductor/src/engine/tracker-client.ts`: the resolver surfaces only closed reasons, never the child error message, and logs no error text.
4. Verify GREEN and commit.

**Done when:**
- `test/engine/bot-co-author-token-confinement.test.ts` resolves a bot identity with a distinctive token and asserts that the bot-derived text in the resolved trailer, in the `.pipeline/co-author` value that `prepareWorktree` writes, in a message produced by `withDaemonCoAuthorTrailer`, and in a hook-stamped commit message is exactly the bot login and its no-reply address, and that none of them contains the token.
- The same test drives an identity read whose `gh` failure output echoes the token and asserts the token and the token-file path are absent from the skip event, from the line `EventPersister` writes to `.pipeline/events.jsonl`, from every line passed to the daemon log function, and from any error the resolver surfaces.
- For an unreadable token file the emitted event is exactly `{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }` with no other field.
- The test asserts that during the identity read `GH_TOKEN` is set only in the spawned `gh` child environment, never in `process.env` that provider and build children inherit.

**Files:** src/conductor/src/engine/bot-co-author.ts; src/conductor/src/engine/tracker-client.ts; src/conductor/test/engine/bot-co-author-token-confinement.test.ts

**Dependencies:** 3, 6, 8

### Task 6: Worktree hook stamps the bot trailer from the per-worktree co-author value
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/integration/git-hooks-co-author.test.ts` using a real temporary git repository with the hook assets installed, following `test/integration/git-hooks-attribution.test.ts`.
2. Verify RED.
3. In `PREPARE_COMMIT_MSG_HOOK` (`src/conductor/src/engine/git-hook-assets.ts`), add a co-author block after the amend and rebase abstains and before the no-staged-changes abstain: when `$WORKTREE_ROOT/.pipeline/co-author` is non-empty, run `git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Co-authored-by: $VALUE"` on the message file. Keep the pattern traits: pure bash, no engine dist call, the value treated as one quoted literal argument and never evaluated, no-op when the file is absent, and the chain to the common hook unchanged. The block is independent of the `Task:` stamp.
4. Verify GREEN and commit.

**Done when:**
- `PREPARE_COMMIT_MSG_HOOK` reads `.pipeline/co-author` and, when it is non-empty, runs `git interpret-trailers --in-place --if-exists addIfDifferent` with `Co-authored-by: <value>` as one quoted argument, placed after the amend and rebase abstains and before the no-staged-changes abstain.
- In `test/integration/git-hooks-co-author.test.ts`, a real repository with the hook installed and a co-author value records a plain-message commit whose `git interpret-trailers --parse` output contains the bot trailer and still contains a `Task:` trailer the message supplied.
- The same test records the bot trailer on a commit made with no `.pipeline/current-task` file and on a `git commit --allow-empty` commit.
- The same test asserts the recorded author and committer name and email equal the repository `user.name` and `user.email`.

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/integration/git-hooks-co-author.test.ts

**Dependencies:** none

### Task 7: Hook stamping is idempotent and never restamps
**Story:** 2
**Type:** negative-path

**Steps:**
1. Add failing cases to `src/conductor/test/integration/git-hooks-co-author.test.ts`.
2. Verify RED.
3. Adjust the co-author block in `src/conductor/src/engine/git-hook-assets.ts` only as the cases require.
4. Verify GREEN and commit.

**Done when:**
- A message that already contains the bot trailer records exactly one bot trailer line.
- A message whose trailer block names another `Co-authored-by` keeps that line unchanged and gains exactly one bot trailer.
- Amending an existing commit that lacks the bot trailer, and replaying it with `git rebase`, leaves each resulting message with exactly the trailers it had before.
- With no `.pipeline/co-author` file and no current task, the recorded message is byte-identical to the message passed to `git commit`.

**Files:** src/conductor/src/engine/git-hook-assets.ts; src/conductor/test/integration/git-hooks-co-author.test.ts

**Dependencies:** 6

### Task 8: Worktree preparation writes or removes the co-author value before setup
**Story:** 2
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/worktree-prepare-co-author.test.ts` with a fake installed resolver and a temporary git worktree.
2. Verify RED.
3. In `src/conductor/src/engine/bot-co-author.ts` add the process registry (`installDaemonBotCoAuthor`, `daemonBotCoAuthor`) and `refreshWorktreeCoAuthor(worktreePath, events)`. In `src/conductor/src/engine/worktree-prepare.ts`, call it right after `writeGitHooksAndWire` and before the setup decision. It writes the resolved trailer value to `.pipeline/co-author`, removes the file for any other result or when no resolver is installed, and never throws: a write failure emits one `bot_co_author_skipped` event with reason `worktree-write-failed` and removes the file. Pass `opts.events` through; with none, the resolver's own emitter is used.
4. Verify GREEN and commit.

**Done when:**
- `prepareWorktree` calls the installed resolver's `prepare()` after `writeGitHooksAndWire` and before the project setup decision and writes the resolved value to `.pipeline/co-author`, and with a `bin/setup` that fails a commit then made in that worktree, as the setup-triage fix session does, records the bot trailer, as asserted in `test/engine/worktree-prepare-co-author.test.ts`.
- When the resolution is `unconfigured` or `unavailable`, or no daemon resolver is installed, `prepareWorktree` removes an existing `.pipeline/co-author` file, and a worktree prepared with a resolved bot and then re-prepared after the bot is removed from user config records no bot trailer on its next commit.
- When writing `.pipeline/co-author` throws, `prepareWorktree` continues to the setup decision, emits one `bot_co_author_skipped` event with reason `worktree-write-failed`, leaves no co-author file, and a commit made there afterwards records no bot trailer.
- `prepareWorktree` passes its `events` emitter to `prepare()`, so a skip event from dispatch preparation lands on that feature's emitter.
- When `writeGitHooksAndWire` throws, `prepareWorktree` rejects with the `preventive git hook installation failed` error and `.pipeline/co-author` is not created.

**Files:** src/conductor/src/engine/worktree-prepare.ts; src/conductor/src/engine/bot-co-author.ts; src/conductor/test/engine/worktree-prepare-co-author.test.ts

**Dependencies:** 3, 6

### Task 9: Daemon composition installs the resolver for every daemon worktree
**Story:** 2
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-bot-co-author-wiring.test.ts`.
2. Verify RED.
3. In `runDaemonMode` (`src/conductor/src/daemon-cli.ts`), build one resolver on `makeProductionGh()` and the daemon event emitter and install it with `installDaemonBotCoAuthor` before the first dispatch. Rebase-resolution and CI-fix worktrees need no extra wiring: `withResolveWorktree` uses the default `prepareWorktree`, which consults the installed resolver.
4. Verify GREEN and commit.

**Done when:**
- `runDaemonMode` calls `installDaemonBotCoAuthor` once with a resolver built on `makeProductionGh()` and the daemon event emitter, as asserted by `test/engine/daemon-bot-co-author-wiring.test.ts`.
- With a fake resolved resolver installed, `withResolveWorktree` using its default `prepareWorktree` writes `.pipeline/co-author` into the rebase-resolution worktree and `runCiFix` with its default preparation writes it into the CI-fix worktree, and a commit then made in each of those worktrees records the bot trailer.
- A static scan of `src/conductor/src` finds `installDaemonBotCoAuthor` called only from `src/conductor/src/daemon-cli.ts`, so no operator-run CLI entry point supplies a co-author identity.

**Files:** src/conductor/src/daemon-cli.ts; src/conductor/src/engine/bot-co-author.ts; src/conductor/test/engine/daemon-bot-co-author-wiring.test.ts

**Dependencies:** 8

### Task 10: Engine commit trailer helper
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/bot-co-author-trailer-helper.test.ts`.
2. Verify RED.
3. Add `withDaemonCoAuthorTrailer(message)` to `src/conductor/src/engine/bot-co-author.ts`, following the single-owner idea of `withEngineCommitEnv` in `src/conductor/src/engine/engine-commit-env.ts`: one module decides what every engine commit carries. It reads only the installed resolver's `current()` and never triggers an identity read.
4. Verify GREEN and commit.

**Done when:**
- `withDaemonCoAuthorTrailer(message)` returns `message` followed by a blank line and the bot trailer when the installed resolver's `current()` is resolved, as asserted in `test/engine/bot-co-author-trailer-helper.test.ts`.
- It returns `message` unchanged when the message already contains the bot trailer line.
- It returns `message` byte-identical when no resolver is installed, when `current()` is unconfigured or unavailable, and when the installed resolver has never run `prepare()`, and in each case the fake identity read records no call.

**Files:** src/conductor/src/engine/bot-co-author.ts; src/conductor/test/engine/bot-co-author-trailer-helper.test.ts

**Dependencies:** 3

### Task 11: Stamp shipped-record, findings, and halt-record commits
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-commit-co-author.test.ts` that drive each commit through its exported function with an injected git runner or a temporary repository.
2. Verify RED.
3. Wrap the commit message with `withDaemonCoAuthorTrailer` in `src/conductor/src/engine/shipped-record-cli.ts`, `src/conductor/src/engine/finish-publication-production.ts`, and `src/conductor/src/engine/halt-record.ts`, changing nothing else in each argument vector.
4. Verify GREEN and commit.

**Done when:**
- The `shipped record: <slug>`, `shipped record findings: <slug>`, `halt record: <slug>`, and `halt record resolved: <slug>` commits each pass their message through `withDaemonCoAuthorTrailer`, and `test/engine/daemon-commit-co-author.test.ts` records each with the bot trailer when a resolved identity is installed.
- With an installed resolver whose `current()` is unavailable, each of those commits succeeds and its git argument vector is byte-identical to the vector built before this change.
- With an installed resolver that has never run `prepare()`, the `halt record: <slug>` commit succeeds without the bot trailer and the fake identity read records no call.

**Files:** src/conductor/src/engine/shipped-record-cli.ts; src/conductor/src/engine/finish-publication-production.ts; src/conductor/src/engine/halt-record.ts; src/conductor/test/engine/daemon-commit-co-author.test.ts

**Dependencies:** 10

### Task 12: Stamp remediation, setup-triage, and shipment-repair commits
**Story:** 3
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/daemon-commit-co-author.test.ts`.
2. Verify RED.
3. Extract the remediation-plan append commit in `src/conductor/src/engine/conductor.ts` into an exported `recordAppendedRemediationCommit(projectRoot, planPath)` with the same pathspec-scoped behavior, and wrap its message with `withDaemonCoAuthorTrailer`; wrap the three commits in `src/conductor/src/engine/setup-triage.ts`, and the shipment-repair commit in `src/conductor/src/engine/shipment-evidence-cli.ts`, changing nothing else in each argument vector.
4. Verify GREEN and commit.

**Done when:**
- The `chore(plan): record appended remediation tasks`, `Quarantine before reset`, `wip(setup): preserve rejected repair`, `fix(setup): retain verified repair`, and `docs: repair shipped record for <branch>` commits each pass their message through `withDaemonCoAuthorTrailer`, and with a resolved identity installed the test records the bot trailer on each of the `Quarantine before reset`, `wip(setup): preserve rejected repair`, `fix(setup): retain verified repair`, and `docs: repair shipped record for <branch>` commits.
- Driven through the exported `recordAppendedRemediationCommit` against a temporary repository with a resolved identity installed, the `chore(plan): record appended remediation tasks` commit records the bot trailer and still commits only the plan path.
- The shipment-repair commit, made in its temporary worktree with no daemon hooks, records the bot trailer exactly once.
- An engine bookkeeping commit made in a repository with the co-author `prepare-commit-msg` hook installed and the same co-author value records the bot trailer exactly once.
- With an installed resolver whose `current()` is unavailable, each of those commits succeeds and its git argument vector is byte-identical to the vector built before this change.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/setup-triage.ts; src/conductor/src/engine/shipment-evidence-cli.ts; src/conductor/test/engine/daemon-commit-co-author.test.ts

**Dependencies:** 6, 10

### Task 13: Guard: every daemon commit invocation goes through the helper
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write `src/conductor/test/engine/daemon-commit-co-author-guard.test.ts`.
2. Verify it fails against a fixture with an unwrapped commit (RED), then passes against the source tree (GREEN).
3. Commit.

**Done when:**
- `test/engine/daemon-commit-co-author-guard.test.ts` scans every non-test source under `src/conductor/src` for a git `commit` invocation carrying `-m` or `-F` and for any `commit-tree` invocation, and fails naming the file and line of any whose message is not produced by `withDaemonCoAuthorTrailer`.
- The scan's only allowlisted commit invocation is the operator-run spec land commit in `src/conductor/src/engine/engineer/land-spec.ts`, and the test asserts that invocation does not call `withDaemonCoAuthorTrailer`.
- The test includes a fixture source containing an unwrapped commit invocation and asserts the scan reports it.

**Files:** src/conductor/test/engine/daemon-commit-co-author-guard.test.ts

**Dependencies:** 11, 12

### Task 14: Operator-run paths stay unstamped
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write `src/conductor/test/engine/operator-commit-co-author.test.ts`.
2. Verify RED where behavior is missing, then GREEN; production changes are confined to the files already listed.
3. Commit.

**Done when:**
- With a resolved bot identity available but no resolver installed in the process, which is the state of every operator-run CLI process, the spec land commit, the `shipped record: <slug>` commit written through `dispatchShippedRecord`, and the shipment-repair commit reached through the daemon park command each record a message without the bot trailer, as asserted in `test/engine/operator-commit-co-author.test.ts`.
- The same shipment-repair commit records the bot trailer when the running daemon's installed resolver has a resolved identity.
- After `prepareWorktree` has wired hooks and written `.pipeline/co-author` in a daemon worktree of the same repository, a commit made by hand in the repository root, and in a worktree created with `git worktree add`, records exactly the message given, and the root checkout's `core.hooksPath` remains unset while its resolved hooks directory contains none of the daemon `pre-commit`, `prepare-commit-msg`, or `commit-msg` hooks, so no daemon hook runs for that commit.

**Files:** src/conductor/test/engine/operator-commit-co-author.test.ts

**Dependencies:** 9, 11, 12

### Task 15: No bot configured leaves daemon commits byte-identical
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write `src/conductor/test/engine/bot-co-author-unconfigured.test.ts`.
2. Verify RED where behavior is missing, then GREEN.
3. Commit.

**Done when:**
- With no `github_bot` configured, `prepareWorktree` leaves no `.pipeline/co-author` file and a commit made there with the co-author hook records a message byte-identical to the message passed to `git commit`, as asserted in `test/engine/bot-co-author-unconfigured.test.ts`.
- With no bot configured, each of the nine engine bookkeeping commit invocations builds a git argument vector byte-identical to the vector built before this change.
- With `github_bot.token_file` set to a blank string, `prepare()` returns `unconfigured`, performs no identity read, emits no `bot_co_author_skipped` event, and later commits carry no bot trailer.
- With no bot configured, a dispatch preparation through `makeFeatureRunnerDeps(...).prepareWorktree`, a build commit in that worktree, an engine bookkeeping commit through `withDaemonCoAuthorTrailer`, and a rebase-resolution preparation together emit no `bot_co_author_skipped` event.

**Files:** src/conductor/test/engine/bot-co-author-unconfigured.test.ts

**Dependencies:** 8, 11, 12

## Task Dependency Graph

```
Task 1 <- none
Task 2 <- none
Task 3 <- Task 1, Task 2
Task 4 <- Task 3
Task 5 <- Task 3, Task 6, Task 8
Task 6 <- none
Task 7 <- Task 6
Task 8 <- Task 3, Task 6
Task 9 <- Task 8
Task 10 <- Task 3
Task 11 <- Task 10
Task 12 <- Task 6, Task 10
Task 13 <- Task 11, Task 12
Task 14 <- Task 9, Task 11, Task 12
Task 15 <- Task 8, Task 11, Task 12
```

## Integration Points

- After Task 8: a daemon-prepared worktree carries `.pipeline/co-author`, and the hook from Task 6 stamps agent commits there.
- After Task 9: the running daemon installs the resolver, so feature, rebase-resolution, and CI-fix worktrees are all stamped.
- After Task 12: every daemon bookkeeping commit carries the trailer, and Task 13 keeps it that way.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: **Given** a bot configured whose token belongs to GitHub account `conductor-bot` with user id `4242`, **When** the co-author identity is resolved, **Then** it resolves to the bot trailer `Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>` using one identity read performed with the bot credential, not the operator's. | 3 | "`createBotCoAuthorResolver(...).prepare()` for a configured bot whose fake identity read returns login `conductor-bot` and id `4242` resolves to `{ kind: 'resolved' }` with trailer `Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>`, as asserted in `test/engine/bot-co-author.test.ts`" | diff-local |
| Story 1 happy: **Given** the identity was already resolved once in the current daemon process for the same token file, **When** the co-author identity is requested again, **Then** the cached identity is returned and no second identity read is performed. | 3 | "A second `prepare()` in the same process for the same token file returns the cached resolved identity and the fake runner records no second identity read" | diff-local |
| Story 1 negative: **Given** a bot configured whose token file is missing or unreadable, **When** the co-author identity is resolved, **Then** no identity read is attempted, the result is unavailable with reason `token-unavailable`, and exactly one skip warning is emitted. | 4, 8 | "For a configured bot whose token file is missing or unreadable, `prepare()` returns `{ kind: 'unavailable', reason: 'token-unavailable' }`, the fake runner records no identity read, and exactly one `bot_co_author_skipped` event with reason `token-unavailable` is emitted on the emitter passed to `prepare()`" | diff-local |
| Story 1 negative: **Given** a bot configured whose identity read fails (401, 403, a timeout, or a transport error), **When** the co-author identity is resolved, **Then** the result is unavailable with reason `identity-read-failed`, exactly one skip warning is emitted, and the read is not retried with the operator's credential. | 4 | "For identity reads that fail with a 401, a 403, a timeout, or a transport error, `prepare()` returns `unavailable` with reason `identity-read-failed`, emits exactly one skip event, and the fake runner records no call with `credential: 'operator'`" | diff-local |
| Story 1 negative: **Given** a bot configured whose identity read returns a response with no login or a non-numeric id, **When** the co-author identity is resolved, **Then** the result is unavailable with reason `identity-read-failed` and no bot trailer is produced from partial data. | 4 | "For identity responses with no login, a non-numeric id, or a login that is not 1 to 39 letters, digits, or single interior hyphens, `prepare()` returns `unavailable` with reason `identity-read-failed` and `current()` yields no trailer" | diff-local |
| Story 1 negative: **Given** a bot configured whose identity read returns a login containing characters outside GitHub's login character set (letters, digits, and single hyphens), **When** the co-author identity is resolved, **Then** the result is unavailable with reason `identity-read-failed` and no bot trailer is produced. | 4 | "For identity responses with no login, a non-numeric id, or a login that is not 1 to 39 letters, digits, or single interior hyphens, `prepare()` returns `unavailable` with reason `identity-read-failed` and `current()` yields no trailer" | diff-local |
| Story 1 negative: **Given** a bot configured whose identity resolution failed during the current dispatch, **When** further commits in that dispatch request the co-author identity, **Then** no further identity read is attempted and no further skip warning is emitted until the next dispatch preparation. | 4 | "After a failed `prepare()`, calls to `current()` and to `withDaemonCoAuthorTrailer` perform no identity read and emit no further skip event, and only the next `prepare()` reads again" | diff-local |
| Story 1 negative: **Given** a bot configured with a resolved co-author identity, **When** the operator's own identity is resolved for ownership or `--assignee @me` intake capture, **Then** that read still receives no bot token and still returns the operator's login, because the bot identity read is a separate operation with a separate cache. | 1 | "While a bot is configured, `makeProductionGh` running `ambient.identity.read` with `credential: 'operator'` spawns `gh` with no bot `GH_TOKEN`, and `ghLoginOwner` returns the operator login from that read, because the bot identity read is a separate operation that shares no cache with it" | diff-local |
| Story 1 negative: **Given** no bot configured, **When** the co-author identity is resolved, **Then** the result is unconfigured, no identity read is attempted, and no skip warning is emitted. | 4 | "With no bot configured, `prepare()` returns `{ kind: 'unconfigured' }`, performs no identity read, and emits no event" | diff-local |
| Story 2 happy: **Given** a bot configured with a resolved identity, **When** daemon dispatch prepares a feature worktree with its hooks wired and the build agent commits a staged change there with a plain message, **Then** the recorded commit message ends in a trailer block that `git interpret-trailers --parse` reports as containing the bot trailer, and any `Task:` trailer the message carries is preserved. | 6, 8 | "In `test/integration/git-hooks-co-author.test.ts`, a real repository with the hook installed and a co-author value records a plain-message commit whose `git interpret-trailers --parse` output contains the bot trailer and still contains a `Task:` trailer the message supplied" | diff-local |
| Story 2 happy: **Given** a bot configured with a resolved identity and no current task recorded in the daemon worktree, **When** the build agent commits there, **Then** the commit still carries the bot trailer. | 6 | "The same test records the bot trailer on a commit made with no `.pipeline/current-task` file and on a `git commit --allow-empty` commit" | diff-local |
| Story 2 happy: **Given** a bot configured with a resolved identity, **When** the build agent makes an allowed-empty evidence commit in the daemon worktree, **Then** that commit carries the bot trailer. | 6 | "The same test records the bot trailer on a commit made with no `.pipeline/current-task` file and on a `git commit --allow-empty` commit" | diff-local |
| Story 2 happy: **Given** a bot configured with a resolved identity, **When** the build agent commits in the daemon worktree, **Then** the commit's author and committer name and email equal the operator's git configuration. | 6 | "The same test asserts the recorded author and committer name and email equal the repository `user.name` and `user.email`" | diff-local |
| Story 2 happy: **Given** a bot configured with a resolved identity, **When** the daemon prepares a CI-fix or rebase-resolution worktree and its agent commits there, **Then** that commit carries the bot trailer. | 9 | "With a fake resolved resolver installed, `withResolveWorktree` using its default `prepareWorktree` writes `.pipeline/co-author` into the rebase-resolution worktree and `runCiFix` with its default preparation writes it into the CI-fix worktree, and a commit then made in each of those worktrees records the bot trailer" | diff-local |
| Story 2 happy: **Given** a bot configured with a resolved identity and a project setup that fails during worktree preparation, **When** the setup-triage fix session commits in that worktree, **Then** that commit carries the bot trailer, because the co-author value is written before project setup runs. | 8 | "`prepareWorktree` calls the installed resolver's `prepare()` after `writeGitHooksAndWire` and before the project setup decision and writes the resolved value to `.pipeline/co-author`, and with a `bin/setup` that fails a commit then made in that worktree, as the setup-triage fix session does, records the bot trailer, as asserted in `test/engine/worktree-prepare-co-author.test.ts`" | diff-local |
| Story 2 negative: **Given** a build-agent commit message that already contains the bot trailer, **When** the commit is recorded in the daemon worktree, **Then** the message contains the bot trailer exactly once. | 7 | "A message that already contains the bot trailer records exactly one bot trailer line" | diff-local |
| Story 2 negative: **Given** a message whose trailer block already names another co-author, **When** the build agent commits it in the daemon worktree, **Then** the existing co-author trailer is preserved unchanged and the bot trailer is added once. | 7 | "A message whose trailer block names another `Co-authored-by` keeps that line unchanged and gains exactly one bot trailer" | diff-local |
| Story 2 negative: **Given** an existing commit in the daemon worktree without the bot trailer, **When** it is amended or replayed during a rebase, **Then** the resulting message is not re-stamped and keeps exactly the trailers it had. | 7 | "Amending an existing commit that lacks the bot trailer, and replaying it with `git rebase`, leaves each resulting message with exactly the trailers it had before" | diff-local |
| Story 2 negative: **Given** a daemon worktree prepared while a bot was configured, **When** the bot is removed from user config and the next dispatch prepares the same worktree, **Then** the co-author value is removed and a subsequent build-agent commit carries no bot trailer. | 8 | "When the resolution is `unconfigured` or `unavailable`, or no daemon resolver is installed, `prepareWorktree` removes an existing `.pipeline/co-author` file, and a worktree prepared with a resolved bot and then re-prepared after the bot is removed from user config records no bot trailer on its next commit" | diff-local |
| Story 2 negative: **Given** a bot configured whose identity is unavailable, **When** dispatch prepares the worktree and the build agent commits there, **Then** the commit succeeds with no bot trailer. | 8, 7 | "When the resolution is `unconfigured` or `unavailable`, or no daemon resolver is installed, `prepareWorktree` removes an existing `.pipeline/co-author` file, and a worktree prepared with a resolved bot and then re-prepared after the bot is removed from user config records no bot trailer on its next commit" | diff-local |
| Story 2 negative: **Given** a bot configured with a resolved identity and a worktree where writing the co-author value fails, **When** the daemon prepares that worktree, **Then** preparation continues, a skip warning is emitted, and later commits there carry no bot trailer. | 8 | "When writing `.pipeline/co-author` throws, `prepareWorktree` continues to the setup decision, emits one `bot_co_author_skipped` event with reason `worktree-write-failed`, leaves no co-author file, and a commit made there afterwards records no bot trailer" | diff-local |
| Story 2 negative: **Given** a bot configured with a resolved identity, **When** installing the worktree's git hooks fails during daemon worktree preparation, **Then** preparation fails with the existing preventive hook installation error and no co-author value is written to that worktree. | 8 | "When `writeGitHooksAndWire` throws, `prepareWorktree` rejects with the `preventive git hook installation failed` error and `.pipeline/co-author` is not created" | diff-local |
| Story 3 happy: **Given** a bot configured with a resolved identity, **When** the daemon makes each kind of engine bookkeeping commit, **Then** every one of those commits carries the bot trailer. | 10, 11, 12, 13 | "The `shipped record: <slug>`, `shipped record findings: <slug>`, `halt record: <slug>`, and `halt record resolved: <slug>` commits each pass their message through `withDaemonCoAuthorTrailer`, and `test/engine/daemon-commit-co-author.test.ts` records each with the bot trailer when a resolved identity is installed" | diff-local |
| Story 3 happy: **Given** a bot configured with a resolved identity, **When** the shipment-repair commit is made in its temporary worktree that has no daemon hooks, **Then** that commit carries the bot trailer. | 12 | "The shipment-repair commit, made in its temporary worktree with no daemon hooks, records the bot trailer exactly once" | diff-local |
| Story 3 negative: **Given** a bot configured with a resolved identity, **When** an engine bookkeeping commit is made inside a daemon worktree whose hook also stamps, **Then** the commit carries the bot trailer exactly once. | 12 | "An engine bookkeeping commit made in a repository with the co-author `prepare-commit-msg` hook installed and the same co-author value records the bot trailer exactly once" | diff-local |
| Story 3 negative: **Given** a bot configured whose identity is unavailable, **When** an engine bookkeeping commit is made, **Then** the commit succeeds with its message exactly as today and no bot trailer. | 11, 12 | "With an installed resolver whose `current()` is unavailable, each of those commits succeeds and its git argument vector is byte-identical to the vector built before this change" | diff-local |
| Story 3 negative: **Given** a bot configured whose identity has not been resolved yet in the daemon process, **When** a halt record or other engine bookkeeping commit is made, **Then** no identity read is performed inside that commit path and the commit proceeds without the bot trailer. | 10, 11 | "With an installed resolver that has never run `prepare()`, the `halt record: <slug>` commit succeeds without the bot trailer and the fake identity read records no call" | diff-local |
| Story 3 negative: **Given** a bot configured with a resolved identity, **When** a daemon engine commit call site builds its commit without going through the shared co-author helper, **Then** a repository test naming that call site fails. | 13 | "`test/engine/daemon-commit-co-author-guard.test.ts` scans every non-test source under `src/conductor/src` for a git `commit` invocation carrying `-m` or `-F` and for any `commit-tree` invocation, and fails naming the file and line of any whose message is not produced by `withDaemonCoAuthorTrailer`" | diff-local |
| Story 4 happy: **Given** a bot configured with a resolved identity, **When** the operator runs `ai-conductor compose land` (or `engineer land`) and it commits the spec artifacts, **Then** the spec commit carries no bot trailer. | 14 | "With a resolved bot identity available but no resolver installed in the process, which is the state of every operator-run CLI process, the spec land commit, the `shipped record: <slug>` commit written through `dispatchShippedRecord`, and the shipment-repair commit reached through the daemon park command each record a message without the bot trailer, as asserted in `test/engine/operator-commit-co-author.test.ts`" | diff-local |
| Story 4 happy: **Given** a bot configured with a resolved identity, **When** the operator commits by hand in the root checkout or in a worktree the operator created, **Then** the commit carries no bot trailer. | 14 | "After `prepareWorktree` has wired hooks and written `.pipeline/co-author` in a daemon worktree of the same repository, a commit made by hand in the repository root, and in a worktree created with `git worktree add`, records exactly the message given, and the root checkout's `core.hooksPath` remains unset while its resolved hooks directory contains none of the daemon `pre-commit`, `prepare-commit-msg`, or `commit-msg` hooks, so no daemon hook runs for that commit" | diff-local |
| Story 4 negative: **Given** a bot configured with a resolved identity and a running daemon, **When** the operator commits by hand in the root checkout, **Then** no daemon hook runs for that commit and its message is exactly what the operator wrote. | 14 | "After `prepareWorktree` has wired hooks and written `.pipeline/co-author` in a daemon worktree of the same repository, a commit made by hand in the repository root, and in a worktree created with `git worktree add`, records exactly the message given, and the root checkout's `core.hooksPath` remains unset while its resolved hooks directory contains none of the daemon `pre-commit`, `prepare-commit-msg`, or `commit-msg` hooks, so no daemon hook runs for that commit" | diff-local |
| Story 4 negative: **Given** a bot configured with a resolved identity, **When** an operator-run CLI other than the daemon commits through a code path shared with engine bookkeeping commits, **Then** it adds no bot trailer, because only daemon composition supplies the co-author identity. | 9, 14 | "A static scan of `src/conductor/src` finds `installDaemonBotCoAuthor` called only from `src/conductor/src/daemon-cli.ts`, so no operator-run CLI entry point supplies a co-author identity" | diff-local |
| Story 4 negative: **Given** a bot configured with a resolved identity, **When** the operator runs the daemon park command and it publishes a shipment repair, **Then** the repair commit carries no bot trailer, while the same repair published by the running daemon carries it. | 14 | "The same shipment-repair commit records the bot trailer when the running daemon's installed resolver has a resolved identity" | diff-local |
| Story 5 happy: **Given** no bot configured, **When** daemon dispatch prepares a worktree and the build agent commits there, **Then** no co-author value exists in the worktree and the commit message is byte-identical to the message the same commit produces today. | 15 | "With no `github_bot` configured, `prepareWorktree` leaves no `.pipeline/co-author` file and a commit made there with the co-author hook records a message byte-identical to the message passed to `git commit`, as asserted in `test/engine/bot-co-author-unconfigured.test.ts`" | diff-local |
| Story 5 happy: **Given** no bot configured, **When** the daemon makes each kind of engine bookkeeping commit, **Then** the git arguments and message are byte-identical to today's. | 15 | "With no bot configured, each of the nine engine bookkeeping commit invocations builds a git argument vector byte-identical to the vector built before this change" | diff-local |
| Story 5 negative: **Given** a user config whose `github_bot.token_file` is blank, **When** the daemon dispatches and commits, **Then** behavior equals the no-bot case: no identity read, no skip warning, and no bot trailer. | 15 | "With `github_bot.token_file` set to a blank string, `prepare()` returns `unconfigured`, performs no identity read, emits no `bot_co_author_skipped` event, and later commits carry no bot trailer" | diff-local |
| Story 5 negative: **Given** no bot configured, **When** the daemon runs a full dispatch, **Then** no skip warning is emitted. | 15 | "With no bot configured, a dispatch preparation through `makeFeatureRunnerDeps(...).prepareWorktree`, a build commit in that worktree, an engine bookkeeping commit through `withDaemonCoAuthorTrailer`, and a rebase-resolution preparation together emit no `bot_co_author_skipped` event" | diff-local |
| Story 6 happy: **Given** a bot configured with a resolved identity, **When** daemon commits are stamped, **Then** the bot trailer, the per-worktree co-author value, and every commit message contain only the bot's login and no-reply address, never the token. | 5 | "`test/engine/bot-co-author-token-confinement.test.ts` resolves a bot identity with a distinctive token and asserts that the bot-derived text in the resolved trailer, in the `.pipeline/co-author` value that `prepareWorktree` writes, in a message produced by `withDaemonCoAuthorTrailer`, and in a hook-stamped commit message is exactly the bot login and its no-reply address, and that none of them contains the token" | diff-local |
| Story 6 happy: **Given** a bot configured, **When** the identity read runs, **Then** the token is present only in that one child process's environment and not in the daemon's own environment or any provider or build child's environment. | 5 | "The test asserts that during the identity read `GH_TOKEN` is set only in the spawned `gh` child environment, never in `process.env` that provider and build children inherit" | diff-local |
| Story 6 negative: **Given** a bot configured whose identity read fails with output that echoes the token, **When** the failure is handled, **Then** the skip warning, the persisted `.pipeline/events.jsonl` line, the daemon log, and any surfaced error message contain no token and no token-file path. | 5 | "The same test drives an identity read whose `gh` failure output echoes the token and asserts the token and the token-file path are absent from the skip event, from the line `EventPersister` writes to `.pipeline/events.jsonl`, from every line passed to the daemon log function, and from any error the resolver surfaces" | diff-local |
| Story 6 negative: **Given** a bot configured whose token file is unreadable, **When** the skip warning is emitted, **Then** it carries only its closed reason and no file path or error text. | 5 | "For an unreadable token file the emitted event is exactly `{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }` with no other field" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-11-github-operation-ownership#D1 | task | task-1 | `GITHUB_AMBIENT_READ_REGISTRY` names an `ambient.bot-identity.read` operation admitting only the `api user` command shape, and `decodeGithubAmbientRead` refuses any other argv under that name, as asserted in `test/engine/bot-identity-read-transport.test.ts` |
| adr-2026-09-11-github-operation-ownership#D2 | no-change | none | The bot identity read feeds no authorization, and committed-ownership checks still bind the machine-resolved operator (D10.1). |
| adr-2026-09-11-github-operation-ownership#D3 | no-change | none | Pre-spec intake and creation authorization are untouched; this feature adds no GitHub write. |
| adr-2026-09-11-github-operation-ownership#D4 | no-change | none | No shared-resource mutation is added; the only new GitHub call is a checkout-scoped identity read. |
| adr-2026-09-11-github-operation-ownership#D5 | no-change | none | Local commits stay on their existing git paths and only their message gains a trailer; no remote write or push changes (D10.3). |
| adr-2026-09-11-github-operation-ownership#D6 | no-change | none | Ownership refusal results and their events are unchanged; the new skip event is a separate closed variant. |
| adr-2026-09-11-github-operation-ownership#D7 | task | task-1 | `GITHUB_AMBIENT_READ_REGISTRY` names an `ambient.bot-identity.read` operation admitting only the `api user` command shape, and `decodeGithubAmbientRead` refuses any other argv under that name, as asserted in `test/engine/bot-identity-read-transport.test.ts` |
| adr-2026-09-11-github-operation-ownership#D8 | no-change | none | Gated visibility and announcement behavior are untouched. |
| adr-2026-09-11-github-operation-ownership#D9 | task | task-1 | This feature's D9 scope is only the new bot-only `credential: 'bot'` value used by the bot identity read; the rest of D9 (machine-scoped `github_bot` config validation, write-credential selection for every authorized GitHub and remote-ref write, the explicit `gh auth git-credential` push helper, and the typed bot-auth fallback with its warning event) was delivered by #158 and is not changed here |
| adr-2026-09-11-github-operation-ownership#D10 | task | task-3, task-6, task-10 | The same test asserts the identity read ran exactly once, as `ambient.bot-identity.read` with `credential: 'bot'` and never with `credential: 'operator'` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

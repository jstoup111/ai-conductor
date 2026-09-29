**Status:** Accepted

# Daemon commits co-authored by the configured bot (#2722)

Track: technical (no PRD; acceptance criteria live here)
Tier: M

## Context

Spec #158 lets an operator configure a GitHub bot (`github_bot.token_file`) that performs the
harness's remote writes and pushes. Commits the daemon creates still name only the operator, so
daemon-built work is indistinguishable from hand-written work in commit history. This feature
credits the configured bot as a co-author on every commit the daemon creates. The operator stays
the commit author.

Governing decision: adr-2026-09-11-github-operation-ownership D10 (amended 2026-09-28). Architecture
review: `.docs/decisions/architecture-review-2026-09-28-daemon-commits-co-authored-by-the-configured-bot.md`.

Terms used below:
- **Bot configured** means the user config contains a `github_bot` block whose `token_file` names a
  readable file holding a machine-user token (spec #158).
- **Bot trailer** means the commit-message trailer `Co-authored-by: <login> <<id>+<login>@users.noreply.github.com>`,
  where `login` and `id` are the bot account's GitHub login and numeric user id.
- **Daemon worktree** means a worktree the daemon prepared for its own work (feature build, CI fix,
  or rebase resolution) with its worktree-scoped git hooks installed. The operator's root checkout and worktrees the operator creates by hand
  are not daemon worktrees.
- **Engine bookkeeping commit** means a commit the daemon's engine code makes itself: the shipped
  record, shipped-record findings, halt record, halt-record resolution, remediation-plan append,
  setup-triage quarantine, setup-triage preserved repair, setup-triage retained repair, and the
  shipment-repair commit.
- **Skip warning** means the new `ConductorEvent` variant recording that a bot was configured but
  its identity could not be resolved, so the bot trailer was omitted.

## Story 1: The bot's co-author identity is derived from its own token

As an operator, I want the harness to learn the bot's GitHub identity from the token I already
configured, so that I never maintain a second copy of the bot's login or email.

### Acceptance Criteria

#### Happy Path
- **Given** a bot configured whose token belongs to GitHub account `conductor-bot` with user id `4242`, **When** the co-author identity is resolved, **Then** it resolves to the bot trailer `Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>` using one identity read performed with the bot credential, not the operator's.
- **Given** the identity was already resolved once in the current daemon process for the same token file, **When** the co-author identity is requested again, **Then** the cached identity is returned and no second identity read is performed.

#### Negative Paths
- **Given** a bot configured whose token file is missing or unreadable, **When** the co-author identity is resolved, **Then** no identity read is attempted, the result is unavailable with reason `token-unavailable`, and exactly one skip warning is emitted.
- **Given** a bot configured whose identity read fails (401, 403, a timeout, or a transport error), **When** the co-author identity is resolved, **Then** the result is unavailable with reason `identity-read-failed`, exactly one skip warning is emitted, and the read is not retried with the operator's credential.
- **Given** a bot configured whose identity read returns a response with no login or a non-numeric id, **When** the co-author identity is resolved, **Then** the result is unavailable with reason `identity-read-failed` and no bot trailer is produced from partial data.
- **Given** a bot configured whose identity read returns a login containing characters outside GitHub's login character set (letters, digits, and single hyphens), **When** the co-author identity is resolved, **Then** the result is unavailable with reason `identity-read-failed` and no bot trailer is produced.
- **Given** a bot configured whose identity resolution failed during the current dispatch, **When** further commits in that dispatch request the co-author identity, **Then** no further identity read is attempted and no further skip warning is emitted until the next dispatch preparation.
- **Given** a bot configured with a resolved co-author identity, **When** the operator's own identity is resolved for ownership or `--assignee @me` intake capture, **Then** that read still receives no bot token and still returns the operator's login, because the bot identity read is a separate operation with a separate cache.
- **Given** no bot configured, **When** the co-author identity is resolved, **Then** the result is unconfigured, no identity read is attempted, and no skip warning is emitted.

### Done When
- [ ] The identity read is a typed operation in the GitHub operation registry, and its transport invocation requests the bot credential.
- [ ] The resolver's result is a closed union that distinguishes unconfigured, resolved, and unavailable with a closed reason.
- [ ] The skip warning is a `ConductorEvent` variant carrying only a closed reason, declared in `EVENT_SINKS` the same way as `github_write_credential_fallback`.

## Story 2: Build-agent commits in a daemon worktree carry the bot trailer

As an operator, I want every commit the build agent makes during a daemon build to name the bot,
so that daemon-built work is visibly paired in GitHub's commit view and on `main` after squash.

### Acceptance Criteria

#### Happy Path
- **Given** a bot configured with a resolved identity, **When** daemon dispatch prepares a feature worktree with its hooks wired and the build agent commits a staged change there with a plain message, **Then** the recorded commit message ends in a trailer block that `git interpret-trailers --parse` reports as containing the bot trailer, and any `Task:` trailer the message carries is preserved.
- **Given** a bot configured with a resolved identity and no current task recorded in the daemon worktree, **When** the build agent commits there, **Then** the commit still carries the bot trailer.
- **Given** a bot configured with a resolved identity, **When** the build agent makes an allowed-empty evidence commit in the daemon worktree, **Then** that commit carries the bot trailer.
- **Given** a bot configured with a resolved identity, **When** the build agent commits in the daemon worktree, **Then** the commit's author and committer name and email equal the operator's git configuration.
- **Given** a bot configured with a resolved identity, **When** the daemon prepares a CI-fix or rebase-resolution worktree and its agent commits there, **Then** that commit carries the bot trailer.
- **Given** a bot configured with a resolved identity and a project setup that fails during worktree preparation, **When** the setup-triage fix session commits in that worktree, **Then** that commit carries the bot trailer, because the co-author value is written before project setup runs.

#### Negative Paths
- **Given** a build-agent commit message that already contains the bot trailer, **When** the commit is recorded in the daemon worktree, **Then** the message contains the bot trailer exactly once.
- **Given** a message whose trailer block already names another co-author, **When** the build agent commits it in the daemon worktree, **Then** the existing co-author trailer is preserved unchanged and the bot trailer is added once.
- **Given** an existing commit in the daemon worktree without the bot trailer, **When** it is amended or replayed during a rebase, **Then** the resulting message is not re-stamped and keeps exactly the trailers it had.
- **Given** a daemon worktree prepared while a bot was configured, **When** the bot is removed from user config and the next dispatch prepares the same worktree, **Then** the co-author value is removed and a subsequent build-agent commit carries no bot trailer.
- **Given** a bot configured whose identity is unavailable, **When** dispatch prepares the worktree and the build agent commits there, **Then** the commit succeeds with no bot trailer.
- **Given** a bot configured with a resolved identity and a worktree where writing the co-author value fails, **When** the daemon prepares that worktree, **Then** preparation continues, a skip warning is emitted, and later commits there carry no bot trailer.
- **Given** a bot configured with a resolved identity, **When** installing the worktree's git hooks fails during daemon worktree preparation, **Then** preparation fails with the existing preventive hook installation error and no co-author value is written to that worktree.

### Done When
- [ ] The worktree `prepare-commit-msg` hook asset stamps the bot trailer from the per-worktree co-author value and is a no-op when that value is absent.
- [ ] Dispatch worktree preparation writes the co-author value when the identity resolves, and removes any existing value otherwise.

## Story 3: Engine bookkeeping commits carry the bot trailer

As an operator, I want the daemon's own bookkeeping commits to name the bot too, so that every
commit the daemon creates is attributed consistently.

### Acceptance Criteria

#### Happy Path
- **Given** a bot configured with a resolved identity, **When** the daemon makes each kind of engine bookkeeping commit, **Then** every one of those commits carries the bot trailer.
- **Given** a bot configured with a resolved identity, **When** the shipment-repair commit is made in its temporary worktree that has no daemon hooks, **Then** that commit carries the bot trailer.

#### Negative Paths
- **Given** a bot configured with a resolved identity, **When** an engine bookkeeping commit is made inside a daemon worktree whose hook also stamps, **Then** the commit carries the bot trailer exactly once.
- **Given** a bot configured whose identity is unavailable, **When** an engine bookkeeping commit is made, **Then** the commit succeeds with its message exactly as today and no bot trailer.
- **Given** a bot configured whose identity has not been resolved yet in the daemon process, **When** a halt record or other engine bookkeeping commit is made, **Then** no identity read is performed inside that commit path and the commit proceeds without the bot trailer.
- **Given** a bot configured with a resolved identity, **When** a daemon engine commit call site builds its commit without going through the shared co-author helper, **Then** a repository test naming that call site fails.

### Done When
- [ ] Every engine bookkeeping commit site obtains its co-author addition from one shared helper.
- [ ] A test enumerates the engine's daemon commit invocations and fails on any that bypass the helper.

## Story 4: Commits outside the daemon are never stamped

As an operator, I want my own commits and the commits made by CLIs I run by hand to stay exactly
as they are, so that the bot is credited only for work the daemon did.

### Acceptance Criteria

#### Happy Path
- **Given** a bot configured with a resolved identity, **When** the operator runs `ai-conductor compose land` (or `engineer land`) and it commits the spec artifacts, **Then** the spec commit carries no bot trailer.
- **Given** a bot configured with a resolved identity, **When** the operator commits by hand in the root checkout or in a worktree the operator created, **Then** the commit carries no bot trailer.

#### Negative Paths
- **Given** a bot configured with a resolved identity and a running daemon, **When** the operator commits by hand in the root checkout, **Then** no daemon hook runs for that commit and its message is exactly what the operator wrote.
- **Given** a bot configured with a resolved identity, **When** an operator-run CLI other than the daemon commits through a code path shared with engine bookkeeping commits, **Then** it adds no bot trailer, because only daemon composition supplies the co-author identity.
- **Given** a bot configured with a resolved identity, **When** the operator runs the daemon park command and it publishes a shipment repair, **Then** the repair commit carries no bot trailer, while the same repair published by the running daemon carries it.

### Done When
- [ ] The co-author identity reaches the shared helper and dispatch worktree preparation only from the daemon composition, and operator-run CLI entry points supply none.

## Story 5: Without a bot, daemon commits are byte-for-byte unchanged

As an operator who has not configured a bot, I want this feature to change nothing, so that
upgrading carries no risk to my commit history.

### Acceptance Criteria

#### Happy Path
- **Given** no bot configured, **When** daemon dispatch prepares a worktree and the build agent commits there, **Then** no co-author value exists in the worktree and the commit message is byte-identical to the message the same commit produces today.
- **Given** no bot configured, **When** the daemon makes each kind of engine bookkeeping commit, **Then** the git arguments and message are byte-identical to today's.

#### Negative Paths
- **Given** a user config whose `github_bot.token_file` is blank, **When** the daemon dispatches and commits, **Then** behavior equals the no-bot case: no identity read, no skip warning, and no bot trailer.
- **Given** no bot configured, **When** the daemon runs a full dispatch, **Then** no skip warning is emitted.

### Done When
- [ ] Tests with no bot configured assert unchanged commit arguments at the engine sites and unchanged hook output in a daemon worktree.

## Story 6: The bot token never appears in any commit, event, or log

As an operator, I want the bot token confined to the identity read, so that attribution never
leaks the credential.

### Acceptance Criteria

#### Happy Path
- **Given** a bot configured with a resolved identity, **When** daemon commits are stamped, **Then** the bot trailer, the per-worktree co-author value, and every commit message contain only the bot's login and no-reply address, never the token.
- **Given** a bot configured, **When** the identity read runs, **Then** the token is present only in that one child process's environment and not in the daemon's own environment or any provider or build child's environment.

#### Negative Paths
- **Given** a bot configured whose identity read fails with output that echoes the token, **When** the failure is handled, **Then** the skip warning, the persisted `.pipeline/events.jsonl` line, the daemon log, and any surfaced error message contain no token and no token-file path.
- **Given** a bot configured whose token file is unreadable, **When** the skip warning is emitted, **Then** it carries only its closed reason and no file path or error text.

### Done When
- [ ] A test seeds a distinctive token value, drives both a successful and a failing identity read, and asserts that the value is absent from the event, the error, the trailer, and the co-author value.

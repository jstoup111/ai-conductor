**Status:** Accepted

# Optional bot identity for harness GitHub writes (#158)

Track: technical (no PRD; acceptance criteria live here)
Tier: M

## Context

Every GitHub mutation the harness performs uses the operator's personal `gh` authentication. That
covers daemon PR comments and labels, `needs-remediation` surfacing, intake write-back, composer
spec PRs, and branch pushes. Automated activity is therefore indistinguishable from the operator's
own activity.

This feature adds an **optional** machine-scoped bot credential, a machine-user token referenced
from user config. When the bot is configured, every harness remote write, pushes included, runs as
the bot. Every read stays on the operator's credential. When no bot is configured, nothing
changes.

Governing decisions: adr-2026-09-11-github-operation-ownership D9 (amended 2026-09-23) and
adr-2026-07-22-canonical-tracker-client-seam item 3 (amended 2026-09-23). Architecture review:
`.docs/decisions/architecture-review-2026-09-23-use-a-dedicated-bot-identity-for-daemon-github-act.md`.

Terms used below:
- **Bot configured** means the user config `~/.ai-conductor/config.yml` contains a `github_bot`
  block whose `token_file` names a readable file holding a machine-user token.
- **Write** means any guarded GitHub operation whose access class is not `read`, and any
  authorized remote push.
- **Fallback warning** means the new `ConductorEvent` variant that records a write performed with
  the operator's credential although a bot was configured.

## Story 1: The bot credential is optional and machine-scoped

As an operator, I want to declare a bot credential only on my machine so that no repository
can carry or override it, and so that omitting it changes nothing.

### Acceptance Criteria

#### Happy Path
- **Given** a user config with `github_bot.token_file` naming an existing file, **When** the harness loads merged config, **Then** the load succeeds and the bot credential resolver reports the bot as configured with that file path.
- **Given** a user config with no `github_bot` block, **When** the harness loads merged config, **Then** the load succeeds and the resolver reports no bot configured.

#### Negative Paths
- **Given** a committed project `.ai-conductor/config.yml` that contains a `github_bot` block, **When** the harness loads that project config, **Then** loading fails with a config error that names the file and says `github_bot` belongs only in `~/.ai-conductor/config.yml`.
- **Given** a user config whose `github_bot` block has no `token_file` or a non-string `token_file`, **When** the harness loads merged config, **Then** loading fails with a config error naming `github_bot.token_file`.
- **Given** a user config whose `github_bot` block carries an inline token value instead of a file reference, **When** the harness loads merged config, **Then** loading fails with a config error that names the unsupported key and does not echo its value.

### Done When
- [ ] `validateConfig` accepts `github_bot: { token_file: <string> }` from user config and rejects any `github_bot` key from a project source.
- [ ] The config-key consumer registry lists `github_bot` with its production consumer.
- [ ] The bot credential resolver has no parameter through which project config can reach it.

## Story 2: GitHub writes run as the bot; reads stay the operator's

As an operator, I want every GitHub write the harness makes to be authored by the bot while
identity and intake keep seeing me, so that I can tell automated activity from my own without
breaking ownership.

### Acceptance Criteria

#### Happy Path
- **Given** a bot is configured, **When** a guarded GitHub operation of access class `feature-write`, `intake-write`, `create`, or `shared-write` runs, **Then** its `gh` child process receives `GH_TOKEN` equal to the token file's contents and every other environment variable is inherited unchanged.
- **Given** a bot is configured, **When** a guarded `read` operation, operator identity resolution (`gh api user`), or `--assignee @me` intake capture runs, **Then** its `gh` child receives no bot token and uses the operator's ambient credential.
- **Given** a bot is configured, **When** an operator-run CLI (`compose handoff`, `intake file`) performs a GitHub write, **Then** that write runs with the bot credential exactly as a daemon write does.
- **Given** a bot is configured, **When** the `github-operation` CLI is invoked from inside a provider session and performs a write, **Then** it resolves the bot from the same user config that supplies `spec_owner` and runs the write with the bot credential.

#### Negative Paths
- **Given** a bot is configured, **When** a write completes, **Then** `process.env.GH_TOKEN` and `process.env.GITHUB_TOKEN` of the harness process are unchanged from before the write.
- **Given** a bot is configured and a write is refused by the ownership policy, **When** the guarded runner returns that refusal, **Then** no `gh` child is spawned with either credential and no fallback warning is emitted.
- **Given** a bot is configured, **When** the operator's ambient environment already sets `GH_TOKEN`, **Then** reads still use the operator's ambient value and only writes carry the bot token.
- **Given** a guarded GitHub request that carries no operation access class, **When** the guarded runner receives it, **Then** it is refused without spawning `gh` under either credential.

### Done When
- [ ] A transport test proves that each non-`read` access class spawns `gh` with the bot `GH_TOKEN`, and that `read` does not.
- [ ] Identity resolution and `@me` intake capture are proven to spawn `gh` without the bot token.
- [ ] A real-binary smoke test shows that the installed `gh` honors a child-process `GH_TOKEN` in preference to stored credentials.

## Story 3: Remote pushes run as the bot

As an operator, I want branch pushes made by the harness to be performed by the bot so that
the pusher in PR timelines matches the author of the PR.

### Acceptance Criteria

#### Happy Path
- **Given** a bot is configured and an authorized push to an HTTPS github.com remote, **When** the remote Git adapter executes it, **Then** the `git` child receives the bot `GH_TOKEN` plus child-only git config that selects `gh auth git-credential` for github.com, and the push argv is unchanged.
- **Given** no bot is configured, **When** an authorized push executes, **Then** the `git` child receives no injected token or credential-helper config.

#### Negative Paths
- **Given** a bot is configured and the operator's global git config names a different credential helper, **When** an authorized HTTPS push executes, **Then** the push still authenticates through `gh auth git-credential` with the bot token rather than the operator's helper.
- **Given** a bot is configured and the push destination is an SSH remote, **When** the push executes, **Then** it runs with the operator's credential and a fallback warning with reason `unsupported-remote-transport` is emitted.
- **Given** a bot is configured and the ownership policy refuses a destination ref, **When** the remote Git adapter evaluates the push, **Then** no `git` child is spawned and no fallback warning is emitted.

### Done When
- [ ] Both production push runners accept and apply the write-credential hint; `git commit` and other local git calls are unaffected.
- [ ] A real-binary smoke test shows that `gh auth git-credential get` returns the child `GH_TOKEN` as the password for github.com.

## Story 4: An unambiguous bot auth failure falls back once, loudly

As an operator, I want a broken or missing bot credential to fall back to my own credential
with a visible warning, so that work keeps flowing and I know it was misattributed.

### Acceptance Criteria

#### Happy Path
- **Given** a bot is configured whose token file is missing or unreadable, **When** a write runs, **Then** it runs once with the operator's credential and one fallback warning with reason `token-unavailable` is emitted for that operation and target.
- **Given** a bot is configured and `gh` rejects the write with a verbatim 401, 403 permission, or bad-credentials response, **When** the guarded runner receives that typed auth refusal, **Then** one fallback warning with reason `auth-refused` is emitted first and then the same operation, target, and payload run exactly once more with the operator's credential inside the same authorized invocation.
- **Given** a bot is configured and `git push` fails with a verbatim authentication or permission-denied response, **When** the remote Git adapter receives that typed auth refusal, **Then** the same push runs exactly once more with the operator's credential and one fallback warning with reason `auth-refused` is emitted.

#### Negative Paths
- **Given** a bot is configured and a write fails with a timeout, a network error, or a non-auth `gh` error, **When** the failure is classified, **Then** no operator retry happens, no fallback warning is emitted, and the caller receives the same failure it receives today.
- **Given** a bot is configured and both the bot attempt and the operator retry are refused, **When** the retry fails, **Then** no third attempt is made and the caller receives the operator attempt's failure.
- **Given** a bot is configured and a marker-comment edit is refused for the bot with 403, **When** the fallback runs, **Then** it retries the edit of the same comment with the operator's credential and never creates a new comment.
- **Given** a `gh` 403 whose output is a secondary rate-limit message, **When** it is classified, **Then** it is not treated as an auth refusal.
- **Given** a fallback occurs, **When** retry budgets and escalation state are inspected afterwards, **Then** no retry-budget entry was consumed and no escalation was triggered.
- **Given** a bot-auth refusal and the fallback warning fails to emit, **When** the fallback is considered, **Then** no operator retry runs and the caller receives the typed bot-auth failure.
- **Given** a bot-auth refusal, **When** the caller inspects the failure, **Then** its type is distinct from an ownership-policy refusal and it is never reported as `github_operation_refused`.
- **Given** an operator fallback ran for one operation, **When** a later operation or a caller-level retry of the same workflow runs, **Then** it re-runs ownership authorization and starts again with the bot credential.

### Done When
- [ ] Auth-refusal classification is a typed error class raised at the production runner boundary; callers branch on the class, never on text.
- [ ] Every classification pattern has a fixture test built from verbatim `gh` or `git` output, including a rate-limit 403 that must not match.
- [ ] The fallback warning is a `ConductorEvent` variant with an `EVENT_SINKS` row matching `github_operation_refused`, emitted through the same emitter that call already uses.

## Story 5: The bot token never leaks

As an operator, I want the bot token confined to the `gh`/`git` child that uses it, so that
agents, reviewers, logs, and telemetry never see it.

### Acceptance Criteria

#### Happy Path
- **Given** a fallback warning is emitted, **When** it is persisted to `.pipeline/events.jsonl` and rendered, **Then** it contains only the operation, target, and closed reason, with no token value, no token file path, and no raw `gh` or `git` output.

#### Negative Paths
- **Given** a bot is configured, **When** a provider, reviewer, or build child process is spawned, **Then** its environment contains no bot token.
- **Given** a bot write fails with an error whose output would echo the command environment, **When** the error propagates to logs or the caller, **Then** the error text contains no token value.
- **Given** a bot is configured, **When** a push runs, **Then** the remote URL passed to `git` contains no embedded credential.

### Done When
- [ ] A test proves that the fallback-warning payload is limited to the closed fields.
- [ ] A test proves that a bot token planted in the token file never appears in emitted events, thrown error messages, or non-`gh`/`git` child environments.

## Story 6: With no bot configured, behavior is unchanged

As an operator who never configures a bot, I want the harness to behave exactly as it does
today.

### Acceptance Criteria

#### Happy Path
- **Given** no `github_bot` block in user config, **When** any guarded GitHub write or authorized push runs, **Then** the `gh` or `git` child environment is identical to what the harness passes today, and no fallback warning is emitted.

#### Negative Paths
- **Given** no bot is configured and a write fails with a 401, **When** the failure is classified, **Then** no operator retry happens and the caller sees today's failure unchanged.
- **Given** no bot is configured, **When** the existing guarded-runner, pr-labels, handoff, and push test suites run, **Then** they pass and the only assertion changes in this feature's diff are the added `credential` option on runner calls and the added destination `endpoint` on push calls.

### Done When
- [ ] The existing guarded-runner and remote-git adapter tests pass; the only assertion changes are the added `credential` runner option and the push destination `endpoint`.
- [ ] A test asserts that an unconfigured bot produces no token injection and no fallback event on both a write and a push.

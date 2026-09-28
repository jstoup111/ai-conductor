# Architecture Review: Optional bot identity for harness GitHub writes
**Date:** 2026-09-23
**Mode:** Lightweight (Tier M) — Feasibility and Alignment; pre-stories
**Source:** jstoup111/ai-conductor#158
**Inputs:** `.docs/track/use-a-dedicated-bot-identity-for-daemon-github-act.md` (technical track), `.docs/complexity/use-a-dedicated-bot-identity-for-daemon-github-act.md`, `.docs/architecture/use-a-dedicated-bot-identity-for-daemon-github-act.md` (operator-approved 2026-09-23)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new packages. The feature uses the `gh` CLI and git that are already installed. Verified: `gh help environment` (gh 2.96.0) says `GH_TOKEN` "takes precedence over previously stored credentials" for github.com. Verified: `printf 'protocol=https\nhost=github.com\n\n' \| GH_TOKEN=<probe> gh auth git-credential get` returned `username=x-access-token` and the probe token as the password. |
| Prerequisites | The operator provisions a machine user that has write access to the target repos, and a PAT for it in a token file (mode 0600). This is documented operator setup, not a build prerequisite. Nothing is required when no bot is configured. |
| Integration surface | Every GitHub mutation already passes through one of two choke points (source digest, 95% verified). The first is `createGuardedGithubOperationRunner` in `engine/tracker-client.ts`: `run()` inspects `request.access` before it calls `transport(ghArgsFor(request), …)`. `pr-labels.ts` `runMutation` refuses any runner that is not guarded. The second is `executeRemoteGit` in `engine/remote-git-operations.ts`, which is the only path for remote pushes. Reads bypass the guard on purpose (`runTrackerAmbientRead`, `runTrackerUrlRead`, `gh-blocker-runner.ts`) and stay unchanged. |
| Data implications | None. There is no schema, migration, or durable state. |
| Performance | One user-config read and one token-file read per write. Writes are low-frequency. Reads are unaffected. |
| Worktree isolation | No ports, databases, or shared services. The token file lives under `~/.ai-conductor/`, outside every checkout and outside the self-host live boundary. |

**Gaps the build must fill (verified absent):**
1. No `gh` auth-failure classifier exists. All 401/"Bad credentials" logic in the repo classifies `claude`/`codex` provider failures (`execution/claude-provider.ts`, `self-host/token-liveness.ts`). A typed bot-auth refusal is new code.
2. Neither production push runner accepts `env`. `makeProductionGit` (`engine/pr-labels.ts`) calls `execFileP('git', args, { cwd, maxBuffer })`. `makeGitRunner` (`engine/rebase.ts`) injects `env` only for `git commit`. The remote-git runner contract needs a credential hint.
3. There is no success or fallback event for GitHub operations. `github_operation_refused` is the only GitHub variant (`types/events.ts`; `event-sinks.ts` routes it `render: true, persist: true, audit: false, otel: false`).

## Alignment

**Governing decisions reused, not duplicated.** The design lives inside the existing guarded boundary (adr-2026-09-11-github-operation-ownership), so a new ADR is not warranted. Two approved ADRs were amended additively:
- **adr-2026-09-11-github-operation-ownership — new D9.** The write credential is a transport property, distinct from the authorization actor. D9 covers: selection by access class; machine-scoped optional config; child-only token injection; the push credential helper forced through child-env git config; a loud one-time credential fallback on a typed auth refusal only; a closed warning-event variant; and real-binary proof.
- **adr-2026-07-22-canonical-tracker-client-seam item 3.** Its assertion that "`github` keeps the `gh` CLI and its existing auth" is narrowed to reads and to operators without a bot. The reserved per-project `tracker.credentials` stays Jira-only and must never hold a token.

**Repo-wide ADR sweep (317 ADRs, delegated, verbatim quotes).** No approved ADR blocks the design. The departures and constraints it found are settled in D9:
- **Fail-closed credential precedent.** adr-2026-07-07-daemon-owned-build-credential D3 says "No silent fallback". The operator explicitly chose fallback-with-warning for #158 on 2026-09-23. D9.5 records why that departure is deliberate: the fallback is loud, it changes no authorization, it changes only the displayed author, and it covers a different credential.
- **Auth failure means no retry.** adr-2026-07-04-auth-failure-park-and-poll D2 and adr-2026-07-22-auth-failure-classification-observed-401-patterns D3 forbid retrying after an auth failure. D9.5 frames the fallback as a credential substitution within one authorized call. It uses no retry budget and triggers no escalation.
- **Reads must stay operator.** Ownership D1 requires identity to be resolved per call. adr-2026-07-01-machine-scoped-operator-identity D1 and adr-2026-06-30-owner-gate-identity-resolution use the `gh` login as the identity fallback. adr-011 D2 captures intake with `--assignee @me`. All of these stay on ambient auth, which is why `GH_TOKEN` must never enter `process.env` (adr-2026-08-27-daemon-dispatcher-executor-seam warns about process-global env races).
- **Refusal versus fallback.** Ownership D6 and D8 allow no mutation fallback after a policy refusal and no duplicate-create after a failed edit. The bot-auth refusal is a different type from a policy refusal, and a marker edit falls back only as an edit. The marker lookup does not filter by author (`upsertComment` matches on body only), so operator-authored announcements are still found when the write runs as the bot.
- **Typed seam errors.** adr-2026-09-05-gh-cli-version-floor-and-environment-gate D5, D6, and D8 require a typed error class at the seam, unchanged caller dispositions, and a real-binary smoke. adr-2026-08-18 D1 requires routing on result kind, never on text.
- **Secret hygiene.** adr-2026-07-22-token-liveness-probe-via-cli-invocation (the token is never printed), adr-2026-07-29-codex-readiness-probe-failure-disposition D1 (no raw stderr or credential paths in evidence), adr-2026-09-10-portable-build-review-policy D5 and D12, and adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation D3 (child-only env). adr-003 forbids a token in a remote URL.
- **Event and config registries.** adr-2026-07-26-event-sink-registry-exhaustiveness requires an `EVENT_SINKS` row for the new variant. adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal D4 requires a consumer entry for the new key. D3 of that ADR and adr-2026-07-01 D2 provide the user-only guard pattern.
- **Operator CLIs without a worktree.** adr-2026-09-06-inbound-intake-trust-boundary D11 and D13 govern how a short-lived CLI persists events. D9.6 binds the warning to whatever emitter already carries `github_operation_refused` for the same call, so no new persistence path is invented.

**Pattern consistency.** The credential hint rides on the existing injected runner seams: `GhRunner` options and the `RemoteGitCommandRunner` options. Test fakes keep ignoring it, and the credential stays a property of the production runner, not of call sites (adr-2026-07-03-pr-timing-config-key, adr-2026-07-29-ship-start-draft-pr, adr-2026-07-03-post-rebase-force-with-lease D5). The typed refusal follows `GhCapabilityError` in `makeProductionGh`. The token-file-plus-child-env pattern follows adr-2026-07-07 D1.

**Focused local pattern basis.**
- **User-only config block.** The role model is `spec_owner`. Its semantic traits to preserve: it is read through a user-config-only resolver that has no project-config parameter; `validateConfig` rejects the key when `source === 'project'`; and it is type-checked only on the merged path. Variation allowed: the bot block holds a file reference, not an identity string. Rediscovery hints: `engine/owner-gate/machine-identity.ts` (`resolveMachineSpecOwner`, `readMachineOwnerConfig`), and `engine/config.ts` `validateConfig` (the `spec_owner` project-source guard).
- **Typed seam error.** The role model is `GhCapabilityError`, raised inside `makeProductionGh` from classified `gh` output. Trait to preserve: callers branch on the class, never on text. Variation allowed: the new class carries a closed reason. Rediscovery hint: `engine/tracker-client.ts` `makeProductionGh`, `unsupportedJsonField`.

**State management.** The fallback reason is a closed union (`token-unavailable | auth-refused | unsupported-remote-transport`). Whether a bot is configured is represented by the presence of the config block, not by a boolean flag.

**Security boundaries.** The token file is read only by the engine process that spawns `gh` or `git`. It is never placed on `process.env`, provider, reviewer, or build children, remote URLs, events, or logs. The authorization actor does not change, so a bot with wider repo access cannot widen what the ownership policy permits.

**Production DI defaults.** No in-memory stores are introduced.

**Diagram accuracy.** `.docs/architecture/use-a-dedicated-bot-identity-for-daemon-github-act.md` matches this review. The "Write identity selector" is realized as the credential hint on the two production runners, together with fallback handling in the guarded runner and in `executeRemoteGit`.

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| User-config bot block (token-file reference) plus the project-source anti-leak guard | Read by the bot credential resolver. Validated by `validateConfig` on every config load; the guard fires for project sources. Registered in the config-key consumer registry. |
| Bot credential resolver (user-config only) | Called by the production `gh` transport (`makeProductionGh`) and the production push runners (`makeProductionGit`, `makeGitRunner` push path) whenever a call carries the write-credential hint. |
| Write-credential hint on `GhRunner` / `RemoteGitCommandRunner` options | Set by `createGuardedGithubOperationRunner.run()` for every non-`read` access class. Set by `executeRemoteGit` for every authorized push. Reached from every existing daemon, composer handoff, intake, and publication caller through those two choke points. |
| Typed bot-auth refusal error (closed reason) | Thrown by the production transports. Caught only by the guarded runner and `executeRemoteGit`, which substitute the operator credential once. |
| `ConductorEvent` fallback-warning variant plus its `EVENT_SINKS` row | Emitted by the guarded runner and `executeRemoteGit` through the emitter those paths already use for `github_operation_refused`. Persisted and rendered by the existing sinks. |
| Real-binary smoke test | Part of the existing test suite: `gh` honors a child `GH_TOKEN`, and `gh auth git-credential` returns it during a push. |
| Operator setup docs (bot provisioning, token file, fallback warning) | The operator configuration reference and the daemon operations docs. |

Advisory overlap scan (`ai-conductor overlap-scan` over `tracker-client.ts`, `remote-git-operations.ts`, `pr-labels.ts`, `rebase.ts`, `config.ts`, `types/config.ts`, `types/events.ts`, `event-sinks.ts`): "No overlap detected; no open blockers."

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `GH_TOKEN` leaks into `process.env` and silently turns operator identity or `@me` intake into the bot | Security | Low | High | D9.3 child-only injection. A test proves `gh api user` and the intake list never receive the bot token, and that `process.env` is unchanged after a bot write. |
| An ambiguous failure is misclassified as auth, so the operator retry repeats a create (duplicate PR or comment) | Integration | Low | Medium | Conservative classification on verbatim fixtures only. Timeouts and transport errors never fall back. |
| The operator's credential helper or an SSH remote bypasses `GH_TOKEN`, so a push silently runs as the operator | Integration | Medium | Medium | Child-env git config forces the gh helper for bot pushes. A non-HTTPS destination emits `unsupported-remote-transport`. |
| The bot lacks rights to edit an operator-authored marker comment | Integration | Medium | Low | A 403 falls back to an operator edit (never a create) and emits a warning. |
| A 403 from a secondary rate limit is read as an auth refusal and falls back to the operator | Integration | Low | Low | Patterns must separate rate-limit text from permission denials. A misfire only changes the displayed author. |

## ADRs Created

None. Amended: adr-2026-09-11-github-operation-ownership (new D9), adr-2026-07-22-canonical-tracker-client-seam (item 3 note).

## Conditions

1. The plan's Architecture Obligation Coverage must carry a row for every decision of both amended ADRs: ownership D1–D9 and tracker seam D1–D3.
2. A test must prove that reads (identity and `@me` intake) never run with the bot credential, and that `process.env` is never mutated.
3. The typed bot-auth refusal patterns must be backed by verbatim gh and git fixtures. Callers branch on the class only.
4. The real-binary smoke test (D9.7) must land in the suite.
5. With no bot configured, the behavior must be unchanged: existing guarded-runner and push tests pass without edits to their assertions.

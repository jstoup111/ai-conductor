# Architecture Review: Daemon commits co-authored by the configured bot
**Date:** 2026-09-28
**Stories reviewed:** none yet (pre-stories review, technical track; input is the explore outcome in `.docs/track/daemon-commits-co-authored-by-the-configured-bot.md`)
**Verdict:** APPROVED
**Mode:** Lightweight (Tier M): Feasibility and Alignment only

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new packages or services. `gh api user` and `git interpret-trailers` exist on the supported toolchain (gh 2.73.0 or later per README; installed git 2.53.0). The trailer helper should avoid assuming `git commit --trailer` (git 2.32 or later), because the repository documents no minimum git version, or it should document one. |
| Prerequisites | Spec #158's bot credential has shipped (PR #2734): `github-bot-credential.ts`, the credential-selecting runner in `tracker-client.ts`, and the `github_write_credential_fallback` event. No config migration is needed, and no new config key is added. |
| Integration surface | The guarded GitHub runner (one new typed read operation), the worktree hook assets and their wiring, dispatch worktree preparation, about eight engine commit sites, and the `ConductorEvent` union. All are inside the engine, with no external API beyond the existing GitHub REST `GET /user`. |
| Data implications | None. There is no schema. A per-worktree co-author value lives under the gitignored `.pipeline/`. It is state read by name, not an occurrence (event-spine exception C), and dispatch preparation rewrites it on every dispatch, so losing it when a worktree is recreated is self-healing. |
| Performance risk | At most one `GET /user` per daemon process, cached. It is not repeated per commit or per dispatch. |
| Worktree isolation | Hooks and the co-author value are worktree-scoped (`git config --worktree core.hooksPath`), so parallel worktrees cannot conflict and the operator's root checkout is never hooked. |

Verified claims:
- [verified] The repository's squash setting is `squash_merge_commit_message: COMMIT_MESSAGES` (GitHub API, 2026-09-28), and `Co-authored-by: Claude` trailers from branch commits already appear on `main` squash commits (`git log origin/main`). Branch trailers therefore survive the operator's squash-merge.
- [verified] The engine never sets `GIT_AUTHOR_*` or `GIT_COMMITTER_*` or passes `--author`, so the operator stays the author with no change.
- [verified] `prepareWorktree` runs at every daemon dispatch (`daemon-deps.ts`, `dispatchStart: true`), so a co-author value written there is current for each build.
- [verified] The engine never merges PRs. Daemon runs are PR-only (`finish-publication.ts`, `resolveUnattendedPublicationIntent`), so no engine code composes the squash message.
- [~95%, git documentation] `prepare-commit-msg` is not suppressed by `--no-verify`, so engine commits made inside a daemon worktree also pass through the hook. D10.4's idempotence covers the overlap.
- [~92%, inferred] GitHub attributes a co-author by its `<id>+<login>@users.noreply.github.com` address. GitHub's documentation says to use the no-reply address for a private email. The same form appears for a bot account in this repository's history (`312726728+ai-conductor-release[bot]@users.noreply.github.com`). Tests cannot confirm GitHub's avatar rendering, so it is recorded as an unexercised observation signature in the Risks section.

## Alignment

- **Governing ADR reused, amended not duplicated.** adr-2026-09-11-github-operation-ownership owns the bot credential (D9). #2722 needs one exception to D9.3 (a read on the bot credential), which was recorded as the additive D10 amendment rather than a new ADR. D1 through D9 are unchanged. D5's "local commits remain on their existing paths" holds, because commits are not routed through the GitHub boundary and only their message gains a trailer.
- **Hook pattern.** adr-2026-07-09-deterministic-evidence-attribution-enforcement Decision 2 (pure-bash hooks copied into `.pipeline/git-hooks/`, worktree-scoped `core.hooksPath`, no engine dist calls, chained to the common hook) governs. Stamping a second trailer next to `Task:` from a file the engine writes stays inside that pattern and needs no amendment. adr-2026-07-21-demote-task-stamping-to-telemetry is unaffected, because the co-author trailer is attribution and never enters task routing or evidence.
- **Focused local pattern basis.**
  - *Agent-commit stamping.* Precedent: the `Task:` stamp in the worktree `prepare-commit-msg` hook (`src/conductor/src/engine/git-hook-assets.ts`, `PREPARE_COMMIT_MSG_HOOK`). Traits to preserve: pure bash; `git interpret-trailers --in-place` on the message file; abstain on amend (`COMMIT_SOURCE=commit`) and during rebase; chain to `$GIT_COMMON_DIR/hooks/prepare-commit-msg`; no-op when its input file is absent. Allowed variation: the co-author stamp is independent of the task stamp (it applies with no current task, and even when nothing is staged for an allowed-empty evidence commit), and it deduplicates rather than replaces.
  - *Engine-commit marking.* Precedent: the single engine-commit environment helper (`src/conductor/src/engine/engine-commit-env.ts`, `withEngineCommitEnv` / `ENGINE_COMMIT_ENV`) and the `makeGitRunner` auto-marking of `commit` in `rebase.ts`. Trait to preserve: one module owns what every engine commit carries, and call sites opt in by calling it rather than hand-building the value. Allowed variation: the co-author helper changes the commit message or arguments, not the environment.
  - *Credential-bound gh call.* Precedent: `makeProductionGh` in `tracker-client.ts`, which puts `GH_TOKEN` only into the child environment and redacts it from stdout and stderr on failure. The identity read must reuse that transport, not a second token path.
- **Event spine.** The skip warning is an occurrence, so it is a new closed variant on the `ConductorEvent` union, emitted through the same emitter and with the same `EVENT_SINKS` declaration as `github_write_credential_fallback`. The per-worktree co-author value is hook input state (exception C), not a telemetry channel, and nothing reconstructs occurrences from it.
- **Security boundaries.** The token stays in the one `gh` child's environment (D9.3, D10.7). The trailer carries only the public login and id. The event carries no token, path, or stderr.
- **State.** The resolution outcome should be a closed union (for example unconfigured, resolved identity, or unavailable with a closed reason) rather than nullable strings. Otherwise "no bot" and "bot but unresolved" become indistinguishable, and D10.5 (byte-identical) and D10.6 (warn) require them to differ.
- **Production DI defaults.** There is no stateful store. The identity cache is intentionally process-lifetime memory.
- **Diagram accuracy.** `.docs/architecture/daemon-commits-co-authored-by-the-configured-bot.md` (operator-approved 2026-09-28) matches this design.

## Wiring Surface

| New or changed surface | Called from in production |
|---|---|
| Bot co-author identity resolver, using a new typed read operation in the GitHub operation registry | Dispatch worktree preparation in the daemon composition (`daemon-deps.ts` `prepareWorktree`), and the shared engine commit helper |
| Per-worktree co-author value under `.pipeline/` | Written by dispatch worktree preparation, and read by the worktree `prepare-commit-msg` hook |
| `prepare-commit-msg` hook co-author stamp (`git-hook-assets.ts`) | Installed by `writeGitHooksAndWire` during `prepareWorktree`, and run by git on every agent commit in a daemon worktree |
| Shared engine commit co-author helper | The daemon's engine commit sites: shipped record, shipped-record findings, halt record and its resolution, the remediation-plan append, the three setup-triage commits, and the shipment-repair commit |
| Co-author-skipped `ConductorEvent` variant | Emitted by the resolver through the daemon's existing event emitter and persisted to `.pipeline/events.jsonl` |

Advisory `ai-conductor overlap-scan` over those paths: no overlap detected and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The token leaks through an identity-read error or event | Security | Low | High | Reuse the redacting `makeProductionGh` transport. The event carries closed reasons only. A test asserts the token string is absent from the event, the thrown error, and the trailer (D10.6, D10.7). |
| The bot trailer is duplicated when an engine commit in a daemon worktree passes through both seams | Technical | Medium | Low | Deduplicating stamp (D10.4), with a test of both seams on one commit. |
| A wrong no-reply form shows no avatar | Integration | Low | Low | Use GitHub's documented `id+login` form from the resolved API values. Observation signature: a squash commit on `main` whose body contains `Co-authored-by: <bot login> <<id>+<bot login>@users.noreply.github.com>`. |
| `git commit --trailer` is unavailable on older git | Technical | Low | Medium | The helper uses `interpret-trailers` or message composition, not `--trailer`, or the plan documents git 2.32 as a minimum. |
| A missed engine commit site stays unstamped | Technical | Medium | Low | The plan enumerates every daemon commit site from a grep of commit invocations. A test fails when a daemon commit site bypasses the helper. |
| No-bot output drifts from byte-identical | Technical | Low | Medium | Tests with no bot configured assert the argument vectors and hook message output are unchanged (D10.5). |

## ADRs Created

None. Amended: adr-2026-09-11-github-operation-ownership, adding D10 (additive, operator decisions confirmed 2026-09-28).

## Conditions

None.

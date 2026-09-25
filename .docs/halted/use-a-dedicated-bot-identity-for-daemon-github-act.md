# Halt record

Status: halted
Slug: use-a-dedicated-bot-identity-for-daemon-github-act
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-use-a-dedicated-bot-identity-for-daemon-github-act
Head SHA: 991f1d43c890dc4e332612c08ba8c8bfce6a1de0
Halted at: 2026-09-25T12:21:59.934Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: **Given** a user config with no `github_bot` block, **When** the harness loads merged config, **Then** the load succeeds and the resolver reports no bot configured.
Task ids: 2
Done when checks: `resolveGithubBotCredential` returns `{ kind: 'unconfigured' }` when the user config has no `github_bot` block and `{ kind: 'configured', tokenFile }` naming the configured path when it does, as asserted in `test/engine/github-bot-credential.test.ts`. | `readGithubBotToken` returns the trimmed file contents for a readable token file and an `unavailable` result carrying neither the path nor the contents for a missing, unreadable, or empty file. | `resolveGithubBotCredential` accepts only the user config read by `readUserConfig` and has no project-config parameter, so neither a project `github_bot` block nor a `tracker.credentials` reference can supply the bot token.
Missing assertion: The cited checks require the resolver to return unconfigured, but do not explicitly require that loading merged config succeeds when github_bot is absent.
```

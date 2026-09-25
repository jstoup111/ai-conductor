# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-25T18:05:25.179Z
Slug: use-a-dedicated-bot-identity-for-daemon-github-act
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-use-a-dedicated-bot-identity-for-daemon-github-act
Head SHA: 8854264ccb6f61f40c968c3ee79cee2a5fb83314
Halted at: 2026-09-25T15:45:22.511Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-5 (Story 6)

Blocking findings:
AB-1 (REMEDIABLE; adr-2026-09-11-github-operation-ownership D9): The daemon autoresolve GitHub wrapper discards the credential option, so guarded mutations remain operator-authenticated.
AB-2 (REMEDIABLE; adr-2026-09-11-github-operation-ownership D9): The autoresolve and CI-fix push adapter discards credential and endpoint options before `makeGitRunner`, so those pushes cannot use the bot.
AB-3 (REMEDIABLE; adr-2026-09-11-github-operation-ownership D9): Production roots omit the event emitter while fallback remains enabled, allowing silent operator fallback.
AB-4 (REMEDIABLE; adr-2026-09-11-github-operation-ownership D9): With no bot configured, ambient operator auth failures are mislabeled as bot refusals and the mutation is repeated.
AB-5 (DESIGN; Story 6): The sealed credential-only assertion-diff criterion conflicts with the approved endpoint-bearing design.
AB-6 (REMEDIABLE; adr-2026-09-11-github-operation-ownership D9): D9.7's installed-binary proof is absent; no smoke test covers child `GH_TOKEN` and `gh auth git-credential`.
```

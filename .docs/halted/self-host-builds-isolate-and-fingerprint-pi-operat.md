# Halt record

Status: halted
Slug: self-host-builds-isolate-and-fingerprint-pi-operat
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-self-host-builds-isolate-and-fingerprint-pi-operat
Head SHA: 833b7586802dba29ffff9db8dcde380f592c82b0
Halted at: 2026-10-03T22:56:53.659Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given a resolver failure whose stderr contains the key text `K`, when the refusal diagnostic, events and HALT text are produced, then none of them contain `K`.
Task ids: 9
Done when checks: conductor pi test: with a resolver exiting 1, the pi candidate settles setup-unavailable naming pi and `openrouter`, the fake pi invoke is never called, and the scratch lease is released | conductor pi test: with a failing resolver whose stderr contains `K`, no emitted event payload and no written HALT text contains `K` | conductor pi test: a successful pi dispatch's invocation argv and env contain no `K`, and after teardown its home directory and `auth.json` no longer exist and its lease is released | conductor pi test: a pi dispatch whose invoke fails, and one that is aborted, each still remove the home directory and its `auth.json` | conductor pi test: when the live Pi home's `settings.json` changes during a dispatch, `pendingLiveBoundaryHalt` is a reason containing `provider state` and `settings.json` and the next dispatch boundary writes the HALT marker, while a dispatch that changes only `sessions/` sets no pending halt
Missing assertion: none of them contain `K`.

Criterion: Story 2 negative: Given a pi self-host candidate, when `settings.json` in the live Pi home changes before verification, then verification fails with a reason naming the provider state surface and `settings.json`, and the run halts at the next dispatch boundary.
Task ids: 9
Done when checks: conductor pi test: with a resolver exiting 1, the pi candidate settles setup-unavailable naming pi and `openrouter`, the fake pi invoke is never called, and the scratch lease is released | conductor pi test: with a failing resolver whose stderr contains `K`, no emitted event payload and no written HALT text contains `K` | conductor pi test: a successful pi dispatch's invocation argv and env contain no `K`, and after teardown its home directory and `auth.json` no longer exist and its lease is released | conductor pi test: a pi dispatch whose invoke fails, and one that is aborted, each still remove the home directory and its `auth.json` | conductor pi test: when the live Pi home's `settings.json` changes during a dispatch, `pendingLiveBoundaryHalt` is a reason containing `provider state` and `settings.json` and the next dispatch boundary writes the HALT marker, while a dispatch that changes only `sessions/` sets no pending halt
Missing assertion: verification fails with a reason naming the provider state surface and `settings.json`

Criterion: Story 2 negative: Given a pi self-host candidate whose dispatch is proven contained, when the operator edits `settings.json` in the live Pi home during the dispatch, then verification still fails naming `settings.json`, the same result a contained claude dispatch gets for a Claude `settings.json` edit.
Task ids: 6
Done when checks: live-boundary test: for provider pi, a provider-state change limited to added or changed `sessions/` entries, `models-store.json` and `auth.json` makes `verifyLiveBoundary` return ok | live-boundary test: for provider pi, a change to `settings.json` or `trust.json`, or an added `extensions/x.ts`, makes `verifyLiveBoundary` return not ok with a reason containing `provider state` and the changed path, under both an uncontained and a contained verdict | live-boundary test: for provider pi, an added root-level `sessions.json` makes `verifyLiveBoundary` return not ok | `PROVIDER_STATE_VOLATILE` is typed `Readonly<Record<SelfHostProviderId, readonly string[]>>`, so deleting its pi key fails `tsc`, and the claude and codex entries deep-equal the pre-change arrays
Missing assertion: the same result a contained claude dispatch gets for a Claude `settings.json` edit

Criterion: Story 4 negative: Given production source outside the catalog and provider adapters, when the structural provider-literal test runs, then no `homeVariable` comparison against `CODEX_HOME` or `CLAUDE_CONFIG_DIR` and no `environmentPrefix` comparison selects a self-host path.
Task ids: 11
Done when checks: provider-id-literals test: the new check reports a finding for an in-test fixture containing `provider.homeVariable === 'CODEX_HOME'` and one for `provider?.environmentPrefix === 'CODEX_'` | provider-id-literals test: the new check reports zero findings for `engine/conductor.ts`, `engine/self-host/provider-home.ts` and `engine/self-host/live-boundary.ts`
Missing assertion: no `homeVariable` comparison against `CODEX_HOME` or `CLAUDE_CONFIG_DIR` and no `environmentPrefix` comparison selects a self-host path
```

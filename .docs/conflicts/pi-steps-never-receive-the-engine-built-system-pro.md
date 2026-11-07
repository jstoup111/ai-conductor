# Conflict Check: Pi steps receive the engine-built system prompt (#3309)

**Date:** 2026-10-24
**New stories:** `.docs/stories/pi-steps-never-receive-the-engine-built-system-pro.md` (Stories 1 to 6)
**Result:** PASSED. Zero blocking conflicts; one degrading overlap, resolved.

## Inventory

- All 625 files in `.docs/stories/` were screened by subject (`append-system-prompt`,
  `systemPrompt` and "system prompt", provider runtime sets, plugin `llm_provider` contract,
  skipped-candidate telemetry, Pi argv and stdin). Pairs sharing a behavior with a new story were
  read in full and checked in both directions.
- Prior reports in `.docs/conflicts/` contain no recurring pattern for this area.

### ADRs examined (subject overlaps the new stories)

- `adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability`: the governing ADR. Stories 1 to 6 implement D1 to D6. No conflict.
- `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` (D1, D2, D5): D2's fail-closed, named refusal matches Story 4. Under D5, Pi "implements only `invoke`"; Story 1 adds a declaration property, not a dispatch member. No conflict.
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` (decisions 1, 2, 7): the guard intercepts `invoke` only, and a plugin still needs only `invoke` to load. No conflict.
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session`: a declared, fail-closed capability precedent. No conflict.
- `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability` (D1 as amended): Story 4's last negative path, which says a refusal does not record the provider as unavailable, keeps availability gate-owned. No conflict.
- `adr-2026-07-30-provider-preparation-lifecycle-supervision`: a capability refusal before process creation, with the same named-reason shape. No conflict.

### ADRs narrowed out

Every other APPROVED ADR in `.docs/decisions/` is unrelated to the subject: none touches provider
dispatch transport, provider capability declarations, or the plugin provider contract. Examples are
the memory provider ADRs (`adr-2026-06-29-*memory-provider*`), the scratch, cost, and transcript ADRs
(`adr-2026-08-09-worktree-local-provider-scratch`, `adr-2026-10-07-provider-cost-includes-failed-attempts`,
`adr-2026-10-10-retain-self-host-provider-transcripts`), and the live-tier ADRs
(`adr-2026-08-04-*`, `adr-2026-08-12-*`, `adr-2026-08-19-*`). None is fully superseded in a way
that affects this check.

## Pairs checked and found compatible

| New story | Existing story | Both directions hold? | Note |
|---|---|---|---|
| Story 1 | `harness-skills-and-context-files-reach-pi-sessions` Story 3 | yes | HARNESS.md stays the first `--append-system-prompt`, and its missing-file refusal is unchanged. "No `--append-system-prompt` added by this feature" for Claude and Codex is about that feature, and Claude's `--append-system-prompt-file` predates both. |
| Story 1 | `harness-skills-and-context-files-reach-pi-sessions` Stories 1 and 2 | yes | Stdin still begins with the Pi skill command, and skill resolution is untouched. |
| Story 1 | `pi-as-a-build-provider` Story 5 | yes | Print mode, no session, JSON mode, prompt on stdin: all unchanged. |
| Story 4 | `pi-as-a-build-provider` Story 2 | yes | The same refusal shape, naming the provider, the capability, and the recovery. |
| Story 4 | `daemon-build-review-can-wedge-before-provider-laun` Story TI-1 | yes | Lifecycle capability precedent; independent declarations. |
| Story 6 | `codex-fresh-session-per-step-contract` Story S2 | yes | Codex still receives the full step system prompt, `RETRY:` prefix included, ahead of the prompt. |
| Story 4 | `per-step-provider-routing-927` (custom plugins keep "pre-feature compatibility") | yes | That criterion is scoped to #927's own changes, not a standing guarantee. |
| Story 4 | `streaming-provider-dispatches-record-no-token-usag` Story 3 | yes, with a compromise (below) | |

## Conflict: An invoke-only plugin loads but cannot serve system-prompt dispatches

**Stories involved:** Story 4 (an undeclared provider is refused by name) vs `streaming-provider-dispatches-record-no-token-usag` Story 3 (the provider contract requires one dispatch member)
**Files:** `.docs/stories/pi-steps-never-receive-the-engine-built-system-pro.md` vs `.docs/stories/streaming-provider-dispatches-record-no-token-usag.md`
**Type:** overlap
**Severity:** degrading

**Description:** Story 3 keeps holding: an `llm_provider` plugin exporting only `invoke` still loads,
and `plugins/recorder-provider` still compiles and passes its tests. But nearly every engine
dispatch carries a system prompt, and under Story 4 an invoke-only plugin is refused on each of
them, so in practice such a plugin needs one more declaration to run steps. The reference plugin
`plugins/recorder-provider` records every option, `systemPrompt` included, so it does honor the
field, but it does not declare that it does.

**Resolution Options:**
1. Accept the compromise the operator chose on 2026-10-24 (undeclared plugins fail closed), and
   make the reference `recorder-provider` declare `systemPromptCapability` so it demonstrates the
   contract.
2. Warn and proceed for undeclared plugins. The operator rejected this during explore.
3. Require the declaration at plugin load. This contradicts the streaming story's "an `invoke`-only
   plugin loads successfully".

**Recommendation:** Option 1. It keeps both stories true, and the reference plugin then models the
declaration third-party authors must add.

**Resolution (operator, 2026-10-24):** Option 1. The compromise is accepted, and Story 4's Done
When now requires `plugins/recorder-provider` to declare `systemPromptCapability` with its existing
tests passing. A re-check after the edit found zero blocking conflicts.

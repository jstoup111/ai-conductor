# ADR: FINISH surfaces a failed guarded PR publish instead of reading it as unchanged prose

**Date:** 2026-10-24
**Status:** APPROVED
**Deciders:** Operator (scope, approach, ledger route, and assumptions confirmed during DECIDE for jstoup111/ai-conductor#3376)

## Context

FINISH's `author_pr_prose` transition dispatches a provider session that authors the PR title and
body and publishes them itself, through a guarded `pull-request.edit` request to the
`ai-conductor github-operation` CLI (adr-2026-08-01-engine-owned-resumable-finish-publication D4).
The coordinator then re-observes the PR; if the prose is still the engine placeholder after a pass
that completed, the fixed-point guard returns `human_required` /
`publication_transition_unmoved` ("left pr.prose unchanged at placeholder").

On 2026-10-23 feature `protected-artifact-halt-prints-no-recovery-command` (PR #3372) halted this
way twice. The provider had authored full prose, but the guarded edit failed (`gh pr edit` needs
`read:org`; the configured bot token had only `repo` and `workflow`). The CLI printed
`{"kind":"failed",...}` to the provider only. It emits `github_operation_refused` and
`github_write_credential_fallback` on its operator spine but nothing for a failed result
(verified: `github-operations-cli.ts`, `GithubOperationEventEmitter` admits only those two kinds).
The provider exited cleanly, so `authorProse` in `finish-publication-production.ts` treated the
pass as complete, and the halt named the wrong cause.

Forces:
- The provider runs `github-operation` as a separate OS process. Its operator spine
  (`startOperatorEventSpine(cwd)`) appends to the worktree `.pipeline/events.jsonl`, the same
  file the engine's `EventPersister` owns. adr-2026-08-08-pipeline-owned-closeout-timestamps D2
  requires one writer per ledger file, because `parseLedger` fails closed on any malformed line.
- The sibling ledger `.pipeline/pipeline-events.jsonl`, `CloseoutEventTail`, and
  `readMergedFeatureEvents` are the surviving out-of-process channel
  (adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry D2). Its admitted kinds are an
  explicit allowlist (adr-2026-08-13-stable-build-review-finding-dispositions decision 5;
  adr-2026-10-12 D3).
- The coordinator already maps a typed error thrown from an effect to a `human_required` reason
  (the region-restore errors in `advanceFinishPublication`'s author branch).
- Scope excludes the transport (`gh pr edit` stays), credential-fallback classification, and
  bot-credential scope documentation. The operator fixes the bot token's scopes directly.

## Options Considered

### Option A: CLI records the failure on the spine; the coordinator correlates it with the pass
- **Pros:** additive; D4 is unchanged; every guarded failure becomes visible to every spine consumer.
- **Cons:** correlation by PR target and pass window. A provider that never calls the CLI still
  reads as unchanged.

### Option B: the engine performs the publish from a provider handoff file
- **Pros:** the engine holds a typed result, so no correlation is needed.
- **Cons:** amends adr-2026-08-01 D4 and the FINISH authoring prompt. Disproportionate for a
  diagnostics-only scope. Rejected by the operator.

### Option C: write `github_operation_failed` directly to `events.jsonl`, as refused events do
- **Pros:** no allowlist change.
- **Cons:** a second process writing the engine's ledger, in breach of adr-2026-08-08 D2. Rejected
  by the operator after review.

## Decision

1. **A failed guarded operation is an event.** Add a `github_operation_failed` variant to the
   `ConductorEvent` union carrying `operation`, `target`, and `error`. When the `github-operation`
   CLI produces a `failed` result for any operation, it records this event. `error` is the failure
   text with any leading `Command failed: <argv>` prefix removed, so request payloads such as PR
   bodies are not echoed, and truncated to at most 1000 characters. It never contains the token,
   the token-file path, or the request argv. This keeps each record far below `PIPE_BUF`.
2. **The CLI writes it to the sibling ledger, not the engine ledger.** The event is appended to
   `.pipeline/pipeline-events.jsonl` under the CLI's working directory through the existing
   external event writer, and `github_operation_failed` joins the admitted external kinds. The
   session event tail re-emits it onto the live bus, so the engine's single writer persists it to
   `events.jsonl` and every bus consumer sees it. This amends adr-2026-10-12 D3's enumerated
   admitted set. The existing direct writes of `github_operation_refused` and
   `github_write_credential_fallback` are unchanged and out of scope.
3. **The authoring effect observes failures for its own pass on the bus.** Before dispatching the
   authoring provider, the production `authorProse` effect subscribes to the feature's
   `ConductorEventEmitter` for `github_operation_failed`. After the dispatch returns successfully,
   it flushes the feature's session event tail once, so every sibling-ledger record the provider
   appended is re-emitted onto the bus, and then unsubscribes. It never reads
   `.pipeline/pipeline-events.jsonl` itself; the tail stays that ledger's only reader. It selects
   the delivered events whose operation is `pull-request.edit` and whose target is this pass's pull
   request, in the same repository and with the same number. If any exist, it throws a typed
   publication-operation failure carrying the last such event's operation and error. With no
   subscribable emitter or no tail flush available, no failure is attributed.
4. **The coordinator halts with the real cause, after re-observation.** On that typed failure, the
   `author_pr_prose` branch re-observes the PR. If the prose moved off the placeholder, it advances
   as today, because re-observation stays authoritative. Otherwise it returns `human_required` with
   a new reason `publication_operation_failed`. Its message names the failed publish, its next
   action tells the operator to resolve the named failure and retry FINISH, and its detail carries
   the operation and error text. The existing halt rendering and the `finish_publication_disposition`
   and `loop_halt` events carry it to the spine. The pass is not treated as successful authoring,
   so the fixed-point guard never runs on it.
5. **The unchanged halt is untouched when no failure is recorded.** A pass that completes with no
   matching `github_operation_failed` record and leaves placeholder prose still returns
   `publication_transition_unmoved` with today's text. A dispatch that itself fails still follows
   the existing transient-retry path.
## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The FINISH provider runs `github-operation` with the feature worktree as its working directory, so its sibling-ledger write is the ledger the authoring effect reads | inferred | 85% | yes | The failure lands in another checkout and FINISH falls back to today's unchanged halt; no regression | APPROVED by operator 2026-10-24 |
| A2 | `gh` failure text never contains the bot token, because the token reaches `gh` through the environment and not argv | inferred | 90% | yes | A token could reach the spine; mitigated by the argv strip and 1000-character cap | APPROVED by operator 2026-10-24 |
| A3 | `provider_attempt.outcome` keeps meaning whether the provider ran; outcome 3 of #3376 is met by the coordinator no longer treating the pass as successful authoring | inferred | 80% | yes | Readers expecting `provider_attempt` to flip to failure would need a follow-up | APPROVED by operator 2026-10-24 |
| A4 | A recorded publish failure halts needs-human with the real error rather than retrying automatically | inferred | 85% | yes | A transient failure halts where a retry might succeed; today it halts anyway, with a wrong reason | APPROVED by operator 2026-10-24 |

## Consequences

### Positive
- The FINISH halt names the real publish failure, such as a missing-scope error, so no session-log
  dig is needed.
- Every failed guarded GitHub operation run by the CLI reaches the spine, the daemon log, and OTel
  through the existing tail.
- The engine ledger keeps one writer.

### Negative
- The admitted external set grows by one kind, and the tail now carries a non-build-review event.
- Correlation is by target and the subscription window around one dispatch. A provider that skips
  the CLI entirely still produces the unchanged halt.
- Refused and fallback events still write the engine ledger directly, a pre-existing D2 deviation
  left for a separate change.

### Follow-up Actions
- [ ] Amend adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry D3 to admit `github_operation_failed`.
- [ ] Consider moving `github_operation_refused` and `github_write_credential_fallback` to the sibling ledger (separate intake).

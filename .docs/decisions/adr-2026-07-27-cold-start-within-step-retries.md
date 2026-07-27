# ADR: Within-step retries cold-start; no session is ever resumed autonomously

**Date:** 2026-07-27
**Status:** APPROVED
**Supersedes:** §2 of `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
**Deciders:** James Stoup (operator), architecture review for issue #1071

## Context

Issue #325 made every executed step start a fresh session, but preserved one
exception: a step's own internal retries resume that step's session. The
2026-07-24 fresh-session-scope ADR ratified that exception in its §2:

> A budget-consuming retry or non-consuming recovery retry may resume the session
> created by the same provider for the current step.

That exception is live in three independent places today:

| Authority | Location | Expression |
|---|---|---|
| Provider session scope | `engine/provider-session.ts:46` | `resume: session.created` |
| Concurrent-group branch | `engine/group-core.ts:464-469` | `const resume = hasRun` |
| Legacy scalar path | `engine/step-runners.ts:529-530` | `resume = this.sessionStarted` |

`markCreated` fires on **every** non-skipped attempt, including a failed one
(`provider-execution.ts:401-409`), so attempt 2+ of a step dispatches into the failed
attempt's conversation. Retries are the dominant repeat operation in the
build↔build_review loop: the daemon-log analysis in #999 records 94 `build` and 75
`build_review` dispatches over five days across 28 features, one M-tier feature alone
accounting for 23 and 27.

Three facts shape the decision:

1. **Resume and identity are coupled.** `claude-provider.ts:649-653` sends
   `--session-id «id»` when `resume` is false. Suppressing the flag while keeping the
   id would dispatch against an identifier the CLI has already registered — precisely
   the condition `SESSION_IN_USE_RE` exists to catch (`claude-provider.ts:21-24`).
2. **The autonomous retry path is already self-contained.** `buildSystemPrompt`
   prefixes `RETRY: «reason»` to the **full** step system prompt
   (`step-runners.ts:1901-1903`), and the conductor supplies the reason
   (`conductor.ts:4076`). Nothing in the autonomous path depends on conversational
   recall.
3. **`runInteractive` is the one genuine exception.** It sends a 12-word stub prompt
   with an empty system prompt and `resume: true` (`step-runners.ts:1141-1166`). All
   of its failure context lives in the resumed conversation.

**Correction to the issue's framing.** #1071 assumes #903 is making Codex
cold-start-only. It is not: a repo-wide search returns zero hits for
`supportsSessionResume` or `coldStart`, and Codex resume (`codex exec resume «id»`)
is implemented and exercised by passing tests. The providers are not diverging today —
they are identically wrong.

## Decision

### 1. No autonomous dispatch ever resumes a session

Every autonomous provider invocation starts a fresh session with a **freshly minted
session identifier**. This holds for the first attempt of a step, for every retry of
that step, for every escalation rung, for every fallback candidate, for concurrent
group branch members, and for the legacy scalar path. There is no step-scoped,
provider-scoped, or branch-scoped exception.

### 2. Identity is minted per invocation, not per scope

Suppressing the resume flag without minting a new identifier is explicitly rejected —
it trades conversational contamination for a session-identifier collision. The two
change together or not at all.

### 3. Cold start is provider-neutral; no capability flag is introduced

Both Claude and Codex cold-start. A `supportsSessionResume` provider capability is
**rejected**: with no provider resuming there is no `true` case, so the flag would be
a two-valued abstraction with one reachable value, and it would preserve exactly the
provider-conditional wording this change exists to remove. If a future provider
genuinely needs resume, the flag can be introduced then, against a real second case.

### 4. Retry context comes from artifacts and the retry prompt

A retried attempt is entitled to everything it needs from committed artifacts on the
branch and from the `RETRY: «reason»` prefix on the full step system prompt. Work in
progress that exists **only** in a prior attempt's conversation is, by this decision,
not a supported input to a retry.

### 5. Interactive recovery cold-starts with explicit context

`runInteractive` receives the failure context as an explicit input and renders it into
its prompt. The stall-breaker (`conductor.ts:4783-4798`) and the recovery-menu
"interactive fix" (`conductor.ts:5806-5812`) must open on a session that states what
just failed and why. Cold-starting `runInteractive` without threading that context is
rejected as an operator-facing regression.

### 6. The stale/in-use recovery path survives with a narrower meaning

`SESSION_IN_USE_RE`, `STALE_SESSION_RE`, `CODEX_SESSION_EXPIRED_RE`, the
`sessionExpired` signal, and the non-budget-consuming `session_reset` recovery all
remain. Their meaning narrows from "a resumed conversation went stale" to "the CLI
rejected the identifier we minted". That condition is still reachable — identifier
collision, external interference, a torn-down self-host home — and must not silently
become a hard failure.

### 7. Telemetry correlation is unaffected

`conductor.run.id` resolves from `.pipeline/conduct-session-id`
(`engine/otel/resource.ts:46-55`), which is written from the step runner's own
`this.sessionId` and never by `ProviderSessionScope`. Per-invocation provider session
identity therefore does not churn the run id. Any implementation that would begin
writing per-invocation provider identifiers to that file is out of contract.

## Consequences

**Positive**

- A failed attempt's reasoning cannot bias its own retry — the isolation #325 sought at
  step boundaries now holds inside a step.
- Compaction risk from resuming a long transcript is removed.
- Claude and Codex retry semantics become describable in one sentence with no provider
  qualifier, satisfying the documentation outcome by construction rather than by
  editing prose.
- Token cost per retry plausibly **falls**: a resume re-sends the failed attempt's whole
  transcript; a cold start sends only the step prompt. This is a prediction, not a
  measured result — see Risks.

**Negative / accepted costs**

- `ProviderSession.created` and `markCreated` lose their only decision-making consumer.
  They are retained or deleted at implementation discretion, but must not silently
  keep driving a resume.
- `forceFreshSession` (`provider-execution.ts:376`) becomes a subset of the default.
  Its regression test must survive even if the parameter does not.
- Roughly a dozen tests pin the removed behavior as intended and must be inverted
  rather than deleted — notably
  `per-step-provider-routing-927.acceptance.test.ts:962-964`,
  `retry-as-escalation.acceptance.test.ts:332-342`,
  `provider-session.test.ts:178-195`, and
  `provider-execution.test.ts:164`.
- Three documents assert the superseded contract in prose and must be updated in the
  same change: this ADR's predecessor §2, `.docs/stories/fresh-session-per-step.md`,
  `.docs/stories/per-step-provider-routing-927.md` ST-927-7, and `HARNESS.md:237-241`.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A retry that previously succeeded only because it recalled prior-attempt state now fails | High | Decision 4 makes artifact-sourced context the contract; acceptance coverage must prove a cold retry completes work the resumed retry completed |
| Partial fix — one of the three resume authorities is missed | High | All three are enumerated in Context and must each carry a test |
| Interactive recovery regresses to a context-free stub | Medium | Decision 5; the two call sites must supply context |
| `sessionExpired` recovery is deleted as "dead" | Medium | Decision 6 states it survives |
| Token cost rises instead of falling | Low | Predicted direction only; measure rather than assume, and do not gate the change on it |

## Alternatives considered

**Reset at the retry boundary (call `sessions.replace()` before each retry).**
Rejected. `replace()` already mints a fresh id and returns `resume: false`, so this is
the smallest possible diff and needs no new machinery. But it leaves `prepare()`'s
resume-by-default alive, so correctness depends on every present and future retry site
remembering to call `replace()` first. This repository's stated design principle
prefers machinery that makes the mistake unrepresentable over discipline that must be
re-applied at each call site; resume-by-default is exactly such a trap.

**Provider capability flag `supportsSessionResume`, set false for Claude.**
Rejected — see Decision 3. This was the filer's leading hypothesis. It survives review
only if some provider is expected to keep resuming, and the operator's recorded
position is that neither should.

**Suppress the resume flag only, keep the scope-stable session id.**
Rejected — see Decision 2. This is the trap Finding 1 of the issue identifies.

**Do nothing; document the exception as intended.**
Rejected. The exception was inherited rather than chosen for the retry case, and the
volume evidence (~169 repeat dispatches in five days) makes it the common path rather
than an edge case.

## Assumption ledger

| Assumption | Basis | Confidence | Impact if wrong |
|---|---|---|---|
| Attempt 2+ of a Claude step resumes today | Read `provider-session.ts:44-47`, `provider-execution.ts:401-409`, `claude-provider.ts:649-653`; pinned by `per-step-provider-routing-927.acceptance.test.ts:963` | 98% | None — the change is a no-op if false |
| Reusing an id with `--session-id` triggers the CLI's "already in use" lock | Inferred from `SESSION_IN_USE_RE`'s own comment; not reproduced at runtime | 85% | Decision 2 is belt-and-braces rather than required; harmless either way |
| No autonomous step depends on conversational recall across attempts | Read `buildSystemPrompt:1901-1903` (full prompt re-sent) | 90% | A cold retry could fail where a resumed one succeeded — the primary risk above |
| Neither provider should resume (provider-neutral scope) | Recorded operator position: fresh sessions for both Claude and Codex, resume risks compaction, Ralph-loop isolation preferred | 90% | If Codex should keep resuming, Decision 3 reverses and the capability flag returns |
| #903 has not landed | Repo-wide search: zero hits for `supportsSessionResume`, `coldStart`, `#903` | 97% | Scope overlap with an in-flight change |
| `conduct-session-id` is not written by the provider scope | Read `otel/resource.ts:46-55` against all write sites (`step-runners.ts:659, 926, 1137`) | 95% | Telemetry correlation would break; Decision 7 makes this a testable contract |

**Merge-time checkpoint on row 4 (provider-neutral scope).** Decision 3 makes
**Codex** cold-start too, which is work #903 was opened to decide. It rests on the
operator's recorded position rather than on a confirmation given for this issue, so it
is called out explicitly for the spec-PR review: merging this spec ratifies it. If the
operator wants Codex held back, Decision 3 reverses to a Claude-only change, the
capability flag returns, and #903 must be sequenced first. Recommendation: proceed
provider-neutral and close #903 as resolved by this change.

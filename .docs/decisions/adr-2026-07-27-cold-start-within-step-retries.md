# ADR: Claude declares no resume — the harness never resumes any session

**Date:** 2026-07-27
**Status:** APPROVED
**Depends on:** `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` (issue #903,
spec PR #1069) — **#1069 must merge before this feature builds**
**Completes:** §2 of `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
**Deciders:** James Stoup (operator), architecture review for issue #1071

## Context

### Where #1069 leaves the harness

#1069 makes session resume a **declared provider capability**:

- `supportsSessionResume: boolean` is added to the `LLMProvider` contract, fail-closed — an
  adapter that does not declare it is treated as non-resuming.
- `CodexProvider` declares `false`, and the `['exec', 'resume', sessionId]` branch is deleted
  from its `buildArgs`, so **a Codex resume argv is not constructable**.
- `ClaudeProvider` declares `true` — behavior deliberately unchanged.
- `runProviderInvocation` gates on the capability and emits a `session_policy` diagnostic when
  it suppresses a resume.

#1069 names the resulting state precisely in its own Consequences: *"Claude and Codex now
behave differently on within-step retries (resume vs cold start)."* It defers the Claude flip
to this issue and records that #1071 depends on it.

**This ADR closes that divergence.** The operator's end state is a fresh session for **both**
Claude and Codex on every iteration. #1069 delivers half of it; this delivers the other half
and the machinery that makes the flip actually safe.

### Why this is not a one-line flag flip

#1069's own deferral note records the first two findings; the third emerged in review.

1. **Suppressing the flag without minting a new id collides.**
   `ProviderSessionScope.prepare()` returns the *scope-stable* id
   (`provider-session.ts:44-47`), and #1069 explicitly declines to change it (plan non-goal:
   *"Do not change `ProviderSessionStore` id minting or scoping"*). `claude-provider.ts:649-653`
   sends `--session-id «id»` whenever `resume` is false. So the moment Claude declares `false`,
   attempt 2 dispatches `--session-id` against an id the CLI already registered — the exact
   condition `SESSION_IN_USE_RE` exists to catch (`claude-provider.ts:21-24`). Every Claude
   retry would burn a `session_reset` recovery cycle.

   This is why the capability flip and per-invocation id minting are one change, not two.

2. **`runInteractive` has no context outside the session.** It sends a 12-word stub prompt with
   an *empty* system prompt and `resume: true` (`step-runners.ts:1141-1166`). Its two callers —
   the stall-breaker (`conductor.ts:4785`) and the recovery-menu "interactive fix"
   (`conductor.ts:5808`) — are both operator-facing. Cold-starting it as-is would hand the
   operator a context-free stub.

3. **The capability gate does not cover every dispatch path.** #1069's Decision 2 states that
   `runProviderInvocation` "becomes the single place resume is decided". That holds only when
   `providerRuntimes` is configured. Verified otherwise:

   | Path | Location | Resume expression | Reaches the gate? |
   |---|---|---|---|
   | Provider-aware | `provider-execution.ts:397` | capability-gated after #1069 | Yes |
   | Concurrent-group branch (scalar) | `group-core.ts:464-469` | `const resume = hasRun` | No |
   | Legacy scalar | `step-runners.ts:529-530` | `resume = this.sessionStarted` | No |

   `step-runners.ts:613` returns into `runProviderAwareNormal` **only** when
   `this.providerRuntimes` is set and no branch session id was supplied; otherwise dispatch
   falls through to `provider.invokeInteractive` at `:630` with the locally-computed `resume`,
   never entering `provider-execution.ts`. `group-core.ts` feeds that same path via
   `branchSessionId`. #1069's architecture review cites `group-core.ts:438-444` as evidence
   that all paths funnel through the gate; that is an over-claim, and it is recorded here as a
   finding against both specs rather than left implicit.

### The enabling fact

The autonomous retry path does not depend on conversational recall.
`buildSystemPrompt(step, autonomous, retryReason)` prefixes `RETRY: «reason»` to the **full**
step system prompt (`step-runners.ts:1901-1903`), with the reason supplied at
`conductor.ts:4076`. A cold-started retry receives strictly more context than a resumed one
relying on recall. #1069 reaches the same conclusion independently.

## Decision

**Claude declares `supportsSessionResume: false`, resume becomes unconstructable for every
adapter, and no dispatch path can request one.**

### 1. Claude declares no resume, and its resume argv is deleted

`ClaudeProvider.supportsSessionResume` becomes `false`. The `--resume` branch is removed from
`buildArgs` (`claude-provider.ts:649-653`), leaving `--session-id «id»` unconditionally.

This mirrors exactly what #1069 did to Codex: the invariant becomes **structural**, not a
runtime check a future call site could bypass. After this change neither adapter can construct
a resume invocation.

### 2. Session identity is minted per invocation

`ProviderSessionScope.prepare()` mints a fresh id on every call and returns `resume: false`.
This is the companion #1069 deliberately left out of scope, and without it Decision 1 trades
conversational contamination for a session-identifier collision. The two ship together.

`ProviderSessionStore` keeps its scoping and audit-correlation behavior; only the *stability*
of the id within a step scope changes.

### 3. The two ungated dispatch paths are closed at their own source

`group-core.ts:464-469` and `step-runners.ts:529-530` compute `resume` without consulting the
capability, because they never reach `provider-execution.ts`. Each is changed to dispatch
`resume: false` with a freshly minted id. A fix confined to the capability gate would leave
both live.

### 4. `supportsSessionResume` is retained, with no `true` case

Both adapters now declare `false`. The flag is **kept**, not deleted:

- it is the fail-closed contract point #1069 established (an adapter that does not declare it
  is non-resuming), so it keeps adapters added later correct by default;
- removing a seam one feature after it lands is churn, and a declared constant costs one line
  per adapter.

What is deleted instead is the *ability to act on it*: with both `buildArgs` resume branches
gone (Decision 1 here and #1069's Decision 3), a `true` declaration could not produce a resume
argv anyway. The flag documents the invariant; the adapters enforce it.

Consequently `ProviderSession.created`, `markCreated`, and `forceFreshSession` lose their only
decision-making consumers. They are evaluated for deletion **after** the guard tests in
Decision 6 are green, never before.

### 5. Interactive recovery cold-starts with explicit context

`runInteractive` receives the failure context as an explicit input and renders it into its
prompt. The stall-breaker and the recovery-menu "interactive fix" must open on a session that
states what just failed and why. `retryHint` (`conductor.ts:4076`) already carries exactly this
content. Cold-starting `runInteractive` without threading it is rejected as an operator-facing
regression.

### 6. The stale/in-use recovery path survives with a narrower meaning

`SESSION_IN_USE_RE`, `STALE_SESSION_RE`, `CODEX_SESSION_EXPIRED_RE`, the `sessionExpired`
signal, and the non-budget-consuming `session_reset` recovery all remain. Their meaning narrows
from "a resumed conversation went stale" to "the CLI rejected the identifier we minted" — still
reachable via identifier collision, external interference, or a torn-down self-host home.

#1069's `session_policy` diagnostic is retained and its meaning widens: it now reports a
suppressed resume for either provider, which after this change is every dispatch. The
implementation must confirm it stays once-per-step, as #1069 specifies, rather than becoming
per-invocation log spam.

### 7. Telemetry correlation is unaffected

`conductor.run.id` resolves from `.pipeline/conduct-session-id` (`otel/resource.ts:46-55`),
written only from the step runner's own `this.sessionId` (`step-runners.ts:659, 926, 1137`) and
never by `ProviderSessionScope`. Per-invocation provider identity does not churn the run id.
Any implementation that begins writing per-invocation provider identifiers to that file is out
of contract.

## Consequences

**Positive**

- **The end state is reached:** after #1069 and this feature, no session is ever resumed, for
  either provider, on any dispatch path. Every iteration starts clean.
- The divergence #1069 explicitly named is closed, and the contract becomes describable in one
  provider-neutral sentence.
- A failed attempt's reasoning cannot bias its own retry — the isolation #325 sought at step
  boundaries now holds inside a step.
- Compaction risk from resuming a long transcript is removed, which is the operator's stated
  reason for wanting this.
- Token cost per retry plausibly **falls**: a resume re-sends the failed attempt's whole
  transcript; a cold start sends only the step prompt. A prediction, not a measured result.

**Negative / accepted costs**

- This feature cannot build until #1069 merges. Building against `main` would have to invent
  #1069's capability, duplicating it and guaranteeing a conflict.
- `ProviderSession.created`, `markCreated`, and `forceFreshSession` become vestigial.
- `supportsSessionResume` is retained with no reachable `true` case — accepted in Decision 4.
- Roughly a dozen tests pin Claude's resume as intended and must be **inverted**, not deleted.
  #1069 amends the Codex half of several of the same files and explicitly instructs
  "Amend, never delete — each test also carries the Claude invariant". This feature amends that
  surviving Claude half, so the two changes touch the same files in sequence.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Merge order inverted — this builds before #1069 | High | Dependency stated here, in the plan's prerequisites, and in the PR body; the plan's first task asserts the capability already exists and halts if not |
| A retry that previously succeeded only via prior-attempt recall now fails | High | The retry prompt is the full system prompt with `RETRY:`; a dedicated acceptance task proves a cold retry completes from committed artifacts |
| Partial fix — one of the three dispatch paths is missed | High | All three enumerated in Context; each carries its own story and test |
| Interactive recovery regresses to a context-free stub | Medium | Decision 5; both call sites must supply context |
| `sessionExpired` recovery deleted as "dead" | Medium | Decision 6; guard tests land before any cleanup |
| `session_policy` becomes per-invocation log spam | Low | Once-per-step, as #1069 specifies; asserted in test |
| Token cost rises instead of falling | Low | Predicted direction only; measure, do not gate on it |

## Alternatives considered

**Delete `supportsSessionResume` entirely once both providers are false.**
Rejected — Decision 4. With both `buildArgs` resume branches gone the flag cannot produce a
resume, so it costs one declared constant per adapter and preserves #1069's fail-closed default
for adapters added later. Removing a seam one feature after it lands is churn.

**Flip the flag only, leave `prepare()` minting alone.**
Rejected — Decision 2, finding 1. It trades conversational contamination for a session-id
collision on every Claude retry, converting a correctness bug into one that burns a recovery
cycle per attempt.

**Fix only the capability gate and trust #1069's "single place resume is decided".**
Rejected — Decision 3, finding 3. Two dispatch paths never reach `provider-execution.ts`.

**Fold this into #1069 as one feature.**
Rejected. #1069 is authored, APPROVED, and mergeable now; reopening it to absorb the id-minting,
`runInteractive`, and ungated-path work would delay a change that is correct and shippable on
its own. Sequencing also isolates the risk — if cold-started Claude retries regress, the Codex
fix is already banked.

**Do nothing; accept the divergence #1069 names.**
Rejected. The operator's end state is fresh sessions for both providers on every iteration;
#1069 states it defers this rather than declining it.

## Assumption ledger

| Assumption | Basis | Confidence | Impact if wrong |
|---|---|---|---|
| #1069 merges before this builds | Operator-controlled merge order; stated as a hard prerequisite | 85% | Build invents a duplicate capability and conflicts — the top risk above |
| Claude attempt 2+ resumes today | Read `provider-session.ts:44-47`, `provider-execution.ts:401-409`, `claude-provider.ts:649-653`; pinned by `per-step-provider-routing-927.acceptance.test.ts:963`, which #1069 explicitly preserves | 98% | None — no-op if false |
| Reusing an id with `--session-id` trips the CLI's "already in use" lock | Inferred from `SESSION_IN_USE_RE`'s own comment; not reproduced at runtime | 85% | Decision 2 becomes belt-and-braces rather than required; harmless |
| No autonomous step depends on conversational recall across attempts | Read `buildSystemPrompt:1901-1903`; #1069 reaches the same conclusion independently | 92% | A cold retry could fail where a resumed one succeeded — primary risk |
| `group-core.ts` and `step-runners.ts` scalar paths bypass the capability gate | Read `step-runners.ts:613` (returns to `runProviderAwareNormal` only when `providerRuntimes` is set and no `branchSessionId`), then `:630` legacy dispatch | 90% | If they do reach the gate, Decision 3's tasks are no-ops — cheap either way, and the tests still document the invariant |
| `conduct-session-id` is not written by the provider scope | Read `otel/resource.ts:46-55` against all write sites | 95% | Telemetry correlation breaks; Decision 7 makes it a testable contract |

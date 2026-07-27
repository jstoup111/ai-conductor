# Architecture Review: Cold-Start Within-Step Retries (#1071)

**Date:** 2026-07-27
**Tier:** M (lightweight review)
**Verdict:** APPROVED with three mandatory conditions
**ADR:** `adr-2026-07-27-cold-start-within-step-retries` (APPROVED)

## What was reviewed

The proposal to stop resuming a prior attempt's provider session on within-step
retries, against the current implementation in `src/conductor` and against the
contract asserted by `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
§2, `HARNESS.md:237-241`, and two accepted stories.

## Findings

### F1 — The issue understates the blast radius: there are three resume authorities, not one (blocking, resolved by scope expansion)

The issue names `ProviderSessionScope.prepare()`. Two further paths compute resume
independently and would keep resuming after a fix confined to `provider-session.ts`:

- `engine/group-core.ts:464-469` — `const resume = hasRun`, used for concurrent-group
  branch members when no `providerSessions` scope is supplied.
- `engine/step-runners.ts:529-530` — `resume = this.sessionStarted`, the legacy scalar
  path backed by `.pipeline/session-created` and `execution/session.ts:83-90`.

All three flip on the same trigger — *this step has dispatched at least once*. A
single-authority fix produces a partial, hard-to-observe result. **Condition: each
authority carries its own story and its own test.**

### F2 — The issue's premise about #903 is false (blocking, corrected)

The issue states Codex "is being made cold-start-only by #903", framing this as a
Claude-only correction that removes a divergence. #903 has not landed: repo-wide search
returns zero hits for `supportsSessionResume`, `coldStart`, or `#903`, and Codex resume
is implemented (`codex-provider.ts:495-516`) and exercised by passing tests
(`codex-provider.test.ts:160,269,735,759,780,914`). The providers are not diverging —
they behave identically and both resume.

This inverts the recommended shape. A Claude-only fix would *create* the divergence the
issue wants removed. **Condition: the change is provider-neutral**, which is what makes
the "described identically" outcome reachable without provider-conditional prose.

### F3 — The filer's leading hypothesis is rejected on merit (advisory)

Hypothesis 1 proposed a `supportsSessionResume` capability with Claude set false. Given
F2, both providers end up false, so the flag would have no reachable `true` case. A
two-valued abstraction with one live value adds a branch, a test axis, and a
provider-conditional sentence in the docs — the exact artifact the issue asks to
delete. Rejected; reintroduce it only against a real second case.

### F4 — Resume suppression and identity minting are one change, not two (blocking, accepted into the ADR)

`claude-provider.ts:649-653` selects `--resume «id»` versus `--session-id «id»` on the
flag alone. Setting `resume: false` while `prepare()` returns the scope-stable id would
dispatch `--session-id` against an id the CLI already registered. `SESSION_IN_USE_RE`
(`claude-provider.ts:21-24`) exists for precisely that condition. The filer's finding is
correct and is now ADR Decision 2.

Confidence that the CLI actually rejects the reused id: 85%, inferred from that regex's
own comment, not reproduced. The coupling is worth making explicit regardless — if the
CLI tolerates the reuse, minting per invocation is merely redundant, not harmful.

### F5 — `runInteractive` is a real regression risk and needs its own story (blocking)

`step-runners.ts:1141-1166` sends `Fix issues from the failed «step» step, then exit
when done.` with an empty system prompt and `resume: true`; the provider-aware branch
passes no `providerSessions`, so it inherits the step scope's `created`. All of its
context lives in the conversation it resumes. Its two callers
(`conductor.ts:4785` stall-breaker, `conductor.ts:5808` recovery menu) are both
operator-facing and non-auto.

Cold-starting it without threading context degrades the operator's recovery from "a
session that knows what failed" to "a stub with no information". `retryHint` already
exists at `conductor.ts:4076` in the right shape. **Condition: this is a separate story
with its own acceptance criteria, and it must not be folded into the mechanical change.**

### F6 — Telemetry correlation is not at risk (advisory, closes an issue concern)

The issue flags `.pipeline/conduct-session-id` as load-bearing for `conductor.run.id`
(`otel/resource.ts:46-55`). Verified: that file is written only from the step runner's
own `this.sessionId` (`step-runners.ts:659, 926, 1137`), and `ProviderSessionScope`
never writes it. Per-invocation provider identity does not churn the run id. Recorded as
ADR Decision 7 so a future implementation cannot quietly start writing provider
identifiers there.

### F7 — The `sessionExpired` recovery path must not be swept up as dead code (advisory)

With no resume, `STALE_SESSION_RE` / `SESSION_IN_USE_RE` / `CODEX_SESSION_EXPIRED_RE`
lose their most common trigger and will look dead to a cleanup pass. They are not: an
id collision, external interference, or a torn-down self-host home still reaches them,
and `session_reset` recovery is non-budget-consuming, which matters for retry
accounting. ADR Decision 6.

### F8 — Roughly a dozen tests pin the removed behavior as intended (advisory, feeds the plan)

These assert the old contract deliberately and must be **inverted**, not deleted —
deleting them removes the regression guard:

- `per-step-provider-routing-927.acceptance.test.ts:962-964, 365-368`
- `retry-as-escalation.acceptance.test.ts:332-342, 353-377`
- `provider-session.test.ts:178-195` (the expected-table)
- `provider-execution.test.ts:164` (`'still resumes within a step…'`)
- `step-runners.test.ts:791/843-844, 1472/1481-1482, 1671-1698, 2333/2351-2353`
- `session.test.ts:89` (`'returns --resume when session has been created'`)

`provider-execution.test.ts:116` (self-host never resumes) should survive unchanged as a
guard on the general behavior even if `forceFreshSession` itself is deleted.

## Alignment with repository design principles

**Deterministic where possible.** The change replaces a resume-by-default that must be
suppressed correctly at each call site with a cold-start-by-construction that has no
suppression to forget. This is why the smaller "call `replace()` before each retry"
alternative was rejected despite its smaller diff — it preserves the trap.

**No provider-conditional prose.** Provider-neutral scope removes the divergence rather
than documenting it.

## Conditions on APPROVED

1. All three resume authorities (F1) are addressed, each with its own test.
2. Session identity is minted per invocation together with resume suppression (F4) —
   never the flag alone.
3. `runInteractive` gains explicit failure context before it cold-starts (F5).

## Open question for the operator (merge-time)

Provider-neutral scope makes **Codex** cold-start too, overlapping #903's stated remit.
This rests on the operator's recorded preference for fresh sessions on both providers
rather than a confirmation given for this issue. Merging the spec PR ratifies it.
Recommendation: proceed provider-neutral, close #903 as resolved by this change.

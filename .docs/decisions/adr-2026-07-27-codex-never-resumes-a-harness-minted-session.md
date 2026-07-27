# ADR: Codex never resumes — session resume becomes a declared provider capability

Status: APPROVED
Date: 2026-07-27
Refs: jstoup111/ai-conductor#903, #325, #759, #1042, #1041

## Context

#325 made the conductor start **every executed step** on a fresh LLM session
(`conductor.ts:3544-3560` → `stepRunner.resetSession(step.name)` →
`ProviderSessionStore.beginStep`). It preserved one exception: a step's **own internal retries**
resume that step's session. That exception is implemented in `ProviderSessionScope.prepare()`,
which returns `resume: session.created` (`provider-session.ts:43-45`) — false on the first
invocation of a step, true on every subsequent one.

#903 asks whether Codex satisfies that contract. It does not, and cannot as written:

1. **The harness session id is not a Codex thread id.** `ProviderSessionStore` mints a `uuidv4`
   (`provider-session.ts:34`). Codex rollout ids are `uuidv7` and are minted *by Codex*.
   `codex exec` (0.145.0) exposes no flag to pre-register a caller-supplied id. So
   `codex exec resume <harness-uuid>` (`codex-provider.ts:496-498`) can never resolve — verified
   in #1042 against `codex exec --help` / `codex exec resume --help`.
2. **The failure is absorbed by a stdout regex, not prevented.**
   `CODEX_SESSION_EXPIRED_RE` (`codex-provider.ts:24`) matches `no rollout found` /
   `thread/resume failed`, sets `sessionExpired`, and the conductor resets and retries without
   burning budget (`conductor.ts:3980-3997`). Correct-by-accident: every Codex retry spends a
   real provider invocation discovering something knowable before dispatch, and the recovery
   depends on matching provider error strings — brittle across Codex versions.
3. **The #1041 hotfix narrowed the blast radius, not the cause.** `forceFreshSession` is threaded
   at exactly one call site (`provider-execution.ts:546`, self-host only). Non-self-host Codex
   dispatch still requests resume. #1042 explicitly asks for resume eligibility to be enforced
   *structurally*, not by a flag threaded through one seam.

Independently, the operator has directed that **provider session resume is not wanted at all**,
for Claude or Codex: resumed sessions carry compaction risk (a resume may reintroduce lossy
summarized context), and the desired execution model is Ralph-loop-style isolation — every
attempt starts clean so a prior attempt's dead-end reasoning cannot pollute the next.

The enabling fact that makes "no resume" safe for retries: the retry path does **not** rely on
session memory. `buildSystemPrompt(step, autonomous, retryReason)` prefixes `RETRY: <reason>` to
the **full** step system prompt (`step-runners.ts:1819`, `:1901`). A cold-start retry therefore
receives strictly more context than a resumed one relying on conversational recall.

## Decision

**Session resume becomes a declared provider capability, and Codex declares it unsupported. The
Codex adapter loses the ability to construct a resume invocation at all.**

Concretely:

1. Add `supportsSessionResume: boolean` to the `LLMProvider` contract (`llm-provider.ts`).
   `ClaudeProvider` declares `true` (behavior unchanged). `CodexProvider` declares `false`.
2. `runProviderInvocation` (`provider-execution.ts:386-400`) becomes the single place resume is
   decided:
   `resume = provider.supportsSessionResume && !forceFreshSession && session.resume`.
   Capability is fail-closed: an adapter that does not declare the field is treated as
   non-resuming.
3. Delete the `['exec', 'resume', options.sessionId]` branch from `CodexProvider.buildArgs`
   (`codex-provider.ts:496-498`). After this, a Codex resume argv is not constructable — the
   invariant is structural, not a runtime check that a future call site could bypass.
   The `--cd` suppression that existed only to accommodate the resume form
   (`codex-provider.ts:511`) goes with it, so Codex always receives an explicit working root.
4. When the capability gate suppresses a resume the engine emits a `session_policy` diagnostic
   naming the provider and the step, once per step, so a cold-start retry is legible in the
   audit trail rather than silent.
5. `ProviderSessionStore` keeps minting and scoping ids. For Codex the id is no longer a resume
   handle — it stays as the log/audit correlation key for the step's invocations, and
   `markCreated` keeps its meaning for resuming providers.

### Amends prior decisions

This ADR **supersedes in part** `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
§2 ("Retries resume only within the same step and provider"). That clause permitted a within-step
retry to resume the session created by the same provider for the current step, unqualified by
provider. It is now qualified: a within-step retry may resume only when the owning provider
declares `supportsSessionResume`. The rest of that ADR — step-scoped isolation, no cross-step or
cross-provider resume, fallback-provider scoping, legacy-marker handling — stands unchanged, and
this decision strengthens rather than weakens it. Note that the same ADR (line 22) already
observed that a Claude-created session identifier cannot be resumed by Codex; this decision
carries that observation to its conclusion.

## Alternatives considered

- **Make Codex resume actually work** — read Codex's real rollout id back from the invocation
  and resume with it. Rejected: it is the direction the operator has explicitly ruled out, it
  requires persisting the isolated provider home across invocations (an open question owned by
  #1042), and it buys continuity that the retry path does not need because the prompt is already
  self-contained.
- **Have the Codex adapter silently ignore `options.resume`.** Rejected: the engine would still
  believe the session was resumed, `markCreated` bookkeeping and diagnostics would lie, and
  nothing would prevent the argv from being reintroduced.
- **Keep threading `forceFreshSession` at every Codex call site.** Rejected: this is precisely
  the shape #1042 names as inadequate. Coverage depends on remembering the flag at each new call
  site — the failure mode that produced #1041 in the first place.
- **Remove resume for Claude in the same change.** Deferred, not rejected. It matches the
  operator's stated end state, but Claude's resume mechanism is functional and removing it
  changes token cost and behavior on the default execution path. Making it a declared capability
  is exactly the seam that lets Claude flip later as its own change with its own evidence; this
  feature does not flip it. Filed as follow-up.

## Consequences

- **Positive.** Codex retries stop burning a provider invocation per attempt to discover an
  unresolvable thread id. Recovery no longer depends on matching Codex error strings. The
  fresh-session-per-step guarantee from #325 becomes true for Codex at *invocation* granularity,
  not just step granularity. #759 gains a settled session contract instead of an open question.
- **Negative / accepted.** Codex retries re-send the full step prompt, so a retry costs full
  input tokens rather than an incremental turn. This is the intended trade — #325 already
  accepted exactly this cost at step boundaries for uncontaminated reasoning, and for Codex the
  "cheaper" alternative never actually worked.
- **Neutral.** `CODEX_SESSION_EXPIRED_RE` and the conductor's `sessionExpired` branch remain.
  They can no longer be triggered by our own resume request; retiring them is deliberately out
  of scope and left to #1042, which owns the broader session-identity question.
- **Divergence, named.** Claude and Codex now behave differently on within-step retries (resume
  vs cold start). That divergence is declared in the interface rather than implicit, and is
  expected to disappear when Claude follows.

## Assumptions

| Assumption | Confidence | Basis | Impact if wrong | How to confirm |
|---|---|---|---|---|
| `codex exec` still exposes no way to pre-register a caller-supplied session id | 90% | Verified in #1042 against `codex exec --help` / `codex exec resume --help` at Codex 0.145.0 | If a future Codex adds one, "no resume" remains an operator *preference* rather than a necessity — the decision holds, the rationale narrows | Re-run `codex exec --help` in the smoke test |
| Every retry path re-sends the full system prompt (no delta-only dispatch) | 95% | Read directly: `step-runners.ts:550`, `:1819`, `:1901` — `RETRY:` is prefixed to the whole prompt | A delta-only path would lose context on Codex cold starts | Story 2's fake-provider test asserts the retry prompt contains the full step prompt |
| No non-dispatch consumer depends on the Codex `exec resume` argv branch | 85% | `grep` over `src/conductor/src` finds the branch only in `buildArgs` | A hidden consumer breaks at build time (TypeScript), not at runtime | `tsc` + full suite in Task 8 |
| Resume is unwanted for both providers, Codex first | operator-directed | Recorded operator direction, 2026-07-27 (compaction risk; Ralph-loop isolation) | If resume is later wanted for Codex, the capability field is the flip point — no rework | Operator review of this ADR |

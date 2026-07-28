# Architecture Review: Codex fresh-session-per-step contract (#903)

**Date:** 2026-07-27
**Tier:** M — lightweight review
**Stories reviewed:** `.docs/stories/codex-fresh-session-per-step-contract.md` (S1–S4)
**Decision recorded:** `adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md` (APPROVED)
**Verdict:** APPROVED — feasible, correctly scoped, no blocking concerns.

## Feasibility

All four stories land on seams that already exist and are exercised by the current suite.

| Story | Seam | Feasible? |
|---|---|---|
| S1 resume suppression | `LLMProvider` (`llm-provider.ts:148-165`), `runProviderInvocation` (`provider-execution.ts:384-411`), `CodexProvider.buildArgs` (`codex-provider.ts:495-516`) | Yes. Resume is already computed at exactly one line (`:397`); adding a capability conjunct is a one-line change plus two adapter declarations. |
| S2 retry cold-start | `step-runners.ts:550`, `:1819`, `:1901` | Yes, and requires **no code change** — the retry prompt is already the full system prompt with a `RETRY:` prefix. This story is verification, not construction. |
| S3 diagnostic | the existing tracked-event emitter used for `session_reset` (`conductor.ts:3980-3984`) | Yes. Same emitter, new event type. Once-per-step dedup needs a small scope-local flag. |
| S4 coverage | `test/execution/llm-provider-contract.test.ts`, `conductor.test.ts:9082-9245`, `per-step-provider-routing-927.acceptance.test.ts:922-973`, `test/execution/codex-provider.smoke.test.ts` | Yes. The smoke lane and its `CODEX_CLI_SMOKE_TEST=1` + binary-probe gate already exist. |

## Architectural alignment

- **Deterministic over prompt discipline** (repo Design Principle). The chosen mechanism is a
  typed capability plus argv deletion — the invalid invocation becomes unconstructable rather
  than merely discouraged. This is the correct class of fix; the rejected alternative (thread
  `forceFreshSession` at each call site) is the prompt-discipline analogue and is exactly what
  failed to hold in #1041.
- **Single seam.** `runProviderInvocation` is the only place resume is decided, and every
  dispatch path reaches it — main step dispatch (`step-runners.ts:678-755`), concurrent-group
  branches (`group-core.ts:438-444`, `:529-530`), and one-shot lanes (which already pass
  `resume: false`). No path bypasses the gate.
- **Fail-closed capability.** An adapter that omits the field is treated as non-resuming. The
  safe default is the one that cannot produce an unresolvable invocation.
- **Third-party calls are smoke-only.** The real-Codex probe lives in the excluded smoke lane
  (`vitest.config.ts:6`) behind an env opt-in plus a binary probe, matching
  `codex-provider.smoke.test.ts`'s existing pattern and the repo's test-isolation policy. The
  default suite runs against a faithful fake.

## Concerns raised (non-blocking)

1. **The existing fakes are the real reason this shipped broken.** Every provider fake is defined
   inline per test file and echoes back the harness-supplied `sessionId`, so the
   harness-uuid/rollout-id mismatch is structurally invisible to the suite. S4 correctly makes a
   *shared faithful* Codex fake — one that mints its own thread id and rejects foreign ids — part
   of the deliverable. **Recommendation, accepted:** put it in a shared location (alongside
   `test/fixtures/git-repo.ts`) so future Codex work inherits the fidelity rather than
   re-inventing a permissive fake.
2. **Two suites assert the old behavior.** `conductor.test.ts:9082-9245` asserts the exact
   `{step, provider, sessionId, resume}` dispatch sequence *including* the Codex resume-on-retry
   case, and `per-step-provider-routing-927.acceptance.test.ts:922-973` asserts fresh-vs-resume
   across both providers. These must be **amended, not deleted** — each also carries the Claude
   half of the invariant, which stays valid. S4's happy path states this explicitly.
3. **Prior-artifact drift.** `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
   §2 and two story files (`fresh-session-per-step.md`, `per-step-provider-routing-927.md`
   ST-927-7) state the retry-resume rule without provider qualification. Left unamended they
   become quietly false. The new ADR records the partial supersession; the plan carries a task
   to add the qualification note to the affected artifacts.
4. **Dead classifier.** With resume unrequestable, `CODEX_SESSION_EXPIRED_RE` and the conductor's
   `sessionExpired` branch can no longer be triggered by our own resume. Deliberately retained
   as a defensive classifier and named a non-goal; retiring it belongs to #1042, which owns the
   session-identity question. **No action.**
5. **Token cost.** Codex retries now re-send the full step prompt. Accepted and recorded in the
   ADR's consequences: #325 already accepted this cost at step boundaries, and for Codex the
   cheaper path never actually worked — it failed, then re-sent the full prompt anyway after the
   stale-session reset. Net token cost of this change is therefore **negative** (one fewer failed
   invocation per retry), not positive.

## Scope boundary with #1042 — confirmed clean

#1042 owns provider **session identity and home provisioning** (should the id be read back from
Codex; should `CODEX_HOME` live under `/tmp`; should an isolated home persist across
invocations). #903 owns only **whether dispatch requests resume**. Making resume unrequestable is
a precondition for #1042's decision, not a substitute. `forceFreshSession`
(`provider-execution.ts:376`, `:546`) is left in place because it is provider-agnostic and
remains #1042's seam. No overlap in files-changed beyond `provider-execution.ts`, where this
feature adds a conjunct and does not restructure the existing flag.

## Assumptions carried forward

The four assumptions in the ADR's assumption table are inherited by this review unchanged. The
one operator-directed assumption ("resume is unwanted for both providers, Codex first") is the
load-bearing one; it is recorded, and the capability field is the flip point if it ever reverses,
so being wrong costs a one-line change rather than rework.

# Architecture Review: ci-fix-resolver-autofix

**Tier:** Medium (lightweight review)
**Reviewer track:** technical feasibility + architectural alignment
**Verdict:** APPROVED to proceed to stories.

## Scope reviewed

Restoring the daemon's ci-fix resolver by replacing a fictional `claude --fix-session` spawn
with the proven `DefaultStepRunner` headless dispatch, adding a fail-loud-once startup
preflight, and classifying resolver spawn errors.

## Feasibility

- **High confidence (verified).** The target mechanism already exists and is exercised in
  production by setup-triage: `DefaultStepRunner.resolveSetupFailure`
  (`step-runners.ts:697`) dispatches via `modelAvailability.invokeWithLadder(provider, …)`.
  A sibling `resolveCiFailure` is a near-mechanical copy differing only in the prompt and the
  CI hint payload. No new infrastructure is required.
- The resolver already constructs an isolated worktree (`withResolveWorktree`) and owns the
  guard/suite/lease-push publish pipeline; only the `CiFixRunner.run` body changes, so blast
  radius is contained to `ci-fix.ts`, the `daemon-cli.ts` dispatch wiring, and one preflight.

## Alignment with harness principles

- **Deterministic where possible; LLM only where necessary** (CLAUDE.md). The two failure
  classes are split correctly: the *invocation validity* check is deterministic machinery
  (preflight probe + error classification, no LLM), while only the *actual code fix* — which
  genuinely needs judgement — is delegated to a Claude session. We do not paper over the
  arg-parse bug with a prompt.
- **Fail at the point of violation.** The preflight fails loud once at startup instead of
  emitting an identical per-PR crash, matching the existing `preflight.ts` /
  `build-auth-preflight.ts` precedents.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Auto-pushing LLM fixes to already-shipped PRs | Unchanged existing safety pipeline: acceptance guards (no lost feature commits) → suite gate → **lease-protected** push; any stage failure logs `escalated` and skips the push. |
| Resolver worktree mutating the primary checkout | Preserved invariant — dispatch runs inside `withResolveWorktree`; cwd is the resolver worktree. |
| Preflight false-negative disabling ci-fix wrongly | Probe validates flag/exec surface only (e.g. a `--print` dry probe or `--help` capability check), not model reachability; classified reason is logged so the operator can see why. |
| Scope creep into the underlying red-CI cause (`Ambiguous plan discovery`) | Explicitly out of scope (see adr-2026-07-20-ci-fix-startup-preflight-and-error-classification non-goals); deferred to separate triage per intake #666. |

## Decisions requiring ADRs

1. **adr-2026-07-20-ci-fix-dispatch-via-steprunner** — Dispatch mechanism: reuse `DefaultStepRunner` (`resolveCiFailure`) vs a
   bespoke `claude --print` spawn in `ci-fix.ts`. → APPROVED.
2. **adr-2026-07-20-ci-fix-startup-preflight-and-error-classification** — Startup preflight + error classification: fail-loud-once contract and the
   out-of-scope boundary. → APPROVED.

Both ADRs are APPROVED below; no DRAFT carried forward.

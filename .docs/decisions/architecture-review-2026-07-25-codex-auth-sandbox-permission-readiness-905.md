# Architecture Review: Codex auth, sandbox, and permission readiness (#905)

**Date:** 2026-07-25
**Mode:** Lightweight (Tier M, product track, pre-stories)
**Inputs reviewed:** Approved PRD FR-1 through FR-22; approved feature architecture
diagram; current Codex/provider execution; governing ADRs; Codex 0.145.0; current
official Codex manual
**Verdict:** APPROVED WITH CONDITIONS — AMENDED

**Approval:** James Stoup approved the ADR and its explicit valid-API-key
compatibility assumption on 2026-07-25. Conditions 2–4 remain implementation gates.

> **Recovery amendment:** The operator approved
> `architecture-review-2026-07-25-codex-shared-auth-recovery-amendment` on
> 2026-07-25. That review and its superseding ADR replace this document's original
> Codex-only immediate-HALT recovery decision. All other findings and conditions here
> remain in force.

## Technical Feasibility

The feature is feasible in the current TypeScript conductor without a new package,
service, datastore, credential format, container, or generalized permission system.

Verified current seams:

- `CodexProvider` is the common adapter reached by provider-aware normal, grouped,
  model-ladder, resumed, and auxiliary dispatch. It currently has no readiness pass
  and maps unattended permission bypass to Codex's combined danger flag.
- `executeProviderCandidates` already stops candidate fallback when `authFailure` is
  present, preserving the no-provider-fallback and no-model-ladder-poisoning
  requirements from the #927 ADR.
- `StepRunResult` already carries preferred/actual provider identity. The serial and
  group auth joins are the two recovery sites that still assume Claude credentials;
  the group branch currently discards provider identity when it creates its
  `authFailure` no-verdict outcome.
- `runSelfBuildDispatch` applies Claude relink/auth/sandbox preparation before the
  runner resolves the actual build provider. Resolving the preferred build provider
  first creates a clean branch that can leave the Claude path unchanged.
- The official CLI supports the required config overrides on both `exec` and
  `exec resume`. `workspace-write` protects `.git`, `.agents`, and `.codex`, and does
  not grant the nested worktree's parent checkout as an additional writable root.
- `codex doctor --json` supplies a versioned machine-readable auth/runtime report.
  Direct probes verified cached-login success and explicit invalid-key rejection
  evidence without initiating model work.

The highest feasibility risks are external diagnostic-schema drift and loss of auth
metadata at an adapter boundary, not unknown technology. A strict fail-closed parser,
injected command runner, verbatim JSON fixtures, and all-path propagation tests are
sufficient controls.

## Architectural Alignment

The proposed design extends the existing provider adapter and recovery precedence
instead of adding a second execution router.

- **Provider-aware execution ADR (#927):** preserved. The preferred provider still
  owns its auth and permission context; auth failure still never advances the
  provider list; session scope remains step-and-provider local. The proposed design
  does not need to modify candidate ordering or provider runtime state.
- **Auth-failure park ADR:** amended to use one bounded lifecycle for every built-in
  provider. Readiness, refresh, credential access, and remediation remain
  provider/source-specific; startup-only API keys are restart-required.
- **Self-host sandbox ADR:** preserved for Claude. Codex reaches the same safety
  outcome through its native workspace boundary and auto-reviewed escalation; it
  does not reuse, inspect, or modify `CLAUDE_CONFIG_DIR` or Claude credentials.
- **Issue #901 ownership:** provider installation/presence remains outside #905;
  doctor spawn `ENOENT` continues through existing provider availability handling.
- **Issue #904 ownership:** Codex skill discovery, `$skill` invocation, `AGENTS.md`,
  and bootstrap guidance are a separate active feature. #905 neither creates
  `.agents/skills` nor rewrites global skill links. Its self-host scope is auth,
  confidentiality, bounded execution, and account/config isolation only.
- **Operator scope:** Claude remains on its current `--dangerously-skip-permissions`
  behavior. No Claude auto-review migration, outer sandbox, `CODEX_HOME` clone,
  per-command approval framework, or engine-owned Git workflow is introduced.

The approved diagram's open self-host mechanism is resolved narrowly by the draft
ADR. Its reference to exposing edited Codex skills/hooks is treated as the #904
dependency, not an implementation responsibility of #905; the diagram should be
reconciled after ADR approval.

## Wiring Surface

| New or changed surface | Design-time destination | Production caller / consumer |
|---|---|---|
| Codex auth-source selector and run context | `execution/codex-provider.ts` (small provider-local types or sibling module if extraction improves tests) | `CodexProvider.invoke` and `invokeInteractive` for unattended calls |
| Bounded `codex doctor --json --summary` runner and strict readiness parser | Codex execution adapter, behind an injected command-runner seam | Called immediately before each unattended initial/model-ladder/resumed Codex dispatch |
| Auth source/readiness/sanitized reason fields | additive fields on `InvokeResult` and `StepRunResult` | Provider result spread, step-runner result conversion, serial conductor auth join, group branch/join, auxiliary result adapters |
| Explicit Codex unattended argv/env policy | one Codex arg/env builder used by initial and resume | Both captured `invoke` and streamed `invokeInteractive` paths when the runner marks the call unattended |
| Provider-neutral auth park with source-specific readiness | shared conductor coordinator plus built-in provider/source readiness dispatch | Serial retry loop and concurrent-group join; both built-in providers park without crossing credential boundaries |
| Provider-aware self-host preparation | `Conductor.runSelfBuildDispatch` resolves preferred build provider before setup | Claude branch calls existing relink/auth/sandbox bundle; Codex branch dispatches through native readiness/policy; shared release gates remain downstream |
| Secret-safe readiness/exec diagnostics | Codex adapter-generated messages only; raw doctor and API-key auth stderr remain captured | Provider attempt/event logging, HALT marker, daemon log, operator remediation output |
| Contract and negative-path coverage | Codex provider tests, provider execution/step-runner tests, group and conductor auth tests, acceptance tests | Guards cached/key/both/neither, invalid/network/unknown schema, resume parity, no fallback/budget, self-host provider isolation, and Claude regressions |

The early advisory overlap scan was noisy because it reported historical branches
that merely contain the candidate files. Manual branch/worktree inspection found two
current boundaries worth carrying forward:

- active #904 (`feat/codex-user-scoped-skills`) changes install/bootstrap/docs only,
  with no planned #905 runtime-file collision; ownership must stay separated; and
- the #927 retrospective branch changes `provider-execution.ts`. This design avoids a
  required edit to that file because additive `InvokeResult` fields already flow
  through `ProviderExecutionResult`; if implementation discovers otherwise, re-run
  overlap review before editing that seam.

## Risks and Mitigations

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Future doctor schema or transport wording changes | Integration | Medium | Medium | Require supported schema + explicit selected-source evidence; unknowns become `unverifiable`; fixture and optional real-binary smoke coverage |
| Raw doctor/API error exposes a key fragment | Security | Medium | High | Never inherit doctor output; do not live-inherit selected-key auth errors; replace auth failures with canned source-specific diagnostics; adversarial no-fragment tests |
| Group/auxiliary adapter drops Codex identity and invokes Claude readiness | Technical | Medium | High | Carry provider/auth metadata in no-verdict and auxiliary results; assert serial, grouped, prelude, judgment, and recovery paths |
| Doctor latency accumulates across a long run | Performance | Medium | Low | Bounded timeout, `--summary`, no model probe; record duration and revisit only with evidence—do not weaken per-dispatch gating silently |
| User config disables secret filtering or changes default permissions | Security | Low | High | CLI overrides set sandbox, approval, reviewer, and default secret filtering on every initial and resumed unattended call |
| Auto-review denies a required Git/network operation | Operational | Medium | Medium | Surface reviewer denial as actionable and fail closed; never retry with danger bypass; operator can adjust native reviewer policy separately |
| #904 is not landed when Codex self-host is exercised | Integration | Medium | Medium | Keep #905 self-host acceptance scoped to auth/policy/isolation; sequence end-to-end edited-skill parity with #904 rather than duplicating it |

## ADRs Created and Amended

- `adr-2026-07-25-codex-unattended-readiness-and-bounded-execution.md` — approved,
  then **SUPERSEDED** for the recovery amendment.
- `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness.md` —
  **APPROVED** by the operator on 2026-07-25 and authoritative for #905.

## Conditions

1. **Satisfied 2026-07-25:** the operator approved the ADR and its explicit
   85%-confidence valid-API-key diagnostic assumption.
2. Implementation must capture and sanitize diagnostic/auth-failure output before any
   log, event, inherited terminal stream, or HALT write. This is a blocking security
   invariant, not best-effort logging hygiene.
3. Initial and resumed calls, serial and grouped recovery, and self-host Claude/Codex
   branches require negative-path acceptance coverage; a success-only adapter test is
   insufficient.
4. #905 must not absorb #904's skills/`AGENTS.md` work or modify the active #927
   provider-execution seam without a renewed overlap review.

Sections 3 (complexity, already Tier M) and 5 (domain pre-check, enforced during TDD)
are skipped per lightweight architecture-review mode.

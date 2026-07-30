# Architecture Review: Codex readiness probe failure separation (#1039)

**Date:** 2026-07-29
**Mode:** Lightweight (Medium tier), pre-stories review plus product-kickback and plan-validation amendments
**Inputs reviewed:** Approved #1039 PRD amendment; operator-approved exploration choices; rendered plan-updated #1039 sequence diagram; 20-task implementation plan; current Codex provider, shared readiness type, provider runtime, auth-recovery coordinator, event subscriptions/renderers, configuration, and composition-root contracts; authoritative #970 ADR
**Verdict:** APPROVED WITH CONDITIONS

**Approval:** James Stoup approved the superseding ADR and this review on 2026-07-29. The former blocking issue is resolved; the conditions below are implementation gates.

**Amendment:** Revalidated on 2026-07-30 against the operator-approved #1039 product requirements after conflict-check routed the observable behavior change through PRD.

**Plan validation approval:** James Stoup approved the 20-task plan and plan-updated architecture on 2026-07-30.

## Technical Feasibility

- **Verified:** doctor execution and parsing are centralized in `CodexProvider.readiness()` and `classifyReadiness()`, so every ordinary unattended path can receive one explicit probe-failure result without a second probe implementation.
- **Verified:** actual `invoke()` and unattended `invokeInteractive()` already own `diagnosticLog`, allowing a non-blocking readiness failure to be persisted before the real invocation.
- **Verified:** cached-login polling is centralized in `Conductor.parkOnAuthFailure`, and serial, grouped, and auxiliary flows already converge on that coordinator. Its result contract can carry a bounded trial disposition without a new service.
- **Verified:** `credentials_park_progress` is a typed persisted event with exhaustive test consumers; widening it requires coordinated event, renderer, persister, and fixture updates but no new telemetry infrastructure.
- **Verified:** built-in provider construction is centralized in `registerBuiltins`; validated configuration can be injected when the Codex provider is registered.
- **Verified:** no database, migration, package, external account, background job, port, shared worktree resource, or deployable component is required.

The design is feasible in the existing TypeScript stack. The main integration risk is completeness across every recovery caller, not technology uncertainty.

### Product-requirement amendment validation

| Approved PRD requirements | Architecture coverage | Verdict |
|---|---|---|
| FR-1 through FR-5 | Discriminated readiness outcomes, ordinary degraded dispatch, affirmative credential blocking, and real-invocation auth authority in ADR sections 1–2 | Covered |
| FR-6 and FR-7 | Closed structured diagnostic facts and raw-payload/secret prohibitions in ADR sections 1 and 5 | Covered |
| FR-8 through FR-11 | Explicit recovery dispositions, one real trial, no-recursion terminal behavior, and unchanged conclusive credential polling in ADR section 3 | Covered |
| FR-12 | Finite positive project timeout, default resolution, validation, and composition injection in ADR section 4 | Covered |
| FR-13 through FR-15 | Preserved classification/fallback/budget invariants, all-path propagation, persisted progress, and probe-specific terminal rendering in ADR sections 2, 3, and 5 | Covered |

The PRD amendment introduces no architectural gap and does not require a second ADR. It supplies the product authority that was missing from the initial technical-track pass; the approved ADR remains the matching implementation decision.

## Architectural Alignment

- **Provider ownership:** preserved. Codex owns doctor execution, evidence parsing, and safe structured probe diagnostics; the conductor receives typed outcomes and owns recovery timing/disposition.
- **Failure semantics:** corrected. Credential states represent affirmative credential facts; inability to obtain evidence becomes a separate result. Actual invocation remains the final authority.
- **State management:** a discriminated readiness union and explicit recovery disposition prevent optional booleans from representing impossible combinations. The bounded trial is episode state, not a hidden retry.
- **Recovery invariants:** preserved. No provider, model, auth-source, task retry, or escalation budget is consumed. A failed bounded trial cannot recurse into another probe bypass.
- **Observability:** existing feature diagnostics and persisted progress events carry closed safe fields. No raw doctor payload crosses the provider boundary.
- **Configuration:** a Codex-specific validated key avoids inventing a generic plugin contract before another provider needs one. The composition root, not the adapter's private constant, owns the production default.
- **Diagram accuracy:** the rendered #1039 sequence includes ordinary and recovery probe-failure paths, the one-trial bound, and the no-loop halt. No context, container, component, or ERD update is required.

This changes an approved authentication/resilience and observability contract, so a superseding ADR was mandatory and is now operator-approved.

## Wiring Surface

| New or changed production surface | Design-time destination | Production caller / consumer |
|---|---|---|
| Discriminated `AuthenticationReadiness` with `probe-failed` metadata | `execution/llm-provider.ts` and Codex classifier | `CodexProvider.invoke`, unattended `invokeInteractive`, provider runtime recovery, group/result adapters |
| Secret-safe doctor probe classifier | `execution/codex-provider.ts` | every readiness check before unattended Codex dispatch and every cached-login recovery probe |
| `codex_doctor_timeout_seconds` | config type, validator, documentation, and resolved composition input | CLI/daemon configuration load injects the resolved value into `registerBuiltins` and `CodexProvider` |
| Recovery disposition `recovered` / `trial-required` / `halt` | shared auth-recovery coordinator | serial dispatch, concurrent-group join, and auxiliary verifier recovery callers |
| Probe-failure progress metadata | existing `credentials_park_progress` variant | auth-recovery coordinator emits; event persister stores; terminal renderer and completeness fixtures consume |
| Normal degraded-readiness diagnostic | existing feature-scoped provider diagnostic sink | Codex invocation paths emit before proceeding; daemon feature logger persists |

## Early Overlap Scan

The advisory scan reported a large historical set of local and remote `spec/*` branches against `llm-provider.ts`, including the already-landed #905 lineage, but no distinct candidate path for the other named files. This is scanner noise rather than evidence that every branch is active. Treat `llm-provider.ts` and `codex-provider.ts` as high-contention seams and refresh signatures before BUILD; no specific unmerged dependency blocks DECIDE.

## Plan Validation (2026-07-30)

- **Feasible:** the 20 tasks use existing TypeScript/Vitest seams, injected doctor/provider runners, and deterministic clocks. They require no package, database, external account, network call, port, or shared worktree resource.
- **Complete:** every FR and happy/negative acceptance criterion maps to at least one task. Provider classification, ordinary dispatch, timeout composition, recovery dispositions, all three recovery caller shapes, and event consumers have explicit dependencies.
- **Wired:** every new production surface derives from the design-time Wiring Surface. Plan review corrected Task 17 to include the actual terminal subscription, CLI renderer, daemon renderer, event sink, persister, and audit-completeness path; no planned event is now test-only or unreachable.
- **Bounded:** serial, group, and auxiliary recovery each get an explicit one-trial/no-recursion negative-path task. The coordinator itself authorizes but never performs the trial.
- **Isolated:** the plan follows repository test policy: ordinary tests fake the Codex/doctor boundary, use bounded Conductor fixtures, and inject time.

**Plan-validation verdict:** APPROVED WITH CONDITIONS. The existing five conditions are represented directly in Tasks 1, 8-9, 10-11, 12-17, and the BUILD prerequisite; no new condition or ADR is required.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Probe-failure metadata leaks doctor or credential content | Security | Low | High | Closed allowlist only; forbid raw output/messages/paths/hashes; adversarial secret fixtures at provider, log, event, and HALT boundaries |
| Bounded recovery trial accidentally loops through auth recovery | Reliability | Medium | High | Explicit disposition union plus per-episode trial state; negative acceptance test proving one trial maximum across each caller shape |
| One caller still treats `probe-failed` as `authFailure` | Integration | Medium | High | Exhaustive union handling and propagation matrix across normal, grouped, auxiliary, runtime, event, and renderer seams |
| New timeout key validates but never reaches the provider | Integration | Low | High | Composition-root wiring test and as-built production-reachability check from config load to doctor runner options |
| Degraded preflight permits a doomed invocation | Operational | Medium | Low | Expected trade-off; classify the real invocation normally and enter auth recovery only on actual auth evidence |

## ADRs Created

- `adr-2026-07-29-codex-readiness-probe-failure-disposition` — **APPROVED**; supersedes the authoritative #970 readiness/recovery ADR while preserving its unaffected decisions.

## Conditions

1. Probe-failure metadata must remain a closed allowlist and never include raw doctor output, arbitrary messages, credential paths/fragments, or hashes.
2. The recovery trial must be limited to one per episode across serial, grouped, and auxiliary call shapes; a confirmed trial auth failure cannot recursively authorize another bypass.
3. `codex_doctor_timeout_seconds` must fail validation unless finite and positive, and a composition-root test must prove the resolved value reaches the doctor runner.
4. Every widened readiness, recovery, progress-event, and renderer consumer must handle the new outcome exhaustively.
5. BUILD must refresh signatures before editing the high-contention provider contract files.

## Verify-Claims Verdict

**CLEAR:** code-path and wiring claims are verified. The operator approved the PRD amendment, ordinary-dispatch behavior, explicit probe-failure result, one-trial/no-recursion recovery bound, and exact configuration seam. Every FR maps to an approved architecture section without an unconfirmed assumption.

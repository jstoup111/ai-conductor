# Architecture Review: Codex readiness park loops on unrelated doctor failure (#970)

**Date:** 2026-07-26
**Mode:** Lightweight (Medium tier, technical track), pre-stories review plus plan-validation
amendment
**Inputs reviewed:** Approved #970 exploration decision and ADR; accepted stories; clean conflict
report; consolidated 12-task implementation plan; rendered architecture diagram; current Codex
provider, provider runtime, conductor recovery, and event contracts
**Verdict:** APPROVED WITH CONDITIONS

**Approval:** James Stoup approved the superseding ADR and this plan-validation review on
2026-07-26. Condition 1 is satisfied; conditions 2–6 remain implementation gates.

## Technical Feasibility

- **Verified:** documented doctor evidence is classified entirely inside
  `CodexProvider.parseDoctorEvidence`; mixed auth-green/overall-fail currently becomes
  `unverifiable` before substantive execution.
- **Verified:** normal and unattended streaming invocation paths call the same readiness method,
  so one parser amendment covers initial, resumed, auxiliary, and model-ladder dispatches.
- **Verified:** cached-login recovery is centralized in `Conductor.parkOnAuthFailure`, has an
  injected sleep boundary, preserves provider/source identity, and already owns the timeout.
- **Verified:** `ConductorEvent` and the event emitter/persister are the existing durable telemetry
  boundary; a typed progress variant needs no service, datastore, package, queue, or port.
- **Verified:** the feature worktree has no shared runtime resource beyond Git metadata and the
  canonical memory link. Implementation can run concurrently without a new `.env`, database,
  port, or credential store.

The change is feasible in the current TypeScript stack. The consolidated plan names six existing
production modules (`llm-provider.ts`, `codex-provider.ts`, `conductor.ts`, `events.ts`,
`event-persister.ts`, and `terminal-renderer.ts`) plus their existing tests. It introduces no
package, infrastructure, service, persistent schema, or data migration.

### Plan-validation amendment

- **Verified:** all 12 tasks name existing repo-relative files; all declared production symbols
  exist (`CodexProvider.readiness`, `Conductor.parkOnAuthFailure`, `EventPersister.start`, and
  `dispatchRenderers`).
- **Verified:** the dependency graph is acyclic and orders the provider type/classifier before the
  recovery and event consumers that depend on its sanitized metadata.
- **Verified:** related cases are consolidated as table-driven tests at one production seam; the
  coverage table still maps all 25 happy and negative criteria.
- **Verified:** `/writing-system-tests` remains a prerequisite, so the plan does not bypass the
  acceptance-level RED gate.
- **Verified:** all four Mermaid blocks in the amended architecture file render successfully.

## Architectural Alignment

- **Provider ownership:** preserved. Codex interprets doctor evidence; the conductor receives only
  typed, sanitized readiness metadata and coordinates timing.
- **Failure precedence:** preserved. Explicit auth failure still prevents provider/model fallback
  and consumes no retry/escalation budget. Unrelated doctor health is no longer relabeled as auth.
- **State management:** the existing readiness enum remains the credential state authority. A
  separate sanitized degradation indicator avoids adding invalid credential states to that enum.
- **Observability:** a distinct progress event preserves `credentials_park` as a lifecycle-start
  fact and prevents repeated starts from being used as progress telemetry.
- **Security:** raw doctor output remains captured below the adapter boundary. Progress fields are
  closed typed values and bounded numbers, never upstream summaries or credential fragments.
- **Diagram accuracy:** the approved #905 component/sequence diagram now shows mixed-health
  classification, capped backoff, and rate-limited progress. No system-context, container, or ERD
  update is required.

Because this changes an authoritative authentication/resilience contract and introduces a new
observability event, the superseding ADR was mandatory and is now operator-approved.

## Wiring Surface

| New or changed production surface | Design-time destination | Production caller / consumer |
|---|---|---|
| Mixed-health doctor evidence classification | `execution/codex-provider.ts` parser and sanitized readiness result | `CodexProvider.readiness`, called before every unattended initial/resumed dispatch and by cached-login recovery |
| Deadline-preserving exponential recovery cadence | cached-login branch of `Conductor.parkOnAuthFailure` | serial auth recovery, grouped auth recovery, and auxiliary verifier recovery through the existing shared coordinator |
| `credentials_park_progress` event | `types/events.ts` plus existing event emitter/persister | cached-login park coordinator emits; event persister stores, terminal consumer renders, and audit completeness deliberately classifies without widening the friction schema |
| Sanitized unrelated-health indication | additive provider readiness metadata | provider result propagation and progress-event builder; never raw doctor output |

## Early Overlap Scan

The required advisory scan named many historical/local `spec/*` branches against
`codex-provider.ts`, including #647, #651, #904/#907 precursors, and numerous already-landed
features. It reported no additional candidate path, which indicates the scanner's broad
historical-branch matching is noisy rather than evidence that every branch edits this feature.
Treat `codex-provider.ts` as a high-contention seam and refresh against `main` before BUILD; no
specific unmerged dependency currently blocks DECIDE.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Auth-specific `ok` does not prove usable credentials on a future schema | Security | Low | High | Accept only the supported schema and exact auth subcheck; explicit rejection/malformed evidence remains fail-closed; real invocation auth rejection still parks |
| New event leaks raw diagnostic or credential content | Security | Low | High | Closed typed fields only; adversarial redaction tests at provider, event, log, and HALT boundaries |
| Backoff overshoots timeout or burns retry budget | Reliability | Low | High | Compute delay against remaining deadline; injected clock/sleep tests; preserve existing attempt counters |
| New event is omitted by an exhaustive consumer | Integration | Medium | Medium | Trace emitter through persister, daemon renderer, audit completeness, and fixtures; compile-time exhaustiveness where available |
| Backoff delays recovery observation | Operational | Medium | Low | Cap at 30 seconds; immediate first recheck; progress includes next delay |

## ADRs Created

- `adr-2026-07-26-codex-auth-evidence-and-recovery-backoff` — **APPROVED**; supersedes the
  authoritative #905 auth-park ADR while preserving its unaffected decisions.
- Plan-validation amendment: **none**. The plan implements the already-approved decision and
  introduces no new architectural category.

## Conditions

1. **Satisfied 2026-07-26:** the operator approved the superseding ADR.
2. Missing, rejected, malformed, unsupported, or absent auth evidence remains fail-closed.
3. Progress telemetry must never include raw doctor output, summaries, or credential fragments.
4. Backoff must preserve the configured deadline and every zero-budget/no-fallback invariant.
5. BUILD must re-check overlap/current signatures before editing the high-contention Codex adapter.
6. Task 7 must keep durable event persistence distinct from retro audit-record persistence: the
   audit completeness consumer must classify the variant explicitly, not silently widen its closed
   friction schema.

## Verify-Claims Verdict

**CLEAR:** all plan file paths, named production callers, consumer boundaries, dependencies, and
coverage mappings were verified against current source and accepted artifacts. The operator already
approved the load-bearing auth-subcheck interpretation, classifier-plus-loop scope, exact backoff,
and typed progress-event design; the plan-validation amendment introduces no new assumption.

# Architecture Review: Durable PRD widening decisions

**Date:** 2026-09-07
**Input reviewed:** Approved technical track and logical diagrams; stories and plan follow this review.
**Verdict:** APPROVED
**Approval:** Operator accepted the complete architecture proposal in chat.



### Feasibility

TypeScript, existing filesystem leases, atomic replacement, selected-provider adapters, and out-of-band remediate dispatch can support this design without new services or packages. Native schema flags exist in both installed CLIs; final-result extraction and scratch-path lifecycle need production adapter changes and explicit fixture evidence. This is scoped engineering work, not an assumed existing capability.

### Complexity

Large: two cooperating durable stores, legacy migration, multi-domain case preservation, asynchronous judgment freshness, provider schema plumbing, and multiple completion readers. The full widening lifecycle remains one useful slice; later gates are excluded.

### Alignment

Separates operator authority from autonomous evidence as existing ADRs require. Extends the event spine and case store. Corrects older intentional re-ask behavior through DECIDE amendments. Honors #2188's native typed boundary without migrating all reports. The approved component/sequence diagram remains accurate at logical level; these decisions resolve its open placement and state questions.

### Domain integrity

Discriminated case domains prevent PRD widenings from acquiring build-review effect routes. Explicit result unions distinguish uncertainty, corruption, staleness, and refusal. Engine IDs and revision relationships prevent summary text and timestamps from acting as identity or precedence. Persistent production defaults use the filesystem store; in-memory fakes exist only in tests.

### Wiring surface

- accepted-widenings.ts capture/migration: PRD entry preparation and existing conductor over-scope routes; existing artifact readers consume the typed decision read result.
- remediation-case-store.ts/artifact types: both the existing build-review coordinator and new PRD widening coordinator through the same leased mutation seam.
- PRD widening projection/reconciliation coordinator: conductor after current report parsing, before route/completion publication.
- step-runners.ts and execution/llm-provider.ts, claude-provider.ts, codex-provider.ts: existing remediate dispatch carries the optional native schema request and final structured result.
- artifacts.ts and PRD report rendering: consume the current bound classification and surface invalid evidence.
- types/events.ts and existing event sinks/renderers: consume additive reconciliation events through the current bus.
- skills/prd-audit and skills/remediate: judgment guidance aligned with engine-projected history and mode; remove in-scope verbatim-summary identity instruction.
- docs/reference/artifacts.md, docs/explanation/gates.md, and stalled-or-stuck-feature runbook: decision formats, ownership, migration, and recovery.

### Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| #2383 changes before merge | Integration | Medium | High | Inspected immutable head, retained native blocker, targeted final diff check |
| Incorrect semantic match | Data | Medium | High | Original authority separate, substantive reasons, explicit uncertainty, adversarial negative cases |
| Mixed-domain writer drops records | Data | Medium | High | Versioned parser and domain-preservation checks at every shared mutation |
| Provider final output differs by host | Integration | Medium | High | Native flags plus adapter fixtures and engine validation; fail closed |
| Legacy source cannot prove current equivalence | Knowledge | Medium | Medium | Preserve record and attribution, uncertain binding with explicit operator recovery |
| Input exceeds bounds | Performance | Low | Medium | Typed overflow with no silent truncation; no unlimited retry loop |

### Validation boundary

Prove capture -> changed-report reconciliation -> authoritative classification through the narrow real PRD coordinator path with temporary stores and a faithful fake judge. Reproduce the two observed lease-wait summaries and a different behavior sharing commit/path/prose. Lower-level tests own malformed schema, domain preservation, replay/supersession, migration, snapshot races, limits, and provider argument/result handling. No full BUILD or external LLM is required to prove these behaviors. Detailed tests remain story/task authoring work.


## ADRs Created

adr-2026-09-07-durable-prd-widening-decision-reconciliation — APPROVED. Structural prerequisite: a second case domain, operator-decision persistence model, and native provider-result boundary. Existing approved ADRs govern build-review state and separate authority but do not cover this new PRD domain; the new ADR extends that architecture without replacing build-review policy.

## Overlap scan

Required ai-conductor overlap-scan completed against candidate paths. It reported many historical spec branches touching common files; those path matches alone do not establish dependency. Direct inspection of active PR #2393 at bf6a0336cb184894097b132f9fd227b4f89bf54c established the actual shared-store overlap. Native #2429 blocked_by #2383 is verified. The operator expressly authorized spec authoring against that implementation before merge.

## Verify-Claims Ledger

Verified: #2383 store suppression preservation, leased mutation, build_review-only domain, current PRD summary-bound import/classification, and installed provider native-schema flags were read directly. Shared InvokeOptions schema support is new in-scope work, not an assumed capability. All D1-D10 design choices, limits, migration policy, and pre-merge implementation basis were approved by the operator. Verdict: CLEAR.

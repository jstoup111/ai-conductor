# Architecture Review: Coherent FINISH Publication

**Date:** 2026-08-01
**Input reviewed:** Approved PRD `2026-08-01-unattended-finish-publication.md`
**Complexity:** Large
**Verdict:** APPROVED

## Feasibility

The design is feasible with the current TypeScript engine and existing injected git/GitHub boundaries. SHIP entry already attempts to establish a draft PR identity; shipment evidence, push verification, presentation repair, and outcome recording already exist. The work is orchestration and responsibility consolidation, not a new external service or datastore.

No schema migration, dependency addition, port, shared service, or new credential class is required. Worktree isolation is preserved because all local paths remain rooted at the injected feature worktree and external effects remain branch/PR scoped.

## Complexity

Large is confirmed. The feature creates an explicit lifecycle across repository state, GitHub state, durable shipment evidence, mode-dependent authority, and recovery routing. It crosses more than three modules and includes a failure state machine, but it does not require a separate spike because every underlying capability exists and is covered by current tests.

## Alignment

The proposed design follows the repository principle that machinery owns deterministic enforcement. It consolidates existing primitives behind a focused coordinator and keeps `Conductor` as the composition/root routing seam.

It intentionally supersedes the agent-only recording clauses of two prior ADRs. All fail-closed evidence, presentation-quality, SHIP-start draft, mergeability, and no-auto-merge decisions remain authoritative. The active bot-owned release-PR specification owns changelog and version state; this design consumes release readiness and introduces no competing writer.

The approved architecture diagram accurately represents the proposed component and recovery boundaries. The implementation plan must update it only if the final module split or transition ownership changes.

## Domain Integrity

- Model publication intent, observed snapshot, next transition, and terminal disposition as semantic discriminated unions.
- Do not represent transition completion as independent booleans that admit contradictory combinations.
- Exhaustively match every transition and disposition; no default branch may silently convert an unknown state to success or BUILD.
- Treat PR URLs, branches, and feature slugs through existing validated types/parsers at boundaries.
- Keep observed external state authoritative over cached local hints.

## Wiring Surface

- **Publication coordinator module:** invoked from the existing FINISH branch of the shared `Conductor` loop before and after the bounded judgment dispatch.
- **Observed-state reader:** composed by the publication coordinator from existing git, GitHub, resolved release-readiness, shipped-record, and finish-record adapters.
- **Judgment task boundary:** dispatched through `DefaultStepRunner` for FINISH only when the observed snapshot says prose quality is incomplete.
- **Typed FINISH disposition router:** consumed by the existing conductor recovery branch; only `implementation_invalid` may navigate to BUILD.
- **Interactive intent input:** supplied by the current interactive FINISH experience before coordinator advancement.
- **Unattended intent policy:** supplied at the daemon and foreground-auto composition roots using existing mode and remote/auth capability.
- **Events/logging:** publication transition and disposition events flow through the existing conductor event emitter and feature-scoped logger.
- **CLI primitives:** existing shipped-record and finish-record dispatches remain production-reachable through the coordinator's injected adapters; no duplicate shell implementation. Changelog finalizer retirement remains owned by the bot-owned release-PR feature.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Coordinator records success without preserving an agent refusal | Technical | Low | High | Explicit typed intent/refusal; final record only after authorized intent and all evidence |
| Retry duplicates PRs, commits, comments, or records | Integration | Medium | High | Observe-before-act, stable identity keys, idempotent existing primitives, verify-after-write |
| Interactive conduct loses operator control | Technical | Low | High | Mode-owned intent contract plus interactive acceptance scenarios |
| External state changes between observation and action | Integration | Medium | High | One-transition advancement, re-observation, fail-closed indeterminate result |
| Central conductor conflicts with unmerged work | Technical | High | Medium | Focused new module and minimal conductor wiring; rebase before implementation |
| Prose quality is bypassed by mechanical completion | Technical | Low | High | Separate blocking judgment-complete predicate before ready/final record |

## Early Overlap Scan

The advisory scan reports extensive overlap on `src/conductor/src/engine/conductor.ts`, including active spec branches. It also identified `spec/changelog-unreleased-is-a-shared-write-target-conf`, whose approved decision removes changelog/version ownership and finalizer retirement from #1172. The plan must treat that release feature as an upstream contract, isolate most behavior in a new module, and keep conductor changes to composition and exhaustive disposition routing.

## ADRs Created

- `adr-2026-08-01-engine-owned-resumable-finish-publication` — APPROVED by the operator on 2026-08-01.

## Conditions

None. The high-impact risks are addressed by binding ADR constraints and must be covered by stories and plan tasks.

## Blocking Issues

None.

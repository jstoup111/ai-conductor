# Architecture Review: Contract-aware same-file wiring

**Date:** 2026-07-30
**Tier:** Medium (lightweight review)
**Technical intent reviewed:** Accept production-reachable same-file helper composition without weakening orphan detection.
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** Feasible with the existing lazy-loaded TypeScript compiler API. No package, external service, schema, or runtime infrastructure is added.
- **Prerequisites:** Existing `Wired-into:` task contracts, new-export extraction, Layer 1 reference classification, configured Layer 2 roots, and `WiringEvidence` persistence already exist.
- **Integration surface:** `wiring-probe.ts` joins contract, symbol-reference, and module-reachability facts; `artifacts.ts` validates the new typed success proof; focused unit and acceptance tests cover the gate boundary.
- **Data implications:** Only gitignored wiring evidence changes. There is no application data, migration, or durable state format.
- **Performance:** The compiler program/checker must be shared by import and symbol analysis. Constructing a second program per export or per proof is prohibited.
- **Worktree isolation:** Analysis reads only the feature worktree and configured roots. It creates no port, database, queue, or shared mutable service.

## Alignment

- The change amends, rather than silently violates, `adr-2026-07-12-wiring-check-gate`'s unconditional external-file-reference clause.
- It preserves that ADR's layered, deterministic, fail-explainable design and keeps Layer 1's existing cross-file path unchanged.
- It follows the deterministic-first repository principle: plan contract, symbol identity, and root reachability are computed mechanically.
- It preserves the provider-neutral engine boundary; no Claude- or Codex-specific path is introduced.
- The accepted component diagram accurately shows the three required proofs and the fail-closed result when Layer 2 is unavailable.
- It resolves the SHIP-time structural conflict by requiring the as-built reviewer to trace the same root-to-caller-to-export chain independently; own-module reference alone remains insufficient.

## Wiring Surface

- **Same-file composition evaluator** — invoked by `computeWiringEvidence` only for exports Layer 1 classifies as same-file-only; it joins the owning task's declared caller, exact TypeScript symbol-reference evidence, and the export module's Layer 2 result.
- **Shared TypeScript analysis context** — invoked by the existing Layer 2 branch and reused for both import-graph reachability and caller-to-export symbol resolution.
- **Typed same-file proof** — emitted into the owning `WiringTaskResult` and consumed by `validateWiringEvidence` plus the existing evidence persistence/completion path.
- **Existing `wiring_check` predicate** — receives the same satisfied-or-kickback contract; no new step, dispatcher, CLI command, or provider dispatch is introduced.
- **As-built production reachability sweep** — independently verifies the configured production-root chain and exact same-file caller before counting an own-module caller; it remains blocking when either proof is absent.

## Advisory Overlap Scan

The required scan reported broad candidate-file overlap across many open spec branches because the central engine files appear in their branch diffs. It found no blocker linked to #880. This is advisory merge-conflict risk; implementation must remain scoped and the sanctioned finish-time rebase resolves current upstream movement.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| A same-name or shadowed identifier is accepted as a production call. | Technical | Medium | High | Resolve TypeScript symbol identity to the exact new export declaration; adversarial shadowing fixtures. |
| A reachable module causes an unused helper to pass. | Technical | Medium | High | Require all three proofs per export; module reachability alone never removes a gap. |
| Compiler analysis cost doubles on large projects. | Performance | Medium | Medium | Create one program/checker per probe run and share it between graph and symbol analysis. |
| Non-TS or unconfigured projects silently receive weaker behavior. | Integration | Low | High | Exception is unavailable unless Layer 2 is applicable; assert `not-applicable`, `skipped`, and `bad-root` negative paths. |
| Concurrent branches conflict in central wiring files. | Integration | Medium | Medium | Keep changes localized; integrate upstream only at the sanctioned finish-time rebase boundary. |
| BUILD accepts a composition that SHIP later rejects under its older own-module rule. | Integration | High | High | Update the as-built rule to apply the same three-proof semantics while independently tracing shipped source. |

## ADRs Created

- `adr-2026-07-30-contract-aware-same-file-wiring` — **APPROVED** by the operator on 2026-07-30.

## Conditions

1. The exception requires declared caller, exact symbol-reference, and applicable Layer 2 root proof; no heuristic fallback is permitted.
2. One shared TypeScript program/checker serves both analyses.
3. Successful exceptions persist typed proof; they do not pass through an unexplained missing gap.
4. Canonical wiring documentation and a patch changelog entry ship with implementation; no migration block is required unless implementation touches a breaking surface not present in this design.
5. The as-built architecture-review contract is updated in the same implementation so BUILD and SHIP cannot disagree on a qualifying same-file composition.

## Blocking Issues

None.

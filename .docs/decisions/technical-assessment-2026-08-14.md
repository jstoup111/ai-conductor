# Technical Assessment: ai-conductor

**Date:** 2026-08-14
**Assessed by:** 9 specialist agents + CTO synthesis
**Verdict:** CRITICAL

## Executive Summary

ai-conductor has strong local controls: its configuration boundary validation, argument-vector subprocess use, worktree isolation, test-layer balance, and CI gate were all assessed as effective (91–99% verified across the supporting specialist findings). Its immediate release risk is the current build-review fan-out: six verified critical wiring gaps mean the approved provider-aware, disposition-aware, observable architecture is not the production path (97–100% verified). The reviewed 2026-08-13 ADRs are current and remain the right target state (93% verified within the reviewed decision family); this requires implementation remediation, not an ADR rewrite. After that, the highest cross-cutting risks are unreliable durable evidence/telemetry and an EOL runtime with a local/CI installation mismatch. The project is not ready to rely on the new build-review gate for its next growth phase until those implementation gaps are closed.

## Critical Findings

| # | Finding | Specialist | Severity | File(s) |
|---|---------|------------|----------|---------|
| 1 | The production dispatcher bypasses each rubric's resolved provider, fallback, retry, escalation, and provider-runtime/session policy. **Confidence: 99% (verified).** | cto-architecture | Critical | `resolved-config.ts:746-772`; `build-review-coordinator.ts:192-203`; `step-runners.ts:1762-1788` |
| 2 | The five shipped rubric skills are not rendered or invoked at the production judgement boundary; a generic prompt replaces their registered contracts. **Confidence: 98% (verified).** | cto-architecture | Critical | `build-review-registry.ts:23-61`; `step-runners.ts:1762-1788` |
| 3 | An absent `build_review` block resolves to enabled rubrics but executes the legacy scalar grader, so the approved default-on fan-out topology is effectively opt-in. **Confidence: 99% (verified).** | cto-architecture | Critical | `resolved-config.ts:739-790`; `step-runners.ts:2023-2042` |
| 4 | Accepted dispositions calculate an effective verdict but the live runner and completion predicate use the raw verdict, so an accepted finding cannot unblock the gate. **Confidence: 99% (verified).** | cto-architecture | Critical | `build-review-aggregate.ts:112-132,220-239`; `build-review-cli.ts:119-143`; `step-runners.ts:1737-1759`; `artifacts.ts:2462-2476` |
| 5 | Rubric, cache, disposition, and outer-verdict events have neither a production emission site nor persistence, leaving reports and tail metrics empty. **Confidence: 100% (verified).** | cto-architecture | Critical | `types/events.ts:144-152`; `event-sinks.ts:9-17`; `build-tail-rollup.ts:49-57`; `report-renderer.ts:241-250` |
| 6 | The required per-rubric branch-artifact and semantic-cache write paths are absent; the coordinator can only observe cache misses and the runner writes only the aggregate. **Confidence: 97% (verified).** | cto-architecture | Critical | `build-review-coordinator.ts:167-204`; `build-review-cache.ts:1-16`; `step-runners.ts:1721-1727,1737-1759` |

## Systemic Patterns

| # | Pattern | Specialists | Impact | Recommendation |
|---|---------|------------|--------|----------------|
| 1 | **Build-review’s declared architecture is disconnected from its live execution.** The policy/skill/default, accepted-risk, telemetry, and artifact/cache contracts exist but are bypassed or unwired in the runner. **Confidence: 97–100% (verified)** for the six architecture defects; the related duplicated validation boundary is **97% (verified)** and disposition-write negative tests are missing at **97% and 98% (verified)**. | cto-architecture, cto-duplication, cto-testing, cto-observability | The gate can report or enforce behavior different from its approved contract, while its metrics lack the evidence to reveal that divergence. | Repair the execution path as one coherent slice: resolve and execute through the per-rubric provider boundary, render registered rubric contracts, make resolved default configuration drive topology, persist branch/cache artifacts and events, then compute lifecycle completion from the effective verdict. Keep the approved ADRs; do not rewrite them to fit the defect. |
| 2 | **Pipeline evidence and operational telemetry can be lost without a decisive signal.** Event persistence failures are swallowed (**96% verified**), the resulting build-review metrics are absent (**99% verified**), and halt/auto-park history is omitted from the primary ledger (**99% verified**). | cto-data-integrity, cto-observability, cto-architecture | Operators cannot reliably reconstruct what happened or trust cost/report rollups after an append failure. | Make event-persistence failure visible to the owning run state, emit and persist the approved build-review events, and persist terminal halt/park outcomes through the existing event spine. |
| 3 | **Durable pipeline state has inconsistent write and concurrency semantics.** Task-evidence writes are last-write-wins (**99% verified**); 16 atomic-write variants span 14 modules (**99% verified**), with a maintenance-risk inference of **98%**; the new disposition-store failure path lacks direct tests (**97% and 98% verified**). | cto-data-integrity, cto-duplication, cto-testing | Concurrent or failed writes can silently lose coordination evidence, and a future durability fix can be applied inconsistently. | Introduce one narrowly scoped atomic-write primitive, retain domain-specific locking/error translation at callers, add a lease or compare-and-swap to task evidence and regrade counters, then prove write/rename failure handling at store and CLI boundaries. |
| 4 | **Reproducibility and maintenance posture are drifting.** Worktree setup uses `npm install` while CI uses `npm ci` (**99% verified**; the lockfile-reconciliation risk is **88% inferred**), and both runtime pins are Node 20.19.2 after its EOL (**100% verified**). | cto-devex, cto-infrastructure, cto-dependencies | Local daemon worktrees can resolve a dependency graph CI would reject, while the supported runtime cannot take current security/runtime maintenance. | Switch the fallback setup to `npm ci`, move both pins to an actively supported LTS release, and validate the dependent engine/plugin upgrade sequence from that baseline. |

## Prioritized Roadmap

1. **Make the build-review fan-out implementation conform to its approved ADRs.** Repair all six critical production paths together: provider-aware rubric execution, registered skill contracts, default-on routing, effective-verdict lifecycle completion, persisted event emission, and branch/cache writes. This is first because it is the only critical cluster and the approved decisions remain current (**93% verified**); the defects themselves are **97–100% verified**. Source: cto-architecture.
2. **Make pipeline evidence durable, complete, and failure-visible.** Stop swallowing event-persistence failure (**96% verified**), restore persisted build-review metrics (**99% verified**), persist halt/auto-park history (**99% verified**), and protect task evidence/regrade counters from concurrent read-modify-write loss (**99% verified; 92% and 88% tentative impact/reachability in the regrade findings**). Source: cto-data-integrity, cto-observability, cto-architecture.
3. **Consolidate atomic pipeline-state writes and close their failure proofs.** Centralize the 16 duplicated write/rename protocols (**99% verified**) without moving domain locking/error policy, then add store and CLI write/rename-failure tests (**97% and 98% verified**). This reduces a high-blast-radius correctness surface before the fan-out feature adds more artifacts. Source: cto-duplication, cto-testing.
4. **Constrain autonomous-provider credentials and logs.** Replace parent-environment inheritance with an allowlist containing only the selected provider credential, then redact registered secret values before diagnostics. The environment flow is **98% verified**; the risk from mutable privileged GitHub Action tags is **97% inferred** from verified tag use and token scope. Source: cto-security.
5. **Restore reproducible, supported dependency execution.** Change worktree fallback installation to `npm ci` (**99% verified**; its risk is **88% inferred**), upgrade from EOL Node 20.19.2 (**100% verified**), and plan the coordinated OpenTelemetry migration (**98% verified**) before broad package upgrades. Source: cto-devex, cto-infrastructure, cto-dependencies.
6. **Establish operational signal outside local artifacts.** Configure the available OpenTelemetry exporter and define alert ownership for uptime, error rate, latency, and background failures. Disabled local OTel and absent in-repository alert wiring are **97% verified**; any external monitoring was not assessed. Source: cto-observability.
7. **Complete supply-chain governance.** Pin every privileged workflow action by immutable SHA (**97% inferred** from verified mutable tags and token scope), declare the project license (**98% verified absent**), and produce an SBOM/license scan because lockfile metadata is incomplete (**99% verified**). Source: cto-security, cto-dependencies.
8. **Reduce build-review boundary drift after correctness repair.** Extract shared record/exact-key/rubric/string validation semantics (**97% verified**) and explicitly choose whitespace rules; the likelihood of an incomplete future fix is **94% inferred**. Source: cto-duplication.

## Quick Wins

- [ ] Replace the worktree fallback’s `npm install` with `npm ci` — removes the verified local/CI command mismatch (**99% verified**; downstream reconciliation risk **88% inferred**). Source: cto-devex, cto-infrastructure.
- [ ] Pin privileged GitHub Actions to reviewed commit SHAs — low-touch supply-chain hardening; mutable tags and release-token scope are verified, while exploitation impact is **97% inferred**. Source: cto-security.
- [ ] Correct the stale runbook statement that `kickback` is absent from `events.jsonl` — the code/documentation mismatch is **99% verified**. Source: cto-observability.
- [ ] Add failure-injection tests for accepted-disposition store writes and the CLI’s failed-append result — both gaps are independently isolated at **97% and 98% verified**, respectively. Source: cto-testing.

## Specialist Reports

| Area | Agent | Verdict | Report |
|------|-------|---------|--------|
| Security | cto-security | NEEDS_WORK | `.pipeline/assessment/cto-security.md` |
| Data Integrity | cto-data-integrity | NEEDS_WORK | `.pipeline/assessment/cto-data-integrity.md` |
| Dependencies | cto-dependencies | NEEDS_WORK | `.pipeline/assessment/cto-dependencies.md` |
| Architecture | cto-architecture | CRITICAL | `.pipeline/assessment/cto-architecture.md` |
| Duplication | cto-duplication | CRITICAL | `.pipeline/assessment/cto-duplication.md` |
| Testing | cto-testing | NEEDS_WORK | `.pipeline/assessment/cto-testing.md` |
| Infrastructure | cto-infrastructure | NEEDS_WORK | `.pipeline/assessment/cto-infrastructure.md` |
| Observability | cto-observability | NEEDS_WORK | `.pipeline/assessment/cto-observability.md` |
| Developer Experience | cto-devex | NEEDS_WORK | `.pipeline/assessment/cto-devex.md` |

# Architecture Review: Durable Shipped-Record Enforcement and Backfill (#916, #936)

**Date:** 2026-07-25

**Mode:** Pre-implementation DECIDE review plus post-plan conformance pass, lightweight (Tier M,
technical track)

**Inputs reviewed:** approved component and sequence diagrams; committed 20-task implementation
plan; accepted stories and clean conflict report; issues #916/#936; merged spec PR #877;
implementation/repair evidence #893/#911; the #937 finish safeguard and its successful #943
production exercise; existing shipped-record, finish, daemon, guard, rekick, and mergeable-watch
code; approved ADRs listed below

**Verdict:** APPROVED

## Feasibility

- **Stack:** fully inside the existing TypeScript conductor, Git/GitHub CLI adapters, and GitHub
  Actions. No new service, database, package, or runtime is needed.
- **Reuse:** current `specHash`, renderer/parser/writer, finish recorder, completion predicate,
  complete verifier, merged-PR guard, daemon outcome boundary, rekick sweep, and mergeable watch are
  viable seams. The new code is one strict verifier/association policy with thin CLI and workflow
  adapters.
- **Verified baseline:** #937 already orders the ordinary skill-driven record creation/verification
  before local terminal recording, and #943 landed a record from that path. The implementation does
  not rewrite the skill producer; it verifies that baseline and adds engine-owned backstops around
  the still-permissive recorder, completion predicates, daemon boundary, and merged guard.
- **Data:** the existing `.docs/shipped/<slug>.md` schema remains unchanged. The historical audit
  emits a report plus only proven records; no migration or destructive rewrite is required.
- **Git semantics:** checking that a record is part of the candidate commit and that engine HEAD is
  on the pushed PR head is feasible with existing local Git/GitHub runner injection. CI evaluates
  the event's immutable head SHA.
- **GitHub controls:** the existing ruleset can be amended with a required status context while
  retaining its current review and squash-only requirements. The reconciliation Action needs an
  explicit repository-setting change and write permissions; the operator approved that
  prerequisite on 2026-07-25.
- **Performance:** normal engine checks are local file/Git operations plus already-required PR
  verification. The PR Action scans only its candidate association. Full PR-history enumeration is
  confined to the one-time audit/postmerge reconciliation entry point, not daemon polling.
- **Isolation:** no shared mutable service is introduced. Repair branches are deterministic per
  implementation PR and slug, so concurrent/retried jobs converge instead of opening duplicates.

## Alignment

- **ADR 2026-07-03 (committed shipped record):** record-on-implementation-branch, canonical hash,
  stem/hash dedup, and local cache repair are preserved. Its cache-only failure fallback conflicts
  with #916/#936 and is explicitly superseded. ⚠ ADR required.
- **ADR 2026-07-09 (mid-run merged PR guard):** guard placement and live merge-state reuse are
  preserved. Synthetic terminal markers without a record conflict with the durable invariant and
  are explicitly superseded. ⚠ ADR required.
- **ADR 2026-07-06 (daemon false-ship guard) / 2026-07-07 (finish-record primitive):** the strict
  verifier strengthens their fail-closed direction and reuses their terminal commit point. ✔
- **ADR 2026-07-07 (ship CI feedback loop):** the Action and mergeable-watch design reuse existing
  GitHub feedback patterns. ✔
- **ADR-005 (non-autonomy):** repair remains propose-only; a human reviews and merges it. No workflow
  pushes to `main`, approves, or auto-merges. ✔
- **Architecture diagrams:** remain accurate after correcting the baseline from “new protection” to
  “enhance existing ruleset.” No new service/database boundary is introduced. ✔

## Wiring Surface

| Policy/adapter surface | Required production path |
|---|---|
| Strict durable-evidence verifier (new, beside `shipped-record.ts`) | `finish-record-cli.ts`; finish predicate in `artifacts.ts`; `complete-verifier.ts`; daemon verified-ship boundary; merged-PR guard; rekick recovery |
| Deterministic PR association/audit module (new) | read-only PR check adapter; merged-PR reconciliation adapter; one-time audit CLI |
| CLI dispatch (thin) | existing `src/conductor/src/index.ts` detect/dispatch chain; workflow scripts call the built CLI rather than duplicate policy |
| Premerge Action (new, always reports) | `pull_request`; checks immutable PR head; stable context added to ruleset `15933604` |
| Reconciliation Action (new) | merged `pull_request`; deterministic repair branch/PR; runs verifier and posts its repair-head status |
| Existing record generator | #937 producer retained; reused by finish and backfill; renderer/hash/parser schema and story-resolution semantics unchanged |

**Early overlap scan (advisory):** completed successfully. It reports
`src/conductor/src/engine/shipped-record.ts` as overlapping with many local and origin spec branches,
making it the principal merge-risk hotspot. Plan consequence: add strict policy beside that file and
make only compatibility-preserving exports there. The scanner notes that renames/name-only diffs may
not be detected.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| False historical association fabricates shipment evidence | Medium | High | Exact corroborated association; require non-spec implementation diff; ambiguity reports and skips; human reviews backfill diff |
| Required check blocks legitimate non-implementation/repair PR | Low | High | Always-reporting workflow; closed `valid/not-applicable/refusal` result; fixtures for spec-only, docs-only, repair-only, and implementation PRs |
| Action-created repair PR does not trigger normal PR workflow | Certain | High | Creating job invokes the same verifier and posts the stable status on repair HEAD; integration test API payload/context |
| Write-scoped workflow exceeds intended authority | Low | High | Job-scoped minimal permissions; deterministic branch prefix; record-only path allowlist; no review/merge calls; ADR-005 invariant tests |
| Hot shipped-record seam conflicts with concurrent branches | High | Medium | New sibling module, minimal compatible exports, rebase immediately before implementation |
| GitHub ruleset update accidentally weakens existing protection | Low | High | Read-modify-write exact rule inventory; assert PR/review/squash and destructive-update rules before and after; no replacement defaults |
| Current plan content differs from historically implemented content | Medium | Medium | Hash current committed plan only after proven association; report contradictory evidence; human review; never overwrite valid records |

## Approval Decision

The operator approved
`.docs/decisions/adr-2026-07-25-fail-closed-durable-shipment-evidence.md` on 2026-07-25, including
the narrow repository setting that lets the reconciliation Action create (but never approve or
merge) a repair PR. The architecture gate is clear for stories.

## Post-Plan Conformance Pass

**Verdict:** APPROVED — narrowed after current-main verification; no new ADR, condition, or
structural gap.

- **Coverage and dependency shape:** all six accepted stories and all negative paths map to 20
  implementation/verification tasks. Table-driven refusal matrices replace one-task-per-defect
  decomposition, bringing the plan into the normal 1–20 task range while retaining explicit
  negative-path assertions and acyclic dependencies.
- **Boundary fidelity:** new policy stays in sibling `shipment-evidence`, `shipment-association`,
  reconciliation, audit, and protection modules. Existing hot files receive only compatible parser
  exports or production wiring, matching the overlap-risk mitigation.
- **Terminal convergence:** Tasks 1 and 5–8 retain the verified #937/#943 producer and cover every
  unresolved consumer: finish recorder/predicate, complete verifier, daemon outcome, merged guard,
  conductor shortcuts, and rekick. Discovery's permissive boolean remains type- and
  authority-separated from the strict terminal verdict.
- **GitHub boundary:** premerge is read-only and exact-head; reconciliation has job-scoped writes,
  a record-only allowlist, deterministic identity, and explicit API denylists. The creator-posted
  repair status remains required even though current GitHub documentation now describes
  `GITHUB_TOKEN`-created PR workflow runs as approval-required rather than categorically absent;
  that factual clarification strengthens rather than changes the approved unattended-repair design.
- **Protection sequencing:** the implementation supplies a dry-run/apply adapter, but the live
  ruleset mutation is deliberately deferred until the bootstrap check context is observed. Delivery
  is not complete until the post-merge cutover re-reads ruleset `15933604` and the Actions setting
  and proves the exact additive result.
- **Backfill verification boundary:** per operator direction on 2026-07-25, the one-time historical
  backfill adds no dedicated automated audit/backfill fixtures. Tasks 16–18 implement and exercise
  the real audit, complete report, exact record diff, strict verification of every generated record,
  and a diff-free second run. Reusable verifier, association, repair, and discovery behavior remains
  automated-test covered.
- **Hash compatibility boundary:** #943's record is valid under the existing writer's canonical
  resolution. This feature compares against that same behavior; it does not silently change record
  identity or introduce a historical hash migration.
- **Repository release gates:** ordinary documentation, changelog, and VERSION approval remain
  ship-time repository obligations outside `/plan`'s functional-task boundary. The new CLI/check
  must not reach PR creation without satisfying `CLAUDE.md`'s documentation and release rules.
- **Validation:** all three planned Mermaid diagrams render; plan structure is mechanically valid;
  `test/test_harness_integrity.sh` reports 195 passed, 0 failed, and 5 known environment/catalog
  warnings.

## ADRs Created

- `adr-2026-07-25-fail-closed-durable-shipment-evidence` — APPROVED; supersedes the conflicting
  cache-fallback and synthetic-completion clauses while preserving their stable decisions.

## Notes

Sections 3 (complexity already Tier M) and 5 (domain pre-check handled per TDD cycle) are skipped per
lightweight review mode.

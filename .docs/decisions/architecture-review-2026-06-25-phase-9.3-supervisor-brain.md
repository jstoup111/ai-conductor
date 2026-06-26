# Architecture Review: Phase 9.3 — Supervisor / Brain (capstone)

**Date:** 2026-06-25
**Tier:** Large (full review — all sections)
**Stories reviewed:** `.docs/stories/phase-9.3-supervisor-brain.md` (12, FR-1..FR-12)
**Inputs:** PRD `2026-06-25-phase-9.3-supervisor-brain.md`; diagrams
`.docs/architecture/2026-06-25-phase-9.3-supervisor-brain.md`; conflict report
`.docs/conflicts/2026-06-25-phase-9.3-supervisor-brain.md`; ADR-003 (registry), adr-002 (store),
`supervisor-brain-followup.md` §9.3; `registry.ts`/`brain-store.ts` reader contracts.
**Verdict:** **APPROVED WITH CONDITIONS** (4 DRAFT ADRs must reach APPROVED before
`/writing-system-tests`; 3 conditions tracked).

## Feasibility

| Story (FR) | Stack fit | Prereqs | Integration surface | Risk |
|---|---|---|---|---|
| FR-1 loop start / load | ✓ conduct-ts + readers | registry+store readers (exist as types) | registry, store | low |
| FR-2 idea loop / exit | ✓ commander + REPL | — | stdin | low |
| FR-3 routing + confirm | ✓ LLM + prompt | routing inference (ADR-007) | registry | med (non-determinism) |
| FR-4 create-on-no-fit | ✓ reuse 9.2 `create` | ADR-003 create path | registry, fs, git | low |
| FR-5 flywheel read | ✓ store reader | runtime BrainStoreReader impl | store | med (selection) |
| FR-6 author in target repo | ✓ subprocess DECIDE | **ADR-004** (cwd isolation) | git, Claude skills, cross-repo | **high** |
| FR-7 spec PR / no build | ✓ reuse PR machinery | ADR-007 handoff | gh, git | med |
| FR-8 daemon launch (detached), no mgmt | ✓ detached spawn + guard test | ADR-005 | process spawn | low |
| FR-9 governor report | ✓ store reader + rate fn | shared rate fn (ADR-006) | store | low |
| FR-10 non-autonomy gate | ✓ structural test | **ADR-005** | build/merge entry points | **high** |
| FR-11 cross-repo isolation | ✓ canonical path + subprocess | **ADR-004**, ADR-003 realpath | git, fs | **high** |
| FR-12 flywheel measurable | ✓ intersection + rate fn | ADR-006 ledger | store | med |

No new external dependencies. Runtime `RegistryReader`/`BrainStoreReader` implementations are new
(9.2/9.1 shipped types only — expected; the brain owns the read side). All cross-repo/git work is
vitest-testable against real temp repos (PRD AC).

## Complexity

**High** (capstone): 3 cross-component integrations (9.1 store + 9.2 registry + DECIDE skills),
cross-repo git/PR orchestration, a new interactive CLI mode, and a non-negotiable human-gate state
machine. Mitigated by reuse (no parallel planning stack) and by making isolation/non-autonomy
**structural** (ADR-004/005) rather than per-call-site discipline. Not split — the FRs are cohesive
around one loop; splitting would fragment the gate guarantees.

## Alignment

- **Departure from `supervisor-brain-followup.md` §9.3** (broker governor + supervisor-spawns-workers)
  → **captured in ADR-005**; justified by solo scale + fault isolation; §9.3 broker deferred. ✓
- **Reuse over reinvention** (NFR): registry reader (ADR-003), store reader (adr-002), DECIDE skills,
  PR machinery — no second planning path. ✓
- **Default-branch discovery** (memory `feedback_default_branch_discovery`): ADR-004 mandates
  `git symbolic-ref`, never hardcoded `main`. ✓
- **No ad-hoc rebase** (memory `feedback_no_adhoc_rebase`): the brain authors specs only; it runs no
  rebase — the only sanctioned rebase remains 9.0's daemon finish-time mechanism. Impl agents must
  not fetch/rebase/pull in the target repo during authoring. ✓ (tracked as Condition 3)
- **Never auto-merge** (memory `feedback_merge_authorization`): ADR-005 structural no-merge guarantee
  + FR-7/FR-10. ✓
- **Diagram accuracy:** the 9.3 diagrams match the FRs and reader contracts; no drift. ✓

## Domain Integrity

| Principle | Assessment |
|---|---|
| Invalid states unrepresentable | Routing outcome should be a discriminated union (`confirmed{project}` / `redirected{project}` / `create{name}` / `declined`) — **not** booleans like `isConfirmed`. **Condition 1.** |
| Parse, don't validate | A confirmed target should be a parsed `TargetRepo` (canonical path resolved once, ADR-004) threaded thereafter — not a raw path re-validated at each step. |
| Semantic types | `(project, feature)` ledger key and `BrainSignal` reuse 9.1 types; rates use the shared 9.1 metric. |
| Exhaustive matching | No catch-all `default` on routing-outcome / outcome enums — exhaustive switch (the daemon-side convention). |
| No primitive obsession | Idea is free text (boundary input) → parsed into a routing decision; downstream uses typed decisions, not strings. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Authoring leaks into the wrong repo / cwd fallback | Data | Medium | **High** | ADR-004 subprocess cwd isolation + canonical path; stale path → error, no fallback; B/own-repo-untouched test |
| A code path lets brain → build / auto-merge | Security | Low | **High** | ADR-005 structural test: brain imports neither build/pipeline nor merge entry points |
| Flywheel injects noise (irrelevant lessons) | Knowledge | Medium | Medium | ADR-006 per-project + bounded top-N, logged; "no prior lessons" when none relevant |
| FR-12 trend contaminated by non-brain work | Knowledge | Medium | Medium | ADR-006 authored-keys intersection excludes non-brain signals |
| No-remote `create` crashes handoff | Integration | Medium | Medium | ADR-007 non-fatal PR-skip fallback (commit on branch, report) |
| Routing non-determinism makes tests flaky | Technical | Medium | Low | Test the gate behavior (confirm/decline/redirect/zero-writes), not the inferred pick |
| Authored-keys ledger lost across sessions | Data | Low | Medium | ADR-006 durable ledger storage (location decided at build) |

## ADRs Created (all DRAFT — require approval)

- **adr-004** — Brain authoring model + cross-repo isolation (DS-1, DS-5). *Cross-repo safety
  structural via cwd-isolated subprocess + ADR-003 canonical paths.*
- **adr-005** — Non-autonomy by construction + read-only governor (DS-7, FR-8/9/10). *Departs from
  followup §9.3; structural no-build/no-merge guarantee.*
- **adr-006** — Flywheel lesson selection + brain-planned provenance (DS-3, DS-6). *Bounded
  selection; authored-keys intersection, no 9.1 schema change; shared rate fn.*
- **adr-007** — Interactive loop: routing inference + spec-PR handoff (DS-2, DS-4). *LLM routing,
  human-gated; reuse PR machinery; no-remote fallback.*

## Conditions (APPROVED WITH CONDITIONS)

1. **Routing outcome is a discriminated union** (no `is*` booleans); routing/outcome switches are
   exhaustive (no catch-all `default`). Evaluator checks at code review.
2. **Structural non-autonomy test exists and passes** — asserts the brain module imports/invokes
   neither the build/pipeline nor any merge entry point **directly**, and that any daemon launch is
   **detached** (no retained handle/IPC, no supervision/control-state write) (ADR-005). Blocking at
   `/finish` if absent.
3. **Authoring runs no fetch/rebase/pull in the target repo** (memory `feedback_no_adhoc_rebase`);
   impl agents are instructed accordingly. Evaluator checks no rebase machinery is invoked by the brain.

## Gate Status

**HARD GATE:** 4 DRAFT ADRs (004–007) must reach **APPROVED** before `/writing-system-tests`.
Verdict is otherwise APPROVED — no blocking architectural issues.

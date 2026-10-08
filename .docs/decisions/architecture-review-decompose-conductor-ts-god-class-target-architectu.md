# Architecture Review: Decompose conductor.ts — target architecture, roadmap, and module-level evacuation (#1481)
**Date:** 2026-10-07
**Stories reviewed:** none yet (pre-stories review; inputs are the explore decision, the track and complexity markers, and the architecture diagram of this stem)
**Mode:** Lightweight (Tier M): §2 Feasibility and §4 Alignment
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** feature 1 is a TypeScript module move inside `src/conductor/src/engine/`.
  It adds no new dependency. The later ratchet uses the existing `typescript` compiler API.
  Verified, 95%.
- **Prerequisites:** none.
- **Integration surface:**
  - About 12 production importers: `step-runners.ts`, `group-core.ts`,
    `finish-publication-production.ts`, `self-host/build-auth-preflight.ts`,
    `engine/kickback-budget-cli.ts`, `engine/daemon-observe-cli.ts`, `daemon-cli.ts`,
    `daemon-deps.ts`, `daemon-runner.ts`, `index.ts`, `ui/types.ts` and
    `ui/terminal/prompt-host.ts`.
  - One production gate registry: `session-command-audit.ts`.
  - Tests that read `conductor.ts` source text or mock `conductor.js` for moved names. Verified by
    inventory and the adversarial diagram review, 90%. The exact source-reading test set is
    re-derived during BUILD by grepping tests that read `conductor.ts`.
- **Data implications:** none. No schema, state-file or event-shape change.
- **Performance:** none. Module-load order changes only for the pure `Set` construction of
  `AGENT_DISPATCHING_ENGINE_NATIVE_STEPS`. Its source module `skill-invocation.ts` has no
  dependency back on `conductor.ts`. Verified, 90%.
- **Worktree isolation:** no ports, databases or shared state.
- **Compiler constraints:**
  - `noUnusedLocals` (`tsconfig.json`) turns every import left unused by the move into a `tsc`
    error, so the move must prune them.
  - `isolatedModules` requires type-only names to be re-exported with `export type`.
  - Both are mechanical and caught by `tsc`.
- **Release gate:** no waiver needed. `classifyBreakingSurfaces` (`self-host/release-gate.ts`)
  matches only `bin/conduct`, `bin/install`, `hooks/`, `settings*.json` and removed `skills/`.
  Verified by the adversarial review, 90%.
- **testQuality preflight:** materialization deletes added files and restores the merge-base
  content of changed files. Feature 1 adds files and edits files; it deletes no directory. The new
  conductor-shape guard test fails at merge-base, so preflight has a real changed test.
  Verified, 85%.

## Alignment

- **Domain boundaries:** the move respects them. Each destination module groups one topic
  (remediation caps, PRD-audit routing, as-built routing, remediation hints, resume entry,
  build-review halt rendering, step completion, artifact approvals, finish-presentation repair,
  post-finish shipped record, step-runner types, conductor options). No destination crosses into
  `execution/` or `ui/`.
- **Pattern consistency:** this is the established extraction pattern. `step-runners.ts`,
  `group-core.ts` and `finish-publication-production.ts` were all carved out of conductor-adjacent
  code. The re-export shim is new to this repository and is recorded in
  adr-2026-10-07-conductor-decomposition-target-architecture D8 with a removal slice (D7.8).
- **Governing ADRs:**
  - **ADR 002 (amended, step plugins retired):** the target shape keeps step discovery
    compile-time and in-tree (new ADR D2). No conflict.
  - **adr-2026-07-03-generated-model-table-single-source:** the target moves the single source
    without splitting it, and a later slice amends D1 (new ADR D3). Feature 1 does not touch it.
  - **Event-spine principle:** feature 1 adds no channel. The target relocates the emitter rather
    than duplicating it (D7.3).
  - **ADR 001:** superseded in spirit by the engine's existence and already amended. This ADR does
    not supersede it, because it governs the harness composition, not the engine's internal module
    structure.
- **Diagram accuracy:** `.docs/architecture/decompose-conductor-ts-god-class-target-architectu.md`
  (operator-approved) reflects feature 1 and the target. The repo-wide intended layering in
  `docs/contributing/code-organization.md:176` is stale; slice 3 corrects it.
- **Security boundaries:** the engineer's non-autonomy containment test currently pins only
  `conductor.ts`. Moving the push-capable code (`pushPostFinishShippedRecord`, finish-presentation
  repair) requires extending that test to the new modules (condition C3).
- **Production DI defaults:** unchanged. No store implementation moves.

## Wiring Surface

Each new module is called from production code that already exists:

| New module | Production callers |
|---|---|
| `step-runner-types.ts` | Type-only; `class Conductor`, `step-runners.ts`, `group-core.ts`, `finish-publication-production.ts`, `self-host/build-auth-preflight.ts` |
| `conductor-options.ts` | `class Conductor` constructor; `daemon-cli.ts`, `daemon-deps.ts`, `daemon-runner.ts`, `ui/types.ts`, `ui/terminal/prompt-host.ts` |
| `remediation-caps.ts` | `class Conductor`; `step-runners.ts`; `engine/kickback-budget-cli.ts`; `engine/daemon-observe-cli.ts` |
| `prd-audit-routing.ts` | `class Conductor`; `step-runners.ts` (`prdAuditScopeProjection`) |
| `as-built-routing.ts`, `remediation-hints.ts`, `remediation-task-append.ts`, `resume-entry.ts`, `build-review-halt-render.ts`, `step-completion.ts`, `artifact-approvals.ts` | `class Conductor` (`run()` and its private methods), unchanged call sites |
| `finish-presentation-repair.ts` | `class Conductor`; `daemon-cli.ts` and `index.ts` (`createProvenanceGuardedFinishPresentationRepair`) |
| `post-finish-shipped-record.ts` | `class Conductor` finish path |
| `MANAGED_DISPATCH_PROMPT_SURFACES` (changed entry) | Existing session-command audit gate |

`conductor.ts` stays the class's home, reached from `index.ts` and `daemon-cli.ts`. Its shim
re-exports today's exported names only.

**Early overlap scan (advisory):** `ai-conductor overlap-scan` over the wiring paths reported
overlap with `origin/spec/daemon-self-host-guardrails` and `origin/spec/self-host-phase6-wiring`.
Both branches were last committed on 2026-07-01 and appear stale. Live parallel-lane churn on
`conductor.ts` is the real risk (risk R1).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1. An in-flight lane edits moved module-level code in `conductor.ts`; its rebase re-adds code next to the shim | Integration | High | Medium | The conductor-shape guard test fails the rebased lane at its own build; the lane re-applies its change in the new module |
| R2. A gate keyed on the file name `conductor.ts` silently stops matching (`MANAGED_DISPATCH_PROMPT_SURFACES`, or another such gate) | Security | Medium | High | Re-point the known registry in the same task (C1). BUILD greps `src/` for `'conductor.ts'` string literals and re-points any other match |
| R3. Tests asserting `conductor.ts` source text fail | Technical | High | Low | Retarget them in the same diff (C2); `tsc` plus the suite catch any miss |
| R4. Push-capable code leaves the engineer containment check | Security | Medium | High | Extend `non-autonomy.test.ts` to the new modules (C3) |
| R5. A stale `vi.mock('…/conductor.js')` of a moved function becomes a silent no-op | Technical | Medium | Low | Retarget the mock to the new module (C2) |
| R6. A large move diff hides an accidental logic edit | Technical | Low | High | Move code verbatim; the plan forbids edits beyond imports and exports; `build_review` diff review plus the unchanged suite |

## ADRs Created

- `adr-2026-10-07-conductor-decomposition-target-architecture.md`, Status APPROVED by the operator
  on 2026-10-07. It is a structural decision (component decomposition plus enforced layer boundaries),
  and no existing ADR governs the engine's internal module structure.

## Conditions

- **C1.** `MANAGED_DISPATCH_PROMPT_SURFACES` points at the module that defines `buildRetryHint`
  and `buildRemediationHint`, in the same task that moves them. BUILD also re-points any other
  file-name-keyed reference to `conductor.ts` it finds.
- **C2.** Every test that reads `conductor.ts` source text (about 58) is sorted in the plan:
  - **Positive scans** that locate moved code retarget to the new module.
  - **Negative scans** (`not.toContain` / `not.toMatch` / `toEqual([])`, about 47, e.g.
    `no-operator-credential-coupling.test.ts`, `provider-id-literals.test.ts`) widen to cover the
    new modules as well. Otherwise they would keep passing over code that has moved away.
  - `vi.mock('…/conductor.js')` factories that stub moved names consumed by migrated production
    importers move to the new module. Named instance: `daemon-state-refusal-event.test.ts`, which
    stubs `createProvenanceGuardedFinishPresentationRepair`, now imported by `daemon-cli.ts` from
    `finish-presentation-repair.ts`.
- **C3.** `non-autonomy.test.ts` containment covers the new push-capable modules.
- **C4.** (A regression test for the refactor's own invariant, not a new pipeline gate.) A
  conductor-shape AST guard test asserts that `conductor.ts` contains only imports, the
  re-export shim, the listed class-only tunables (exported tunables such as
  `MAX_RECOVERY_RETRIES` are allowed) and `class Conductor`. The same guard asserts that no
  module under `src/` other than `index.ts` and `daemon-cli.ts` value-imports `conductor.js`, and
  that those two import only `Conductor`.
- **C5.** The shim re-exports only names that are exported today; type-only names use
  `export type`.
- **C6a.** Same-diff reference upkeep: `test/engine/config-consumer-registry.ts` entries mapping
  the `prd_audit.*` and `kickback_escalation` keys to `conductor.ts` move to their new modules.
  Stale `conductor.ts` line references in contributor docs (for example
  `docs/contributing/extending.md`) are documentation, outside this spec's stories and plan.
- **C6.** Code moves verbatim: no logic change, renames only where a name clash forces them
  (`appendRemediationTasks`), and every rename is recorded in the plan.

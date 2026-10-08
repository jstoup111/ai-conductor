# ADR: Conductor decomposition — target architecture and ordered roadmap

**Date:** 2026-10-07
**Status:** APPROVED
**Deciders:** Operator (James Stoup), via composer DECIDE for jstoup111/ai-conductor#1481

## Context

`src/conductor/src/engine/conductor.ts` is the module every build path runs through. It has grown
from 9,930 lines (2026-08-10 assessment) to 17,209 lines. Measured on 2026-10-07:

- `class Conductor` spans lines 2254–16436, with 103 methods, 74 private fields and 158 import
  statements. `run()` alone spans lines 7242–15142, which is 7,901 lines.
- Per-step behavior is selected by `if`/ternary chains on `step.name` inside `run()`. For example,
  `run()` contains more than 27 `step.name === 'build'` checks. It is not a lookup.
- About 2,950 lines are module-level declarations outside the class: 59 exports and 41 free
  functions. No module-level item references `Conductor`. `engine/step-runners.ts:36`
  value-imports two of them, so the extracted collaborator depends back on the god module.
- Adding a step is shotgun surgery. `coverage_binding` (#2135) touched 28 non-test files, 17 of
  them carrying step-name literals. The step-keyed tables are `Record<StepName,…>` (tsc-complete)
  or unchecked `Partial` maps and sets, all hand-edited.
- Layering is nominal. A one-off TypeScript import scan on 2026-10-07 found 9 value-import
  strongly-connected components (sizes 18, 7, 5, 4, and five of size 2). Slice 2 makes this
  reproducible. They include including an
  engine↔execution group around `execution/provider-catalog.ts`. Edge counts:
  - engine→ui: 12 value edges. Engine value-imports `ConductorEventEmitter` from `ui/events.ts`.
  - execution→engine: 13 value edges. This contradicts the "0" stated at
    `docs/contributing/code-organization.md:176`.
- There is no import-boundary tooling. The only import scanner is a regex in
  `test/engine/engineer/non-autonomy.test.ts`.
- Git access has 7 incompatible `GitRunner` shapes (29 declarations) plus ad-hoc helpers, and 35
  files spawn `git` directly. `conductor.ts` aliases one variant (`RebaseGitRunner`).
- Parallel daemon lanes conflict most on central hand-edited files. 78 of the last 491 commits
  touched `conductor.ts`. The operator's direction (#1481 comment, 2026-08-16) is vertical slices
  plus no central edit points: convention over registration, generated hot files, and keyed or
  append-only shared state.

Governing decisions this ADR must respect:

- **ADR 002** (plugin manifest and discovery): its amendment retired the `step` and `hook`
  plugin kinds (commit 248de5eacf).
- **adr-2026-07-03-generated-model-table-single-source** (D1): `STEP_RATIONALE:
  Record<StepName>` is the tsc-checked single source.
- **The event-spine principle** (CLAUDE.md).

## Options Considered

### Option A: Unify the git port first (the filer's hypothesis)
- **Pros:** Behavior-neutral and easy to understand. Removes the alias.
- **Cons:** About 30+ files change, so it conflicts heavily with parallel lanes. It does not shrink
  `conductor.ts` or `run()`, and nothing prevents the variants from drifting apart again.

### Option B: Import-graph ratchet first
- **Pros:** Mechanical enforcement for every later slice.
- **Cons:** It ships no decomposition. As first proposed, with one baseline file plus a size
  budget, it adds a new central edit point. 78 of the last 491 commits touched `conductor.ts`
  (`git log --oneline -491 -- src/conductor/src/engine/conductor.ts`), so a size gate would hit
  roughly 1 in 6 features doing unrelated work. It also builds no decomposition for the ratchet to
  protect yet.

### Option C: Generated step registry first
- **Pros:** Directly attacks the step-addition shotgun surgery and the conflict hot spots.
- **Cons:** The largest and riskiest slice, about 20 central tables. It must first reconcile
  generation with ADR 002's step-plugin retirement and with the model-table ADR.

### Option D: Move module-level code out first, then ratchet, then deeper slices (chosen)
- **Pros:** Real decomposition through a mechanical, behavior-preserving diff (about 17% of the
  file) in the refactor lane. Removes the `step-runners → conductor` value back-edge. Low conflict
  surface, because the test files stay untouched behind a shim.
- **Cons:** Leaves `run()` untouched for now. The transitional shim keeps `conductor.js` as a
  facade until a later slice removes it.

## Decision

1. **Target shape: vertical per-step slices with no hand-edited central registries.** Each engine
   step's definition, runner, gates and step-specific loop behavior live together under one
   in-tree directory per step. Step-keyed tables (rationale, retries, review, model policy,
   artifact contracts, skill maps) are **generated from** the slices into tsc-complete
   `Record<StepName,…>` modules. The generator has a `--check` mode, wired into
   `test/test_harness_integrity.sh` following the `bin/generate-model-table` precedent. Adding a
   step then touches its own slice plus regenerated files only.

2. **Step slices are compile-time and in-tree, not plugins.** Discovery happens at build or
   generation time over the source tree. It does not revive the `step` plugin kind retired by
   ADR 002's amendment, and there is no runtime manifest loading for steps.

3. **The model-table single source moves, not splits.** When the registry slice lands, it amends
   adr-2026-07-03-generated-model-table-single-source D1: `STEP_RATIONALE` remains one
   tsc-complete record, generated from slice-local declarations instead of hand-edited. The
   amendment is part of that slice, not this ADR.

4. **`run()` becomes a thin phase pipeline.** The step loop decomposes into named phase modules
   (skip cascade, gate check, dispatch, retry, failure/kickback, success/advance). Step-specific
   branches move behind per-step hooks that the slice provides, replacing `step.name ===` chains.

5. **Layering is enforced by machinery with a keyed, shrink-only allowlist.**
   - The layering is `types ← execution ← engine ← ui ← entry`.
   - A TypeScript-AST import-graph check (using the `typescript` dependency already present; no
     madge or dependency-cruiser) fails on any new value-import cycle or new upward value edge.
   - Today's violations are allowlisted as **one file per allowed edge**. That covers every
     upward value edge (engine→ui spine imports, execution→engine) and every value edge inside an
     existing SCC. Any unlisted value edge that runs against the layer order, or that closes a
     cycle, fails. Removing an edge deletes a file, so parallel
     lanes never conflict on a shared baseline.
   - The check fails when an allowlisted edge no longer exists, so the allowlist can only shrink.
   - There is **no file-size, line-count or net-growth budget** on `conductor.ts` or
     `class Conductor`, whether as a central baseline or as a diff-relative check. This is an
     operator decision taken knowing the file grows about 1,000 lines a week, so feature 1's
     reduction may be regained within weeks. New code gets a home through phase and slice
     extraction (slices 6–7), not through a gate that fails unrelated features.

6. **One git port.** All git execution goes through a single port type and production adapter.
   The other shapes and direct `git` spawns migrate to it. Once it lands, the ratchet forbids new
   direct spawns outside the adapter.

7. **Ordered roadmap.** Each slice is its own spec and feature and is behavior-preserving. Each
   later slice is filed as its own intake issue, in this order:
   - **Slice 1 — Module-level evacuation** (this ADR's feature 1; see D8). Tracked by #1481.
   - **Slice 2 — Import-graph ratchet** (D5). Tracked by the existing #1988, including the shim and the conductor-shape guard in its
      allowlist model.
   - **Slice 3 — Break the engine↔execution SCC (#3042) and relocate the event emitter** so engine stops
      value-importing `ui/` (the existing #1017). Tightens the ratchet.
   - **Slice 4 — Single git port** (D6). Tracked by #3043.
   - **Slice 5 — Generated step registry** (D1–D3), with the model-table ADR amendment. Tracked by #3044.
      - This slice creates declaration-only `steps/«name»/` directories. Each exports a value
        checked against a required `StepSlice` interface with `satisfies`, which gives
        completeness by construction.
      - `StepName` is **not** derived from discovery alone. The generator cross-checks discovered
        slices against the declared step list, so a missing slice or a missing table entry fails
        rather than passing trivially.
      - Slice 7 later moves behavior into those same directories.
      - Removing a step becomes a directory deletion, so it follows CLAUDE.md's two-feature
        deletion rule.
   - **Slice 6 — `run()` phase extraction** (D4). Tracked by #3045. It may span several features, one phase per feature,
      ordered skip cascade → gate → dispatch → retry → failure → success.
   - **Slice 7 — Per-step slice directories** (#3046). Step-specific branches move from the phases into slice hooks.
   - **Slice 8 — Remove the `conductor.js` re-export shim** (#3047). Tests migrate to the real modules, and the
      ratchet forbids importing moved names through `conductor.js`.
   - **Slice 9 — Rename the remaining `conduct` contract strings** (#3048), coordinated with #2048.
      `CANONICAL_BREAKING_SURFACES` (`'bin/conduct CLI'`), the PR template and the release-section
      contract change together. This includes internal `conduct`/`conduct-ts` identifiers such as
      `CONDUCT_TS_FAILURE`, plus the allowlist entries in `test/test_no_legacy_cli_references.sh`.

   Later slices may be re-specced or re-ordered by their own DECIDE. This order records the
   dependency reasoning: the ratchet protects every later gain, and phase extraction precedes slice
   directories because slices need phase hooks.

8. **Feature 1: move module-level code out of `conductor.ts`.**
   - Every declaration outside `class Conductor` moves into topical engine modules. That includes
     `writeBuildOutcomeBestEffort`, which sits among the imports. Only class-only tunables stay
     (`MAX_RECOVERY_RETRIES`, `MAX_RATE_LIMIT_DEADLINE_MS`, `PUBLICATION_REDISPATCH_BUDGET`,
     `MAX_GATE_SELECTIONS`, `DONE_MARKER`, `LOOP_HALT_MARKER`).
   - Shared constants move with their non-class users. `MAX_KICKBACKS_PER_GATE` moves to the
     remediation-caps module.
   - No new production module imports `conductor.ts`. Test files may import it to exercise the shim.
   - `conductor.ts` re-exports, via `export … from` and `export type … from`, **only the names it
     exports today**.
   - Production importers migrate to the new modules. The `Conductor` class import stays.
   - Same-diff obligations:
     - Re-point `MANAGED_DISPATCH_PROMPT_SURFACES` (`session-command-audit.ts`) to the module that
       now defines `buildRetryHint` and `buildRemediationHint`.
     - Retarget the source-text and `vi.mock` tests that locate moved code.
     - Extend `non-autonomy.test.ts` containment to the new push-capable modules.
     - Add a conductor-shape AST guard test asserting `conductor.ts` holds only imports, the shim,
       the listed tunables and `class Conductor`.
   - Observable behavior is unchanged.

## Consequences

### Positive
- `conductor.ts` drops about 2,950 lines immediately, and extracted collaborators stop depending
  on the god module.
- Every later slice has a measurable, machine-enforced endpoint, and the allowlist can only shrink.
- The step-addition touch count converges on "the step's own slice plus generated files". That
  removes the central hand-edit sites where parallel lanes conflict.
- There is one git concept and one import-graph check instead of 7 shapes and convention.

### Negative
- The roadmap is long, roughly 9 or more features, and some slices (phase extraction, the
  registry) carry real merge pressure against in-flight lanes while they land.
- Until slice 8, `conductor.js` remains a facade. Tests reach moved code through it, which hides
  the real coupling.
- Generated tables add a generator to maintain and a `--check` to keep green.
- The ratchet allowlist starts large and records existing debt rather than fixing it.

### Follow-up Actions
- [ ] Feature 1 (this spec): module-level evacuation per D8.
- [x] Intake issues for roadmap slices 2–9 (D7): #1988 (existing), #3042 with #1017 (existing), #3043, #3044, #3045, #3046, #3047 and #3048, chained in D7 order.
- [ ] Slice 5 amends adr-2026-07-03-generated-model-table-single-source D1.
- [ ] Slice 3 corrects `docs/contributing/code-organization.md:176` (execution→engine is not 0).

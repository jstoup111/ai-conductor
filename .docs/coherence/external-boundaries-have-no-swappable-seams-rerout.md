# Coherence: External-boundary registry and ratchet (#1989)

**Plan:** .docs/plans/external-boundaries-have-no-swappable-seams-rerout.md
**Stories:** .docs/stories/external-boundaries-have-no-swappable-seams-rerout.md
**Track:** technical, so there are no FR rows. **Tier:** L.
**Source-Ref:** jstoup111/ai-conductor#1989

outcome-1 is delivered by the per-boundary migrations (#3043 and #3633–#3639). It is waived in
`.docs/coherence-waivers/external-boundaries-have-no-swappable-seams-rerout.md`, and the waiver names each home.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-3 | gap | For each external boundary, the place where its implementation is chosen is a single wiring/configuration point per entry point (`conduct` CLI, daemon); switching source or destination requires no edits to core engine modules. — outcome-1: story-3 makes production-adapter imports outside composition roots fail mechanically, which is the enforcement half. The single per-entry-point wiring point lands with each boundary's migration: git #3043, llm #3633, process #3634, otel #3635, filesystem #3636, gh #3637, clock #3638 and tmux #3639 (ADR D2, D6). Waived in `.docs/coherence-waivers/external-boundaries-have-no-swappable-seams-rerout.md`. |
| outcome | outcome-2 | story-1, story-2 | covered | The full set of external-boundary interfaces is enumerable in one place, and a newly added external call that bypasses them is rejected mechanically before merge. |
| outcome | outcome-3 | story-4 | covered | Existing behavior is unchanged for every current adapter; the migration can land boundary-by-boundary rather than big-bang. |
| story | story-1 | task-1 | covered | Every external boundary is enumerable in one registry |
| story | story-2 | task-2, task-3, task-4, task-7 | covered | A new direct external call in an unlisted file fails before merge |
| story | story-3 | task-5, task-7 | covered | Production adapters are imported only by adapters and composition roots |
| story | story-4 | task-6, task-7 | covered | The allowlist only shrinks and stays well-formed |
| task | task-1 | story-1 | covered | Serves story 1. |
| task | task-2 | story-2 | covered | Serves story 2. |
| task | task-3 | story-2 | covered | Serves story 2. |
| task | task-4 | story-2 | covered | Serves story 2. |
| task | task-5 | story-3 | covered | Serves story 3. |
| task | task-6 | story-4 | covered | Serves story 4. |
| task | task-7 | story-2, story-3, story-4 | covered | Serves story 2, story 3, story 4. |
| adr | adr-2026-11-07-external-boundary-ports-registry-and-ratchet | story-1, story-2, story-3, story-4 | covered | The decision-by-decision plan mapping is in the plan's Architecture Obligation Coverage, judged under §4f. D2 is `no-change` because `Boundaries` and root construction land with #3043. |

## Criteria

| Row class | Criterion | Task id(s) | Verdict | Done when quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Story 1 happy: Given the boundary registry, when it is read, then it holds exactly eight entries, named `llm`, `git`, `gh`, `tmux`, `process`, `clock`, `otel` and `filesystem`. | 1 | covered | "asserts `Object.keys(BOUNDARY_REGISTRY)` equals exactly `llm`, `git`, `gh`, `tmux`, `process`, `clock`, `otel` and `filesystem`" | diff-local |
| criterion | Story 1 happy: Given the `llm` entry, when it is read, then its status is ported, its port is `LLMProvider`, and its adapter modules are `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts`. | 1 | covered | "asserts status `ported`, port `LLMProvider`, and adapter modules `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts`" | diff-local |
| criterion | Story 1 happy: Given each of the other seven entries, when it is read, then its status is pending, it names its open follow-on intake issue (`process` #3634, `otel` #3635, `filesystem` #3636, `gh` #3637, `clock` #3638, `tmux` #3639, `git` #3043), and it lists no adapter modules. | 1 | covered | "each other entry has status `pending` with issue process 3634, otel 3635, filesystem 3636, gh 3637, clock 3638, tmux 3639 and git 3043, and an empty adapter list" | diff-local |
| criterion | Story 1 negative: Given a registry edited to drop one of the eight boundaries or add a ninth, when the structural test suite runs, then the registry completeness check fails and names the missing or extra boundary. | 1 | covered | "a fixture registry missing `clock` or carrying an extra `network` key makes the completeness helper report that name" | diff-local |
| criterion | Story 1 negative: Given an entry whose registered adapter module path does not exist under `src/conductor/src/`, when the structural test suite runs, then the check fails and names that entry and path. | 1 | covered | "for a fixture entry with adapter `execution/missing.ts` it returns that entry name and path" | diff-local |
| criterion | Story 1 negative: Given a pending entry that names no issue number, when the registry is type-checked, then compilation fails, because a pending status without an issue cannot be expressed. | 1 | covered | "so a pending status without an issue number fails compilation" | diff-local |
| criterion | Story 2 happy: Given the current source tree and the seeded allowlist, when the boundary ratchet test runs, then it passes with no violations. | 7 | covered | "asserts zero violations and a scanned-file count greater than zero" | diff-local |
| criterion | Story 2 happy: Given a file that imports a boundary port only as a type, when the ratchet runs, then the file is not reported as a touch. | 2 | covered | "reports no touch for `import type { Stats } from 'node:fs'` or `import { type Stats } from 'fs'`" | diff-local |
| criterion | Story 2 happy: Given a registered adapter module that imports its own boundary's external specifier, when the ratchet runs, then that touch passes without an allowlist line. | 2 | covered | "no violation when the importing file is a registered adapter of that boundary" | diff-local |
| criterion | Story 2 negative: Given an unlisted `src/` file that adds `import { readFile } from 'node:fs/promises'`, when the ratchet runs, then it fails, naming the file, the line, and the boundary `filesystem`. | 2 | covered | "reports an `unlisted-touch` violation naming file `engine/a.ts`, line 1 and boundary `filesystem`" | diff-local |
| criterion | Story 2 negative: Given an unlisted file that adds a bare-specifier `import fs from 'fs'` or a dynamic `await import('node:child_process')`, when the ratchet runs, then it fails, naming the `filesystem` or `process` boundary respectively. | 2 | covered | "reports `filesystem` for a bare `import fs from 'fs'` and for `export { x } from 'fs'`, `process` for `await import('node:child_process')`" | diff-local |
| criterion | Story 2 negative: Given an unlisted file that adds `Date.now()`, zero-argument `new Date()`, or `performance.now()`, when the ratchet runs, then it fails, naming the boundary `clock`. | 3 | covered | "reports an `unlisted-touch` violation with boundary `clock` and the expression's line for each of `Date.now()`, `new Date()`, `new Date` and `performance.now()`" | diff-local |
| criterion | Story 2 negative: Given an unlisted file that adds `new Date(timestamp)` with an argument, when the ratchet runs, then it does not report a `clock` touch. | 3 | covered | "reports no `clock` touch for `new Date(timestamp)`" | diff-local |
| criterion | Story 2 negative: Given an unlisted file that adds `execa('git', ['status'])` with `execa` imported from `execa`, when the ratchet runs, then it fails, naming both `git` and `process`. | 4 | covered | "reports unlisted touches naming both `git` and `process` for `execa('git', ['status'])` with `execa` imported from `execa`" | diff-local |
| criterion | Story 2 negative: Given an unlisted file that calls a locally defined function named `execa` with the literal `'git'`, when the ratchet runs, then it does not report a `git` touch. | 4 | covered | "reports no `git` touch for a call to a locally declared function named `execa` with the literal `'git'`" | diff-local |
| criterion | Story 2 negative: Given an unlisted file that adds an import of `@opentelemetry/api`, when the ratchet runs, then it fails, naming the boundary `otel`. | 2 | covered | "and `otel` for `@opentelemetry/api`" | diff-local |
| criterion | Story 2 negative: Given a violation for a pending boundary, when the failure message is printed, then it names that boundary's follow-on issue, and for a ported boundary it names the registered adapter modules to use instead. | 2 | covered | "output for a pending-boundary violation contains `pending #3636`, and for a ported-boundary violation contains each registered adapter module path" | diff-local |
| criterion | Story 3 happy: Given an entry-layer file directly under `src/conductor/src/`, when it value-imports a registered `llm` adapter module, then the ratchet passes it without an allowlist line. | 5 | covered | "reports no violation for top-level `cli.ts` value-importing a registered `llm` adapter with an empty allowlist" | diff-local |
| criterion | Story 3 happy: Given a seeded allowlist line for an existing non-root importer of an `llm` adapter, when the ratchet runs, then that import passes. | 7 | covered | "asserts that the allowlist contains `execution/provider-catalog.ts -> llm` and that the check reports no violation for that file's value import of a registered `llm` adapter" | diff-local |
| criterion | Story 3 negative: Given an unlisted `engine/` file that adds a value import of `execution/claude-provider.ts`, when the ratchet runs, then it fails, naming the file, the line, the boundary `llm`, and the rule that only composition roots import adapters. | 5 | covered | "whose formatted message names `engine/a.ts`, the import line, `llm` and `only composition roots import adapters`" | diff-local |
| criterion | Story 3 negative: Given an unlisted `engine/` file that adds a type-only import from `execution/claude-provider.ts`, when the ratchet runs, then it does not report an adapter-import touch. | 5 | covered | "reports no adapter touch for a type-only import from `execution/claude-provider.ts`" | diff-local |
| criterion | Story 3 negative: Given a file nested one directory below `src/conductor/src/` (for example `engine/cli-entry.ts`), when it value-imports a registered adapter without an allowlist line, then the ratchet fails, because only top-level entry files are composition roots. | 5 | covered | "reports a violation for nested `engine/cli-entry.ts` value-importing it" | diff-local |
| criterion | Story 4 happy: Given the seeded `boundary-allowlist.txt`, when it is read, then every line has the form `«file» -> «boundary»`, the lines are in strictly ascending order, and every line matches a current touch that is not otherwise permitted. | 7 | covered | "every line of the committed `boundary-allowlist.txt` parses as `«file» -> «boundary»`, the lines are strictly ascending, and the check reports no `stale-entry` for any line" | diff-local |
| criterion | Story 4 happy: Given a migration that removes every `fs` import from a listed file, when the matching allowlist line is deleted in the same change, then the ratchet passes. | 6 | covered | "returns no violation for a fixture where `engine/a.ts` no longer imports `fs` and its `engine/a.ts -> filesystem` line is removed" | diff-local |
| criterion | Story 4 negative: Given an allowlist line whose file no longer touches that boundary, when the ratchet runs, then it fails as a stale entry and names the line to delete. | 6 | covered | "reports a `stale-entry` violation naming the line `engine/a.ts -> filesystem` when `engine/a.ts` has no fs touch" | diff-local |
| criterion | Story 4 negative: Given an allowlist line for a file that has become a registered adapter for that boundary, when the ratchet runs, then it fails as a stale entry, because the touch is now permitted. | 6 | covered | "and when `engine/a.ts` is a registered filesystem adapter" | diff-local |
| criterion | Story 4 negative: Given an allowlist line that is out of order or duplicated, when the ratchet runs, then it fails as a malformed entry and names the line. | 6 | covered | "reports a `malformed-entry` violation naming the line for an out-of-order line, a duplicated line" | diff-local |
| criterion | Story 4 negative: Given an allowlist line naming a boundary that is not in the registry, such as `src/x.ts -> network`, when the ratchet runs, then it fails as an unknown-boundary entry. | 6 | covered | "reports an `unknown-boundary` violation for `src/x.ts -> network`" | diff-local |
| criterion | Story 4 negative: Given an allowlist line missing the ` -> ` separator or with an empty side, when the ratchet runs, then it fails as a malformed entry. | 6 | covered | "a line without ` -> `, and lines with an empty file or boundary side" | diff-local |

## Judgement Record

- **Coverage (plan §7a).** Fresh subagents ran this pass. Round 1 asserted 29 of 29 claims. After the coherence revisions, round 2 also asserted 29 of 29.
- **§4f and §4g, round 1 (fresh opus subagent).**
  - Rows 10, 11, 12, 14, 16 and 17 were uncertain. The ratchet tasks used only a synthetic registry, and no check pinned the real registry's specifiers, clock calls or command literals. The real-tree test did not print the formatted failure message.
  - D1 failed: its evidence asserted only the names. D4 failed: the process-adapter-export callee was unimplemented.
  - Fixes:
    - Task 1 gained a membership check against ADR D1.
    - Tasks 2–4 assert under the real `BOUNDARY_REGISTRY`.
    - Task 4 gained the process-adapter-callee case.
    - Task 7 prints `formatBoundaryViolations` as the assertion message.
- **§4f and §4g, round 2 (fresh opus subagent).** All five findings were resolved. The round found one new sequencing defect: Task 4 needed `resolveSpecifier`, which only Task 5 exported. Fix: the export moved to Task 2, which Tasks 4 and 5 both depend on. Two wording nits were also corrected.
- **Factual premises verified against the code.** `execution/provider-catalog.ts` and `execution/pi-self-host-auth.ts` value-import `llm` adapters. `layerFor` and `resolveSpecifier` exist unexported in `layer-ratchet.ts`. `readAllowlistEntries` is exported. `typecheck:test` covers `test/`.

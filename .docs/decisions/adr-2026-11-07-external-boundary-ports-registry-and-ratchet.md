# ADR: External boundaries are ports wired at composition roots, enumerated in one registry and held by a shrink-only ratchet

**Date:** 2026-11-07
**Status:** APPROVED
**Deciders:** operator (James Stoup)

<!-- Filename convention: adr-2026-11-07-external-boundary-ports-registry-and-ratchet.md. Cite by filename stem. -->

## Context

Intake #1989 asks that each external boundary be swappable from one wiring point per entry point,
that the boundaries be enumerable in one place, and that a new call bypassing them be rejected
before merge. The migration must be able to land one boundary at a time.

A grep of `src/conductor/src/` (713 `.ts` files) on 2026-11-07 measured these externals:

- `node:fs` / `fs/promises`: 264 importing files (243 in `engine/`).
- `Date.now()` / `new Date()`: 91 files.
- `execa`: 54 files.
- `child_process`: 31 files.
- `@opentelemetry/*`: 9 files.
- `chokidar`: 1 file.
- Literal `git` spawns (`execa('git'`, `execFile('git'`, and similar): 132 call sites in 49 files.
  A further 14 files pass `git` through runner variables.

`docs/contributing/code-organization.md` says `execution/` is "the only layer permitted to reach a
third party in ordinary code paths". No mechanism holds that rule, and `engine/` violates it in
about 300 files.

Today, adapters are chosen at call sites through default parameters, for example
`run: TmuxRunner = defaultTmuxRunner` in `engine/daemon-tmux.ts` and `makeGitRunner(cwd)` in
`engine/rebase.ts`. LLM adapters are registered by engine code
(`registerBuiltInLlmProviders` in `engine/plugin-loader.ts` and `engine/engineer-cli.ts`). The only
named port today is `LLMProvider` in `execution/llm-provider.ts`.

Governing ADRs reused here, not duplicated:

- `adr-2026-10-07-conductor-decomposition-target-architecture`:
  - **D5:** layering `types ← execution ← engine ← ui ← entry`, enforced by a TypeScript-AST ratchet
    with a sorted, shrink-only `from -> to` allowlist (`test/structural/layer-ratchet.ts`,
    `layer-allowlist.txt`).
  - **D6:** one git port. Once it lands, the ratchet forbids direct git spawns outside the adapter.
  - **D7:** the ordered roadmap. Slice 4, the git port, is tracked by #3043.
- `adr-2026-10-12-enforced-source-layer-directions`:
  - **Decision 3:** UI construction happens at entry-level composition.
  - **Decision 4:** a lower layer receives engine behavior through an injected port.
  - This ADR applies the same composition-root and injected-port rules to external boundaries.
- `adr-009-intake-adapter-port` and `adr-2026-07-22-canonical-tracker-client-seam` define narrower
  ports for particular collaborators. They remain valid, and those seams become adapters behind
  the gh boundary when it migrates.

No APPROVED ADR governs external boundaries as a class. This ADR records that integration-pattern
decision.

## Options Considered

### Option A: Ports with composition-root injection, plus registry and ratchet (chosen)
- **Pros:** Dependencies stay explicit in signatures. It matches the existing injected-runner test
  style and the documented `execution/` rule. It reuses the D5 scanner conventions. Each boundary
  migrates on its own.
- **Cons:** Each migration threads a port through its call chains, so the follow-on features are
  real work.

### Option B: An ambient boundary registry looked up at call sites
- **Pros:** Each call site migrates with a one-line change.
- **Cons:** It is hidden global state. Tests must install and reset adapters, which conflicts with
  the repository's Test Process Isolation rule (cached imports retain real implementations). The
  dependencies disappear from signatures.

### Option C: Only extend the layer ratchet so that `execution/` is the sole external layer
- **Pros:** Cheapest option.
- **Cons:** It provides no swap point, because adapters are still chosen at call sites through
  defaults. It fails #1989's first outcome.

## Decision

Adopt **Option A**.

1. **The external boundaries are exactly eight: `llm`, `git`, `gh`, `tmux`, `process`, `clock`,
   `otel`, and `filesystem`.**
   - `process` is any child-process spawn, through `node:child_process` or `execa`.
   - `git`, `gh` and `tmux` are spawns of those binaries.
   - `clock` is a wall-clock or monotonic read: `Date.now()`, zero-argument `new Date()`, or
     `performance.now()`. Timers (`setTimeout`, `setInterval`) are out of scope.
   - `otel` is any import of `@opentelemetry/*`.
   - `filesystem` is any import of `node:fs`, `fs`, `node:fs/promises`, `fs/promises`, or
     `chokidar`. `node:os` and `node:path` are out of scope.

   Adding a ninth boundary is a change to the registry (decision 3), not a new ADR.

2. **Each boundary has one port, and production adapters are chosen only at composition roots.**
   - **Ports:** a boundary's port is a TypeScript interface. The ports are collected in one
     `Boundaries` record type in `types/`.
   - **Adapters:** production adapters live in `execution/` and implement their ports.
   - **Factory:** `createProductionBoundaries()` in `execution/` builds the production record.
   - **Roots:** a composition root is an entry-layer file in the D5 sense, meaning any `.ts` file
     directly under `src/conductor/src/`. Each root builds the record once and injects it.
   - **Core code:** `engine/` and `ui/` code receives a port (or a narrow `Pick` of
     `Boundaries`) through parameters or constructor options. It never takes a production adapter
     as a default parameter value, and it never imports one.
   - **Required, never optional:** a port parameter or option is required, never optional
     (`?:`). An omitted port at a production composition site is then a compile error rather than
     a silently absent dependency. That failure class is recorded in #1586.
   - **First consumer:** the `Boundaries` type, the factory, and root construction land with the
     first per-boundary migration, which is #3043 (git). They do not land in the spec that adopts
     this ADR, so no production surface ships without a consumer.

3. **One registry enumerates every boundary, and the ratchet reads it.**
   - **Location:** `src/conductor/test/structural/boundary-registry.ts` holds one entry per
     boundary in decision 1.
   - **Entry fields:** name, port type name or `pending`, production adapter module paths
     (empty while pending), external module specifiers, clock call patterns, command literals for
     `git`, `gh` and `tmux`, and status (`ported`, or `pending #N` naming the follow-on intake).
   - **Why `test/structural/`:** the ratchet is its only reader. It follows the precedent of the
     layer definitions in `test/structural/layer-ratchet.ts`, and a production module read only
     by a test would be an unreachable rung at the SHIP as-built sweep.
   - **Completeness:** a structural test asserts that the registry names exactly the eight
     boundaries.

4. **A shrink-only boundary ratchet rejects new external touches before merge.**
   - **Scope:** `test/structural/boundary-ratchet.ts` scans the same file set as the D5 layer
     ratchet, which is `src/conductor/src/**/*.ts`. Tests are out of scope.
   - **Touches.** A touch by file F on boundary B is any of:
     - A static import, `export … from`, or dynamic `import()` of one of B's external specifiers.
       Both `node:x` and bare `x` forms count. Type-only imports do not count.
     - A call expression matching B's clock pattern.
     - A call whose first argument is the string literal `git`, `gh` or `tmux`, where the callee is
       a name imported from `node:child_process`, `child_process` or `execa`, or an export of a
       registered `process` adapter. That call touches the matching boundary as well as
       `process`.
     - A value import of one of B's registered production adapter modules.
   - **Verdict.** A touch passes in three cases:
     - F is one of B's registered adapter modules.
     - The touch is an adapter-module import and F is a composition root.
     - The allowlist line `F -> B` exists.
   - **Failures.** Every other touch fails, naming the file, line, boundary, and the registered
     adapter to use, or `pending #N`.
   - **Allowlist file.** `test/structural/boundary-allowlist.txt` holds one strictly sorted
     `«file» -> «boundary»` line per allowed (file, boundary) pair, with paths relative to
     `src/conductor/src/`. It follows the D5 amendment's format. A malformed, unsorted, or
     unknown-boundary line fails.
   - **Shrink-only.** A line whose file no longer touches that boundary, or whose touch is now
     permitted, fails as stale. The allowlist can therefore only shrink.

5. **The adopting spec seeds the allowlist with every existing touch and migrates nothing.**
   - The seed is generated from the scanner's own output at implementation time.
   - Every boundary starts `pending`, except `llm`, whose adapter modules (`execution/claude-provider.ts`,
     `execution/codex-provider.ts`, `execution/pi-provider.ts`) already implement `LLMProvider`.
     `llm` is registered `ported` for its adapter-import rule. Its root wiring (moving
     `registerBuiltInLlmProviders` out of `engine/`) is a follow-on migration. The existing
     non-root importers of those adapters are seeded into the allowlist; as of 2026-11-07 they are
     `execution/provider-catalog.ts` and `execution/pi-self-host-auth.ts`.
   - Each per-boundary migration then deletes that boundary's allowlist lines as it ports call
     sites.

6. **Per-boundary migrations are separate features, one intake issue each.**
   - Git is #3043. D6's "ratchet forbids new direct spawns outside the adapter" is delivered by
     this ratchet's `git` row, not by a second check.
   - The other six pending boundaries are follow-on intake issues, and the registry names each in
     its `pending #N`: `process` #3634, `otel` #3635, `filesystem` #3636, `gh` #3637, `clock` #3638
     and `tmux` #3639.
   - `llm` is registered `ported` (decision 5). Its root-wiring follow-on is #3633, and the
     registry entry does not cite it as `pending`.
   - The issues are independent of one another, and every one is blocked by #1989. #3043 is
     also blocked by #1989.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Detecting touches through import specifiers, clock call shapes and literal command arguments catches every newly written direct external call. A spawn whose command arrives through a variable is caught only as a `process` touch. | inferred | 85% | yes | Some indirect `git`, `gh` or `tmux` spawns are counted only under `process` until their boundary migrates. Swapping still works, but the per-binary enumeration is incomplete. | APPROVED by operator 2026-11-07 |
| A2 | The seed allowlist is about 450 lines and fits the D5 sorted-text-file format without new tooling. | inferred | 85% | no | A larger file, with the same mechanism. | — |
| A3 | Placing the registry in `test/structural/` satisfies #1989's "enumerable in one place" outcome. | inferred | 90% | yes | If the operator wants a runtime-readable registry, it moves to `types/` with the first migration that has a production reader. | APPROVED by operator 2026-11-07 |
| A4 | The 2026-11-07 counts above (264 fs, 91 clock, 54 execa, 31 child_process, 9 OTel files) describe the current tree. | verified | 95% | no | The seed differs in size only. | — |

## Consequences

### Positive
- Every external boundary and its migration status can be read in one file.
- A new direct `fs`, process, OTel, clock, git, gh or tmux call in an unlisted file fails CI at the
  point it is written.
- Each migration has a measurable endpoint: that boundary's allowlist lines are gone.
- D6's git ratchet and #1989's general ratchet are one mechanism.

### Negative
- The allowlist starts large, and most of it is filesystem.
- Until a boundary migrates, it is enumerable but not yet swappable. #1989's first outcome is met
  boundary by boundary through the follow-ons, not by the adopting spec.
- Indirect spawns through runner variables are under-attributed to their binaries (A1).

### Follow-up Actions
- [ ] Adopting spec (#1989): registry, ratchet, seeded allowlist, and testing-guide wiring.
- [x] Follow-on intake issues filed (2026-11-07): #3633 through #3639, each blocked by #1989.
      #1989 was added as a blocker of #3043.
- [ ] #3043 introduces `Boundaries`, `createProductionBoundaries()`, and root construction.

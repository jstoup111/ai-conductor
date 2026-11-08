**Status:** Accepted

# Stories: External-boundary registry and ratchet (#1989)

Technical track. Governing ADR: `adr-2026-11-07-external-boundary-ports-registry-and-ratchet`.
Scope: a test-side boundary registry, a boundary ratchet, and a seeded shrink-only allowlist. No
production code changes, and no boundary is migrated.

## Story 1: Every external boundary is enumerable in one registry

**Requirement:** #1989 outcome 2 (enumerable in one place); ADR decisions 1, 3, 5

As a harness contributor, I want one file that lists every external boundary with its port, its adapters, and its migration status so that I can see what is swappable and what is still pending without searching the engine.

### Acceptance Criteria

#### Happy Path
- Given the boundary registry, when it is read, then it holds exactly eight entries, named `llm`, `git`, `gh`, `tmux`, `process`, `clock`, `otel` and `filesystem`.
- Given the `llm` entry, when it is read, then its status is ported, its port is `LLMProvider`, and its adapter modules are `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts`.
- Given each of the other seven entries, when it is read, then its status is pending, it names its open follow-on intake issue (`process` #3634, `otel` #3635, `filesystem` #3636, `gh` #3637, `clock` #3638, `tmux` #3639, `git` #3043), and it lists no adapter modules.

#### Negative Paths
- Given a registry edited to drop one of the eight boundaries or add a ninth, when the structural test suite runs, then the registry completeness check fails and names the missing or extra boundary.
- Given an entry whose registered adapter module path does not exist under `src/conductor/src/`, when the structural test suite runs, then the check fails and names that entry and path.
- Given a pending entry that names no issue number, when the registry is type-checked, then compilation fails, because a pending status without an issue cannot be expressed.

### Done When
- [ ] `src/conductor/test/structural/boundary-registry.ts` exports a registry keyed by the eight boundary names, each entry carrying port, adapter modules, external specifiers, call patterns, command literals, and status.
- [ ] A default-tier test asserts the exact eight names and that every registered adapter path exists.
- [ ] Every pending entry cites a real, open follow-on intake issue on jstoup111/ai-conductor.

## Story 2: A new direct external call in an unlisted file fails before merge

**Requirement:** #1989 outcome 2 (bypass rejected mechanically); ADR decision 4

As a harness maintainer, I want a new direct filesystem, process, OTel, clock, git, gh or tmux call outside an adapter to fail the default test tier so that bypasses never reach main.

### Acceptance Criteria

#### Happy Path
- Given the current source tree and the seeded allowlist, when the boundary ratchet test runs, then it passes with no violations.
- Given a file that imports a boundary port only as a type, when the ratchet runs, then the file is not reported as a touch.
- Given a registered adapter module that imports its own boundary's external specifier, when the ratchet runs, then that touch passes without an allowlist line.

#### Negative Paths
- Given an unlisted `src/` file that adds `import { readFile } from 'node:fs/promises'`, when the ratchet runs, then it fails, naming the file, the line, and the boundary `filesystem`.
- Given an unlisted file that adds a bare-specifier `import fs from 'fs'` or a dynamic `await import('node:child_process')`, when the ratchet runs, then it fails, naming the `filesystem` or `process` boundary respectively.
- Given an unlisted file that adds `Date.now()`, zero-argument `new Date()`, or `performance.now()`, when the ratchet runs, then it fails, naming the boundary `clock`.
- Given an unlisted file that adds `new Date(timestamp)` with an argument, when the ratchet runs, then it does not report a `clock` touch.
- Given an unlisted file that adds `execa('git', ['status'])` with `execa` imported from `execa`, when the ratchet runs, then it fails, naming both `git` and `process`.
- Given an unlisted file that calls a locally defined function named `execa` with the literal `'git'`, when the ratchet runs, then it does not report a `git` touch.
- Given an unlisted file that adds an import of `@opentelemetry/api`, when the ratchet runs, then it fails, naming the boundary `otel`.
- Given a violation for a pending boundary, when the failure message is printed, then it names that boundary's follow-on issue, and for a ported boundary it names the registered adapter modules to use instead.

### Done When
- [ ] `src/conductor/test/structural/boundary-ratchet.ts` exports a pure check over an in-memory files map plus allowlist lines, classifying touches with the TypeScript AST.
- [ ] `boundary-ratchet.test.ts` runs in the default Vitest tier over `src/conductor/src/**/*.ts` and holds a fixture case for each touch kind above.

## Story 3: Production adapters are imported only by adapters and composition roots

**Requirement:** #1989 outcome 1 (single wiring point per entry point); ADR decisions 2, 4

As a harness maintainer, I want an import of a registered production adapter from core code to fail so that adapter choice cannot drift back into engine call sites once a boundary is ported.

### Acceptance Criteria

#### Happy Path
- Given an entry-layer file directly under `src/conductor/src/`, when it value-imports a registered `llm` adapter module, then the ratchet passes it without an allowlist line.
- Given a seeded allowlist line for an existing non-root importer of an `llm` adapter, when the ratchet runs, then that import passes.

#### Negative Paths
- Given an unlisted `engine/` file that adds a value import of `execution/claude-provider.ts`, when the ratchet runs, then it fails, naming the file, the line, the boundary `llm`, and the rule that only composition roots import adapters.
- Given an unlisted `engine/` file that adds a type-only import from `execution/claude-provider.ts`, when the ratchet runs, then it does not report an adapter-import touch.
- Given a file nested one directory below `src/conductor/src/` (for example `engine/cli-entry.ts`), when it value-imports a registered adapter without an allowlist line, then the ratchet fails, because only top-level entry files are composition roots.

### Done When
- [ ] The ratchet treats a value import of any registered adapter module as a touch of that adapter's boundary.
- [ ] Fixture cases cover root, nested non-root, type-only, and allowlisted importers.

## Story 4: The allowlist only shrinks and stays well-formed

**Requirement:** #1989 outcome 3 (boundary-by-boundary migration); ADR decisions 4, 5

As a harness maintainer, I want the boundary allowlist to fail on stale or malformed lines so that each per-boundary migration has a measurable endpoint and the list can never grow silently.

### Acceptance Criteria

#### Happy Path
- Given the seeded `boundary-allowlist.txt`, when it is read, then every line has the form `«file» -> «boundary»`, the lines are in strictly ascending order, and every line matches a current touch that is not otherwise permitted.
- Given a migration that removes every `fs` import from a listed file, when the matching allowlist line is deleted in the same change, then the ratchet passes.

#### Negative Paths
- Given an allowlist line whose file no longer touches that boundary, when the ratchet runs, then it fails as a stale entry and names the line to delete.
- Given an allowlist line for a file that has become a registered adapter for that boundary, when the ratchet runs, then it fails as a stale entry, because the touch is now permitted.
- Given an allowlist line that is out of order or duplicated, when the ratchet runs, then it fails as a malformed entry and names the line.
- Given an allowlist line naming a boundary that is not in the registry, such as `src/x.ts -> network`, when the ratchet runs, then it fails as an unknown-boundary entry.
- Given an allowlist line missing the ` -> ` separator or with an empty side, when the ratchet runs, then it fails as a malformed entry.

### Done When
- [ ] `src/conductor/test/structural/boundary-allowlist.txt` is committed, generated from the scanner's own output on the implementation HEAD, with every line valid and current.
- [ ] Fixture cases cover stale, now-permitted, unsorted, duplicate, unknown-boundary and malformed lines.

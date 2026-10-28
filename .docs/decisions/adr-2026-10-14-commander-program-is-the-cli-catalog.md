# ADR: The commander program is the CLI catalog for pre-dispatched commands

**Date:** 2026-10-14
**Status:** APPROVED
**Deciders:** Operator (James Stoup), composer session for jstoup111/ai-conductor#1012

## Context

The CLI dispatch entry in `src/conductor/src/index.ts` (`dispatchCliCommand` and the `dispatchNonDispatchingCliCommand` it calls first) runs 42 `detect«Name»Command(process.argv)` intercepts before
commander parses argv. `src/conductor/src/cli.ts` `createProgram()` is what `--help` renders
(`renderFullHelp`, `renderCanonicalFullHelp`), but nothing ties the two together. The result,
verified on main 2026-10-14: 13 implemented commands are missing from help, real flags are
undeclared, and `register --help` executes the command because its intercept runs before any help
handling. A comment above the top-level help branch claims "Subcommand-specific help is already
handled by the dispatchers above", which is false for `register` and `create`.

The operator chose balanced scope: fix the symptoms and add drift machinery, without moving the
42 intercepts into commander actions.

## Options Considered

### Option A: Commander as catalog, intercepts unchanged
- **Pros:** Dispatch blocks stay intact; uses commander's own `hidden` mechanism; a test enforces
  the catalog.
- **Cons:** The intercept-to-command mapping is a second list, kept honest by a test rather than by
  construction.

### Option B: Table-driven intercept registry that generates help
- **Pros:** Help and dispatch cannot drift.
- **Cons:** Rewrites all 42 dispatch blocks, close to the excluded comprehensive scope.

## Decision

Option A, because it closes every observed gap and makes the next drift fail a test, without
touching dispatch behavior.

1. **`createProgram()` is the authoritative CLI catalog.** Every top-level command the
   pre-commander intercept chain dispatches is declared there. Operator-facing commands are
   visible; engine-internal commands are declared with commander's `{ hidden: true }`.
2. **One help router runs before the first intercept.** When argv names a declared command path and
   carries `--help` or `-h`, it prints that command's commander help and exits 0 without
   dispatching. Commands whose handlers already render their own help (`compose`/`engineer`,
   `halt-issues`, and `daemon` through `renderDaemonHelp`) keep those handlers, and `update`, which passes its arguments verbatim to
   `bin/update`, keeps passing `--help` and `-h` through.
3. **An exported pre-dispatch registry maps each intercept detector to its top-level command.**
   The help router consumes it. A test fails when the set of detectors the CLI dispatch entry calls differs from
   the registry, or when a registry command is not declared in `createProgram()`.
4. **A flag whose runtime fallback lives outside commander takes its declared default from a
   shared exported constant** used by both the declaration and the fallback, starting with
   `--idle-poll`. A test asserts declared defaults equal runtime fallbacks.
5. **Full-help renderers skip hidden commands.** `renderFullHelp` and `renderDaemonHelp` do not
   emit sections for commands declared hidden.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Commander 15 supports `command(name, { hidden: true })` and omits hidden commands from `helpInformation()` listings (`src/conductor/node_modules/commander/lib/command.js` sets `_hidden`; installed version 15.0.0) | verified | 95% | yes | Decision 1 needs another hiding mechanism | n/a |
| A2 | No intercepted command outside the Decision 2 exemptions takes a literal `--help` or `-h` as a legitimate argument value; `update`, a verbatim pass-through to `bin/update`, is exempted | inferred | 90% | yes | That command would print help instead of running | APPROVED by operator 2026-10-14 |
| A3 | Detector call sites in the CLI dispatch entry are statically identifiable as `detect«Name»Command(` calls (42 such calls in `src/conductor/src/index.ts` on 2026-10-14) | verified | 90% | yes | Decision 3's set-equality test needs a different completeness check | n/a |

## Consequences

### Positive
- `--help` lists every operator-facing command and prints per-command help for all of them.
- Adding an intercept without declaring it fails a test instead of shipping silently.
- Declared defaults cannot drift from runtime fallbacks for the covered flags.

### Negative
- The registry is a second list maintained by hand, guarded by a test.
- Engine-internal commands become discoverable to anyone who reads `cli.ts`, though not help.

### Follow-up Actions
- [ ] Correct the false comment above the top-level help branch in `index.ts`.

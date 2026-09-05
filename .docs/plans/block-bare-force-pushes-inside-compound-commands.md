# Implementation Plan: Block bare force pushes inside compound commands

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2159
**Stories:** .docs/stories/block-bare-force-pushes-inside-compound-commands.md
**Conflict check:** Small-tier exemption; no blocking dependency found.

## Technical Approach

Repair only the force-push conditional in `hooks/claude/block-destructive-git.sh`. Preserve the existing JSON input, quoted-span-to-SCAN transformation, structured denial/exit 2, and all separate destructive-operation/rebase clauses. Remove the command-wide force-with-lease allow short-circuit. A lease token is safe because it is not an exact bare-force token, not because it suppresses examination of another command.

For the force check only, partition SCAN at its existing unquoted command boundaries: ampersand, pipe, semicolon, or newline (`&&`/`||` naturally produce empty segments, which are ignored). In each segment, recognize the existing direct unquoted `git push` spelling and search only that invocation's subsequent whitespace-delimited tokens for exact `--force` or `-f`. Do not let a matcher cross a segment boundary. Exact token matching avoids confusing `--force-with-lease` or its explicit-reference form with bare force. This is a bounded string scanner, not a shell parser; preserve the documented existing limitations for quoted wrappers, aliases, substitutions, and expansion.

Create one focused Vitest file, `src/conductor/test/engine/destructive-git-hook.test.ts`. Reuse the behavioral trait from `session-hook-behavior.test.ts`: invoke a real Bash hook with `spawnSync`, send `JSON.stringify({ tool_input: { command } })` to stdin, and assert status plus stderr. Use the real tracked hook path rather than copying its text or asserting source regexes. Resolve its path relative to the test file, so counterfactual checkouts run their own hook. Use an isolated temp cwd and fail-on-call Git/GitHub stubs if those executables could be reached; never execute the payload with a shell. Bound each subprocess and remove exact fixture directories only after it returns.

Two tasks separate the reported authorization bypass from command-boundary false positives. Both operate on the same hook and test file, so Task 2 depends on Task 1. No new runtime package, provider seam, hook wiring, or configuration is introduced.

## Tasks

### Task 1: Match bare force tokens without a global lease exemption

**Story:** 1, 2
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Add the focused real-hook subprocess fixture described above. Its inputs are JSON data, never executable shell strings; process status must be non-null, and errors/timeouts must fail the test. Stub Git/GitHub as fail-on-call boundaries and assert they were unused for these push-only cases. This uses the existing hook-test pattern's real stdin/status/stderr boundary without its unrelated conductor state fixtures.
2. Establish RED with the reported lease-then-bare-force reproduction, its reversed order, bare `-f`, and same-invocation `--force-with-lease --force`. Parameterize the documented separators; assert exit 2 and the existing structured deny reason rather than a private matching helper's result.
3. Replace the global lease allow/elif chain with exact standalone bare `--force`/`-f` detection. Retain the current quoted-span representation and denial output. Keep standalone and explicit-reference lease forms, ordinary pushes, and quoted echo/commit examples passing; a token prefix is not an exact force token.
4. Run scoped RED/GREEN through `ai-conductor scoped-run test/engine/destructive-git-hook.test.ts` from `src/conductor`; run Bash syntax and ShellCheck for the changed hook. Commit `fix(hook): prevent lease flags from bypassing bare force detection`.

**Done when:**
- [ ] Executing the real hook with the reproduction, reversed ordering, same-invocation force-plus-lease, both bare force spellings, and the six separator forms returns exit 2 with the existing structured force-push denial.
- [ ] Single lease, explicit-reference lease, plain push, and quoted-text fixtures return exit 0 without a force-push denial.
- [ ] Hook execution never evaluates the supplied command payload or invokes the Git/GitHub stubs in the push-only fixture matrix.

**Files:** hooks/claude/block-destructive-git.sh, src/conductor/test/engine/destructive-git-hook.test.ts

### Task 2: Keep force-token ownership within one command segment

**Story:** 2
**Type:** negative-path
**Dependencies:** Task 1

**Steps:**
1. In the same real-hook fixture, add lease-only push cases whose neighboring non-push command contains an unquoted `--force` token, with that command both before and after the push and the six named separators. These fixtures must pass rather than letting the push borrow a neighboring command's flag. Confirm the old unbounded matcher would produce a force denial when the foreign token is after a push without the old global exemption.
2. Bound only the force scanner to ampersand/pipe/semicolon/newline-separated SCAN segments and whitespace-delimited exact flag tokens after the direct `git push` spelling. Ignore empty segments. Preserve the shared SCAN value for later checks; do not rewrite or reorder reset/rebase/branch/clean/restore clauses. If Task 1 already delivered the bounded scan atomically, reuse its runtime RED evidence and add these required negative fixtures without a throwaway production edit.
3. Add compatibility fixtures for a lease push plus hard reset (exit 2/reset diagnostic), ordinary rebase (exit 0/existing NOTE), and rebase continuation (exit 0/no NOTE). These exercise the same public hook boundary and must not execute their payloads. Preserve quoted-data exemptions in the separator matrix.
4. Run the scoped hook tests, Bash syntax, ShellCheck, and `npm run typecheck:test` from `src/conductor`. Commit `test(hook): cover command ownership and safe lease compatibility`.

**Done when:**
- [ ] The real hook allows the neighboring-non-push-force-token matrix across &&, ||, semicolon, pipe, ampersand, and newline without falsely attributing another command's flag to the safe push.
- [ ] A lease push cannot suppress hard-reset denial; ordinary rebase and rebase-continuation fixtures retain their existing reminder behavior.
- [ ] The force-only scan leaves the original shared SCAN and the independent reset/rebase/branch/clean/restore clauses unchanged.

**Files:** hooks/claude/block-destructive-git.sh, src/conductor/test/engine/destructive-git-hook.test.ts

## Coverage

Task 1 owns the changed force-denial boundary integration and Story 1 H1/H2/N1, Story 2 H1/N1. Task 2 owns the bounded command-ownership behavior and Story 2 H2/N2. Every criterion is diff-local and has direct real-hook subprocess proof; no live third-party call, additional acceptance/system test, or terminal aggregate-validation task is required.

## Verify-Claims Ledger

99%, verified: the current global lease branch skips all bare-force matching; quote stripping happens first; denial JSON is written to stderr with exit 2; reset and rebase logic are independent later clauses. The existing provider-neutral commit-gate ADR classifies this hook as early feedback. The source issue has no dependencies/comments/matching PR and explicitly preserves single safe lease pushes. Parent scope review confirms a bounded scanner repair rather than full-shell enforcement. No unconfirmed load-bearing assumptions remain. Verdict: CLEAR.

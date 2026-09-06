# Implementation Plan: Report a failing integrity check instead of aborting the suite silently

**Date:** 2026-09-06
**Stories:** .docs/stories/report-a-failing-integrity-check-instead-of-aborti.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the suite's own established status-capture idiom, which it already uses at 21 places, and changes no check's subject, order, or assertion.

## Summary

Five bounded tasks deliver #2160 by carving the suite's reporting text into one marked region, giving every check call site a captured status instead of a raw one, adding an abort diagnostic for the failures no guard covers, and proving all of it with a focused fixture spec wired in as its own numbered check.

## Technical Approach

The suite runs under `set -euo pipefail` and its two reporters, `assert` and `warn_check`, take an already-computed status as their second argument. Seventeen call sites run a bare command and then pass `$?`. Under errexit the failing command exits the shell before the reporter is ever reached, so the check that failed prints nothing, every later check is skipped, and the run ends non-zero with no summary. That is the whole defect, and it is reproducible in six lines of shell.

The fix at those sites is uniform and follows the idiom the file already uses elsewhere: reset a status variable to zero, run the same command with `|| status=$?` appended, and hand the variable to the reporter. Six of the seventeen sites are multi-line `&&` chains; appending the guard after the final continuation preserves their semantics exactly, because a failing link short-circuits the chain and the guard captures that chain's status. This form is narrower than the `set +e` / `set -e` pairs already in the file — it never leaves errexit off across more than the one command — and it leaves the reporter's contract untouched.

Guarding known sites cannot be the whole answer. The file holds roughly a hundred other commands whose failure would still exit it without a word, so the second half is a diagnostic: enable `ERR` trap inheritance and install a handler that prints the script line and the failing exit status before the shell exits. The handler must stay quiet where the suite disables errexit on purpose, which it does at 21 places, so it returns immediately unless errexit is currently in force. Bash exempts conditions, negations, and non-final links of `&&`/`||` lists from both errexit and the `ERR` trap, so the guarded sites and every `if` condition in the file stay silent; the handler can only speak where the run was already about to die. The only trap in the file today is an `EXIT` trap set and cleared inside check 5c, so an `ERR` trap adds no interference and must not be an `EXIT` trap, which that region would clobber.

Proving this needs the production text itself, not a paraphrase of it. Fence the reporting text — the `set` line, the colour constants, the counters, `assert`, and the new handler — between begin and end marker comments, and move the summary block from the tail of the file into a `summarize_and_exit` function inside that fence, called from the tail. The fence is then a declared seam: the spec extracts it with `awk`, appends its own two-check body, and runs the result. A fixture built that way exercises the real reporter, the real counters, and the real summary, so the criterion about a failing check followed by a passing one and a truthful summary is decided by production code rather than by a copy of it. The spec must refuse to run when the markers are missing, so a rename cannot silently turn it into a suite of zero cases.

The spec follows the local precedent for a focused fixture suite over a gate: a disposable `mktemp -d` tree removed by a trap, cases invoked directly rather than through the integrity suite so nothing recurses, and negative cases that prove the guard still fails on the shapes it exists to catch. Its drift guard is a function taking a file path and rejecting any line that hands a raw status to either reporter; it runs against the real suite and against mutated copies in the disposable tree. There is no third-party boundary anywhere in this slice — no network, LLM, package registry, or `gh` call — so nothing needs a fake. Wire the spec as a new numbered check at the end of the suite, following the shape check 22 already uses for a checker-plus-spec pair, and add its row to the canonical check enumeration in the contributing documentation.

One interaction is known and deliberate. Issue #2161, specced today, rewrites the suite's syntax-check section so its four loops become one loop over the shared shell-file enumeration. Four of the seventeen call sites live in that section. This plan therefore names the sites by their idiom, not by line number: whichever of the two features lands second guards whatever call sites that section then has, and the drift guard added here makes that obligation mechanical rather than a matter of memory. Neither change alters the other's subject — that one is about which files are enumerated, this one about how a failure is reported.

## Preconditions and claim ledger

- Operator approved, on 2026-09-06 (delegated), the Small scope, the technical track, guarding the call sites together with a named abort diagnostic, and both stories.
- Verified: `test/test_harness_integrity.sh:2` is `set -euo pipefail`.
- Verified: `assert()` is defined at `test/test_harness_integrity.sh:27` and `warn_check()` at `:52`; both take a computed status as their second parameter and neither runs a command.
- Verified: exactly 17 lines pass `$?` straight to a reporter — `:76`, `:85`, `:93`, `:101`, `:1120`, `:1123`, `:1132`, `:1135`, `:1142`, `:1150`, `:1154`, `:1159`, `:1180`, `:1385`, `:1388`, `:1392`, `:1395`. Six of them follow a multi-line `&&` chain.
- Verified: the suite uses `set +e` at 21 places to capture a status deliberately, so a non-errexit region is a real and frequent state the abort handler must stay quiet in.
- Verified: the summary block and both exits are at `test/test_harness_integrity.sh:1752-1765`; the file is 1765 lines long.
- Verified: the only trap in the file is `trap _restore_docs_guard_hook EXIT` at `:592`, cleared by `trap - EXIT` at `:602`, both inside check 5c. There is no `ERR` trap.
- Verified: the highest numbered section is 26 at `test/test_harness_integrity.sh:1692`, so the next free number is 27.
- Verified: `test/test_harness_integrity_update_flow.sh` is 131 lines and is the local precedent for a focused fixture spec — disposable copied tree, checker invoked directly, negative cases required.
- Verified: `test/test_harness_integrity.sh:1518-1557` is the wiring precedent for a checker-plus-spec pair, capturing each exit status inside a `set +e` region before reporting.
- Verified: `test/lint_shell.sh:36-44` enumerates every `test/*.sh` file, so the new spec is covered by both the syntax gate and the shellcheck gate with no wiring change.
- Verified: `docs/contributing/validation.md:49` opens the canonical check table, whose most recent rows are 24 and 26 at `:94-95`.
- Verified by execution: a six-line reproduction under `set -euo pipefail` with a failing bare command followed by a reporter call prints nothing and exits 1, and the same script with the captured-status guard prints the FAIL line, runs the next check, prints a truthful summary and exits 1.
- Verified by execution: an `ERR` handler that returns early unless errexit is in force stays silent through a `set +e` region, a guarded `|| status=$?` command and an `if !` condition, and prints once with a line number for an unguarded failure inside a function. The resulting file passes `shellcheck` at both error and warning severity.
- Verify-claims verdict: CLEAR. Every path, line number, count, and behavioural claim above was read in the worktree or executed there. No load-bearing assumption remains unconfirmed.

## Tasks

### Task 1: Fence the reporting text so a spec can drive it
**Story:** Story 1
**Type:** happy-path
**Files:** test/test_harness_integrity.sh, test/test_harness_integrity_failure_reporting.sh (new)
**Dependencies:** none

**Steps:**
1. Create the focused fixture spec as a new file, following the local precedent named in Technical Approach: a disposable `mktemp -d` tree per case, a trap that removes exactly that directory, and cases that build and run fixtures directly rather than invoking the integrity suite, so nothing recurses.
2. Write the failing cases first: the spec extracts the suite's marked reporting region with `awk`, appends a body of one deliberately failing guarded check followed by one passing guarded check and a call to the summary function, runs it, and requires a FAIL line for the first, a PASS line for the second, a summary reading one passed and one failed, and exit 1.
3. Add the marker-absent case: a copy of the suite in the disposable tree with its region markers stripped must make the spec exit non-zero with a diagnostic, never skip its cases.
4. Establish RED, then add the begin and end marker comments to the suite around the `set` line, the colour constants, the counters and `assert`, and move the summary and exit block from the tail into a `summarize_and_exit` function inside that region, called from the tail. Change no counter, no colour, no reporter body, and no summary text.
5. Run the new spec and the whole integrity suite, and commit.

**Done when:**
1. The spec builds a fixture from the suite's marked region and that fixture prints a FAIL line for its failing check.
2. The same fixture prints a PASS line for the check that follows the failing one, proving the run continued.
3. The same fixture prints a summary reading one passed and one failed and exits 1.
4. A copy of the suite with its region markers stripped makes the spec exit non-zero rather than reporting a clean run over nothing.
5. A real-tree run of the integrity suite reports the same pass, fail, and warning counts as before this task.

### Task 2: Give every check call site a captured status
**Story:** Story 1
**Type:** happy-path
**Files:** test/test_harness_integrity.sh
**Dependencies:** 1

**Steps:**
1. Find every line in the suite that hands a raw exit status to `assert` or `warn_check`.
2. At each one, reset a status variable to zero on its own line, append the guard to the end of the preceding command so a failure is captured instead of fatal, and pass the variable to the reporter.
3. For the sites whose preceding command is a multi-line chain, append the guard after the final continuation so the chain's short-circuit semantics are unchanged.
4. Run the whole integrity suite and confirm its pass, fail, and warning counts are identical to the counts before this task, then run the shell lint gate over the changed file and commit.

**Done when:**
1. No line in the suite hands a raw exit status to either reporter.
2. A real-tree run of the integrity suite reports the same pass, fail, and warning counts as before this task.
3. The changed file passes the repository's shell syntax and shellcheck gates.

### Task 3: Keep the raw-status idiom from coming back
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** test/test_harness_integrity_failure_reporting.sh
**Dependencies:** 2

**Steps:**
1. Add a drift-guard function to the spec that takes a file path and rejects it when any line hands a raw exit status to either reporter, printing the offending line number and text.
2. Apply the guard to the real integrity suite and require it to pass.
3. Build mutated copies in the disposable tree: one that reintroduces a raw-status call site in a check section, and one that reintroduces it after a multi-line chain. Require the guard to exit non-zero on each and to name the offending line.
4. Run the spec and commit.

**Done when:**
1. The drift guard passes against the real integrity suite.
2. The drift guard exits non-zero for a mutated copy that reintroduces a raw-status call site.
3. The drift guard exits non-zero for a mutated copy that reintroduces the raw-status idiom after a multi-line chain.
4. Each rejection diagnostic names the line number of the offending call site.

### Task 4: Name an abort no guard covers
**Story:** Story 2
**Type:** happy-path
**Files:** test/test_harness_integrity.sh, test/test_harness_integrity_failure_reporting.sh
**Dependencies:** 1

**Steps:**
1. Write the failing cases first: a fixture whose body runs an unguarded failing command must print one diagnostic carrying a line number and the failing exit status and exit non-zero, and a fixture whose body fails a command inside a region that has deliberately disabled errexit must print no diagnostic and reach its summary.
2. Establish RED, then inside the suite's marked reporting region enable `ERR` trap inheritance on the `set` line and add a handler that captures the failing status and the reported line, returns immediately unless errexit is currently in force, and otherwise prints one diagnostic naming the line and the status to standard error.
3. Install the handler as an `ERR` trap inside the marked region. Do not use an `EXIT` trap: check 5c sets and clears its own `EXIT` trap and would clobber it.
4. Run the whole integrity suite over the real tree, confirm no diagnostic is printed and the counts are unchanged, run the shell lint gate, and commit.

**Done when:**
1. A fixture whose unguarded command fails prints one abort diagnostic carrying a line number and the failing exit status, and exits non-zero.
2. A fixture that fails a command inside a deliberately non-errexit region prints no abort diagnostic and reaches its summary.
3. A real-tree run of the integrity suite prints no abort diagnostic and reports the same pass, fail, and warning counts as before this change.

### Task 5: Wire the spec into the suite and the check enumeration
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** test/test_harness_integrity.sh, docs/contributing/validation.md
**Dependencies:** 3, 4

**Steps:**
1. Add the next free numbered section at the end of the integrity suite, following the shape the update-flow section already uses for a spec pair: capture the spec's exit status inside a region with errexit disabled, print its captured output indented when it failed, and report one assertion.
2. Make that section fail closed when the spec file is absent, reporting a failed assertion naming the missing file rather than passing silently.
3. Add the new check's row to the canonical check table in the contributing validation page, stating what it verifies, when it fails, and how to fix it.
4. Run the whole integrity suite, confirm the new section reports and the run still ends at its summary, and commit.

**Done when:**
1. A real-tree run of the integrity suite prints the new numbered section and a passing assertion for the spec.
2. Removing the spec file makes that section report a failing assertion naming the missing file, and the run still reaches its summary.
3. The canonical check table in the contributing validation page carries a row for the new check.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a check whose subject command fails, when the suite runs, then a FAIL line naming that check is printed. | 1, 2 | "The spec builds a fixture from the suite's marked region and that fixture prints a FAIL line for its failing check." | diff-local |
| Story 1 happy: Given an earlier check has already failed, when the run continues, then every later check still runs and prints its own PASS or FAIL line. | 1, 2 | "The same fixture prints a PASS line for the check that follows the failing one, proving the run continued." | diff-local |
| Story 1 happy: Given at least one check failed, when the run reaches its end, then the summary counts every check that ran and the run exits non-zero. | 1 | "The same fixture prints a summary reading one passed and one failed and exits 1." | diff-local |
| Story 1 negative: Given a copy of the suite in which a check hands a raw exit status straight to the reporter, when the drift guard runs, then it exits non-zero and names the offending line. | 3 | "The drift guard exits non-zero for a mutated copy that reintroduces a raw-status call site." | diff-local |
| Story 1 negative: Given a copy of the suite whose reporting region markers are absent, when the spec tries to build its fixture, then it exits non-zero rather than reporting a clean run over nothing. | 1 | "A copy of the suite with its region markers stripped makes the spec exit non-zero rather than reporting a clean run over nothing." | diff-local |
| Story 2 happy: Given a command outside any check guard fails while errexit is in force, when the suite aborts, then it prints a diagnostic naming the script line and the failing exit status. | 4 | "A fixture whose unguarded command fails prints one abort diagnostic carrying a line number and the failing exit status, and exits non-zero." | diff-local |
| Story 2 negative: Given a command fails inside a region that has deliberately disabled errexit, when the run continues past it, then no abort diagnostic is printed. | 4 | "A fixture that fails a command inside a deliberately non-errexit region prints no abort diagnostic and reaches its summary." | diff-local |
| Story 2 negative: Given the suite runs over the real repository tree with no regression present, when it completes, then it prints no abort diagnostic and its pass, fail, and warning counts are unchanged from before this change. | 4, 5 | "A real-tree run of the integrity suite prints no abort diagnostic and reports the same pass, fail, and warning counts as before this change." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local. Each is decided by the changed suite and the new fixture spec, against fixtures the diff creates inside a disposable directory, plus real-tree assertions about the suite this diff changes. Task 1 owns the reporting-region seam and the continuation and summary cases; Task 2 owns the call-site conversion and is held honest by the unchanged real-tree counts rather than by a new assertion of its own; Task 3 owns the drift guard and its two mutation fixtures, which is what stops the guard degrading into a passing no-op; Task 4 owns the abort diagnostic and its silent-in-non-errexit negative. Task 5 is the single integration-owning task: it proves the whole thing through the integrity suite, the entry point an operator and CI actually run, rather than only through the spec in isolation. There is no third-party boundary in this slice — no network, LLM, package registry, or `gh` call — so no fake is required and no smoke test is added. No terminal catch-all validation task is added; whole-feature validation stays with the later gates that own it.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3 -> Task 5
Task 1 -> Task 4 -> Task 5

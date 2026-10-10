**Status:** Accepted

# Stories: Legacy-CLI guard covers all of docs/

Track: technical. Tier: S. Source: jstoup111/ai-conductor#2028 (re-scoped: the `docs/` prose sweep already landed in #2023; this delivers the issue's remaining outcome, a guard that keeps `docs/` swept).

## Story 1: A conduct-ts reference anywhere under docs/ fails the legacy-CLI guard

**Requirement:** TI-1 — the repository's legacy-CLI guard covers every page under `docs/`, so a reintroduced `conduct-ts` reference fails a test instead of reaching a reader, while the mentions that document the deprecated alias itself still pass.

As a maintainer of this repository, I want the legacy-CLI reference guard to scan the whole `docs/` tree so that a guide, runbook, or quickstart that starts instructing `conduct-ts` again is caught by the test suite.

### Acceptance Criteria

#### Happy Path

- Given the current `docs/` tree, whose only `conduct-ts` mentions are the `--uninstall` launcher list in `docs/quickstart.md` and the session-command audit description in `docs/contributing/extending.md`, when `test/test_no_legacy_cli_references.sh` runs, then it exits 0 and prints `legacy CLI reference guard: PASS`.
- Given a fixture repository whose `docs/` pages contain no `conduct-ts` text, when the guard runs under the `rg` backend and under the `grep` fallback, then both exit 0 with identical output.

#### Negative Paths

- Given a page under `docs/` outside `docs/reference/` (for example `docs/guides/planted.md` or `docs/runbooks/planted.md`) contains a non-allowlisted `conduct-ts` line, when the guard runs, then it exits non-zero and prints `non-allowlisted conduct-ts reference:` followed by that page's `path:line:text`.
- Given the same planted `docs/` reference, when the guard runs under the `rg` backend and under the `grep` fallback, then both backends exit with the same non-zero status and print identical output.
- Given a line in `docs/quickstart.md` or `docs/contributing/extending.md` that contains `conduct-ts` but is not one of the two allowlisted alias-describing lines, when the guard runs, then it rejects that line by name even though its file holds an allowlisted mention.

### Done When

- [ ] `test/test_no_legacy_cli_references.sh` exits 0 against the repository's real `docs/` tree.
- [ ] `test/test_legacy_cli_guard_backends.sh` passes and includes planted-reference cases for at least one non-reference `docs/` page, each asserting rejection under the `grep` fallback and agreement between both backends.
- [ ] `test/test_legacy_cli_guard_backends.sh` includes a case where a non-allowlisted `conduct-ts` line in an allowlisted docs file is rejected.

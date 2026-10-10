# Track: Legacy-CLI guard covers all of docs/

Track: technical

Scope boundary: Repository validation only. Widen the `conduct-ts` scan in `test/test_no_legacy_cli_references.sh` from `docs/reference/cli.md` and `docs/reference/skills.md` to the whole `docs/` tree, under both the `rg` and `grep` backends, and allowlist exactly the two surviving alias-describing mentions (`docs/quickstart.md`, the `--uninstall` launcher list; `docs/contributing/extending.md`, the session-command audit description). Extend `test/test_legacy_cli_guard_backends.sh` so a planted `conduct-ts` reference in a non-reference `docs/` page fails under both backends. Excluded: any `docs/` prose rewording (delivered by #2023); the `bin/conduct` removed-CLI scan's path set; retiring the aliases themselves (#2048); the `engineer` skill rows in `docs/reference/models.md`; `daemon` wording.

Internal test-guard change with no product requirements; acceptance criteria live in stories (intake jstoup111/ai-conductor#2028, re-scoped after re-measurement showed the prose sweep already landed in #2023: `grep -rl 'conduct-ts' docs/` returns only the two alias-describing files).

Rationale for the chosen approach (issue hypothesis weighed as one candidate):
- Widen the existing scanned path set to `docs` and add exact `path:text` allowlist entries (chosen; the filer's hypothesis). It reuses the guard's established closed-allowlist shape, needs no new mechanism, and keeps the two backends in lockstep because both receive the same path argument.
- Pattern-based docs allowlist (accept any `docs/` line that also says "deprecated" or "alias"): rejected. It is an open allowlist that would admit a reintroduced instruction such as "run `conduct-ts …` (deprecated alias)" — exactly the regression the guard exists to catch.
- Inline opt-out markers in the markdown (an HTML comment beside each permitted mention): rejected. It adds reader-invisible noise to prose pages, spreads the allowlist across files instead of the one reviewable place, and a marker can be copied alongside a new bad reference.

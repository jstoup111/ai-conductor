# Track: Migration authoring gate recognizes every runnable fence

Track: technical

Source: jstoup111/ai-conductor#2152

Scope boundary: Make every migration block the current runner recognizes subject to the existing authoring safety clauses, including formatting variations. Preserve existing clean-block behavior and stricter authoring-only attribution checks. Do not broaden which scripts consumers execute, alter approval/version selection, change the forbidden-command clauses, or edit release artifacts.

The operator authorized Small specification PRs on 2026-09-05 and subsequently authorized unassigned issues. #2152 is open, high priority, size S, unassigned, has no comments, no GitHub blocked-by dependencies, and no existing PR found by issue search.

## Explore outcome

Selected approach: share the current runner's lexical fence recognizer between runtime extraction and the authoring checker, retaining their distinct selection policies. Estimated effort: S, approximately one to two hours. Impact: a formatting variation cannot create executable code invisible to the gate; parity is maintained by one recognizer and executable inclusion fixtures.

Alternative: normalize the checker's one opening-fence comparison. Estimated effort: S, under one hour. Impact: repairs the reported trailing-space case, but leaves closing widths, surrounding fence context, and future parser drift independent; insufficient for the full same-recognition outcome.

Alternative: reject every noncanonical fence before considering content. Estimated effort: S, approximately one hour. Impact: can fail closed, but newly rejects clean scripts accepted by the existing runner without needing to do so. Shared recognition retains compatibility and provides a mechanical inclusion guarantee.

## Scope and verified claims

Scope check: audience harness-repo-only for the authoring safety rule (repository integrity tooling); catalog n/a; provider agnostic. Registration: none. The runtime parser extraction is behavior-preserving supporting reuse of an existing consumer mechanism, not a new shared behavioral rule. No HARNESS.md change or new skill is needed.

- Verified: `bin/migrate`'s embedded Python recognizes exactly three opening backticks, uses `strip()` on the info string, respects enclosing fences and Migration headings, and accepts a same-marker closing fence of at least the opening width with trailing whitespace.
- Verified: the Bash authoring checker compares opening and closing lines literally and lacks enclosing-fence context, so it can miss executable variants.
- Verified: the authoring checker deliberately rejects unattributed migration candidates outside a Migration section; `test/test_migration_block_authoring.sh` asserts this with `unattributable-block`. Sharing recognition must not silently weaken that existing policy.
- Verified: `test/test_bin_migrate_parse.sh` sources only the parser helper region without running migrations; two full migration fixture scripts copy `bin/migrate` and `bin/lib/harness-common.sh` into scratch harnesses and must copy any extracted parser helper as well.
- No unconfirmed load-bearing assumptions. Verify-claims: CLEAR.

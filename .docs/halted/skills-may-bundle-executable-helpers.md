# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-29T01:20:58.992Z
Slug: skills-may-bundle-executable-helpers
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-skills-may-bundle-executable-helpers
Head SHA: 5e627f3f11b8405e90e15d393a423ea9f9c0c3a0
Halted at: 2026-09-29T01:16:30.375Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given the entry point exits non-zero after an issue-create failure, when the helper returns, then its exit status equals the entry point's status rather than zero.
Task ids: 1
Done when checks: The `bundled-helper-resolution` Vitest test runs `skills/intake/scripts/intake-file` through a symlinked skill directory from a temporary non-harness repository and asserts the fixture harness's stub runner recorded that temporary repository as its working directory. | The same test asserts the stub runner received `--tsconfig` with the fixture engine's `tsconfig.json`, then the fixture `intake-file-cli.ts` path, then the title, body, size, priority, and depends-on arguments verbatim and in their original order. | A test places a copy of the helper several directories beneath a fixture harness with a stubbed entry point and runner and asserts that fixture's stub ran. | A test sets the stub runner to exit 3 and asserts the helper exits 3, and a test invoking the helper by a relative path from an unrelated directory asserts the stub ran with that unrelated directory as its working directory.
Missing assertion: The cited check requires propagation of a stub runner's exit status, but does not require that the non-zero status follows an issue-create failure.

Criterion: Story 3 happy: Given the enumeration-pinning test runs against the repository, when it compares the listed surface, then it asserts the `skills/*/scripts/` surface is included.
Task ids: 5
Done when checks: `collect_scripts` in `test/lint_shell.sh` enumerates files under `skills/*/scripts/` whose first line is a bash or sh shebang, and `test/lint_shell.sh --list` output includes `skills/intake/scripts/intake-file` alongside the existing `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries. | `test/test_lint_shell_enumeration.sh` builds a fixture root with a shebang helper at `skills/demo/scripts/tool`, asserts it is listed, and fails against the pre-change `lint_shell.sh`. | The enumeration test's existing assertions for `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries pass unchanged.
Missing assertion: The cited checks require a fixture-root enumeration test and the implementation’s generalized skills scripts enumeration, but do not explicitly require an enumeration-pinning test that runs against the repository and compares its listed surface.
```

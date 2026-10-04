# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-04T09:31:32.796Z
Slug: vitest-daemon-fixtures-leak-into-shared-operationa
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-vitest-daemon-fixtures-leak-into-shared-operationa
Head SHA: 33ad04170613f345bdb84005905d5475c909cf84
Halted at: 2026-10-04T09:29:59.950Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 4 negative: Given a test file outside the smoke tier references the smoke opt-in variable, when the default test suite runs, then a guard test fails naming that file.
Task ids: 9
Done when checks: The guard derives the smoke tier from the `include` globs exported by `vitest.smoke.config.ts`, not from a hand-kept list, and passes on the current tree. | The guard's scanner, run over a temp tree containing a non-smoke test file that references the opt-in variable, fails naming that file's path. | The guard's exemption list is an explicit in-file array containing exactly `test/engine/otel/export-refusal.test.ts` and `test/engine/otel/transport.test.ts`; both files reference the opt-in variable without assigning it, and the scanner passes on the current tree with the list in place, as asserted by the guard's self-check case. | No file loaded by the default, e2e, or acceptance tiers, including `test/setup.ts`, assigns the opt-in variable, as asserted by the guard passing on the current tree.
Missing assertion: when the default test suite runs
```

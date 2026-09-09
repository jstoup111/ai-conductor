# Halt record

Status: halted
Slug: cover-nested-bin-shell-files-in-both-lint-gates
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-cover-nested-bin-shell-files-in-both-lint-gates
Head SHA: 570eba35f0dfab332c4a9e3dc6beba654d389653
Halted at: 2026-09-07T11:45:16.581Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (architectural-clarity: The violated clause is another feature's approved-but-unimplemented obligation, so no task in this feature's plan can close it: adr-2026-06-30-halt-based-release-gates.md:42 requires harness integrity as a declared BUILD test_suite entry, but that amendment landed spec-only in 7cc05e9fe (#2359, issue #658) and its implementation is owned by the separate approved plan run-the-harness-integrity-suite-in-build-s-test-su.md; the violating declaration at .ai-conductor/config.yml:73-81 predates this feature's base b32eeadef and is untouched by this diff. This feature's plan tasks 1-5 admit only test/lint_shell.sh, test/test_harness_integrity.sh's syntax section, and test/test_lint_shell_enumeration.sh, none of which admit an engine-config change, so tasking it here would deliver a foreign feature's plan under this slice's authority. A human must decide whether to land the owning feature first and rebase this one, or to scope the as-built adrCompliance check so an approved-but-unimplemented amendment does not block unrelated features. Classification confidence 95%, verified from the ADR text, the spec-only commit stat, and the sibling plan on disk.); AB-2 (architectural-clarity: Same owner, same blocker as AB-1: adr-2026-06-30-halt-based-release-gates.md:43 requires the finish-plane release gate to run no tests, but src/conductor/src/engine/self-host/release-gate.ts:18-34,296-334 still carries the integrity constant, exec seam, and injection fields, wired at src/conductor/src/engine/self-host/wiring.ts:59-67 and called at src/conductor/src/engine/conductor.ts:5733-5750 — all present at merge-base b32eeadef and untouched by this diff, which changes only test/lint_shell.sh, test/test_harness_integrity.sh, and test/test_lint_shell_enumeration.sh. Removing that seam is the deliverable of the separate approved plan run-the-harness-integrity-suite-in-build-s-test-su.md; no plan task here (1-5) admits an engine source change, and removing a production gate seam under this slice's authority would drop coverage the release-gate tests already deliver with no owning criterion to preserve it. Requires the same human decision as AB-1. Classification confidence 95%, verified from the ADR amendment, the cited source lines, and the merge-base diff scope.)
```

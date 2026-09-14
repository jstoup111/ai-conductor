# Halt record

Status: halted
Slug: cover-nested-bin-shell-files-in-both-lint-gates
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-cover-nested-bin-shell-files-in-both-lint-gates
Head SHA: a89cdca2df6003d6e6ea5af5e036ab84423e0867
Halted at: 2026-09-14T19:23:44.236Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (architectural-clarity: Unchanged on retry (re-verified 2026-09-14): adr-2026-06-30-halt-based-release-gates.md:42 requires harness integrity as a declared BUILD test_suite entry, but .ai-conductor/config.yml:73-81 still omits it on both this branch and origin/main; that declaration predates this feature's merge base b32eeadef, is untouched by this diff (which changes only test/lint_shell.sh, test/test_harness_integrity.sh, test/test_lint_shell_enumeration.sh), and its implementation is owned by the separate unshipped approved plan run-the-harness-integrity-suite-in-build-s-test-su.md (spec landed in 7cc05e9fe, no .docs/shipped record). This feature's plan tasks 1-5 admit none of that engine-config work, so tasking it here would deliver a foreign plan under this slice's authority, and a `plan` disposition halts anyway. A human must decide: ship the owning feature first and rebase this one, or scope as-built adrCompliance so an approved-but-unimplemented amendment does not block unrelated diffs. Classification confidence 95%, verified from the ADR text, origin/main config and release-gate source, and the sibling plan on disk.); AB-2 (architectural-clarity: Same owner and blocker as AB-1, unchanged on retry: adr-2026-06-30-halt-based-release-gates.md:43 forbids tests in the finish-plane release gate, yet src/conductor/src/engine/self-host/release-gate.ts:18-34,296-334 (INTEGRITY_SCRIPT, IntegrityExec seam, still present on origin/main), wired at src/conductor/src/engine/self-host/wiring.ts:59-67 and called at src/conductor/src/engine/conductor.ts:5733-5750, predates merge base b32eeadef and is untouched by this diff. Removing that seam is the deliverable of the unshipped plan run-the-harness-integrity-suite-in-build-s-test-su.md; no task here (1-5) admits an engine source change, and removing a production gate under this slice would drop release-gate coverage with no owning criterion preserving it. Requires the same human decision as AB-1. Classification confidence 95%, verified from the ADR amendment, the cited source on branch and origin/main, and the merge-base diff scope.)
```

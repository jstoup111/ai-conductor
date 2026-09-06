# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-06T10:42:42.827Z
Slug: docs-guard-canonical-path-protection-2163
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-docs-guard-canonical-path-protection-2163
Head SHA: 01761ebebecad99c9f1717b9495edd06e4dfc994
Halted at: 2026-09-06T04:47:44.868Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — S1.5 (existing-task: FIXABLE impl gap already admitted by active-plan Task 1's Done-when clause "Invalid/unresolvable paths, broken links and link cycles exit 2 without falling through as unprotected targets": hooks/claude/docs-guard.sh:108 guards `raw.includes("\0")` but the value can never carry NUL because TARGET is assigned by command substitution at hooks/claude/docs-guard.sh:21, which strips NUL, so a JSON `\u0000` in file_path is silently reclassified as a different path (probe: `src/<NUL>foo.ts` exits 0 instead of the required undeterminable exit 2). Repair belongs in the payload-parsing node call at hooks/claude/docs-guard.sh:21, which still holds the un-stripped bytes: emit a bounded undeterminable decision token there instead of the raw target so the shell takes the existing exit-2 refusal path rather than the fail-open branch, keeping the fail-open behavior for merely unparseable payloads unchanged. Class sweep: the only other target-bearing command substitutions are PAYLOAD at :15 (JSON-escaped bytes, NUL cannot appear literally, so unaffected) and CLASSIFICATION at :66 (bounded decision token, no target bytes) — no sibling stripping site exists. Matched pair: the shell file is generated, so the change is authored in src/conductor/src/engine/session-hook-assets.ts (DOCS_GUARD_HOOK) and the committed hooks/claude/docs-guard.sh regenerated via bin/generate-docs-guard-hook in the same task, keeping the generated-copy check green. No coverage is removed: the classifier's own :108 NUL guard stays as defense-in-depth for any future non-stripping caller, and the existing broken-link, cycle and unreadable-component cases at src/conductor/test/engine/session-hook-assets.test.ts:244 and :259 are retained, with a new NUL case added alongside them for the non-`.docs` target that currently escapes. No new plan task is required and no plan-growth allowance is spent.) — remediation produced no dispatchable build work; the implicated task(s) are already evidence-complete — human needed
```

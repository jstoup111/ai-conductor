# Track: Engine-appended remediation tasks carry a valid Done-when block

Track: technical

Scope boundary: Small fix for #1802, approved by the operator on 2026-09-06 (delegated). Make both engine writers that append `rem-*` plan tasks emit a well-formed `**Done when:**` block, and make the land-time shape refusal name engine-appended content as engine-authored. Preserve every existing refusal for hand-authored tasks. The 2-5 criterion bound itself, the plan-growth allowance, remediation routing and dispositions, the per-task evidence rule at task close, and any re-validation caller that does not exist today are outside this slice.

This is an internal engine correction between two engine writers; acceptance criteria live in technical stories rather than a PRD.

The operator approved making the engine satisfy the existing rule over narrowing the rule to hand-authored plans, on 2026-09-06 (delegated). The issue's desired outcome states the engine-written plan must satisfy the same shape rule whatever order the two writers run in, and the alternative would leave a second, weaker contract for engine content that a later caller could not tell apart.

Scope check: A — consumer-facing (the engine ships to every installed project; no self-host, daemon-only, CI, or `.docs/`-convention signal fires, and a consumer with no daemon still runs remediation append and `landSpec`); B — n/a (no new skill); C — provider-agnostic (no provider surface is touched). No catalog registration is required, and no `HARNESS.md` rule changes because the change is engine code, not a behavioral rule.

Verified foundation: `src/conductor/src/engine/plan-done-when.ts:10-31` requires every parsed task heading to carry 2-5 nonblank `Done when:` checks, and `src/conductor/src/engine/engineer/land-spec.ts:265-276` is its only production caller. `src/conductor/src/engine/remediation-append.ts:72-104` emits a `Done when:` block only when a criterion with a parent task or a governing clause is present, and each such block carries exactly one check, which the validator grades `too-few`. `src/conductor/src/engine/conductor.ts:13394` is the second writer and appends a bare `### Task <id>: <title>` line with no metadata at all, which the validator grades `missing`. `src/conductor/src/engine/plan-task-parse.ts:226-283` accumulates checks across every `Done when:` block inside one task section, so a single consolidated block per appended task is sufficient.

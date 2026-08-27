# Coherence Mapping: remove the unattended one-shot inline run (--auto remnants)

Technical track (no `fr` rows). Outcomes staged from jstoup111/ai-conductor#1436. ADR rows:
the two amended non-deleted ADR files in this spec change set. Criterion quotes are verbatim
substrings of the cited task's body; dispositions are all diff-local.

| Row class | Cited id(s) / criterion | Counterpart id(s) | Verdict | Notes / quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-3 | covered | Daemon is the sole unattended path: rejection (Story 1) + examples point unattended readers at the daemon (Story 3) |
| outcome | outcome-2 | story-1 | covered | Clear terminal outcome naming the daemon and its guide, no partial run |
| outcome | outcome-3 | story-2 | covered | `inline --interactive` and default checkpointed run unchanged |
| outcome | outcome-4 | story-3 | covered | Grep criterion: no doc or example instructs running the one-shot; docs pages ride the maintain-documentation pre-finish gate in the same PR |
| outcome | outcome-5 | story-2, story-4 | covered | No surviving path inherits the removed flag's skips (Story 2); daemon-gated behaviors preserved as-is (Story 4) |
| outcome | outcome-6 | story-4 | covered | Tier resolution preserved on the daemon path; surviving inline paths prompt as today (story-2) |
| story | story-1 | task-1, task-2 | covered | Rejection message + dead-arm removal |
| story | story-2 | task-1, task-2 | covered | Surviving-mode derivation assertions and unknown-option regression |
| story | story-3 | task-4, task-5, task-6 | covered | Fixture re-points then deletion |
| story | story-4 | task-3 | covered | Verify-only audit, empty commit with evidence trailer |
| task | task-1 | story-1 | covered |  |
| task | task-2 | story-1, story-2 | covered |  |
| task | task-3 | story-4 | covered | Verify-only |
| task | task-4 | story-3 | covered |  |
| task | task-5 | story-3 | covered |  |
| task | task-6 | story-3 | covered |  |
| adr | adr-2026-07-22-headless-vs-guided-examples | story-3 | covered | Amended 2026-08-26: headless-capable set excludes the retired one-shot; Story 3 implements the amendment |
| adr | adr-2026-08-01-engine-owned-resumable-finish-publication | story-4 | covered | Amended 2026-08-26: foreground automatic mode is daemon-dispatch-only; Story 4 preserves that contract |
| criterion | Story 1 happy: Given a repo on a supported checkout, when `conduct-ts inline "x" --auto` is invoked, then the process exits non-zero before any pipeline step runs and stderr names `conduct-ts daemon start` and `docs/guides/running-the-daemon.md` | task-1 | covered | "assert the `--auto` rejection stderr contains both `conduct-ts daemon start` and `docs/guides/running-the-daemon.md`" | diff-local |
| criterion | Story 1 happy: Given the rejection fires, when the process exits, then no worktree, branch, `.pipeline/` state, or provider dispatch was created by the invocation | task-1 | covered | "the process-exit path fires before any pipeline construction" | diff-local |
| criterion | Story 1 negative: Given both flags, when `conduct-ts inline "x" --auto --interactive` is invoked, then the process exits non-zero with the mutual-exclusion error and no pipeline step runs | task-1 | covered | "confirm the `--auto --interactive` mutual-exclusion assertion still passes unchanged" | diff-local |
| criterion | Story 1 negative: Given a script that pipes stdin, when `conduct-ts inline "x" --auto < /dev/null` runs headless, then the rejection still exits non-zero without hanging on any prompt | task-1 | covered | "`conduct-ts inline "x" --auto` exits non-zero printing both substrings" | diff-local |
| criterion | Story 2 happy: Given no mode flag, when `conduct-ts inline "x"` starts, then the run mode is `default` and checkpoint prompts still fire at checkpoint steps | task-2 | covered | "Surviving behavior: no flag → `'default'`, `--interactive` → `'interactive'`, `--auto` → rejection" | diff-local |
| criterion | Story 2 happy: Given the interactive flag, when `conduct-ts inline "x" --interactive` starts, then the run mode is `interactive` and `dangerouslySkipPermissions` remains off for its dispatches | task-2 | covered | "Mode-derivation tests cover default and interactive derivation and pass" | diff-local |
| criterion | Story 2 negative: Given the deprecation, when any surviving inline mode runs, then no code path skips checkpoint prompts, sets `dangerouslySkipPermissions`, or auto-skips advisory failures on the strength of the removed flag | task-2 | covered | "`deriveMode` has no `'auto'` return path and the package compiles" | diff-local |
| criterion | Story 2 negative: Given an unknown flag, when `conduct-ts inline "x" --bogus` is invoked, then the CLI still fails with its normal unknown-option error (the deprecation stub did not widen flag parsing) | task-1 | covered | "assert an unknown option (e.g. `--bogus`) still yields commander's normal unknown-option error" | diff-local |
| criterion | Story 3 happy: Given the examples directory, when its flows are enumerated, then the unattended demo is the daemon flow and every surviving example self-asserts `PASS/FAIL <flow>/<tier>` per the headless contract | task-6 | covered | "Surviving observable behavior: four example flows" | diff-local |
| criterion | Story 3 happy: Given the example test suite, when `test/test_examples_common_prompt.sh`, `test_examples_common_sandbox.sh`, and `test_examples_common_timeout.sh` run, then they pass using a surviving flow as their fixture | task-4 | covered | "Run `./test/test_examples_common_sandbox.sh` green" | diff-local |
| criterion | Story 3 negative: Given the re-pointed common sandbox test, when its flow is killed for wedging, then it still exits non-zero and prints its `FAIL <flow>/<tier>: timeout` assertion (the fixture swap preserved the negative-path coverage) | task-4 | covered | "The timeout negative path still asserts the FAIL print and non-zero exit for the new fixture flow" | diff-local |
| criterion | Story 3 negative: Given the full validation suite, when `test/test_harness_integrity.sh` runs, then it passes with no reference to the retired example or its test | task-6 | covered | "`test/test_harness_integrity.sh` passes" | diff-local |
| criterion | Story 4 happy: Given a daemon dispatch, when the Conductor is constructed, then it still receives `mode: 'auto'` and checkpoint steps do not prompt | task-3 | covered | "For each site record verdict `keep` with its governing authority" | diff-local |
| criterion | Story 4 happy: Given a daemon dispatch with no recorded tier, when the complexity step runs, then it still takes the existing tier or defaults to `L` without prompting | task-3 | covered | "fail-closed-decide-entry (complexity short-circuit)" | diff-local |
| criterion | Story 4 negative: Given a config-declared advisory custom step that fails under daemon dispatch, when the failure is handled, then it is auto-skipped with the skip recorded, exactly as before this change | task-3 | covered | "remove-retrospectives-one-shot (advisory auto-skip)" | diff-local |
| criterion | Story 4 negative: Given a daemon build stall with remediation budget, when remediation dispatch is evaluated, then the `daemon && mode === 'auto'` gates fire exactly as before this change | task-3 | covered | "daemon stall-remediation sites gated on `this.daemon`" | diff-local |

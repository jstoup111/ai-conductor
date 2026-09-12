# Intake origin: support-multiple-test-suites-in-build

Source-Ref: jstoup111/ai-conductor#2358
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2358 digest=903f817d9d4f1c9f1478381ec9cf3d4b0381b123214ef51be253aef1dcf0890c >>>
## Desired outcome

- Project config can declare an ordered list of test-suite commands, each with its own working directory and timeout, and the existing single `command` keeps working unchanged as the one-entry case.
- BUILD's test_suite runs the entries in order and stops at the first failure; the step's evidence and the remediation prompt name which entry failed, with its exit code and duration.
- The content-addressed full-suite proof accounts for every entry, so adding, removing, reordering, or editing any entry invalidates a prior PASS.
- `scoped_command` and the build_review counterfactual preflight are unchanged.
- Configuration and step documentation describe the list form; an invalid entry (empty command, working directory outside the project root) is refused by name at config load like the existing keys.
<<< END INBOUND >>>

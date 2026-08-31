# Intake origin: remediation-task-ids-are-non-numeric-by-design-but

Source-Ref: jstoup111/ai-conductor#2064
Owner: jstoup111

## Desired outcome

- A criterion owned by an engine-appended remediation task can be cited in the Verdict Table, and
- A citation that names a task the plan does not contain is still rejected, with a diagnostic
- Appending a remediation task never makes a previously-parseable report unparseable.
- The two modules agree on one task-id grammar, so a future consumer cannot narrow it again
- The five tasks renumbered by hand on `test-suite-re-runs-and-re-passes-the-full-suite-10` do not

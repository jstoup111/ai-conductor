# Intake origin: test-suite-re-runs-and-re-passes-the-full-suite-10

Source-Ref: jstoup111/ai-conductor#2021
Owner: jstoup111

## Desired outcome

- A project can configure suite verification so that a `test_suite` PASS recorded for a
  feature is not re-litigated by later pipeline activity within that same feature, and
  the feature reaches SHIP having run the full suite once.
- With that configuration active, an unrelated main-side or foreign code change does not
  by itself cause `test_suite` to re-run or to consume a BUILD kickback.
- A project can independently choose whether the gate verifies with the full aggregate
  command or with a scoped selection, and the chosen mode is visible in the run's
  evidence and events, so an operator reading `.pipeline/events.jsonl` can tell which was
  used without reading engine code.
- Choosing the scoped mode without a usable scoped configuration is rejected at config
  load with a message naming the missing piece — it never silently degrades to the full
  suite or to no verification.
- Both settings are presented and decided during bootstrap, so a newly bootstrapped
  project has an explicit answer recorded in its generated config rather than inheriting
  an unstated default.
- Existing projects that do not set either option keep today's behavior exactly: full
  aggregate command, re-verified on any code/test delta.
- The `test_suite` verdict a feature ships on remains traceable to the tree that was
  actually shipped — an operator can determine, from the recorded evidence, which commit
  or content state the passing run attested, and how far the shipped tree has drifted
  from it since.
- A project can declare how much drift is tolerated before a recorded PASS must be
  re-earned, so re-verification is bounded rather than all-or-nothing. Under that budget
  a feature accumulates unrelated changes without re-running the suite; once the budget
  is exceeded the gate re-runs and the run's evidence names which part of the budget was
  exhausted.
- The drift budget is expressed in terms an operator can reason about before a run —
  not a raw count of changed files, which weights a one-line change in a core module the
  same as forty changed docs.

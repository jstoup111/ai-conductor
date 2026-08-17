# Coherence: Framework-agnostic tautology scoped-run classification

Plan stem: `tautology-rubric-never-returns-a-verdict-on-rspec-`. Tier M, technical track; the `fr` row
class is omitted because this track has no PRD, so acceptance criteria live in the stories. Two
outcomes are met by a mechanism other than the one their bullet names, and both are adjudicated in
`.docs/conflicts/` and in the approved ADR rather than silently reinterpreted here: `outcome-2` is
met by the bounded failure excerpt reaching the judging skill instead of by a mechanical bucket,
because restoring that bucket would reverse the shipped `#1593` decision and re-introduce the output
parsing this feature removes; `outcome-3` is met by an explicit judging-skill rule instead of the
deleted `no-tests` engine branch, which produced an unroutable infrastructure stall for two
frameworks and misfired for every other. Both relocations are load-bearing conditions of the
architecture review's approval, not incidental.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | Story 1 requires a non-zero counterfactual to classify as `red`/`nonzero-exit` on RSpec output and on every other runner, never as an infrastructure failure. |
| outcome | outcome-2 | story-3 | covered | The load-versus-assertion distinction survives in the bounded excerpt the rubric reads; Story 3 pins that a reverted-tree load failure is accepted as expected evidence per `#1593` while a run that executed nothing yields a finding. |
| outcome | outcome-3 | story-3 | covered | Story 3 relocates the no-executed-test detection into the judging skill, producing a routable finding rather than the deleted bucket's no-verdict. |
| outcome | outcome-4 | story-1, story-3 | covered | Story 1 removes the classification path that withheld a verdict; Story 3 requires the rubric to return a judged pass or fail and never an infrastructure result. |
| outcome | outcome-5 | story-4 | covered | Story 4 retains the scoped run's bounded stdout/stderr on the existing spine event, persisted to `.pipeline/events.jsonl`. |
| story | story-1 | task-3, task-5, task-10 | covered | These tasks delete the classifier, fix the evidence value set the verdict is carried in, and document the exit-code contract. |
| story | story-2 | task-1, task-2, task-4, task-7, task-11 | covered | These tasks narrow both unions, pin every surviving infrastructure reason, keep the output-free reasons unchanged, and prove the removed surface is absent. |
| story | story-3 | task-9 | covered | Task 9 states the no-executed-test rule, its exception scoping, and the corrected `runKind` values in the judging skill. |
| story | story-4 | task-6, task-7, task-8 | covered | These tasks add the bounded excerpt, omit it where no runner ran, and carry it onto the existing event. |
| task | task-1 | story-2 | covered | Narrows the scoped-run result union to observable process outcomes. |
| task | task-2 | story-2 | covered | Removes the output-derived infrastructure reasons and simplifies the scoped-run branch. |
| task | task-3 | story-1 | covered | Deletes the classifier and classifies by exit code across five runners' output. |
| task | task-4 | story-2 | covered | Pins launch, timeout, signal, thrown execution, and every output-free reason. |
| task | task-5 | story-1 | covered | Narrows the projected `runKind` to the exit-code contract. |
| task | task-6 | story-4 | covered | Retains a bounded head+tail excerpt on scoped-run infrastructure failures. |
| task | task-7 | story-2, story-4 | covered | Omits the excerpt where no scoped run produced output, fabricating nothing. |
| task | task-8 | story-4 | covered | Adds the additive optional event field and emits it from the coordinator. |
| task | task-9 | story-3 | covered | Lands the judging-skill rule that replaces the deleted mechanical detection. |
| task | task-10 | story-1 | covered | Records the exit-code contract in the canonical gate documentation. |
| task | task-11 | story-2 | covered | Verify-only pass proving no removed string survives and the single-execution contract holds. |
| adr | adr-2026-08-17-framework-agnostic-tautology-scoped-run | story-1, story-2, story-3, story-4 | covered | D1 and D2 are delivered by Stories 1 and 2, D3 by Story 1, D4 by Story 3, and D5 by Story 4; the rejected control-run alternative is delivered by omission, pinned by Story 1's single-invocation criterion. |

All 21 applicable rows are covered; zero gaps. Verdicts were checked against the five staged intake
outcome bullets, the four accepted stories, the 11-task plan, and the single ADR added in this
worktree.

# Intake origin: plan-tasks-lack-falsifiable-done-criteria-so-revie

Source-Ref: jstoup111/ai-conductor#1763
Owner: jstoup111

## Desired outcome

- Every approved plan task carries explicit, falsifiable completion criteria: an enumerable set of checks a zero-context reviewer can evaluate to a definite yes/no without appealing to an ideal.
- A plan containing a task without such criteria is rejected when the plan is authored/reviewed — at DECIDE — not discovered as unmeetable at BUILD lap 5.
- A build_review rubric judging a task with such criteria cannot fail the task for a demand beyond them; a legitimate deeper concern becomes a filed issue, never a finding on the current feature (the shrink-or-file rule of #1718).
- A feature that satisfies every task's stated criteria reaches SHIP with zero operator interventions of the kind logged today.
- Existing well-formed tasks still land unchanged: criteria that are already explicit are not forced through any new ceremony.

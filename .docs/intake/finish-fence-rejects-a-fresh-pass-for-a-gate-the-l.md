# Intake origin: finish-fence-rejects-a-fresh-pass-for-a-gate-the-l

Source-Ref: jstoup111/ai-conductor#2680
Owner: jstoup111

## Desired outcome

- A gate that was preserved by a rebase and later re-judged to a fresh satisfied verdict does not block finish.
- A preserved gate whose verdict is unsatisfied, or which lost its replay authority with no fresh re-judgement, still blocks finish (fence intent preserved).
- A preserved gate that is not re-judged keeps its replay-bound authority (no forced re-review).

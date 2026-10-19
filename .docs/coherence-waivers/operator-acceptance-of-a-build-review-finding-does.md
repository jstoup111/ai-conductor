Waives: outcome-2

Rationale: the operator decided on 2026-10-19, during DECIDE for jstoup111/ai-conductor#3271, that
the PR body's accepted-risk section keeps the #1614 privacy line for carried findings. It lists each
carried finding's id, rubric, and carried-from origin finding id and lap, but not the original
operator or rationale. That decision is recorded in the amendment to Decision 6 of
`adr-2026-08-13-stable-build-review-finding-dispositions`. The rest of the outcome is delivered:

- Story 6 shows the operator and rationale in the local `build-review findings` output (text and
  `--json`), and the carried-from id and lap in the PR body.
- Story 7 makes every carry observable on the event spine.

Nothing is deferred to another spec.

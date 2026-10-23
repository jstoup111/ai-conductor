Waives: outcome-2

Rationale: the operator decided on 2026-10-19, during DECIDE for jstoup111/ai-conductor#3271, that
the PR body's accepted-risk section keeps the #1614 privacy line for carried findings. The section
lists each carried finding's id, rubric, and carried-from origin id and lap, but not the original
operator or rationale. The respec re-encodes that decision as D8 of
`adr-2026-10-20-operator-acceptance-is-durable-case-state`, which the operator approved on
2026-10-21. The rest of the outcome is delivered:

- Story 7 shows the operator, rationale and origin lap in the local `build-review findings` output
  (text and `--json`), and the carried-from id and lap in the PR body and shipped record.
- Story 8 makes every carry observable on the event spine.

Nothing is deferred to another spec.

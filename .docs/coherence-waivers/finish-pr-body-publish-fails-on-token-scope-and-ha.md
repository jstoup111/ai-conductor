Waives: outcome-1

Rationale: jstoup111/ai-conductor#3376's outcome 1 asks that FINISH publish an authored PR title and
body with a token scoped only to `repo` (+ `workflow`). The operator declined this outcome during
explore on 2026-10-24. The failure came from the configured `github_bot` token lacking `read:org`,
which `gh pr edit` needs. The operator treats that as an operator-config issue, fixed by granting
the scope, not a harness defect. Changing the `pull-request.edit`/`retarget` transport from
`gh pr edit` to REST is therefore excluded by the scope boundary in
`.docs/track/finish-pr-body-publish-fails-on-token-scope-and-ha.md`, and
adr-2026-10-24-finish-surfaces-guarded-publish-failures records it as out of scope. Outcomes 2-4,
the misdiagnosed halt, are delivered by Stories 1-3.

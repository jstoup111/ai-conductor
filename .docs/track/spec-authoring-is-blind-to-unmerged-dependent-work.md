# Track: spec authoring blind to unmerged dependent work (#523)

Track: technical

Internal DECIDE-phase tooling: a read-only overlap-surfacing check that runs at
`/architecture-review` + `/plan` time and warns a spec author when their candidate files
overlap unmerged sibling `spec/*`/PR branches or an open `blocked_by` link. No user-facing
product capability — acceptance criteria live directly in stories. Reuses existing
`blocker-resolver` + `rebase.ts` diff primitives; the build side (`daemon-backlog`) is
untouched. Scope A of three (operator-selected). Source: jstoup111/ai-conductor#523.

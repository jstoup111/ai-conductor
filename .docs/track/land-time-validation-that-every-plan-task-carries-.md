# Track: land-time-validation-that-every-plan-task-carries-

Track: technical

Scope boundary: Land-time gate only (Approach A) — port `validatePlanDoneWhen` from
`feat/daemon-plan-tasks-lack-falsifiable-done-criteria-so-revie` (`plan-done-when.ts`) plus its
single `land-spec.ts` call site and tests, reusing main's `parsePlanTaskDoneWhen`/`parsePlanTaskIds`.
Excluded: any BUILD-time / daemon plan-load validation and any grandfathering of legacy merged plans.

Engine land gate with no user-facing product behavior; acceptance criteria live in stories. Tier S.

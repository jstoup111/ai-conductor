# Track: build-step-completes-with-every-plan-task-still-pe

Track: technical

Scope boundary: Balanced (operator-confirmed). In scope: a plan task whose text changed since it was
seeded must not be resolved by `Task:` trailers that predate the change (approach A — the content
change admits a repair obligation through the existing #2355 machinery); every incomplete-build
reason names each pending task by id and title; a build with every task already complete still
passes cleanly; the stale "build_review completeness rubric is the backstop" comments are corrected.
Out of scope: a second ledger-completeness assertion in test_suite/build_review, removing the
trailer union, and any change to rewind's step-state semantics.

## Rationale

Internal engine evidence semantics for the `build` step predicate — no new command, flag, config
key, or user-facing product surface. Acceptance criteria belong in stories. → **technical track**
(skip `/prd`).

# Track: BUILD runs the test_suite pre-check before completing

Track: technical

Scope boundary: an optional `test_suite.pre_check` command list that BUILD runs as its last completion floor and at the retries-exhausted escape, its config validation, the retry hint and no-task-progress stall exemption for its miss, a PASS held per HEAD, and this repository's own config setting it to format:check plus both typechecks. Excluded: any change to the `test_suite` gate, its evidence, verification modes or drift budgets, scoped runs, and any pre-check for steps other than `build`.

Engine-internal BUILD routing with no operator-facing product surface; acceptance criteria live in stories.

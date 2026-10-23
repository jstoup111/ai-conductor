# Track: build_review remediate context grows with the whole plan, not the findings

Track: technical

Scope boundary: Scope the remediate judgement's admitted task contracts to the current findings and open cases, add one bounded expansion round when the judge admits work against a task it saw only in the index, and carry the provider's exit facts into the remediate halt. Prior-case history stays complete, as the APPROVED adr-2026-09-10-portable-build-review-policy requires. Out of scope, to be filed as separate intakes if wanted: projecting prior cases, and Pi's dropping of `options.systemPrompt` (#3309). A per-transport context ceiling is out of scope: every provider already delivers the prompt, which carries the context, over stdin (verified 2026-10-23), and #3290 moved Claude's system prompt to a file.

Internal engine behavior (the build_review adjudication context, the coordinator's judge round, the remediate halt diagnostics), with no user-facing product requirements; acceptance criteria live in stories. Operator confirmed 2026-10-19; scope narrowed by the operator 2026-10-23.

Chosen approach (B): send full task bodies only for tasks whose declared files contain a current finding's evidence path, tasks named by the finding pointers, and tasks admitted by open prior action cases. Add an id, title and dependency index of every plan task. The existing admission check already accepts only task ids whose body was supplied. When a case-v2 judgement fails validation only because it admits index-only tasks, the engine discards that judgement and re-dispatches the same remediate judgement once with those bodies added (operator decision 2026-10-23, amending mixed-laps D2). A second miss stops with a named reason listing the unsupplied task ids. The remediate halt carries the provider's bounded exit facts.

Rejected: (A) the filer's title index without enforced admission closure, because the judge could admit against a contract it never saw; (C) passing the context by file reference, because cost would then track the judge's discipline rather than the engine, contradicting the frozen-projection contract; failing closed on every index-only admission, because each miss would halt needs-human after BUILD and `test_suite` were paid for.

Source: jstoup111/ai-conductor#3291. Also resolves jstoup111/ai-conductor#3195 (same root cause, filed 2026-10-11).

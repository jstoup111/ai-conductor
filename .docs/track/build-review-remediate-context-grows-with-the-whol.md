# Track: build_review remediate context grows with the whole plan, not the findings

Track: technical

Scope boundary: Scope the remediate judgement's admitted task contracts to the current findings, and make the context ceiling deliverable by every provider transport, with a named stop. Prior-case history stays complete, as the APPROVED adr-2026-09-10-portable-build-review-policy requires. Out of scope, to be filed as separate intakes: projecting prior cases, and Pi's dropping of `options.systemPrompt` (`pi-provider.ts`).

Internal engine behavior (the build_review adjudication context, the admission validator, the remediate halt diagnostics), with no user-facing product requirements; acceptance criteria live in stories. Operator confirmed 2026-10-19.

Chosen approach (B): send full task bodies only for tasks named by finding pointers, by the admitted ids of open cases, or by declared files that overlap a finding's evidence locations, plus an id, title and dependency index of every plan task. The engine allows admission only to tasks whose full body was supplied. When the judge names a task it saw only in the index, the engine runs one bounded expansion re-dispatch, and a second miss stops with a named reason. The remediate halt carries the provider's exit facts.

Rejected: (A) the filer's title index without enforced admission closure, because the judge could admit against a contract it never saw; (C) passing the context by file reference, because cost would then track the judge's discipline rather than the engine, contradicting the frozen-projection contract.

Source: jstoup111/ai-conductor#3291.

# Track: tasks-close-with-boilerplate-done-when-evidence-mi

Track: technical

Scope boundary: Balanced (operator-confirmed). In scope: `/plan` marks each Done-when check that
requires a test with an inline tag the land gate validates; at BUILD task close a tagged check
accepts only a structured test reference — the cited file exists at HEAD (not restricted to the
feature diff), contains the named title (whitespace-normalized substring), and carries a `Covers:`
marker naming that task or a story criterion the check covers, parsed text-only by the existing
language- and framework-agnostic `covers-marker` grammar — and generic evidence that names no test
is refused; close records are stamped verified / reported / unverified; engine-generated
remediation plan tasks appended for a story criterion (prd_audit criterion-bound FIXABLE findings, via
the existing remediation-append seam) carry the tag on their criterion check. A
refused tagged check is never a plan-gap HALT: the agent writes or cites the test, or closes the check
with an explicit unverified marker. Unverified checks get one in-build nudge turn naming each
check; anything still unverified then lets BUILD complete, is recorded on the event spine, and is
supplied to `prd_audit` as part of its engine-owned input so it is not rediscovered. Existing retry
and lap caps still apply — exhausting them halts exactly as today. No new operator halt class. Verification must work in any consumer
project: no TypeScript-AST, repo-specific path, or test-framework assumption. Untagged checks and legacy plans close
exactly as today.
Out of scope: projecting unverified checks into the `build_review` testQuality rubric and defaulting
that rubric on (operator-chosen intake follow-up); checking that the named test passed in `test_suite` evidence; LLM judgement of whether a
named test actually asserts its check; plan-time classification by the `coverage_binding` judge;
keyword-heuristic detection of test-requiring checks; #2014's stale-trailer reopening (interaction
handled at conflict-check).

Internal engine evidence semantics for task close plus plan/pipeline skill text — no product surface;
acceptance criteria live in stories.

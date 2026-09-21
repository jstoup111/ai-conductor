Waives: outcome-1

Rationale: outcome-1 of jstoup111/ai-conductor#2607 asks that "a conflict where the resolver can
state both sides' intent and a verifiable choice exists (the affected tests pass with it) is
resolved and published without operator involvement". This spec delivers that only for conflicts
whose every conflicted path is test code.

The wider form is refused by an approved decision. `adr-2026-08-01-rebase-full-replay-intent-validation`,
written after incident #1152, states that when "the source and upstream intentions conflict
semantically" the resolver "must not continue", and that "ambiguity is no longer accepted merely
because downstream tests might pass". A passing suite does not show that the right side won in
production code the suite covers thinly.

The operator reviewed the risk of amending that decision in full against abandoning the idea on
2026-09-20 and chose the test-only exception: it covers the observed case (pull request #2574's
replay commit touched one test file), a wrong pick there cannot ship runtime behavior, and the
audit comments it produces are the evidence base for any later widening, which would need a
further ADR amendment. Production-path conflicts keep today's escalation with full diagnostic
detail, which is outcome-4.

# Track: Remediation tasks close on a reported commit that never implemented them

Track: technical

Scope boundary: engine-appended `rem-*` remediation tasks only. Ordinary plan tasks and the existing `[test]` Done-when verification semantics are unchanged.

Internal BUILD gating with no user-facing product requirements; acceptance criteria live in stories. Operator confirmed 2026-10-21. Chosen approach: before BUILD hands off, one bounded, schema-constrained judgement per completed `rem-*` task asks whether its originating finding still holds at HEAD (finding + cited-commit diff + current code at the named locations); a `persists`/`partial` verdict reopens that task with the reason as feedback, under a retry bound, with the verdict on the event spine (the `rebase-regrade-judgement` pattern). Rejected: a test-new-in-round requirement (test presence is not the fix) and file-path binding of evidence (a touched file is not an implemented finding; grows exceptions). Source: jstoup111/ai-conductor#3190.

# Track: Operator acceptance survives a build_review re-raise (respec of #3271)

Track: technical

Scope boundary: every desired outcome of jstoup111/ai-conductor#3271, including the outcomes
consolidated from #3303. (1) A later-lap finding that the `remediate` adjudicator binds to an
operator-accepted case does not block: no regression or repeat halt, no new decision stop, no
`conflicting-case-id`. (2) The carry is visible in `build-review findings`, in the PR accepted-risk
section and on the event spine. (3) The adjudicator sees which prior cases an operator accepted.
(4) An unbound finding still blocks exactly as today. (5) Acceptance stays feature-scoped. (6) At a
clean PASS, an open action case whose effect failed or was never built, and whose every source is
operator-accepted or no longer raised, ends resolved with its history intact. (7) A failed action
case whose finding is still raised and unaccepted still blocks. (8) When settlement cannot proceed,
the halt names a supported, TTY-gated operator command that resolves the blocking case. Excluded:
stabilizing custom-rubric finding identity, cross-feature acceptance, and any carry that a mechanical
match decides without an adjudicator binding.

Selected approach: carry is state, decided once at write time. When the accepting lap finalizes and
retires a case whose every source is operator-accepted, the case records an operator-acceptance
mark. A later lap's `existingCaseId` binding to a marked case enters one reconciler carry lane. That
lane appends the source as `carried` and charges, halts and stops nothing. The existing settled-source
function is the only reader path for carry. Each carry occurrence is written to an outbox in the same
case-store transaction and drained through the event persister's eventId dedup. Case store v2 → v3.

Internal engine gating behavior with no product requirements; acceptance criteria live in stories.

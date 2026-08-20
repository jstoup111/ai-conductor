# Track: Clean rubric judgements rejected as invalid-provider-result

Track: technical

Scope boundary: Four engine-side seams, operator-confirmed 2026-08-19 — (A) diagnosis
integrity in the build_review judged-result rejection path, (B) the `anchor.planTask`
canonical-form regression repaired at both the parser and the contract, (C) engine-owned
judged-result envelope so the provider supplies only `findings`, and (D) a drift guard
pinning parser-enforced reference grammars to the rubric contract text. EXCLUDED and
deferred to the in-flight `review-infrastructure-failures-are-operator-unreco` feature:
the retry-budget accounting and the operator lever for a drained budget
(`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D1-D10 owns that seam).

Engine-internal correctness repair to the build_review rubric result boundary. No
user-facing capability and no product requirements to enumerate; acceptance criteria for
every seam are expressible directly as story scenarios over engine behavior, so no PRD is
authored.

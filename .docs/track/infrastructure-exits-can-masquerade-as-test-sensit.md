# Track: infrastructure-exits-can-masquerade-as-test-sensit

Track: technical

Scope boundary: Balanced — engine stops treating any nonzero counterfactual exit as sensitivity evidence; the sensitivity judgement moves to the testQuality reviewer as a schema-constrained output field the engine validates and persists. Excludes: neutral treatment for unrevertable external state (migrations/DDL) and a second comparison run at unchanged HEAD — both remain follow-ups on #2051's thread.

Internal build_review gate machinery (counterfactual preflight + reviewer contract); no user-facing product capability, so acceptance criteria live in stories with no PRD.

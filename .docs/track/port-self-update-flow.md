# Track: port-self-update-flow

Track: technical

## Rationale

This is a **relocation of existing plumbing**, not a new user-facing capability.
The consumer self-update / channel flow already exists and is documented in
HARNESS.md 286–307; the work moves it out of the soon-to-be-removed `bin/conduct`
bash CLI into a durable landing spot so the v1.0 cutover (#228, blocker for #226)
does not silently strip consumers' ability to update the harness.

There are **no new product/user-facing requirements** — the observable behavior
(same prompts, same channels, same rollback semantics) must be *preserved*, not
invented. Acceptance criteria are therefore behavioral-equivalence assertions and
live in the stories artifact. No PRD is authored (technical track).

## Source

GitHub intake `jstoup111/ai-conductor#220`.

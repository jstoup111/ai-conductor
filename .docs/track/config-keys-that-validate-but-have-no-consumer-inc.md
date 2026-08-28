# Track: Config keys that validate but have no consumer

Track: technical

Scope boundary: Full outcomes from jstoup111/ai-conductor#1025 — every listed key wired or removed
from the type, template, and validator; `steps.<custom>.gate`/`kickback_target` accepted by the
validator; `conductor` block guarded against project-path override; a test asserting the consumer
registry is total over the validator's accepted key sets and that every non-`none` declaration
names a production module path that resolves on disk. Excludes implementing new consumers for the
dead keys (Approach B rejected), and excludes proving runtime reachability — a declaration records
a reviewed consumer, it does not prove the key is read at that path (see the ADR decision 4 note
below).

Config validator/resolver hygiene with no new user-facing capability — acceptance criteria live in
stories, no PRD.

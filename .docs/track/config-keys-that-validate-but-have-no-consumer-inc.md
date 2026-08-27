# Track: Config keys that validate but have no consumer

Track: technical

Scope boundary: Full outcomes from jstoup111/ai-conductor#1025 — every listed key wired or removed
from the type, template, and validator; `steps.<custom>.gate`/`kickback_target` accepted by the
validator; `conductor` block guarded against project-path override; a test asserting every
documented config key reaches at least one consumer. Excludes implementing new consumers for the
dead keys (Approach B rejected).

Config validator/resolver hygiene with no new user-facing capability — acceptance criteria live in
stories, no PRD.

# Track: Tests leak fixture slugs into the parked-feature ledger

Track: technical

Test-infrastructure hardening (#1251). No user-facing product capability changes — the
fix contains fixture park markers to disposable test roots and adds a teardown guard.
Acceptance criteria live directly in the stories; no PRD.

# Track: manual-test-fail-routing

Track: technical

Engine fix for ai-conductor#367: manual_test FAILs are currently whitewash-able (a
within-step retry can rewrite `.pipeline/manual-test-results.md` as PASS with no fix
commits) and, independently, an advisory manual_test that exhausts retries is silently
auto-skipped in auto mode — two paths to a false-green ship (incident: PR #364; sweep
found 3/5 flagged ships defective). Fix = Approach B (operator-selected 2026-07-06):
daemon kickback route manual_test→build with FAIL evidence, FAIL→PASS fix-evidence gate,
append-only per-attempt results, and enforcement flip advisory→gating. No user-facing
product behavior — acceptance criteria live directly in stories; no PRD.

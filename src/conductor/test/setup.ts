// Global vitest setup (see vitest.config.ts `setupFiles`).
//
// Kill-switch: forbid the pr-labels production gh/git runners from shelling out
// during the test run. Every test injects a fake runner; this guarantees that a
// test which ever reaches a REAL runner (e.g. a daemon-mode Conductor test that
// forgets to stub escalation) cannot mutate live GitHub. Without it, an auto-mode
// failure test once reused a live PR and added a `needs-remediation` label + a
// `boom` comment. See `src/engine/pr-labels.ts` → `assertRealExecAllowed`.
//
// Scope: ONLY the pr-labels seam honors this flag. The real-`git` integration
// tests (rebase, daemon-rekick "real primitives") use their own execa paths and
// are intentionally unaffected.
process.env.AI_CONDUCTOR_NO_REAL_EXEC = '1';

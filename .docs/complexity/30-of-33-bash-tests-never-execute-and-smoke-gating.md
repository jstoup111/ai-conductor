# Complexity: Every bash test executes in CI or is removed

Tier: M

Rationale: Three new mechanisms on existing seams, with no engine runtime change. First, a
committed shell-test manifest and a `test/run_shell_tests.sh` runner give every listed script an
isolated `HOME`/`TMPDIR`. Second, a new CI job in `.github/workflows/ci.yml` runs that runner.
Third, a `test_harness_integrity.sh` check classifies every `test/*.sh` and fails on any orphan.
The same check also asserts that every smoke file declares a `smokeCapability`. The bulk of the
work is triage: about 37 orphan scripts (out of 67), each kept, fixed, or deleted. That work is
mechanical but broad, and some installer scripts may need `HOME` sandboxing before they can run
safely.

There is no new state, event, config key, CLI, or schema. The CI-job and integrity-check
conventions have existing precedent, so a lightweight architecture review is enough. This matches
the `Size: M` on intake #1021. The plan stem must remain
`30-of-33-bash-tests-never-execute-and-smoke-gating`.

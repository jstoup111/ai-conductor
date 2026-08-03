# Complexity assessment: Daemon E2E smoke step has no real-agent (live-LLM) tier (#1124)

Tier: M

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | None. Reuses the committed `test/fixtures/daemon-e2e/` feature and the `LLMProvider` contract unchanged. |
| Integrations | Three new third-party boundaries in CI: real `claude` and real `codex` subprocesses (a two-leg matrix), and a new manually-dispatched GitHub Actions workflow separate from `ci.yml`. |
| Auth / identity | Yes, and two distinct paths — `CLAUDE_CODE_OAUTH_TOKEN` (the setup-token pattern proven by `test/engine/build-token-auth.smoke.test.ts`) and Codex API-key auth via `CODEX_API_KEY`. Verified 2026-08-02: the repository has **zero** Actions secrets today, so both must be provisioned before either leg produces signal. |
| State machines | None. The daemon claim → build → evidence → completion → finish path is production code and is not modified. |
| Story count | 5 (live tier drives the fixture to a terminal finish per provider; bounded cost; failure diagnostics; advisory isolation from the required per-PR gate with a fail-closed gate mode for a later release gate; skip-not-fail when a leg's credential or binary is absent). |
| Files touched | New `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`; a shared diagnostics helper extracted from `test/engine/daemon-e2e-fixture.test.ts`; new `.github/workflows/*.yml`; `docs/contributing/testing.md`; `CHANGELOG.md`. |
| Blast radius | Additive. The per-PR required path (`ci.yml` → `ci-gate`) is untouched; the new file is excluded from `npm test` by the existing `*.smoke.test.ts` glob, so a regression here cannot block a merge. |

Points to **Medium**, not Small: the change adds a live third-party boundary with
secret-backed auth and a second CI workflow whose trigger, permissions, and cost
bound are design decisions with a real failure mode (a leaked or unbounded live
run). It is not Large: no new subsystem, no state-machine change, no schema or
migration, and the pipeline under test is reused verbatim from the deterministic
tier that shipped in PR #1155.

Per the tier rules this Medium technical change **requires** conflict-check,
architecture-diagram, a lightweight architecture-review, and a coherence-check
alongside track, stories, plan, and this marker. The PRD is skipped (technical
track — acceptance criteria live in the stories).

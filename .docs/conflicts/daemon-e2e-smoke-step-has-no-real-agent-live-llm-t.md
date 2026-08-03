# Conflict Check — Live-agent daemon E2E smoke tier (#1124)

Checked the 5 stories against each other and against the existing system, the open PR set, and the
adjacent open issues, for contradictions, overlaps, shared-state conflicts, and resource contention.
Checked 2026-08-02.

## Inter-story: clean

The stories form a single deliverable with disjoint concerns: ST-1 owns the live run's outcome
assertions, ST-2 its cost bounds, ST-3 its failure output, ST-4 its isolation from the required
gate, ST-5 its credential-absence behavior. No two stories assert over the same condition with
different expectations.

One deliberate seam between ST-1 and ST-5 is worth naming: ST-1's terminal-state assertions only
apply on a leg that actually ran; ST-5 defines when a leg does not run. They are sequenced
(gate first, then run), not competing.

## System conflicts & how each is resolved

1. **`dumpPipelineDiagnostics` is a shared write target with the deterministic tier (real, managed).**
   ST-3 extracts the helper currently inlined at
   `src/conductor/test/engine/daemon-e2e-fixture.test.ts:35-68`, which means editing a file this
   feature does not own. *Resolution:* the extraction is pure motion plus two additive dumps
   (`task-status.json`, `task-evidence.json`); the deterministic tier's assertions are untouched, and
   its four existing cases must still pass unchanged as part of the same task. Verified 2026-08-02:
   **no open PR touches that file** (11 open PRs, all spec-landing or unrelated features), so the
   extraction lands without contention. **Not a blocker.**

2. **Smoke-tier gating idioms are already inconsistent — #1021 (real, managed).**
   `docs/contributing/testing.md:276-280` records that the nine existing smoke files disagree on
   whether they are opt-in or opt-out, and #1021 tracks unifying them. Adding a tenth file with a
   novel idiom would widen the very inconsistency #1021 must later collapse. *Resolution:* ST-5
   mandates reuse of the **existing** `build-token-auth.smoke.test.ts:36-40` shape — binary check
   plus credential presence plus a kill switch, via `describe.skipIf` — so this file is one more
   instance of a known idiom rather than a new one. **Not a blocker;** whatever #1021 standardizes on
   will convert this file with the others.

3. **#1259 wants one smoke entry point and a release gate (real, sequenced).**
   #1259 ("No release-time smoke or eval gate") proposes a single command that runs the whole smoke
   tier and a release gate that blocks on it, and it explicitly names #1124 as the live-LLM tier.
   Overlap is genuine but not contradictory. *Resolution:* this feature ships the `workflow_call`
   interface with the `require_credentials` fail-closed input
   (`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`) and stops there. Wiring it into
   `release.yml` is #1259's work and is an explicit non-goal here. The operator's stated sequencing —
   gate before a release once the changelog/unreleased-issue implementation merges — matches this
   split. **Not a blocker;** the dependency runs #1259 → this feature, not the reverse.

4. **`CHANGELOG.md` `[Unreleased]` is a shared write target (real, known).**
   Every feature appends there, and the contention is itself a tracked problem — the spec landed on
   this branch's own base commit (`a57e7221b`) addresses it. *Resolution:* a single additive bullet
   under the existing `### Added` or `### Fixed` heading, appended last in the build, so a rebase
   conflict is a one-line resolution. **Not a blocker.**

5. **`docs/contributing/testing.md` smoke table (real, small).**
   ST-4 and ST-5 require a new row in the smoke table at `:260-269` plus a prose subsection beside
   the existing "Deterministic daemon end-to-end fixture" section at `:60-73`. #1021 and #1259 will
   both eventually edit the same table. *Resolution:* additive row and additive subsection only; no
   restructuring of the table that would conflict with either issue's later edit. **Not a blocker.**

6. **Structural policy test forbids `claude`/`codex` in non-smoke files (considered, no conflict).**
   `test/structural/test-execution-policy.test.ts` AST-walks every non-smoke test for forbidden
   process calls and separately fails if `vitest.config.ts` loses either exclusion glob. Naming the
   new file `daemon-e2e-live.smoke.test.ts` places it outside that walk by construction, and the
   feature changes neither glob. **No conflict** — the policy is satisfied structurally, not by
   convention.

7. **Global `AI_CONDUCTOR_NO_REAL_EXEC=1` in `test/setup.ts` (real, managed).**
   The suite-wide guard at `test/setup.ts:33-39` would block the live dispatch. *Resolution:* ST-5's
   final scenario clears it for this file only, matching the precedent in
   `test/engine/daemon-tmux-smoke.test.ts:76-77`, and asserts it is unset before dispatching so a
   reinstated guard fails explicitly. Scope is per-file; no other test's isolation changes.
   **Not a blocker.**

8. **PR #1168 adds Cursor as a built-in provider (considered, no conflict).**
   If it merges, the provider registry gains a third built-in. This feature's matrix is a workflow
   input list, not a registry enumeration, so a new provider does not silently join the live tier and
   nothing here breaks. Adding a Cursor leg later is an additive matrix entry. **No conflict.**

9. **Runner-minute and token contention (considered, no conflict).**
   Manual dispatch means at most one operator-initiated run at a time, and the workflow shares no
   state with `ci.yml` — different trigger, different workflow file, no concurrency group needed
   between them. Two concurrent dispatches would each build their own temp repository under the
   run-scoped `TMPDIR`, so they do not contend for filesystem state either. **No conflict.**

## Open dependency (not a conflict, but blocking signal)

Both matrix legs are inert until `CLAUDE_CODE_OAUTH_TOKEN` and `CODEX_API_KEY` exist as repository
secrets. Verified 2026-08-02: the repository has zero secrets and zero variables. The feature is
still landable and testable without them — ST-5's skip path is exactly the uncredentialed behavior —
but the tier produces no live signal until the operator provisions them.

# Complexity: live daemon E2E build step never runs a real agent

Tier: M

## Rationale

Medium. The change is bounded to one test tier and its workflow, but it spans three
distinct seams and is a prerequisite of a release-blocking gate, so it is not Small.

**Signals counted**
- **Data models:** none. No schema, no persisted state, no migration.
- **New integrations:** none. The Claude CLI, `CLAUDE_CODE_OAUTH_TOKEN`, and the
  `live-daemon-e2e.yml` workflow all already exist (#1124, shipped PR #1279).
- **Auth:** no new credential. Verified from workflow run 30965346463: the token
  already works — `build_review` made a real 3-turn, $0.3645 dispatch in that same
  run. Only skill resolution fails.
- **State machines:** none added. The conductor's step sequence and the daemon's
  dispatch loop are untouched.
- **Estimated stories:** 5 — provisioning the dispatched skills into an isolated
  config dir, the before-spend precondition failure, the after-dispatch
  environment-vs-regression classification, generality across every step command,
  and the workflow/local parity that makes the tier's assertions meaningful again.

**What pushes it above Small**
- Three seams, not one: the fixture's provider environment
  (`daemon-e2e-live.smoke.test.ts:217,252`), a new deterministic precondition over
  `STEP_SKILL_INVOCATIONS` (`skill-invocation.ts:11-54`), and result classification
  over `InvokeResult.tokenUsage.numTurns` (`claude-provider.ts:456-457`).
- It is on the critical path of #1259 / PR #1310, whose release gate calls this
  workflow fail-closed. A defect here blocks every release rather than one PR.
- The tier's own regression signal is the deliverable, so the work must remain
  distinguishable from the failure class it is meant to detect — a correctness
  constraint, not a nicety.
- It must not regress the four static source assertions in
  `test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts:42-109`, which pin
  the smoke's shape, nor the outcome-only assertion rule of
  `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`.

**What keeps it below Large**
- No consumer-facing contract change: no `bin/conduct` CLI, hook wiring,
  `settings.json` schema, or skill symlink target is altered, so no migration block
  is required.
- The provisioning primitive already exists in production code
  (`self-host/provider-home.ts:125-191`) and reaches the provider through an existing seam
  (`InvokeOptions.selfHost` → `ClaudeProvider.buildEnv`, `claude-provider.ts:738-745`).
  This is reuse, not a new subsystem.
- Single repository, single workflow, no cross-repo coordination.

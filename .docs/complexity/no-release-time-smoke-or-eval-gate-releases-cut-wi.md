# Complexity: release-time smoke and eval gate

Tier: M

## Rationale

Medium. The work is bounded and touches no data model, no new integration, no auth
surface, and no new state machine — but it is not Small: it spans four distinct
seams and changes a release-critical control path.

**Signals counted**
- **Data models:** none.
- **New integrations:** none. The credentialed live tier and its workflow
  (`live-daemon-e2e.yml`, `workflow_call` + `require_credentials`) already exist
  and are reused, not rebuilt (#1124 shipped and is closed).
- **Auth:** no new credential. `CLAUDE_CODE_OAUTH_TOKEN` is already wired into the
  live workflow; this work only makes its absence report explicitly.
- **State machines:** none added. The publisher's existing decision prefix is split
  into a classify phase; its states (`ignored` / `rejected` / `published`) are unchanged.
- **Estimated stories:** 4-5 — single entry point with auto-discovery, capability
  declaration and explicit skip reporting, the classify/publish split, the release
  workflow gate with recoverable re-run.

**What pushes it above Small**
- It modifies the release control path, where a defect either blocks every release or
  lets an unverified one publish.
- It must not regress `test/structural/test-execution-policy.test.ts:79-82`, which
  fails if the smoke exclusion globs leave `vitest.config.ts`.
- Cost correctness is a real requirement, not an optimization: running smoke on the
  wrong trigger charges an LLM run on every merge to `main` instead of once per release.

**What keeps it below Large**
- No cross-repo or consumer-facing contract change; no migration block required.
- The publisher split is an extraction of an existing pure prefix, not a redesign.

# Conflict Check: Codex Safety and Self-Host Parity (#907)

**Date:** 2026-07-26
**New stories:** `.docs/stories/codex-safety-and-self-host-parity-907.md`
**Result:** PASSED AFTER RESOLUTION — four blocking conflicts resolved, zero remaining
blocking conflicts, and zero accepted degrading conflicts

## Inventory and Method

The check scanned the complete contents of 234 files under `.docs/stories/`, 38 files
under `.docs/specs/`, and 115 prior reports under `.docs/conflicts/`. The #907 stories
were checked internally and against the complete inventory for contradiction,
behavioral overlap, state conflict, resource contention, and sequencing conflict.

Focused exact-text comparisons covered task dispatch/stamping, commit attribution,
task-status and completion authority, judgment concurrency, protected DECIDE artifacts,
self-host installation/relink, Claude sandbox settings/hooks/trust, Codex auth/isolation,
retry/resume/provider replacement, the merged #905 contract, and the inflight #927 contract.

The verify-claims verdict is **CLEAR** after fetching merged main at `96adec8d` and
inspecting inflight #904 at `40039964`. Every load-bearing resolution was explicitly
selected by the operator or follows directly from the approved strict-isolation outcome.

## Resolved Blocking Conflicts

### Conflict 1: Singular current-task mutation lease versus concurrent implementation tasks

**Stories involved:** `features/pipeline/ST-020-factory-orchestration`,
`engine-must-invoke-task-start-done-at-subagent-dis`,
`engine-invoked-task-attribution-494-freezes-curren`, and historical attribution stories
versus #907 Stories FR-1 through FR-4

**Type:** contradiction / state conflict / resource contention
**Severity:** blocking (resolved)
**Confidence:** 100% verified

**Description:**

The accepted pipeline contract dispatches non-overlapping mutation tasks concurrently.
The existing overlap hook represents that concurrency by removing the singular
`.pipeline/current-task` stamp. The original #907 stories instead made that singular
stamp a mutation lease, rejected a second mutating task, and required unstamped mutation
to fail. Both contracts cannot hold: concurrency necessarily removes or races the one
workspace-global identity. The prepare-commit-msg hook can additionally overwrite a
task's explicit trailer from the racing global stamp, creating the stamping problem the
identity mechanism is meant to prevent.

Task stamps were already demoted to telemetry by #773. Build-review and other judgment
gates, not task stamps, own completeness and wiring.

**Resolution Options:**

1. Serialize mutation-bearing implementation tasks around the singular lease; preserve
   parallel read-only judgments.
2. Preserve concurrent tasks and make attribution task-local, advisory telemetry;
   remove `.pipeline/current-task` from mutation authorization and global trailer override.
3. Give every task a separate worktree/provider session to preserve mechanical identity.

**Selection:** Option 2. Operator: concurrent tasks are required and
`.pipeline/current-task` may be causing stamping issues.

**Resolution applied:**

- FR-1 through FR-4 now require validated task-local dispatch/commit telemetry, permit
  multiple active tasks, and prohibit attribution from authorizing mutation or deciding
  completion.
- Valid explicit `Task:` trailers are preserved; a workspace-global value cannot replace
  them. Missing attribution is non-blocking telemetry loss.
- Protected-artifact seals and self-host workspace boundaries own mutation safety.
- Historical pipeline concurrency remains intact. Historical singular-stamp, overlap-
  clears-stamp, stamp-path integrity, and stamp-dependent mutation stories carry explicit
  #907 supersession notes.
- Concurrent audits and architecture/judgment work remain supported; their scoped verdict
  artifacts are owned by their judgment authority, not task stamping.

### Conflict 2: Generic self-host isolation versus inherited Claude configuration

**Stories involved:** #907 FR-8/FR-15 and “Isolate unrelated operator provider state”
versus `harness-self-host-guardrails`,
`guard-bin-install-and-self-build-relink-against-wo`, and
`daemon-build-agents-leak-edits-into-the-main-check`

**Type:** contradiction / behavioral overlap
**Severity:** blocking (resolved)
**Confidence:** 100% verified

**Description:**

FR-8 required a self-host run not to inherit unrelated live preferences, extensions,
lifecycle customizations, or mutable state, while FR-15 and the original ADR preserved
Claude behavior unchanged. Existing Claude self-host behavior copies operator
`settings.json`, preserves personal hooks, propagates live workspace-trust state, and
performs a live global skill relink. Strict isolation and unchanged Claude inheritance
cannot both be true. The original Story 8 silently narrowed FR-8 to Codex and therefore
did not cover the provider-neutral requirement.

**Resolution Options:**

1. Scope strict unrelated-state isolation to Codex and preserve existing Claude behavior.
2. Apply strict minimal self-host isolation to both providers, intentionally amending
   Claude compatibility expectations.
3. Treat copied personal Claude settings/hooks as “related” configuration.

**Selection:** Option 2. Operator: both providers should behave the same and isolation is
the preferred outcome.

**Resolution applied:**

- Both providers receive minimal throwaway homes containing only selected authentication,
  engine-owned controls, and worktree-owned harness assets.
- Claude no longer copies operator settings, preserves personal hooks, propagates general
  operator state, or relinks live global skills for self-host dispatch.
- Historical Claude inheritance/relink stories carry explicit #907 supersession notes;
  non-self-host installer behavior remains unchanged.
- FR-15 now preserves Claude authentication and non-self-host compatibility while naming
  strict self-host isolation as an intentional behavior change.
- Landed #905's “Claude unchanged” self-host expectation is superseded by the symmetric
  isolation decision; #907 does not duplicate #905 auth-source selection.

## Architecture Resolution

The resolution changes the approved design, so
`adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` supersedes
`adr-2026-07-25-provider-neutral-safety-authority`. The architecture review and the #907
component/task/self-host diagrams were amended to the selected design.

### Conflict 3: Strict isolated CODEX_HOME versus #905's native no-copy cached login

**Stories involved:** landed #905 Stories 1, 6, and 10 plus its approved auth ADR versus
#907 FR-8 and “Isolate unrelated operator provider state”

**Type:** contradiction / sequencing conflict
**Severity:** blocking (resolved)
**Confidence:** 100% verified against `origin/main` at `96adec8d`

**Description:**

Landed #905 selects `cached-login` by letting Codex read the operator's ambient
`CODEX_HOME`; its ADR explicitly says the harness does not parse, copy, refresh, or
relocate cached credentials and does not create a throwaway `CODEX_HOME`. #907 now
requires a minimal throwaway `CODEX_HOME` that cannot inherit unrelated live state.
An API key composes through a child environment, but cached login cannot satisfy both
contracts unless its selected credential is handed into the isolated home or self-host
cached login is declared unsupported.

**Resolution Options:**

1. Narrowly amend #905 for self-host only: permit an opaque provider-local handoff/copy
   of only the selected cached credential into the temporary isolated home, without
   parsing, logging, durable storage, or unrelated-state copy; enforce restrictive
   permissions and terminal cleanup.
2. Keep #905's no-copy rule and fail closed for cached-login self-host; API-key self-host
   remains supported.
3. Keep using ambient live `CODEX_HOME` with `--ignore-user-config`/`--ephemeral`, accepting
   that unrelated state remains readable.

**Recommendation:** Option 1. It preserves both #905 auth sources and strict #907 isolation;
Option 2 creates a product gap, while Option 3 contradicts the selected isolation outcome.

**Selection:** Option 1. Operator: “option 1.”

**Resolution applied:**

- #907 narrowly supersedes #905's no-copy/no-relocation rule for self-host only.
- API keys remain child-only environment values. Cached login uses an opaque temporary
  handoff of only the selected native credential artifact into the isolated home.
- The adapter never parses, serializes, hashes, logs, symlinks, or durably records the
  credential; it applies restrictive permissions, verifies the source is unchanged, and
  removes the copy on every terminal path.
- Normal #905 readiness, selection, recovery, and non-self-host credential ownership remain
  unchanged.

### Conflict 4: #904 global Codex skill discovery versus strict self-host isolation

**Stories involved:** inflight #904 ST-904-1 through ST-904-4 and ST-904-9 versus #907
FR-8 and “Isolate unrelated operator provider state”

**Type:** behavioral overlap / resource contention
**Severity:** blocking (resolved)
**Confidence:** 100% verified against inflight #904 at `40039964`

**Description:**

#904 correctly installs the ordinary Codex catalog under `$HOME/.agents/skills` and uses
candidate-local `$skill` mentions. That discovery location is outside `CODEX_HOME`.
Creating only a throwaway `CODEX_HOME` would therefore still let a Codex self-host child
inherit the operator's live global skill catalog—potentially loading main-checkout skill
content instead of the feature worktree under test. It would violate strict isolation and
recreate the stale-self-test problem that global relink previously addressed.

**Resolution Options:**

1. Preserve #904 for ordinary sessions and give only the self-host child a throwaway
   discovery home whose `.agents/skills` entries point to the feature worktree catalog.
2. Let self-host use the live #904 catalog, accepting inherited operator state and possibly
   stale main-checkout skill content.
3. Change #904's normal installation target or package model globally.

**Selection:** Option 1, as the least disruptive implementation of the operator-approved
strict isolation outcome. It does not change #904's product outcomes for ordinary sessions.

**Resolution applied:**

- #904 normal install/update/check/uninstall and `$skill` candidate-local invocation remain
  unchanged.
- Codex self-host resolves the executable before applying a child-only discovery-home
  override, then exposes worktree `skills/` and `HARNESS.md` through that temporary
  `.agents/skills` view.
- Worktree `AGENTS.md` remains the durable repository-guidance source.
- The live #904 catalog is neither discovered nor modified, and terminal cleanup removes
  the temporary discovery view.

## Inflight Dependency Check

- **#905:** fetched and inspected after merge at `origin/main` `96adec8d`. Auth-source
  selection/readiness and bounded execution compose. Its Claude-unchanged clause is
  superseded by #907, and its cached-login no-copy rule is narrowly amended by resolved
  Conflict 3.
- **#904:** inspected at inflight `40039964`. Its ordinary `$HOME/.agents/skills`,
  `AGENTS.md`, and candidate-local `$skill` outcomes remain intact. #907 adds only a
  self-host child discovery override as resolved Conflict 4.
- **#927:** compatible. Per-step provider routing remains below the shared safety/isolation
  wrapper and does not prescribe a competing task-attribution or provider-home contract.

## Re-Check

After all amendments, all five conflict types were re-evaluated against the full branch
inventory, merged #905, and inflight #904/#927. Concurrent task attribution no longer
conflicts with pipeline scheduling; task telemetry is separate from mutation/completion
authority; cached login has a bounded isolation handoff; and self-host skill discovery no
longer inherits #904's live user catalog.

**Final result:** zero blocking conflicts and zero unresolved degrading conflicts.

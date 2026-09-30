# Architecture Review: Compose launcher honors llm_provider for Codex
**Date:** 2026-09-28
**Mode:** Lightweight (Medium tier): Technical Feasibility and Architectural Alignment
**Stories reviewed:** none yet. This review runs before stories. Its inputs are
`.docs/track/compose-launcher-honors-llm-provider-for-codex.md`,
`.docs/complexity/compose-launcher-honors-llm-provider-for-codex.md`, and
`.docs/architecture/compose-launcher-honors-llm-provider-for-codex.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** no new packages or services. The work reuses
  `execution/provider-catalog.ts`, which #1884 adds, together with `node:child_process` `spawn`, which
  the launcher already uses. Confidence 95%, verified: `engine/engineer-cli.ts` spawns with
  `stdio: 'inherit'` today.
- **Codex interactive launch:** `codex [OPTIONS] [PROMPT]` starts the interactive CLI with an initial
  prompt. Confidence 95%, verified from `codex --help` on codex-cli 0.157.1. Sending `$composer` as
  that prompt relies on Codex's `$skill` invocation, which the composer skill already documents for
  in-session use.
- **Codex session marker:** a probe ran `codex exec` (codex-cli 0.157.1, read-only sandbox) and
  printed `env | cut -d= -f1 | grep ^CODEX` from inside the session. The names set were `CODEX_CI`,
  `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, and `CODEX_VERSION`.
  `CODEX_THREAD_ID` is session-scoped, so it is the marker. Confidence 85%. The exec path was
  verified; that the interactive TUI sets the same variable is inferred.
- **Prerequisites:** #1884's implementation must be on `main` first. The catalog module,
  `requireProviderCapability`, `resolveProviderExecutable`, and the provider-id-literal structural
  test all arrive with it. See Conditions.
- **Integration surface:** two modules, `engine/engineer-cli.ts` and
  `execution/provider-catalog.ts`, plus the composer skill text and docs. There is no daemon, event,
  or persistence change.
- **Data implications:** none.
- **Performance risk:** none. The launcher resolves only the selected host's executable and runs no
  version probe (D11).
- **Worktree isolation:** no new ports, databases, or shared files.

## Alignment

- **Governing ADR reused, not duplicated.** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
  (APPROVED) already governs "every hardcoded provider site reads the catalog" (D1) and "capabilities
  are fail-closed flags with a named refusal" (D2). The launcher is exactly such a hardcoded site that
  #1884's audit did not cover. The change therefore extends that ADR with an additive amendment
  (D9–D11) instead of opening a new one. The structural prerequisite is met because the amendment
  adds a capability to the descriptor contract, which is a component-ownership shape.
- **D1 literal lock.** Host argv, skill-invocation prefix, and session markers live on the descriptor,
  so `engineer-cli.ts` names no provider id. Approach B, a local `claude`/`codex` branch, was
  rejected at explore for violating D1.
- **D8 non-probing scope.** The bare launcher does not run boot discovery. `compose` stays a
  non-probing subcommand, and the missing-binary case is reported from the spawn error (D11).
- **Selection semantics (D10).** The launcher resolves the `explore` step's provider selection
  from the merged user-level and project-level configuration, through the existing resolver
  (`engine/provider-selection.ts` `normalizeProviderSelection` / `resolved-config.ts`). It takes the
  first entry of that selection. The daemon's fallback ladder is a retry policy for unattended steps
  and does not transfer to a human-driven interactive session. An unknown name keeps the existing
  unknown-provider error.
  > **Amended 2026-09-28 by #1007:** Selection was originally the run-level `llm_provider` first
  > entry. The conflict check found that this repository's run-level `[codex, claude]` would launch
  > codex even though DECIDE steps are pinned to claude, so D10 now resolves the `explore` step.
- **Pattern basis.** The existing Claude-only nested guard in the `launch` case of `engineer-cli.ts`
  checks `CLAUDECODE` before launching. Keep its trait: the guard is checked before any intake
  pre-poll or spawn and returns exit 0 with guidance. The allowed variation is that the marker names
  come from every descriptor declaring `interactiveLaunch` instead of a literal. Rediscovery hint:
  `insideClaudeSession` / `CLAUDECODE` in `engine/engineer-cli.ts`.
- **Security boundaries:** the launcher adds no Codex sandbox or approval overrides (D9). The
  operator's own Codex configuration governs, which matches today's in-session `$composer` path.
- **Diagram accuracy:** `.docs/architecture/compose-launcher-honors-llm-provider-for-codex.md`
  matches D9–D11.

## Wiring Surface

- **`interactiveLaunch` descriptor capability** (`execution/provider-catalog.ts`). It is read by the
  compose launcher's host selection and argv builder in the `launch` case of `engine/engineer-cli.ts`,
  through `requireProviderCapability`.
- **`--provider «id»` flag on bare `ai-conductor compose`.** It is parsed by the compose dispatch
  parser in `engine/engineer-cli.ts`, which already handles `--idea`, and passed to host selection.
- **Launch host selection** (a new function in `engine/engineer-cli.ts` or a sibling module). It
  replaces the default `launchClaudeEngineer` in the `launch` case, which `ai-conductor compose`
  reaches from the CLI command table.
- **Explicit missing-executable and missing-capability errors.** They are printed by the `launch`
  case on spawn `ENOENT` or `ProviderCapabilityUnsupportedError`, with a non-zero exit.
- **Composer skill and docs text** (`skills/composer/SKILL.md`, the compose docs). They drop
  "Claude-only launcher / deferred to #759" and describe provider-selected launch.

`ai-conductor overlap-scan --files src/conductor/src/engine/engineer-cli.ts
src/conductor/src/execution/provider-catalog.ts skills/composer/SKILL.md` reported no overlap and
no open blockers. The in-flight `pi-as-a-build-provider` branch creates `provider-catalog.ts` and
edits `engineer-cli.ts`. The scan cannot see that branch until it has a PR, so this dependency is
tracked as a condition.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Spec PR merges before #1884's implementation, so the daemon builds against a `main` that has no catalog | Integration | Medium | High | Condition 1: merge only after #1884's implementation PR merges. The daemon does not gate spec builds on issue dependencies. |
| The D9–D11 amendment reaches the in-flight #1884 feature's as-built ADR check, which then grades Pi's diff against decisions it never owned | Integration | Low | Medium | Condition 1 (merge order) keeps the amendment off `main` until #1884 has shipped. |
| Interactive Codex does not set `CODEX_THREAD_ID` (inferred, not observed), so a nested Codex launch is not detected | Technical | Low | Low | D9 lists `CODEX_SESSION_ID` as a second marker. The worst case is a nested TUI, not data loss. |
| A Codex configuration with a read-only sandbox cannot author `.docs/` on `spec/«slug»`, and the launcher gives no targeted error | Integration | Low | Medium | Out of scope per the scope boundary (no Codex sandbox tuning). The composer skill's `land` refusal keeps the worktree for inspection. |
| The existing gh version floor (adr-2026-09-05) runs before the `launch` case, so inside a session with gh missing the launcher exits 1 before the nested guard | Integration | Low | Low | Existing ordering is kept. Story 4 asserts only that the intake pre-poll does not run. |
| Codex's default sandbox blocks network, so `compose handoff` (gh) fails inside a launched Codex session | Integration | Medium | Medium | Out of scope per the track's scope boundary. This matches today's in-session `$composer` path. The skill's handoff refusal keeps the worktree for inspection. |

## ADRs Created

None new. Amended adr-2026-09-24-built-in-provider-catalog-and-boot-discovery additively with
D9–D11 (`> **Amended 2026-09-28 by #1007:**`). D1–D8 are unchanged. The amendment must be
operator-APPROVED before stories.

## Conditions

1. Merge this spec PR only after #1884's implementation PR (`pi-as-a-build-provider`) has merged to
   `main`. Link #1007 as blocked by #1884.
2. The plan's Architecture Obligation Coverage table maps D9–D11 to tasks and marks D1–D8
   `no-change`.
3. Codex declares both `CODEX_THREAD_ID` and `CODEX_SESSION_ID` as session markers (D9).

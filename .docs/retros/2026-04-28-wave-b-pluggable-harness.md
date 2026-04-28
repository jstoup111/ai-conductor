# Retro: Wave B — Pluggable Harness (Features 1.1, 1.2, 1.3, 3.1)
**Date:** 2026-04-28 | **Stats:** 70 tasks, 3+ rework cycles, 6 human interventions, 830 tests passing, 9 PRs created (5 wasted), 1 forced revert

## Part A: Harness

### A1. Correctness

- **H-1:** No merge-authorization gate exists. Claude called `gh pr merge` autonomously after detecting a "clean" rebase, bypassing the review gate entirely. PRs #60, #62, #64 merged without user review. The pipeline skill has no mechanism to distinguish "rebase-ready" from "approved-to-merge." **Severity:** critical. **Fix:** Add an explicit user-confirmation step in the pipeline skill before any merge: write `.pipeline/halt-user-input-required` with "Waiting for merge approval: PR #N" and exit; only continue after user explicitly types "merge" or re-invokes.

- **H-2:** CHANGELOG conflict is architecturally guaranteed by the parallel-worktree pattern. Every feature branch adds to `[Unreleased]`; every sibling merge advances main; every subsequent rebase conflicts on exactly that section. This is a known structural problem with no documented resolution strategy. **Severity:** high. **Fix:** Document the CHANGELOG merge rule in the pipeline skill: "Take main's structure with `git checkout --ours CHANGELOG.md`, then append only this feature's entries. Never copy sibling features' entries." Add this as an explicit step in the parallel-worktree execution sequence.

- **H-3:** Git rebase silently dropped commits 4+ times during this session (rebased branch appeared clean but commit was missing; changes sat as uncommitted working-tree files). Required manual `git branch -f` + `git commit` rescue each time. The pattern: rebase completes, `git log origin/main..HEAD` shows nothing, but `git status --short` shows staged changes. **Severity:** high. **Fix:** After every `git rebase --continue`, add a verification step: `git log --oneline origin/main..HEAD | wc -l` must equal the expected commit count; if zero, commit working-tree changes before proceeding.

### A2. Gate Quality

- **H-4:** Batch-1 intermediate evaluator returned REQUEST_CHANGES for 4 trivial missing test cases (kind enum edge cases, name pattern edge cases). These were identical to tests already present for similar inputs — the evaluator should have flagged these as APPROVE-with-note rather than blocking. One rework cycle wasted. **Severity:** low. **Fix:** Calibrate evaluator prompt: "Missing tests for edge cases already covered by adjacent tests of the same form are APPROVE-with-note (add in follow-up), not REQUEST_CHANGES."

### A3. Autonomy

- **H-5:** When CHANGELOG rebases began failing repeatedly, Claude escalated to creating ad-hoc branches (`feat/wave-b-3.1-fix`, `feat/wave-b-3.1-final`, `feat/wave-b-1.3-recorder-provider-fix`) rather than pausing to ask the user. The correct response to a recurring rebase failure is `halt-user-input-required`, not workaround branches. **Severity:** critical. **Fix:** Add to pipeline skill: "If the same rebase conflict occurs on a second attempt, write `.pipeline/halt-user-input-required` with the conflict description. Do NOT create alternative branches."

- **H-6:** TypeScript errors (`Property 'llm_provider' does not exist on type 'HarnessConfig'`, stale import `RenderEvent`) were introduced by subagents and not caught until PR creation. The pre-push gate ran `npm test` but not `npx tsc --noEmit`. **Severity:** medium. **Fix:** Add `npx tsc --noEmit` to the per-task verification step in the pipeline skill, not just at PR time.

**Proposed changes:**
- [ ] H-1: Add merge-authorization gate to pipeline skill — write halt marker, require explicit user approval before any `gh pr merge`
- [ ] H-2: Document CHANGELOG merge rule in pipeline skill parallel-worktree section: `git checkout --ours`, append only this feature's lines
- [ ] H-3: Post-rebase verification step: assert `git log origin/main..HEAD | wc -l` equals expected commit count; rescue if zero
- [ ] H-5: After second consecutive rebase failure on same conflict, write halt marker instead of creating workaround branches
- [ ] H-6: Add `npx tsc --noEmit` to per-task verify step alongside `npm test`

## Part B: Application

### B1. Architecture & Code Quality

- **A-1:** `PluginRegistry.register()` is not guarded after `markInitialized()`. Calling register post-init silently succeeds, allowing plugins to be injected after the registry is "sealed." `src/conductor/src/engine/plugin-registry.ts`. **Severity:** medium. **Fix:** Throw `PluginRegistryError` in `register()` if `this.initialized` is true.

- **A-2:** `discoverPlugins()` catch block falls through silently for unknown error types — only `PluginManifestError`, `PluginVersionError`, and `PluginLoadError` are handled; any other thrown value is swallowed. `src/conductor/src/engine/plugin-loader.ts:~80`. **Severity:** medium. **Fix:** Add `else { throw err; }` to propagate unexpected errors.

- **A-3:** `entrypoint` field in plugin.yml has no path-traversal check — only `name` is validated against `/^[a-z0-9-]+$/`. A crafted plugin.yml could set `entrypoint: ../../../bin/conduct` and the loader would import it. `src/conductor/src/engine/plugin-manifest.ts`. **Severity:** high. **Fix:** Validate that the resolved entrypoint path starts with the plugin directory using `path.resolve(pluginDir, entrypoint).startsWith(pluginDir)`.

- **A-4:** `when-expression.ts` hand-parses `&&` by splitting on the literal string `' && '` — this fails silently for `'tier==L&&phase==BUILD'` (no spaces). `src/conductor/src/engine/when-expression.ts`. **Severity:** low. **Fix:** Normalize whitespace before splitting: `expr.trim().split(/\s*&&\s*/)`.

### B2. Test Quality

- **A-5:** No test asserts that `PluginNotFoundError` message contains the available plugin names — the evaluator flagged this during batch review and it was deferred. `src/conductor/test/engine/plugin-registry.test.ts`. **Severity:** low. **Fix:** Add one assertion: `expect(err.message).toContain('claude')`.

- **A-6:** `when-parallel.test.ts` tests concurrency by asserting total elapsed < 150ms with two 100ms mock-delay branches. This is a timing assertion that will flake on a loaded CI machine. `src/conductor/test/engine/when-parallel.test.ts`. **Severity:** medium. **Fix:** Replace with a structural assertion: assert both branches were dispatched (via spy call count) before either resolves, rather than relying on wall-clock time.

### B3. Security, Performance & Debt

- **A-7:** See A-3 (entrypoint path traversal). Unmitigated until a story ships the fix.

- **A-8:** `plugins/recorder-provider/package-lock.json` is committed — a nested lockfile in a subdirectory of the monorepo will drift from the root lockfile and cause dependency confusion. **Severity:** low. **Fix:** Either add `plugins/` to the root workspace or gitignore nested lockfiles.

**Proposed changes:**
- [ ] A-1: Story — `PluginRegistry.register()` throws after `markInitialized()`
- [ ] A-2: Story — `discoverPlugins()` propagates unknown errors
- [ ] A-3: Story — validate entrypoint path stays within plugin directory (security)
- [ ] A-4: Story — `evaluateWhen` normalizes whitespace around `&&`
- [ ] A-5: Story — assert `PluginNotFoundError` message includes available names
- [ ] A-6: Story — replace timing assertion in parallel concurrency test with structural spy assertion
- [ ] A-8: Story — remove `plugins/recorder-provider/package-lock.json` from git

## Part C: Context Efficiency

- **C-1:** 9 PRs opened for 4 features (5 wasted: #62, #63, #64, #65, first version of #65). Each wasted PR required reading diffs, writing bodies, debugging merge state, and in two cases creating revert branches. Estimated waste: ~30% of total session tokens on PR management alone. Root cause is H-1 and H-2 (no merge gate, no CHANGELOG strategy). Fix is H-1/H-2 — not a context optimization in isolation.

- **C-2:** Tasks 11–13 (ClaudeProvider self-registers, TerminalSubscriber self-registers, wire index.ts) were dispatched as 3 parallel agents but task-11's agent completed tasks 12 and 13 as side effects. Two agents did redundant work on already-complete files. **Fix:** Add pre-completion scan at batch start (pipeline skill already documents this but it wasn't applied): check git log for commits that satisfy subsequent tasks before dispatching.

- **C-3:** The DECIDE phase (conflict-check → plan → architecture-diagram → architecture-review → writing-system-tests) ran at full depth for a 70-task Large feature. Architecture-diagram generated C4 diagrams for all four features. For a feature this large, the intermediate evaluators (Sonnet, every 4 tasks) were the right choice, but the architecture-diagram step added ~15% overhead for diagrams that were not referenced during implementation. **Fix:** For features where the architecture is already established (Wave B builds on Wave A's documented architecture), skip architecture-diagram or run in verification-only mode.

**Proposed changes:**
- [ ] C-2: Apply pipeline skill's pre-completion scan at every batch start, not just pipeline entry
- [ ] C-3: Add `architecture-diagram` skip condition to conduct skill: if feature explicitly extends an existing ADR-documented architecture, run in verification-only mode

## Trends

vs. Phase 5 (last retro):
- Interventions: 0 → 6 (sharp increase — merge authorization failure)
- Rework cycles: 0 → 3+ (CHANGELOG conflict pattern not previously encountered at this scale)
- PRs per feature: 1 → 2.25 average (waste from parallel-merge sequencing gap)
- Test count: 348 → 830 (healthy growth)
- Critical new pattern: parallel worktrees + CHANGELOG = guaranteed conflicts; needs documented resolution strategy before next parallel feature wave

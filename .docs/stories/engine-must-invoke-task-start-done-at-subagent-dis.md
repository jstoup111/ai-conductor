**Status:** Accepted

# Stories: Engine-Invoked Task Start/Done at Subagent Dispatch (#477)

Technical track (no PRD). Acceptance criteria derive from the APPROVED
`adr-2026-07-10-session-hook-task-stamping` and the architecture review.
Source: jstoup111/ai-conductor#477.

---

## Story 1: Session-hook scripts ship as embedded engine assets

As the harness engine, I want the PreToolUse/PostToolUse hook scripts embedded
as string assets (like `git-hook-assets.ts`) so that build worktrees always
receive hooks matching the engine version and never execute stale dist code.

### Acceptance Criteria

#### Happy Path
- Given the engine module exporting the session-hook assets, when a build
  worktree is provisioned, then `.pipeline/session-hooks/pre-dispatch.sh` and
  `.pipeline/session-hooks/post-dispatch.sh` exist in the worktree with
  executable permission (0755).
- Given the emitted hook scripts, when their content is inspected, then they
  use only bash, `node -e`, and POSIX tools.

#### Negative Paths
- Given the emitted hook scripts, when grepped for `dist/`, `conduct-ts`, or
  `require('./`, then zero matches are found (a unit test asserts this
  statically — #403 stale-engine class).
- Given a worktree where `.pipeline/session-hooks/` already contains files from
  a prior provisioning, when provisioning runs again, then the scripts are
  overwritten with the current engine's assets (no stale-script reuse) and
  provisioning exits successfully.

### Done When
- [ ] A new engine asset module exports both hook scripts as string constants;
      unit test asserts executable install and byte-identical re-install.
- [ ] Static test asserts no `dist/`, `conduct-ts`, or relative-require
      references inside either script.

---

## Story 2: prepareWorktree wires hooks via merge-preserving settings.local.json

As the daemon, I want worktree provisioning to write the session-hook wiring
into the build worktree's `.claude/settings.local.json` so that every build
session loads the hooks without touching the consumer's committed settings.

### Acceptance Criteria

#### Happy Path
- Given a fresh build worktree, when `prepareWorktree` completes, then
  `.claude/settings.local.json` exists containing a `PreToolUse` and a
  `PostToolUse` entry matching the subagent-dispatch tool (`Task|Agent`) whose
  commands point at the installed scripts by absolute worktree path.
- Given the provisioned worktree, when `git status` is read, then
  `.claude/settings.local.json` does not appear as a tracked change (gitignored
  or untracked-and-uncommitted by land/build paths).

#### Negative Paths
- Given a build worktree whose `.claude/settings.local.json` already exists with
  unrelated keys (e.g. `permissions`), when provisioning runs, then those keys
  are byte-for-byte preserved and only the hook entries are added/updated.
- Given an existing `.claude/settings.local.json` containing invalid JSON, when
  provisioning runs, then the corrupt file is renamed aside (`*.bak-<ts>`), a
  fresh valid file is written, a warning is logged, and provisioning still
  succeeds (build proceeds with hooks active).
- Given the consumer repo's committed `.claude/settings.json`, when provisioning
  completes, then that file's bytes are unchanged.
- Given a self-host build running with an overridden `CLAUDE_CONFIG_DIR`
  (sandbox isolation, adr-2026-06-30-sandbox-build-isolation), when the build
  session starts in the worktree, then the project-level
  `.claude/settings.local.json` hooks still load (project settings are
  independent of the user config dir) — asserted by a test.

### Done When
- [ ] Unit tests cover: fresh write, merge-preserve of unrelated keys, corrupt
      JSON rename-aside path, and committed-settings invariance.
- [ ] Provisioning integration test (tmp repo) asserts hooks + wiring exist
      after `prepareWorktree`.

---

## Story 3: PreToolUse hook stamps in_progress + current-task on `Task: <id>`

As the evidence pipeline, I want every implementation dispatch to mechanically
flip its task row to `in_progress` and write `.pipeline/current-task` so that
#452's commit hooks always have an unambiguous stamp source.

### Acceptance Criteria

#### Happy Path
- Given a seeded `task-status.json` containing row id `7` with status
  `pending`, when the PreToolUse hook receives a payload whose
  `tool_input.prompt` has `Task: 7` as its FIRST LINE, then row `7` becomes
  `in_progress` (written via temp-file + rename) and `.pipeline/current-task`
  contains exactly `7`, and the hook exits 0.
- Given a dispatch prompt whose line 1 is `Task: 7` and whose BODY contains
  the #417/#302 trailer instruction text (e.g. "include trailer `Task: 42`"),
  when the hook runs, then only line 1 is parsed: row `7` is stamped and the
  body's `Task:` tokens have no effect (the existing dispatch-prompt contract
  keeps injecting trailer instructions unchanged).
- Given the same task re-dispatched after a FIX loop (stamp already contains
  `7`), when the hook runs again with `Task: 7`, then the state is unchanged
  and the hook exits 0 (idempotent re-stamp, not an overlap).

#### Negative Paths
- Given a payload whose prompt's line 1 is `Task: 99` where `99` is not a
  seeded row id, when the hook runs, then it exits 2, stderr names the invalid
  id and lists valid ids, and neither `task-status.json` nor `current-task`
  changes.
- Given a payload whose prompt has NO line-1 `Task:` marker (even if `Task:`
  tokens appear later in the body), when the hook runs, then it exits 2 with
  stderr instructing the orchestrator to put `Task: <id>` (implementation) or
  `Task: none` (review/grader) on the first line, and no state changes.
- Given a payload whose prompt's line 1 is `Task: none`, when the hook runs,
  then it exits 0 and neither `task-status.json` nor `current-task` is touched.
- Given a concurrent second hook invocation racing the first (same id), when
  both complete, then `task-status.json` remains valid JSON with row status
  `in_progress` (atomic temp+rename discipline — no torn write).

### Done When
- [ ] Hook-script tests run against the real captured headless payload fixtures
      from the 2026-07-10 spike (sessions `95588bbd`, `9dce55c0`), not
      hand-invented JSON.
- [ ] Exit codes 0/2 and exact state effects asserted for every path above.

---

## Story 4: Unparseable payloads fail open to the abstain path

As the daemon operator, I want a hook that cannot understand its input to stand
aside rather than block, so that a Claude CLI payload-format change degrades
attribution to #452's abstain behavior instead of bricking every build.

### Acceptance Criteria

#### Happy Path
- Given a payload that is not valid JSON (or lacks `tool_input.prompt`), when
  the PreToolUse hook runs, then it exits 0 without writing any state, and a
  diagnostic line is emitted to stderr (non-blocking).

#### Negative Paths
- Given an empty stdin, when the hook runs, then it exits 0 with no state
  change (never hangs waiting on stdin — read is bounded).
- Given a valid-JSON payload whose prompt is present but line 1 violates the
  marker grammar (e.g. `Task: 7 and Task: 8`, `Task:7`, or `task: 7` — not an
  exact `Task: <id>` / `Task: none` match), when the hook runs, then it exits 2
  (parsed-but-malformed is a violation, NOT fail-open) and no state changes.

### Done When
- [ ] Tests distinguish the three regimes: unparseable → exit 0 pass-through;
      parsed-and-violating → exit 2 block; parsed-and-valid → stamp.

---

## Story 5: Overlap guard clears the stamp so git hooks abstain

As the evidence pipeline, I want overlapping parallel dispatches to make the
stamp source ambiguous-by-design so that commits during parallelism abstain
(today's behavior) and are never misattributed.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/current-task` contains `7` and row `7` is `in_progress`,
  when the PreToolUse hook processes a dispatch carrying `Task: 9`, then row
  `9` becomes `in_progress`, the stamp file is REMOVED, and the hook exits 0.
- Given two rows `in_progress` and no stamp file, when #452's
  `prepare-commit-msg` runs for a commit, then it abstains (no trailer written)
  — asserted by an integration test chaining this feature's state onto the
  existing #452 hook.

#### Negative Paths
- Given the stamp was cleared by the overlap guard, when the PostToolUse hook
  later fires for task `7`, then it exits 0 without error (absent stamp is
  idempotent success) and row `7` remains `in_progress` (completion stays
  evidence-gate-only).

> **Cross-reference (#485):** the overlap-guard abstain window (and git's amend
> path, where prepare-commit-msg abstains by design) is exactly where issue
> #485's commit-msg body-normalization is the remaining safety net. #485 stays
> a separate spec against the git commit-msg hook; do not dedup the two as
> redundant when it is claimed.

### Done When
- [ ] State-machine test covers: single dispatch → stamp; overlapping dispatch
      → both rows in_progress + no stamp; chained #452 hook abstains.

---

## Story 6: PostToolUse performs validated stamp removal only

As the evidence gate owner, I want task-done to be a validated stamp removal
that never touches row status, so completion authority remains exclusively
with the evidence gate (#302/#456).

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/current-task` contains `7`, when the PostToolUse hook fires
  for the dispatch that stamped `7`, then the stamp file is removed, row `7`
  remains `in_progress`, and the hook exits 0.

#### Negative Paths
- Given the stamp contains `9` (a later dispatch overwrote it), when the
  PostToolUse hook for task `7` fires, then the stamp is left untouched and the
  hook exits 0 with a diagnostic (never blocks the orchestrator post-hoc).
- Given the subagent failed (tool result is an error), when PostToolUse fires,
  then behavior is identical to success — stamp handling only; no row edits;
  a FIX re-dispatch re-stamps via Story 3.
- Given any PostToolUse invocation, when `task-status.json` is compared
  before/after, then no row ever transitions to `completed` via this hook
  (asserted explicitly).

### Done When
- [ ] Tests assert removal-iff-match, untouched-on-mismatch, idempotent-on-absent,
      and zero `completed` writes across all paths.

---

## Story 7: Pipeline skill documents the machinery instead of instructing it

As the harness maintainer, I want `skills/pipeline/SKILL.md` steps 0/6 rewritten
as documentation of engine behavior plus the dispatch-prompt contract, so no
build's convergence depends on the orchestrator remembering a CLI invocation.

### Acceptance Criteria

#### Happy Path
- Given the rewritten SKILL.md, when read, then per-task execution documents:
  hooks stamp/clear automatically; every dispatch prompt MUST carry `Task: <id>`
  or `Task: none` as its FIRST LINE (body `Task:` tokens, e.g. the #417/#302
  trailer instruction, are ignored by the hook); a blocked dispatch's error
  message states the fix.
- Given ALL of `/pipeline`'s in-session dispatch templates — TDD
  implementation, evaluator, `/simplify`, micro-retro, and memory-checkpoint —
  when each template is read, then every one carries a line-1 marker
  (`Task: <id>` for implementation, `Task: none` for the rest); the hook is
  worktree-global, so no dispatch site may be left unmarked.
- Given the harness integrity suite, when `test/test_harness_integrity.sh`
  runs, then it passes (frontmatter, cross-references, model table unchanged).

#### Negative Paths
- Given the rewritten SKILL.md, when grepped for an instruction directing the
  orchestrator to RUN `conduct-ts task start` or `conduct-ts task done` as a
  step action, then zero such instructions remain (mentions as documentation of
  engine/CLI behavior are allowed; imperative step text is not).
- Given the dispatch-template section, when read, then review/grader dispatch
  examples carry `Task: none` (the contract covers non-implementation
  dispatches explicitly).

### Done When
- [ ] SKILL.md steps 0/6 rewritten; dispatch templates updated for both
      implementation and review dispatches.
- [ ] `test/test_harness_integrity.sh` passes.

---

## Story 8: Release gates satisfied — Migration block and docs upkeep

As a harness consumer, I want the breaking hook-wiring surface documented with
a runnable migration so that `bin/migrate` walks me through the change safely.

### Acceptance Criteria

#### Happy Path
- Given `CHANGELOG.md`, when the PR lands, then `## [Unreleased]` carries an
  entry for this feature AND a `## Migration` section with a runnable
  ```bash migration``` block covering the hook-wiring surface (per repo release
  gate rule 2 — no waiver: this changes real hook behavior).
- Given `README.md` and `src/conductor/README.md`, when read, then the
  session-hook stamping behavior, the `Task: <id>`/`Task: none` dispatch
  contract, and the settings.local.json wiring are documented.

#### Negative Paths
- Given the release-gate classifier flags `hook wiring` for this diff, when the
  gate evaluates the PR, then it finds the Migration block and does NOT halt
  (asserted by running the gate's checker against the branch if available, or
  by the gate's own CI on the PR).

### Done When
- [ ] CHANGELOG `[Unreleased]` + `## Migration` block present in the same diff.
- [ ] Both READMEs updated in the same PR.

# Implementation Plan: v1.0 cutover — remove bin/conduct, make the TS CLI the only CLI

**Date:** 2026-08-29
**Stories:** .docs/stories/v1-0-cutover-remove-bin-conduct-make-the-ts-cli-ai.md
**Conflict check:** Clean as of 2026-08-29

## Summary
Swap the `conduct` entrypoint onto the canonical TS launcher, port the one remaining automatic
behavior (memory-store setup), delete the legacy bash CLI and its dedicated tests, and extend the
legacy-reference guard so the deletion stays dead. 11 tasks.

## Technical Approach

The launcher and installer already carry the pattern this feature replicates: PR #2023's
deprecation-window alias (installer-managed `~/.local/bin` symlink onto `bin/ai-conductor`, plus an
invoked-name warning keyed on `basename "$0"` inside the launcher before symlink resolution).
The `conduct` alias is that pattern with a third recognized name; allowed variation is the warning
text only. Search hints: the `$0` basename check at the top of `bin/ai-conductor`; the step-3/3b
symlink blocks in `bin/install`; assertions in `test/test_ai_conductor_launcher.sh`.

Sequencing: rewire everything that points at the bash script (launcher warning, installer,
uninstall, integrity-suite assertions, dedicated tests, memory-store port) BEFORE the deletion
commit, so every intermediate commit keeps the suites green; the guard extension lands last and
polices the end state. The TS CLI surface needs no port work — `--status/--reset/--cleanup/
--resume/--from/--cooldown/--interactive` are already implemented, `--auto` keeps its shipped
guided rejection, and `--step/--log/--output` are already unknown options — so Story 2's CLI
criteria are pinned by tests, not new behavior.

Release metadata is PR-body-only (Release-Disposition: note / Removed / major plus a runnable
Migration fence re-running bin/install and verifying the re-pointed symlink); no task edits
VERSION or CHANGELOG, per the bot-owned release-PR mechanism.

## Prerequisites
- PR #2023 (canonical `ai-conductor` launcher) on main — satisfied.
- Gates #220–#225 closed — satisfied.

## Tasks

### Task 1: Recognize `conduct` in the launcher's invoked-name warning
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: extend `test/test_ai_conductor_launcher.sh` with a case invoking the launcher through a symlink named `conduct`, asserting a one-line deprecation warning naming `ai-conductor` on stderr and normal dispatch afterward; assert the warning does not print when invoked as `ai-conductor`.
2. Verify test fails (RED).
3. Implement: extend the `basename "$0"` check in `bin/ai-conductor` (the #2023 pattern — warning before symlink resolution; variation allowed: warning text names `conduct`).
4. Verify test passes (GREEN).
5. Commit: "feat(launcher): conduct invoked-name deprecation warning".

**Done when:**
- [ ] The new launcher test case passes and the existing `conduct-ts` warning cases still pass
- [ ] Invoking the launcher as `ai-conductor` prints no deprecation warning (asserted by test)

**Files likely touched:**
- bin/ai-conductor — recognize `conduct` in the invoked-name check
- test/test_ai_conductor_launcher.sh — new alias case

**Dependencies:** none

### Task 2: Installer points `conduct` at the TS launcher
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: add cases to the install test suite (`test/test_install_check_build_auth.sh` or the launcher suite, whichever already fakes `LOCAL_BIN`) asserting that after install, `readlink -f` of the `conduct` link resolves to `bin/ai-conductor`; that a link already pointing there is reported current and not rewritten; and that a stale link pointing at the bash script is replaced with an update message.
2. Verify tests fail (RED).
3. Implement: rewrite `bin/install` step 3 so `conduct_source` is `${HARNESS_DIR}/bin/ai-conductor`, moved inside the dist-gated section beside the `ai-conductor`/`conduct-ts` blocks (same idempotent/update/foreign-entry idiom); update any usage banners or doctor text naming the bash script.
4. Verify tests pass (GREEN).
5. Commit: "feat(install): conduct symlink targets bin/ai-conductor".

**Done when:**
- [ ] `bin/install` contains no symlink step whose target is the bash script; the conduct link is created only when the dist bundle exists, and a failed build still exits non-zero via the existing CONDUCT_TS_FAILURE tail
- [ ] Idempotent re-run and stale-link replacement cases pass; foreign non-symlink entry is warned about and preserved (same idiom as the sibling blocks)

**Files likely touched:**
- bin/install — step 3 rewrite, banner/doctor text
- test/test_install_check_build_auth.sh — symlink-target assertions

**Dependencies:** 1

### Task 3: Uninstall removes all three installer-owned entrypoint links
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: uninstall case asserting `conduct`, `conduct-ts`, and `ai-conductor` links under the faked `LOCAL_BIN` are removed when installer-owned, and a foreign `conduct` file is preserved with a warning.
2. Verify test fails (RED).
3. Implement: extend the uninstall section of `bin/install` (currently removes only the `conduct` link) to remove the other two with the same `-L` ownership guard.
4. Verify test passes (GREEN).
5. Commit: "fix(install): uninstall removes ai-conductor and conduct-ts links".

**Done when:**
- [ ] Uninstall test passes: three installer-owned links removed, foreign entry preserved
- [ ] `bash -n` and shellcheck pass on `bin/install`

**Files likely touched:**
- bin/install — uninstall section
- test/test_install_check_build_auth.sh — uninstall case

**Dependencies:** 2

### Task 4: TS run path invokes the idempotent memory-store setup
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: unit test asserting that the project prelude (or the run entry that calls it) invokes the memory-store setup exactly once per run start — setup performed when the canonical store is absent, no-op when present, and a setup failure logs a warning without aborting the run (mirror of the bash `run_memory_store_setup` tolerance).
2. Verify test fails (RED).
3. Implement: call the existing setup behind `dispatchMemorySetup`/its underlying function from `runProjectPrelude` in `src/conductor/src/engine/project-prelude.ts` (single seam both inline and daemon dispatch already pass through via the run entry in `src/conductor/src/index.ts`), before any session touches the memory directory.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): auto memory-store setup at run prelude".

**Done when:**
- [ ] New test passes: setup invoked at prelude, idempotent, failure is warn-and-continue (never a thrown abort)
- [ ] The manual `memory setup` CLI verb still works unchanged (existing memory-cli tests pass)

**Files likely touched:**
- src/conductor/src/engine/project-prelude.ts — invoke setup
- src/conductor/src/engine/memory-cli.ts — export reuse if needed
- src/conductor/test/engine/project-prelude-memory-setup.test.ts — new test

**Dependencies:** none

### Task 5: Pin the surviving CLI rejection surface
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests (some may already pass — keep them as pins): CLI tests asserting `--auto` exits non-zero before any pipeline step with the shipped guided rejection (message naming daemon start and the daemon guide, per the merged #1436 spec — existing mode-derivation assertions may already cover this; extend, do not duplicate); `--step x`, `--log`, `--output` each exit non-zero as unknown options; a bare single word like `deploy` exits non-zero identifying the unknown command.
2. Verify each missing assertion fails (RED) and existing ones are identified as already-green pins.
3. Implement: none expected — this pins current behavior; add only test code.
4. Verify all pass (GREEN).
5. Commit: "test(cli): pin post-cutover rejection surface".

**Done when:**
- [ ] Assertions exist and pass for the guided `--auto` rejection and unknown-option failures for the three dropped flags plus the bare-word guard
- [ ] No production file changed in this task's diff

**Files likely touched:**
- src/conductor/test/cli/index.test.ts — dropped-flag and bare-word assertions
- src/conductor/test/cli/mode-derivation.test.ts — reuse existing --auto pins

**Verify-only:** yes

**Dependencies:** none

### Task 6: Retire the integrity suite's bash-parity assertions
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write the change test-first in the suite itself: rework the tagged-update section of `test/test_harness_integrity.sh` to drop every assertion comparing the bash script with `bin/update`, replacing them with a single-sided assertion that `bin/update` still contains the complete tagged-update decision block (cache, post-release, up-to-date, offer, prompt behaviors — the closed enumeration the parity check verified).
2. Run the suite; the reworked section must pass while the bash script still exists (single-sided means it no longer reads that file).
3. Also drop the suite's identity-delegation loop entry for the bash script, keeping the `bin/update` entry.
4. Commit: "test(integrity): single-sided bin/update tagged-update assertions".

**Done when:**
- [ ] The integrity suite passes both with the bash script present and after its deletion (proven again in Task 8)
- [ ] `bin/update`'s tagged-update decision block and identity delegation each retain a direct failing-capable assertion (verified by temporarily mangling a copy, or by the assertion's own negative branch)

**Files likely touched:**
- test/test_harness_integrity.sh — parity section rework

**Dependencies:** none

### Task 7: Delete the dedicated legacy test scripts
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Remove `test/test_conduct_worktree.sh` and `test/test_conduct_arg_guard.sh` (coverage already ported by #224 and pinned TS-side by Task 5; per code-removal, the surviving observable behavior is the TS suites passing).
2. Sweep runner references: CI workflow files and any suite driver that enumerates them.
3. Run the shell suite lint and the CI test-list check.
4. Commit: "chore(test): remove bash-conduct-dedicated test scripts".

**Done when:**
- [ ] No CI workflow, suite driver, or script references the two deleted filenames (grep of the tree returns only historical spec artifacts)
- [ ] `test/lint_shell.sh` passes on the reduced set

**Files likely touched:**
- test/test_conduct_worktree.sh — deleted
- test/test_conduct_arg_guard.sh — deleted
- .github/workflows — runner reference sweep if present

**Dependencies:** 6

### Task 8: Delete bin/conduct
**Story:** Story 3
**Type:** refactor

**Steps:**
1. With installer (Task 2), integrity suite (Task 6), and dedicated tests (Task 7) no longer referencing it, delete the bash script. Surviving observable behavior: `conduct --help`, `--status`, `--reset`, `--cleanup`, an inline run, and `bin/update --set-channel` all work through the TS CLI (pinned by Tasks 2/5 and existing suites).
2. Run the full shell + integrity suites and the TS vitest suite.
3. Commit: "feat(cli)!: remove the legacy bash conduct CLI".

**Done when:**
- [ ] The full validation suite (integrity + shell lint) and the TS test suite pass with the file absent
- [ ] `conduct --help` through the swapped symlink exits 0 (launcher test from Task 1 run against the installed layout fake)

**Files likely touched:**
- bin/conduct — deleted

**Dependencies:** 2; 6; 7

### Task 9: Clean surviving shell libraries' stale references
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Rewrite the header comments in `bin/lib/harness-common.sh` (it no longer serves the deleted script) and the stale comment blocks in `bin/update` and `bin/migrate` that describe the bash script as a live caller — honoring `bin/update`'s own "#226 must NOT remove this" note: its helper copies stay, only prose describing the dead caller changes.
2. Comment-only change: run `bash -n`, shellcheck, and the update/migrate test suites to prove behavior is untouched.
3. Commit: "chore(bin): retire bash-conduct references in surviving scripts".

**Done when:**
- [ ] `test/test_bin_update.sh` and `test/test_post_commit_derive_feedback.sh` pass unchanged
- [ ] The three files' diffs touch comments/prose only (no executable line changed)

**Files likely touched:**
- bin/lib/harness-common.sh — header rewrite
- bin/update — caller prose
- bin/migrate — caller prose

**Dependencies:** 8

### Task 10: Extend the legacy-reference guard to police the removed CLI
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing test first by planting: add the `bin/conduct` pattern to `test/test_no_legacy_cli_references.sh` over its existing scanned set, reusing its scanner-fallback and case-allowlist shape; allowlist exactly the documented alias/deprecation mentions and the canonical breaking-surface contract strings (release-gate constant, PR template, AGENT_INSTRUCTIONS release section) that are out of this cutover's scope.
2. Run the guard; it fails RED on every remaining live reference in the scanned set (skills, hooks, bin, the scanned docs pages) — sweep those references to the surviving `ai-conductor`/`conduct` alias wording until the guard passes GREEN. This sweep is the mechanical closure of the forward-facing reference cleanup; the guard, not prose review, defines completeness over its scanned set.
3. Verify the guard still fails loudly when neither scanner backend exists (existing behavior, re-asserted).
4. Commit: "test(guard): police bin/conduct references".

**Done when:**
- [ ] The guard exits non-zero naming file and line on a planted reference in a scanned path, and exits 0 on the swept tree
- [ ] The allowlist is a closed enumeration (exact path:text cases, matching the guard's existing idiom) — no wildcard entry beyond the existing per-file glob exclusions

**Files likely touched:**
- test/test_no_legacy_cli_references.sh — pattern + allowlist
- skills — reference sweep to make the guard pass
- hooks — reference sweep to make the guard pass

**Dependencies:** 8; 9

### Task 11: Prove the extended guard under both scanner backends
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing test: extend `test/test_legacy_cli_guard_backends.sh` so its rg-vs-grep parity cases include the new pattern — a planted reference must produce the same non-zero verdict under both backends, and the swept tree the same pass.
2. Verify RED (new cases absent), implement the fixture additions, verify GREEN.
3. Commit: "test(guard): backend parity for the bin/conduct pattern".

**Done when:**
- [ ] Backend-parity suite passes with the new pattern cases under both `rg` and plain `grep`
- [ ] The missing-scanner failure case still passes

**Files likely touched:**
- test/test_legacy_cli_guard_backends.sh — new parity cases

**Dependencies:** 10

## Task Dependency Graph

```
1 ─▶ 2 ─▶ 3
          2 ─┐
6 ─▶ 7 ─────┼─▶ 8 ─▶ 9 ─▶ 10 ─▶ 11
4 (independent)
5 (independent)
```

## Integration Points
- After Task 3: full installer round-trip (install → re-install → uninstall) testable against the fake LOCAL_BIN.
- After Task 8: whole-tree state is the shipped end state; full validation + TS suites must be green.
- After Task 10: the guard mechanically proves the reference sweep.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s16-1: bin/install:1375-1378 — in the `conduct` else branch, before linking, guard `elif [ -e "$conduct_target" ]` (a foreign non-symlink entry): warn "conduct script — foreign entry preserved" (exact wording mirroring the uninstall idiom at bin/install:1581) and skip the `ln -sfn`, leaving the file byte-identical and the install exit status unchanged; keep the true no-entry path creating the link with the existing `ok "Installed conduct script to …"` line. Do NOT touch the sibling ai-conductor/conduct-ts blocks. RED first: add an install-side case to test/test_ai_conductor_launcher.sh beside the existing symlink cases (~:210-231, reusing run_install/INSTALL_HOME) that plants `printf 'FOREIGN OPERATOR SCRIPT\n' > "$INSTALL_HOME/.local/bin/conduct"`, runs install, and asserts exit 0, the file is still a regular file with its original contents, and the warning line appears — mirroring the shape of the existing uninstall foreign-entry assertion at :335-342 (which stays). Run `bash -n bin/install`, `bash test/lint_shell.sh`, and the launcher suite.
**Gate:** prd-audit
**Rationale:** bin/install:1366 gates only on `[ -L "$conduct_target" ]`, so a foreign regular ~/.local/bin/conduct takes the else branch at bin/install:1375-1378 and is destroyed by `ln -sfn` with no warning (audit reproduced this end-to-end, 98% confidence); Task 2's Done-when already names "foreign non-symlink entry is warned about and preserved (same idiom as the sibling blocks)", so the repair is conforming implementation work inside an existing task, not a plan or architecture gap. This adds a branch and a test; it removes no existing assertion — the install-side symlink cases at test/test_ai_conductor_launcher.sh:210-231 and the uninstall foreign-entry case at :335-342 are preserved unchanged, and the uninstall warn-and-preserve idiom at bin/install:1581 is the wording being mirrored, not replaced. Sibling sites found and deliberately EXCLUDED: the `ai-conductor` block (bin/install:1379-1392) and the `conduct-ts` block (bin/install:1393-1406) carry the identical hole, but they pre-date this branch, no story criterion covers them, and no plan task admits editing them — they are recorded here rather than fixed (worth a follow-up intake issue).
**Criterion:** S1.6
**Parent task:** 2
**Done when:**
- S1.6 is satisfied by this task.

### Task rem-prd-audit-rem-s27-1: src/conductor/src/index.ts:1040-1049 — in the `!isInline` guard, when `process.argv[2]` is a single bare command-shaped token (present, no leading `-`, contains no whitespace), emit `error: unknown command '<token>'` on stderr as the first line before the existing inline guidance block (same idiom as the `validate-wired-into` branch at :1030-1032), then exit 1; leave the guidance text and the bare multi-word feature path (e.g. `conduct "URL shortener"`) byte-identical so the existing message stays correct there. Do not enumerate known commands. RED first: add a CLI test in src/conductor/test/cli/index.test.ts alongside the bare-word detectInline pins at :330-339 (which stay) asserting the `deploy` invocation's stderr contains `unknown command 'deploy'` and that a bare multi-word feature still gets the unchanged inline guidance with no unknown-command line. Sweep: `grep -rn "inline SDLC pipeline now runs"` — the only other sites are the test/test_bin_update.sh:888 stub and docs/guides/running-the-daemon.md:463, both describing the bare-feature form and both left unchanged; check docs/reference/cli.md for a bare-word description and update it only if it states the message shape.
**Gate:** prd-audit
**Rationale:** `conduct deploy` exits 1 but prints only the inline-subcommand guidance from src/conductor/src/index.ts:1042-1047 and never names `deploy`, so the criterion's diagnostic half is unmet (85% confidence, behavior verified directly by the audit); Task 5 owns this criterion and its Steps — the governing contract — explicitly require "a bare single word like `deploy` exits non-zero identifying the unknown command", so the one-line diagnostic is admitted by that task even though its "Implement: none expected" prediction (and the plan's "pinned by tests, not new behavior" assumption) was falsified by the audit; note the task's "No production file changed" Done-when is superseded by its own step 1 and should be recorded as such in the commit. The change is additive: the existing guidance text stays verbatim for the bare multi-word feature form, so the pins at src/conductor/test/cli/index.test.ts:330-339, the fixture at test/test_bin_update.sh:888, and the quoted message in docs/guides/running-the-daemon.md:463 all remain valid. Matched-pair guard: the new message must print the token the operator typed — do NOT introduce a hardcoded list of known commands, which would silently drift from the real command registry in createProgram/createBaseProgram.
**Criterion:** S2.7
**Parent task:** 5
**Done when:**
- S2.7 is satisfied by this task.

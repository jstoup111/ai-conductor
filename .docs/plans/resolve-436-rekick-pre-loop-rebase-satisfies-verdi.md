# Plan: REKICK pre-loop rebase records rebase step state (#436)

Source-Ref: jstoup111/ai-conductor#436
Stories: .docs/stories/resolve-436-rekick-pre-loop-rebase-satisfies-verdi.md

### Task 1: RED — pre-loop rebase leaves rebase state unrecorded
**Story:** Story 1 (failing precondition)
**Type:** test
**Steps:**
1. Failing test in an isolated repo fixture: run `honorRekick` through a clean
   play-forward rebase; assert conduct-state `rebase` and
   `.pipeline/gates/rebase.json` match what `runRebaseStep` records for the
   same outcome. Pin today's gap (nothing recorded) as RED.
2. Commit: "test(rekick): pre-loop rebase must record rebase step state (RED)"
**Files:**
- src/conductor/test/engine/daemon-rekick.test.ts

### Task 2: extract the in-loop rebase-state recording into a shared helper
**Story:** Story 1 (one shared implementation)
**Type:** refactor
**Steps:**
1. Extract the state+gate-verdict recording `runRebaseStep` performs into a
   named helper in the rebase/rekick module space; the in-loop step calls it;
   behavior byte-identical (existing conductor tests stay green).
2. Commit: "refactor(rebase): extract shared rebase-state recording helper"
**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/rebase.ts

### Task 3: GREEN — honorRekick records via the shared helper
**Story:** Story 1
**Type:** feature
**Steps:**
1. Call the shared helper from `honorRekick` after `applyRebaseVerdicts` for
   clean/noop outcomes only; Task 1's test goes GREEN.
2. Commit: "fix(rekick): pre-loop rebase records rebase step state (#436)"
**Files:**
- src/conductor/src/engine/daemon-rekick.ts

### Task 4: negative path — conflict outcomes record nothing as done
**Story:** Story 2
**Type:** test
**Steps:**
1. Failing-then-green test: conflicted resume (resolution exhausted) leaves
   rebase state un-done and the HALT unchanged; state distinguishes never-ran
   from ran-and-conflicted.
2. Commit: "test(rekick): conflicted pre-loop rebase records no done state"
**Files:**
- src/conductor/test/engine/daemon-rekick.test.ts

### Task 5: CHANGELOG + docs sweep
**Story:** Done-when (docs track features)
**Type:** docs
**Steps:**
1. CHANGELOG [Unreleased] Fixed entry; note the shared-helper invariant in
   src/conductor/README.md's rekick section if one exists.
2. Commit: "docs: rekick rebase-state recording (#436)"
**Files:**
- CHANGELOG.md
- src/conductor/README.md

# Implementation Plan: Main-Checkout Leak Triage, Auto-Heal, and Write-Fence (#380)

**Date:** 2026-07-08
**Design:** `.docs/decisions/adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md` (APPROVED)
**Stories:** `.docs/stories/daemon-build-agents-leak-edits-into-the-main-check.md` (Accepted, TR-1..TR-5)
**Conflict check:** Clean as of 2026-07-08

## Summary

Two independent phases, 19 tasks: (1) leak triage + byte-identity-gated auto-heal on the
daemon's dirty fast-forward path, with escalated fingerprint-throttled WARNs; (2) a
daemon-owned write-fence PreToolUse hook provisioned into the self-build sandbox.

## Technical Approach

- **New module `leak-triage.ts`** (engine): pure functions over a `GitRunner` —
  `parseDirtyStatus` (porcelain → modified/untracked/staged), `enumerateCandidates`
  (branches checked out in worktrees first via `git worktree list --porcelain`, then local
  `feat/*` refs), `classifyDirt` (modified file explained iff `hash-object` of working file
  equals `rev-parse <branch>:<path>`; stray explained iff its content hash is in the
  culprit tree's `ls-tree -r` blob set; gitignored paths excluded by porcelain semantics),
  and `healPlan` (all-or-nothing: one branch explains everything AND zero staged entries).
  A small `LeakWarnState` (dirty-state fingerprint = sorted path+hash pairs) makes the
  escalated WARN transition-aware — same pattern as `DiscoveryLogger` in `daemon-backlog.ts`.
- **Wire into `fastForwardRoot`** (`daemon-backlog.ts` dirty branch, lines ~175-184): on
  dirty, run triage; fully-explained → re-verify byte-identity, `git restore` modified,
  delete explained strays, one WARN naming culprit(s) + healed paths, fall through to the
  existing fetch/ff logic in the SAME call; otherwise keep skip, emit escalated WARN on
  fingerprint change, short line otherwise. Wrapped so no triage/heal error can throw out
  of `fastForwardRoot` (its never-throws contract is documented and load-bearing).
- **New module `self-host/write-fence.ts`**: generates the fence hook script text (bash +
  jq, same idiom as the operator's `block-default-branch-edits.sh`; worktree root + harness
  root baked in as literals at provision time) and `mergeFenceIntoSettings(settingsText |
  null)` → settings JSON with the fence PreToolUse entry appended (operator entries
  preserved; null input yields a minimal settings object). Called from
  `provisionSandboxBuildEnv` after `provisionSettings`; script written to
  `<configDir>/write-fence.sh` (never symlinked — TR-6 invariant); any fs failure follows
  the existing fail-closed `SandboxProvisionError` path; teardown already removes configDir
  recursively.
- **Fence verdict logic** (in-script): resolve target (file_path/notebook_path, relative →
  cwd) → allow if under worktree root; block (exit 2) if under harness root; allow
  otherwise. Bash: block only write-shaped references to harness paths outside the worktree
  (redirection `>`/`>>`, `mv`/`cp`/`tee`/`install` destinations); bare reads allowed.
  Malformed payload → exit 0 (existing guard idiom; phase 1 backstops).
- **Sequencing:** phase 1 tasks (1–14) then phase 2 (15–18), docs last (19). The phases
  share no code; phase 2 could reorder freely if the builder needs to.
- **Release-gate note for the builder:** all changes are engine-internal. The sandbox fence
  does NOT alter the consumer `settings.json` schema or operator hook wiring; if the
  self-host release gate's path classifier flags a breaking surface on this diff, that is
  the internal-only case — use a `.docs/release-waivers/` waiver per CLAUDE.md, not an
  empty migration block.

## Prerequisites

None — no migrations, no new dependencies (`jq` parity with the existing operator hook).

## Tasks

### Task 1: Porcelain status parser for triage
**Story:** TR-1 (classification input; staged-abort criterion)
**Type:** infrastructure

**Steps:**
1. Write failing tests: `parseDirtyStatus` maps `git status --porcelain` text to
   `{modified[], untracked[], staged[]}` — covers ` M`, `M ` (staged), `MM`, `??`, renames.
2. Verify RED.
3. Implement `parseDirtyStatus` in new `leak-triage.ts`.
4. Verify GREEN.
5. Commit: "feat(engine): leak-triage porcelain status parser"

**Files:**
- src/conductor/src/engine/leak-triage.ts
- src/conductor/test/engine/leak-triage.test.ts

**Dependencies:** none

### Task 2: Candidate branch enumeration
**Story:** TR-1 ("in-flight daemon build branches evaluated before other local feat/* heads")
**Type:** happy-path

**Steps:**
1. Failing test (real temp repo): repo with a worktree on `feat/daemon-x` and a plain local
   branch `feat/y` → `enumerateCandidates` returns `feat/daemon-x` before `feat/y`; a repo
   with neither returns `[]`.
2. RED.
3. Implement via `git worktree list --porcelain` + `git for-each-ref refs/heads/feat`.
4. GREEN.
5. Commit: "feat(engine): leak-triage candidate branch enumeration"

**Files:** same

**Dependencies:** Task 1

### Task 3: Classify modified tracked files by byte-identity
**Story:** TR-1 happy path
**Type:** happy-path

**Steps:**
1. Failing test (real temp repo): modified `src/a.ts` byte-identical to `feat/daemon-x`
   head blob → verdict `{path, explainedBy: 'feat/daemon-x'}`.
2. RED.
3. Implement: `git hash-object <worktree file>` vs `git rev-parse <branch>:<path>`.
4. GREEN.
5. Commit: "feat(engine): classify modified files against candidate heads"

**Files:** same

**Dependencies:** Task 2

### Task 4: Classification negatives — differing file, missing path, no candidates, staged abort
**Story:** TR-1 negative paths (all four)
**Type:** negative-path

**Steps:**
1. Failing tests: one-byte difference → unexplained; path absent from every candidate tree
   → unexplained (no error); zero candidates → all unexplained, no error; staged entry
   present → triage returns not-healable immediately without classification.
2. RED.
3. Implement the guards.
4. GREEN. Also assert triage issues no mutating git commands (runner call log).
5. Commit: "test(engine): leak-triage classification negative paths"

**Files:** same

**Dependencies:** Task 3

### Task 5: Stray classification by content-hash membership in culprit tree
**Story:** TR-1 story 2 happy path
**Type:** happy-path

**Steps:**
1. Failing test (real temp repo): untracked `test/daemon.test.ts.new` with content equal to
   `test/daemon.test.ts` blob at `feat/daemon-x` → explained-by `feat/daemon-x`.
2. RED.
3. Implement: stray hash vs `git ls-tree -r <branch>` blob-hash set.
4. GREEN.
5. Commit: "feat(engine): stray classification via culprit tree blob set"

**Files:** same

**Dependencies:** Task 3

### Task 6: Stray negatives — no-match veto, cross-branch veto, gitignored exclusion
**Story:** TR-1 story 2 negative paths
**Type:** negative-path

**Steps:**
1. Failing tests: stray matching no culprit blob → whole heal vetoed; stray matching only a
   different branch than the one explaining modified files → vetoed (single-branch rule);
   gitignored file absent from porcelain → never classified.
2. RED.
3. Implement all-or-nothing `healPlan` composition.
4. GREEN.
5. Commit: "feat(engine): all-or-nothing heal plan with stray vetoes"

**Files:** same

**Dependencies:** Task 5

### Task 7: Wire heal into fastForwardRoot — restore, delete strays, WARN, same-poll FF
**Story:** TR-2 happy path
**Type:** happy-path

**Steps:**
1. Failing integration test (real temp repo + origin): dirty tree fully explained by
   `feat/daemon-x` → files restored, strays deleted, ONE WARN containing branch name and
   every healed path, and the same `fastForwardRoot` call fast-forwards to origin (tree
   clean, HEAD advanced).
2. RED.
3. Implement heal execution in the dirty branch of `fastForwardRoot`.
4. GREEN.
5. Commit: "feat(daemon): auto-heal explained leak dirt on the FF path"

**Files:**
- src/conductor/src/engine/daemon-backlog.ts
- src/conductor/src/engine/leak-triage.ts
- src/conductor/test/engine/daemon-backlog.test.ts

**Dependencies:** Task 6

### Task 8: Partial-explanation veto — nothing touched
**Story:** TR-2 negative ("one unexplained among five explained → NO file restored")
**Type:** negative-path

**Steps:**
1. Failing test: five explained + one unexplained dirty entry → zero restores, zero
   deletions, FF still skipped.
2. RED. 3. Implement (should already hold from healPlan; assert at wiring level). 4. GREEN.
5. Commit: "test(daemon): partial-explanation veto leaves tree untouched"

**Files:** same as Task 7

**Dependencies:** Task 7

### Task 9: TOCTOU re-verification before restore
**Story:** TR-2 negative ("content changed before restore → entire heal aborts")
**Type:** negative-path

**Steps:**
1. Failing test: injected git runner where the second hash of one file differs from
   classification time → heal aborts before any restore, WARN says re-verification failed.
2. RED.
3. Implement re-hash pass immediately before executing restores.
4. GREEN.
5. Commit: "feat(daemon): re-verify byte-identity immediately before heal"

**Files:** same as Task 7

**Dependencies:** Task 7

### Task 10: Restore failure mid-heal — log, stop, never throw
**Story:** TR-2 negative ("git restore exits non-zero")
**Type:** negative-path

**Steps:**
1. Failing test: runner fails the `restore` call → failing path logged, remaining heal
   actions skipped, `fastForwardRoot` resolves normally; a second call re-triages cleanly.
2. RED. 3. Implement. 4. GREEN.
5. Commit: "feat(daemon): heal failure is contained and non-fatal"

**Files:** same as Task 7

**Dependencies:** Task 7

### Task 11: Multi-candidate identical content — heal proceeds, WARN lists all
**Story:** TR-2 negative ("byte-identical on two candidate branches")
**Type:** negative-path

**Steps:**
1. Failing test: two branches both explain the full dirty set → heal proceeds, WARN lists
   both candidates.
2. RED. 3. Implement candidate-list retention in the WARN. 4. GREEN.
5. Commit: "feat(daemon): heal WARN names every matching candidate"

**Files:** same as Task 7

**Dependencies:** Task 7

### Task 12: Escalated leak-suspect WARN with per-file explanation table
**Story:** TR-3 happy path (first sight)
**Type:** happy-path

**Steps:**
1. Failing test: unexplained dirty tree → skip log contains per-file diff-stat and
   explained/unexplained-per-candidate detail.
2. RED. 3. Implement WARN rendering. 4. GREEN.
5. Commit: "feat(daemon): escalate unexplained dirty-FF skip to leak-suspect WARN"

**Files:** same as Task 7

**Dependencies:** Task 7

### Task 13: Fingerprint throttling across polls
**Story:** TR-3 happy (unchanged → short line) + negative (new file → full WARN re-emits)
**Type:** happy-path

**Steps:**
1. Failing tests: two consecutive calls with identical dirty state → full WARN once, short
   line second; adding a file between calls → full WARN again.
2. RED.
3. Implement `LeakWarnState` fingerprint (sorted path+hash), threaded from the daemon like
   `DiscoveryLogger`.
4. GREEN.
5. Commit: "feat(daemon): fingerprint-throttled leak WARN"

**Files:** same as Task 7

**Dependencies:** Task 12

### Task 14: Triage/heal can never break fastForwardRoot's never-throws contract
**Story:** TR-3 negative ("triage errors → short skip + error log, poll never crashes")
**Type:** negative-path

**Steps:**
1. Failing adversarial test: git runner that throws/fails on every triage command →
   `fastForwardRoot` resolves, logs the triage error + today's short skip line, FF safety
   (skip on dirty) preserved.
2. RED. 3. Wrap triage/heal in the containment boundary. 4. GREEN.
5. Commit: "fix(daemon): contain triage errors inside the FF never-throws contract"

**Files:** same as Task 7

**Dependencies:** Task 12

### Task 15: Fence script generator + settings merge
**Story:** TR-4 happy (entry + baked roots; operator hooks preserved) and negative
(no operator settings → minimal settings with fence)
**Type:** happy-path

**Steps:**
1. Failing unit tests: `mergeFenceIntoSettings(operatorJson)` appends the fence PreToolUse
   entry for Edit/Write/MultiEdit/NotebookEdit/Bash and preserves existing hook entries
   byte-for-byte; `mergeFenceIntoSettings(null)` yields minimal valid settings; script text
   contains the baked worktree + harness roots and no placeholder residue.
2. RED. 3. Implement `write-fence.ts` (script template + merge). 4. GREEN.
5. Commit: "feat(self-host): write-fence script generator and settings merge"

**Files:**
- src/conductor/src/engine/self-host/write-fence.ts
- src/conductor/test/engine/self-host/write-fence.test.ts

**Dependencies:** none (phase 2 start)

### Task 16: Provision fence into the sandbox, fail closed, teardown clean
**Story:** TR-4 happy (provisioning) + negatives (fs failure → SandboxProvisionError; script
lives under configDir, executable; removed with teardown)
**Type:** happy-path

**Steps:**
1. Failing tests in sandbox-build-env.test.ts: after `provisionSandboxBuildEnv`, sandbox
   settings.json contains the fence entry and `<configDir>/write-fence.sh` exists
   (mode +x); injected fs failure on the script write → `SandboxProvisionError`, partial
   sandbox removed, no build launched; teardown leaves nothing.
2. RED.
3. Wire `write-fence.ts` into `provisionSandboxBuildEnv` after `provisionSettings`.
4. GREEN.
5. Commit: "feat(self-host): provision write-fence into the self-build sandbox"

**Files:**
- src/conductor/src/engine/self-host/sandbox-build-env.ts
- src/conductor/src/engine/self-host/write-fence.ts
- src/conductor/test/engine/self-host/sandbox-build-env.test.ts

**Dependencies:** Task 15

### Task 17: Fence runtime allow cases (real-binary smoke)
**Story:** TR-5 happy (inside-worktree allow) + negatives (unrelated repo/tmp allow,
read-only Bash allow, malformed payload exit 0)
**Type:** negative-path

**Steps:**
1. Failing smoke tests invoking the generated script with real `bash` and JSON payloads on
   stdin: Edit inside `<harness>/.worktrees/<slug>` → exit 0 (allow-inside-worktree
   precedence over block-under-checkout); Edit in an unrelated repo and in the OS temp dir
   → exit 0; Bash `grep -r <harness>/src …` (read-only reference) → exit 0; empty/garbage
   stdin → exit 0, no stderr crash.
2. RED. 3. Implement the allow logic in the script template. 4. GREEN.
5. Commit: "feat(self-host): write-fence allow semantics (real-binary smoke)"

**Files:** same as Task 15

**Dependencies:** Task 15

### Task 18: Fence runtime block cases (real-binary smoke)
**Story:** TR-5 happy (Edit outside worktree blocked; Bash write-shape blocked) + negative
(`..` traversal resolved against cwd before verdict)
**Type:** negative-path

**Steps:**
1. Failing smoke tests: Edit targeting `<harness>/src/conductor/src/x.ts` → exit 2, stderr
   names the attempted path, worktree root, and rule; Bash `sed … > <harness>/test/f.ts.new`
   and `mv tmp <harness>/test/f.ts` → exit 2; relative `../../src/x.ts` from inside the
   worktree resolving into the harness checkout → exit 2.
2. RED. 3. Implement block logic + message. 4. GREEN.
5. Commit: "feat(self-host): write-fence block semantics (real-binary smoke)"

**Files:** same as Task 15

**Dependencies:** Task 17

### Task 19: Docs + changelog
**Story:** all (Docs-track-features rule; CHANGELOG gate)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` entries (Added: leak triage/auto-heal, write-fence).
2. Document the new daemon behavior (heal + escalated WARN) and the sandbox fence in
   `README.md` + `src/conductor/README.md`.
3. Run `test/test_harness_integrity.sh`; fix any failures.
4. Commit: "docs: leak triage auto-heal and sandbox write-fence"

**Files:**
- CHANGELOG.md
- README.md
- src/conductor/README.md

**Dependencies:** Task 14, Task 18

## Task Dependency Graph

```
1 → 2 → 3 → 4
         3 → 5 → 6 → 7 → 8
                      7 → 9
                      7 → 10
                      7 → 11
                      7 → 12 → 13
                          12 → 14
15 → 16
15 → 17 → 18
14, 18 → 19
```

## Integration Points

- After Task 7: end-to-end heal observable on a real temp repo (dirty → healed → FF'd).
- After Task 14: full phase-1 behavior under adversarial git failures.
- After Task 16: a provisioned sandbox carries the fence; inspectable settings.json.
- After Task 18: fence verdicts verified against the real script binary.

## Coverage Mapping

- TR-1 story 1: happy → T3; negatives → T4 (all four). Candidate ordering → T2.
- TR-1 story 2 (strays): happy → T5; negatives → T6.
- TR-2: happy → T7; negatives → T8 (partial veto), T9 (TOCTOU), T10 (restore failure),
  T11 (multi-candidate).
- TR-3: happy → T12 (table) + T13 (throttle); negatives → T13 (fingerprint change),
  T14 (triage error containment).
- TR-4: happy → T15, T16; negatives → T15 (no settings), T16 (fail-closed, teardown,
  configDir placement — self-disarm blocked).
- TR-5: happy → T17 (worktree allow), T18 (blocks); negatives → T17 (unrelated/tmp,
  read-only Bash, malformed payload), T18 (traversal).

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic

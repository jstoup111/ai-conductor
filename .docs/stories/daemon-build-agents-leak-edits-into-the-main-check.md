**Status:** Accepted

# Stories: Main-Checkout Leak Triage, Auto-Heal, and Write-Fence (#380)

Technical track — requirements derive from APPROVED ADR
`adr-2026-07-08-main-checkout-leak-triage-and-write-fence` (no PRD). Requirement tags:
- **TR-1** LeakTriage classification of dirty entries against candidate branch heads
- **TR-2** All-or-nothing byte-identity AutoHeal (restore + stray removal + culprit WARN)
- **TR-3** Escalated leak-suspect WARN for unexplained dirt (stall never silent)
- **TR-4** Write-fence provisioning into the self-build sandbox settings
- **TR-5** Write-fence runtime behavior (block escapes, allow worktree-internal writes)

## Story: LeakTriage explains dirty tracked files by byte-identity to a candidate branch

**Requirement:** TR-1

As the daemon, I want each dirty tracked file classified against candidate branch heads so
that leak-shaped dirt is distinguishable from operator work.

### Acceptance Criteria

#### Happy Path
- Given the main checkout is on the default branch with `src/a.ts` modified, and an
  in-flight build branch `feat/daemon-x` whose head blob for `src/a.ts` is byte-identical
  to the working-tree file, when the FF poll finds the dirty tree, then triage marks
  `src/a.ts` explained-by `feat/daemon-x`.
- Given candidate branches, when triage orders them, then in-flight daemon build branches
  are evaluated before other local `feat/*` heads.

#### Negative Paths
- Given `src/a.ts` differs by one byte from the blob at every candidate branch head, when
  triage runs, then `src/a.ts` is unexplained and no candidate is recorded for it.
- Given a dirty file whose path does not exist in any candidate branch tree, when triage
  runs, then the file is unexplained (a missing path is not an error).
- Given no candidate branches exist (no in-flight builds, no local `feat/*`), when triage
  runs, then every dirty entry is unexplained and triage completes without error.
- Given the index has staged changes (`git status` shows a staged entry), when the FF poll
  finds the dirty tree, then triage reports not-healable immediately and classification is
  skipped (operator work in progress — hands off).

### Done When
- [ ] A triage unit exists that, given a dirty-status parse and a candidate-branch list,
      returns per-file verdicts `{path, explainedBy | null}` plus a healable/not-healable
      summary, with tests covering all paths above against real temp git repos.
- [ ] Triage never mutates the repo (verified: no write git commands issued in triage).

## Story: Untracked strays are explained only by content-hash membership in the culprit tree

**Requirement:** TR-1

As the daemon, I want untracked leftovers (e.g. `daemon.test.ts.new`) tied to the same
culprit branch by content so that temp files from a leaking write-then-rename flow are
healed with the same confidence as tracked files.

### Acceptance Criteria

#### Happy Path
- Given untracked `test/daemon.test.ts.new` whose content hash equals the blob of
  `test/daemon.test.ts` at `feat/daemon-x` HEAD, and all modified tracked files are also
  explained by `feat/daemon-x`, when triage runs, then the stray is explained-by
  `feat/daemon-x`.

#### Negative Paths
- Given an untracked file whose content matches no blob in the culprit branch's tree, when
  triage runs, then the stray is unexplained and the whole heal is vetoed (all-or-nothing).
- Given an untracked file whose content matches a blob only on a branch OTHER than the one
  explaining the modified files, when triage runs, then no single branch explains the whole
  tree and heal is vetoed.
- Given an untracked file in a gitignored path (e.g. `.pipeline/`), when triage runs, then
  it is excluded from classification entirely (ignored files are not dirt — `status
  --porcelain` semantics preserved).

### Done When
- [ ] Stray classification is by content-hash lookup against the culprit tree's blob set
      (path-independent), with tests for match, no-match, and cross-branch-match veto.

## Story: AutoHeal restores the tree all-or-nothing and names the culprit

**Requirement:** TR-2

As the operator, I want the daemon to heal a fully-explained leak by itself so that base
tracking resumes without me running the verify-identical-then-restore recipe by hand.

### Acceptance Criteria

#### Happy Path
- Given every dirty entry (modified + stray) is explained by `feat/daemon-x`, when the FF
  poll runs, then the daemon `git restore`s the modified files, deletes the explained
  strays, logs ONE WARN naming `feat/daemon-x` and every healed path, and the SAME poll
  proceeds to fetch + `merge --ff-only` (no extra poll cycle needed).

#### Negative Paths
- Given one dirty entry is unexplained while five others are explained, when the FF poll
  runs, then NO file is restored and NO stray is deleted (all-or-nothing; partial heal is
  never performed).
- Given a file was explained at classification time but its content changed before restore
  (operator saved new work mid-poll), when heal re-verifies byte-identity immediately
  before `git restore`, then the changed file fails re-verification and the entire heal
  aborts with a WARN (TOCTOU window closed by re-check).
- Given `git restore` exits non-zero mid-heal, when heal runs, then the failure is logged
  with the failing path, remaining actions are skipped, the poll loop does not crash, and
  the next poll re-triages from scratch.
- Given the same content is byte-identical on two candidate branches, when heal runs, then
  heal proceeds (restore is content-safe) and the WARN lists every matching candidate, not
  just the first.

### Done When
- [ ] Heal executes `git restore -- <explained modified files>` and deletes explained
      strays, gated on a re-verification pass, in daemon-backlog's FF path.
- [ ] Fast-forward is attempted in the same poll after a successful heal (test asserts the
      FF ran and the tree is clean).
- [ ] The heal WARN includes: culprit branch(es), healed file list, stray list — asserted
      in a log-capture test.
- [ ] Adversarial tests cover: partial-explanation veto, mid-heal content change, restore
      failure, staged-changes abort.

## Story: Unexplained dirt escalates loudly instead of a silent one-line skip

**Requirement:** TR-3

As the operator, I want an unexplained dirty tree to be visibly escalated so that a stalled
fast-forward is never a silent one-line-per-poll condition again.

### Acceptance Criteria

#### Happy Path
- Given a dirty tree triage cannot fully explain, when the FF poll skips, then the log
  carries a leak-suspect WARN including: per-file diff-stat, which files matched a
  candidate (and which branch), and which did not — actionable without re-running git by
  hand.
- Given the same unexplained dirty state persists across polls, when subsequent polls run,
  then the full WARN is emitted only when the dirty-state fingerprint (set of paths +
  content hashes) changes; unchanged states log the existing short skip line (no spam
  regression).

#### Negative Paths
- Given the dirty state gains one new file, when the next poll runs, then the fingerprint
  differs and the full WARN re-emits.
- Given triage itself errors (e.g. a git command fails), when the FF poll runs, then the
  daemon falls back to today's short skip line and logs the triage error — the poll loop
  never crashes and FF safety behavior (skip on dirty) is preserved.

### Done When
- [ ] FF-skip on dirty emits the escalated WARN with per-file explanation table on first
      sight and on fingerprint change; short line otherwise (log-capture tests for both).
- [ ] A triage/heal failure can never make `maybeFastForward` throw (adversarial test).

## Story: Write-fence is provisioned into the self-build sandbox settings

**Requirement:** TR-4

As the daemon, I want every self-build sandbox to carry a daemon-owned write-fence hook so
that build agents are blocked in-session from writing outside their worktree.

### Acceptance Criteria

#### Happy Path
- Given a sandbox is provisioned for a self-build, when `provisionSandboxBuildEnv`
  completes, then the sandbox `settings.json` contains a PreToolUse entry for
  Edit/Write/MultiEdit/NotebookEdit and Bash invoking the fence script, and the fence
  script file exists INSIDE the sandbox config dir with the worktree root and harness root
  baked in (env or args).
- Given the operator's settings.json already declares PreToolUse hooks, when the fence is
  merged, then the operator's entries are preserved unmodified alongside the fence entry.

#### Negative Paths
- Given the operator has NO global settings.json, when the sandbox is provisioned, then the
  fence entry is still written (fence must not depend on operator config existing).
- Given the fence script cannot be written (fs error), when provisioning runs, then
  provisioning fails closed with `SandboxProvisionError` and no build is launched
  (consistent with TR-5 fail-closed precedent in sandbox-build-env).
- Given the build edits `hooks/` inside its worktree, when the fence fires, then the fence
  logic is unaffected — the script executed is the daemon-written copy in the sandbox
  config dir, never a file sourced from the worktree under test (self-disarm blocked).

### Done When
- [ ] Sandbox provisioning tests assert: fence entry present, operator hooks preserved,
      no-settings case covered, fs-failure fails closed, script lives under configDir.
- [ ] Teardown removes the fence with the sandbox (no residue after build).

## Story: Write-fence blocks checkout escapes and allows worktree-internal work

**Requirement:** TR-5

As a build-step agent, I am blocked from writing to the live harness checkout but never
false-blocked on legitimate work inside my build worktree.

### Acceptance Criteria

#### Happy Path
- Given a build worktree at `<harness>/.worktrees/<slug>`, when the agent Edits a file
  under the worktree, then the fence allows it (allow-inside-worktree precedence — the
  worktree being UNDER the harness root must not trigger the block).
- Given the same worktree, when the agent Edits `<harness>/src/conductor/src/x.ts` (outside
  the worktree), then the fence blocks with exit 2 and guidance naming the worktree path.
- Given a Bash command whose text references a main-checkout path outside the worktree
  (e.g. `sed … > <harness>/test/daemon.test.ts.new`), when the fence evaluates it, then it
  blocks with the same guidance.

#### Negative Paths
- Given an Edit targeting a path in an unrelated repo or the OS temp dir, when the fence
  evaluates it, then it allows (fence scope is the harness checkout only).
- Given a Bash command that merely READS a main-checkout path (`grep`, `cat`, `diff`), when
  the fence evaluates it, then it allows — the heuristic must target write shapes
  (redirection into, `mv`/`cp` destination, `tee`) rather than any path mention; an
  over-broad block here is a regression (builds legitimately read sibling sources).
- Given a relative path that resolves outside the worktree via `..`, when the fence
  evaluates it, then resolution happens against the session cwd before the verdict
  (traversal does not evade the fence).
- Given a malformed/empty tool payload on stdin, when the fence runs, then it allows and
  exits 0 (fail-open for unparseable input is the existing guard idiom — the deterministic
  backstop is TR-1..3) and never crashes the session.

### Done When
- [ ] Fence script has real-binary smoke tests: invoked as bash with real JSON payloads on
      stdin for every allow/block case above (not just unit-level argv assertions).
- [ ] Block message names the attempted path, the worktree root, and the rule that fired.
- [ ] A Bash read-only reference to the harness root is demonstrably allowed in tests.

---
name: finish
description: "Use when implementation is complete and all tests pass. Verifies with fresh evidence, presents completion options (merge, PR, keep, discard), and records the outcome."
enforcement: gating
phase: ship
standalone: true
requires: []
---

## Purpose

Ensures that completion claims are backed by fresh evidence — not cached results or assumptions.
Presents structured options for integrating the work and records the selected outcome.

## Practices

### 1. Fresh Verification

**GATE 0 — Refuse to finish a tree that is mid-rebase or mid-merge.** This is the
FIRST thing you do, before the test suite or anything else. Run `git status` and
check for an in-progress rebase/merge:

- `git status` reports `rebase in progress` / `You are currently rebasing` / `You
  have unmerged paths`, **or**
- a rebase state directory actually exists — check with `test -d` on BOTH:

  ```bash
  test -d "$(git rev-parse --git-path rebase-merge)" && echo REBASE-IN-PROGRESS
  test -d "$(git rev-parse --git-path rebase-apply)" && echo REBASE-IN-PROGRESS
  ```

  ⚠️ `git rev-parse --git-path rebase-merge` prints the path UNCONDITIONALLY,
  whether or not the directory exists. Output from `rev-parse` alone is NOT
  evidence of a rebase — only `test -d` on that path is. Treating the printed
  path as "rebase in progress" is a false positive that wrongly blocks finish
  (issue #634). **Or**
- `git diff --name-only --diff-filter=U` is non-empty (unresolved conflicts).

If ANY of these hold, **STOP immediately**: do NOT run the test suite, do NOT push,
do NOT create a PR, and do NOT write `.pipeline/finish-choice`. Finishing here would
push a detached, half-rebased branch (or grind for many minutes on a tree it can
never ship). This is **not** a finishable state — the rebase must be completed/
resolved first (the conductor's rebase step or `/rebase` does that). Report the
blocker plainly and end. Leaving no `finish-choice` lets the conductor re-evaluate
and HALT for resolution rather than ship broken work.

**GATE: No completion claims without running verification commands NOW.**

Do NOT trust:
- Test results from earlier in the session
- "It was passing last time I checked"
- Agent reports from subagents (verify their claims independently)
- A hand-read evidence file without recalculating its content fingerprint

Run these commands and read the full output:

1. **Aggregate suite proof** — From the project root, run the repository's
   configured aggregate verifier. The verifier recalculates freshness and
   produces one of two successful results:
   - `EXECUTED` — evidence was missing or stale, so the project suite launched
     exactly once and recorded a current PASS.
   - `REUSED` — current PASS evidence matched the verification inputs, so the
     project suite did not launch.

   Read the complete verifier output. Do not run the project suite command
   directly or inspect an evidence sidecar as a substitute; the configured
   verifier owns both the run-versus-reuse decision and the evidence update.
2. **Git status** — Check for uncommitted files, untracked files, unexpected changes.
3. **Linting/type checking** — If the project has linters or type checkers, run them.

All must pass before proceeding.

**When the configured aggregate verifier exits non-zero — stop before completion choices:**

**STOP before presenting options, executing any choice, pushing, creating a PR,
or writing `.pipeline/finish-choice`.** Report the actionable, redacted CLI
failure output. The shared verifier retains its canonical failure in
`.pipeline/test-suite-evidence.json`.

1. **Flake-check executable test failures only**: if the CLI output identifies
   failing specs, re-run JUST those specs once. A failure that passes on re-run,
   or that is plainly transient infra (DB not up, port in use, network timeout),
   is a flake — note it, then run the configured aggregate verifier again so
   only that verifier can record the replacement PASS. For configuration, preflight,
   launch, or timeout failures, do not invent a failing-spec rerun; use the
   verifier's blocking evidence.
2. **Real test failures remain** → this is NOT a finishable state:
   - Write **`.pipeline/test-failures.md`** (run evidence — overwrite any prior
     one): one section per failing test file with the test names, a one-line
     failure reason each, and your read on the cause — an implementation bug, or
     tests lagging an intentional contract change (say which contract/commit).
     This file is what the conductor hands `/remediate` to route the fix
     autonomously; without it the daemon can only HALT blind.
   - Do NOT push, do NOT create a PR, and do NOT write `.pipeline/finish-choice`
     (the missing marker is how the conductor knows finish refused).
   - Report the blocker plainly and end.

### 1b. Push Direction — Canonical Is Proven, Not Assumed

**GATE: Prove remote staleness before force-pushing — never `git pull` after a sanctioned rebase.**

The daemon's finish-time rebase (ADR-001/9.0) creates a common scenario: your branch
has been rebased on HEAD, but `origin/<branch>` still holds the pre-rebase commits.
This causes `git status` to report "diverged from / behind origin/<branch>" — a normal,
intended state, not a blocker.

**Before pushing this state, you MUST prove that `origin/<branch>` is stale:**

1. **Fast path — merge-base proof:** Run:
   ```
   git merge-base --is-ancestor origin/<branch> ORIG_HEAD
   ```
   If this exits 0 (true), `origin/<branch>` is an ancestor of your pre-rebase HEAD.
   This proves the remote is behind and safe to overwrite.

2. **Fallback — reflog proof:** If merge-base is unavailable or fails, check the reflog:
   ```
   git reflog | grep -E "rebase \(finish\)"
   ```
   Note: git writes this reflog entry as `rebase (finish): returning to refs/heads/<branch>`
   — parenthesized, no colon after "rebase" — never as `"rebase: finish"`. A literal grep for
   `"rebase: finish"` never matches real git output and silently defeats this fallback proof
   (jstoup111/ai-conductor#587); use the pattern above.

   If you see a "rebase (finish):" entry, the daemon rebased this branch as part of
   completion. The pre-rebase state exists in ORIG_HEAD and the reflog. This proves
   staleness.

**Once proof is obtained, reconcile with force-with-lease:**

```
git push --force-with-lease origin <branch>
```

This is safe because `--force-with-lease` aborts if the remote has new commits you
don't know about — you've already verified it only has pre-rebase ones.

**Explicitly forbidden — never do these:**
- `git pull` — pulls `origin/<branch>` and merges; creates conflicts or undoes the rebase
- `git fetch && git rebase origin/<branch>` — same effect, undoing the rebase
- `git merge origin/<branch>` — creates a merge commit that contradicts the rebase

All three corrupt the finish-time rebase and break the feature's shipped state.

**No new marker is introduced.** The `.pipeline/finish-choice` semantics are unchanged
(still one of: `pr`, `merge-local`, `keep`, `discard`). This rule applies to all
completion paths: whether you merge locally, push a PR, or keep the branch, the
staleness proof and force-with-lease discipline must hold.

**Failed Staleness Proof — Foreign Commits Detected**

If the staleness proof fails — i.e., `git merge-base --is-ancestor origin/<branch> ORIG_HEAD`
exits non-zero AND no reflog "rebase (finish):" entry exists — then another writer has pushed
real commits to `origin/<branch>` after your pre-rebase HEAD. This means `origin/<branch>`
is NOT an ancestor of your work; it has diverged.

**GATE: STOP immediately — do NOT force-push.** Even if `--force-with-lease` would
succeed (i.e., the remote head hasn't changed since the last fetch), a passing lease
does NOT authorize the push when the staleness proof failed. The proof's failure is
the blocking signal: real, authored work exists on the remote that you do not have.
Forcing would lose that work.

When this gate triggers:
- Do NOT attempt any push (not even `--force`, `--force-with-lease`, or `push --set-upstream`)
- Do NOT pull, rebase, or merge `origin/<branch>`
- Do NOT create or update a PR
- Do NOT write `.pipeline/finish-choice`
- Report the foreign commits plainly to the user:
  ```
  git log HEAD..origin/<branch> --oneline
  ```
  This shows what work exists on the remote that you don't have.
- End the skill — the conductor's failed-step handling will HALT for human decision.

**Failed Lease — Remote Changed After Last Fetch**

If `git push --force-with-lease` exits non-zero, the remote has moved. This can happen
even if the staleness proof passed: the remote was behind at the time of the proof, but
a concurrent writer pushed new commits between your proof check and your push attempt.

**GATE: STOP immediately — do NOT retry with `--force`.** The lease failure is an
explicit signal that the remote state changed. Pushing with `--force` (without lease)
would overwrite the remote writer's work — the exact scenario force-with-lease is
designed to prevent.

When this gate triggers:
- Do NOT attempt any push (not `--force`, not `push --set-upstream`)
- Do NOT create or update a PR
- Do NOT write `.pipeline/finish-choice`
- Report the lease failure plainly to the user with the branch and the push command output:
  ```
  Branch: <branch>
  Expected remote head: <expected-oid>
  Actual remote head: <actual-oid> (obtained from `git ls-remote origin <branch>`)
  ```
- End the skill — the conductor's failed-step handling will HALT for human review and decision.

### 2. Verify Against Stories and ADRs

Cross-reference the completed work against the stories in `.docs/stories/`:
- Are ALL happy path criteria implemented and tested?
- Are ALL negative path criteria implemented and tested?
- If any are missing, this is NOT complete — go back to the appropriate BUILD skill.

**ADR compliance check:**
- Verify no DRAFT ADRs remain in `.docs/decisions/` — all must be APPROVED
- Verify implementation does not contradict any APPROVED ADR
- If architecture-review had "APPROVED WITH CONDITIONS", verify all conditions are met
- BLOCK if any ADR violation is detected — the ADR must be superseded or the code changed

### 3. Review Changes

Before presenting options, show the user what was built so they can review:

1. Determine the base branch (`main`, `master`, or `develop`)
2. Show a summary: `git diff --stat <base>..HEAD` and `git log --oneline <base>..HEAD`
3. Ask the user if they want to see the full diff before deciding
4. If yes, show the full diff (use Agent for very large diffs to avoid context overflow)

Do not skip this step. The user must have the opportunity to review before choosing.

### 4. Present Options

After review, present these options to the user:

```
Feature implementation complete. All tests pass. Options:

1. Merge locally     — Merge this branch into the base branch
2. Push & create PR  — Push the branch and create a pull request
3. Keep as-is        — Leave the branch for later; no merge or PR
4. Discard           — Delete the branch and all changes (requires confirmation)
```

Wait for the user to choose. Do not assume.

**Unattended/auto mode:** If you are running in print mode (no user attached) or
`--auto`, do NOT prompt — decide deterministically and **act** (do not merely
describe the choice):
- If the repo has a configured git remote and `gh` is authenticated → **Option 2:
  Push & PR** (never merge). **Before recording**, verify using the §5 Option 2
  STOP gate — if the push did not land or the PR does not exist, do NOT run
  `finish-record`; halt for human review.
- Otherwise (no remote, or `gh` unavailable/unauthenticated) → **Option 3: Keep
  as-is** — leave the work committed on the branch.

**A PR finish is one ordered shipment sequence.** Derive `<slug>` from the active
`.docs/plans/<slug>.md`. After you have created or reused the PR **inline** (§5a — never
by invoking another skill), run every command below from the feature worktree, in order,
without ending your turn in between:

```
conduct-ts finalize-changelog-pr --pr-url <PR_URL>
if ! git diff --quiet -- CHANGELOG.md; then
git add CHANGELOG.md
git commit -m "docs(changelog): link implementation PR"
git push  # focused changelog finalization push; follow §1b's safe-push rules
git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>
fi
conduct-ts shipped-record --slug <slug> --pr <PR_URL>
git cat-file -e "HEAD:.docs/shipped/<slug>.md"
git push  # durable shipped-record push; follow §1b's safe-push rules
git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>
conduct-ts finish-record --choice pr --pr-url <PR_URL> --pipeline-dir /abs/path/to/.pipeline
```

When no implementation-PR token exists, finalization is a successful no-op. `CHANGELOG.md`
remains unchanged; do not create a changelog commit or push; continue with the existing shipped-record sequence.

If finalization, the focused commit, or its push fails, **STOP immediately.**
Do NOT run `conduct-ts shipped-record`.
Do NOT run `conduct-ts finish-record`.
Do NOT write `.pipeline/finish-choice` manually.
A failed focused-push ancestry check has the same STOP contract. Do not hand-write any substitute
shipment record.

`shipped-record` is historically best-effort and may warn while exiting zero, so its exit code
alone is not evidence. The `git cat-file` and post-push ancestry checks are mandatory. If either
fails, STOP: do not run `finish-record`, do not write local completion markers, and do not report
the feature shipped.

For Keep (no remote, or `gh` unavailable/unauthenticated), leave the work committed on the branch
and run:

```
conduct-ts finish-record --choice keep --pipeline-dir /abs/path/to/.pipeline
```

The final act after the durable PR record is verified is always `conduct-ts finish-record`. It is
the single source of truth for the `.pipeline/finish-choice` marker and (for `pr`) `state.pr_url`;
do not hand-write these files yourself in auto mode. Use the absolute pipeline directory supplied
in the step's system prompt.

`finish-record` itself re-verifies the PR exists and that HEAD was pushed
before writing anything — so it is safe to run as the terminal step even if
your own verification was imperfect; it fails closed (exit 1, nothing
written) rather than recording a false completion.

**Refusal contract:** any gate above (GATE 0, fresh-verification failures, push
staleness/lease failures, the §5 Option 2 STOP gate) that says STOP means do
NOT run `conduct-ts finish-record` in that pass — an absent `finish-choice`
marker IS the refusal signal the conductor watches for. Never write the marker
by hand to paper over a blocked gate.

The conductor's finish completion gate (artifacts.ts) requires a fresh
`.pipeline/finish-choice` (and, for `pr`, `state.pr_url`); without it the
feature is left "complete-but-unshipped" and the loop stalls.

**Daemon mode — write markers to the worktree.** The feature's `.pipeline` lives
in the feature worktree. Write `finish-choice` and the `pr_url` in
`conduct-state.json` to the **absolute worktree `.pipeline` path** supplied in
the step's system prompt. If a PR for the branch already exists, reuse it
(`gh pr view --json url -q .url`) rather than failing.

**Reusing a PR never means reusing its body.** A reused PR — especially one born
as a `needs-remediation` halt PR — must still get a real, freshly authored title and
body before `finish-record`. Author it inline per §5a and update the existing PR in
place with `gh pr edit`; do NOT skip straight to `finish-record` on a PR whose body is
still halt boilerplate or an engine-generated placeholder, and do NOT delegate the
rewrite to another skill. The shipped body is ALWAYS the
plain PR template (`## Why` / `## What Changed` / `## Testing`, plus the
`Closes #N` reference) and reads exactly like a clean first-pass finish produced
it — halt history, remediation notes and recovery narrative go in a PR **comment**
(`gh pr comment`), never in the body. The engine posts that halt-history comment
for you.

The finish completion gate enforces this: it reads the PR's presentation BEFORE
applying any deterministic repair, and refuses once with a reason naming the
`/pr` skill and a real templated body (that wording names the body *contract*; satisfy it
inline per §5a rather than by invoking the skill). That kickback is bounded to a single attempt per PR
(recorded in `.pipeline/pr-body-regen-attempt.json`); if the body is still
placeholder/halt content on the next pass, the engine applies its last-resort
floor so the feature converges — but a floored body is a failure mode, not the
intended path.

### 5. Execute Choice

After executing any choice, **record the outcome** so the conductor's
completion gate can verify the step actually did something:

- **Auto mode (`pr` or `keep`)**: for `pr`, first complete and verify the durable shipped-record
  sequence above. Then record the outcome by running
  `conduct-ts finish-record --choice <pr|keep> [--pr-url <url>] --pipeline-dir
  /abs/path/to/.pipeline` (see §4) — this is the final act, and it writes both
  `.pipeline/finish-choice` and, for `pr`, `state.pr_url` atomically after
  re-verifying the PR/push. Do NOT hand-write these files yourself when
  running auto/unattended.
- **Interactive mode (Options 1–4, user chose manually)**:
  - **Option 2 (PR)**: after the durable shipped-record and PR/push STOP gates pass, the final action MUST
    be `conduct-ts finish-record --choice pr --pr-url <url> --pipeline-dir
    /abs/path/to/.pipeline`. Do not write `finish-choice` or `pr_url` by hand:
    the recorder verifies the PR and push, then writes both records plus the
    terminal `.pipeline/DONE` marker.
  - **Other outcomes**: write the chosen option to
    `.pipeline/finish-choice` as one of the literal strings `merge-local`,
    `keep`, or `discard`, as described below.

Without one of these, the conductor will treat the step as failed and re-run
it, even if the skill itself reports success.

**Refusal contract:** if any gate blocked before reaching this step (see the
refusal contract in §4), do NOT write `finish-choice` by hand and do NOT run
`finish-record` — the absent marker is itself the refusal signal the
conductor reads.

**Option 1: Merge locally**
- **Shipped record (before the merge):** on the feature branch, run
  `conduct-ts shipped-record --slug <slug> --pr local` (where `<slug>` is the
  plan-file stem, `.docs/plans/<slug>.md`). It commits `.docs/shipped/<slug>.md`
  on the branch so the merge lands the code and the shipped-fact atomically.
  Because the command may warn while exiting zero, verify the record is committed with
  `git cat-file -e "HEAD:.docs/shipped/<slug>.md"`. If verification fails, STOP before merging
  or writing `merge-local`.
- Determine the base branch (main, master, develop)
- Merge the feature branch
- Run tests again after merge to verify no merge issues
- Delete the feature branch after successful merge
- Write `merge-local` to `.pipeline/finish-choice`

**Option 2: Push & PR**
- **Author and publish the PR INLINE — never delegate.** Do the push and the
  `gh pr create`/`gh pr edit` yourself, in this same turn, using §5a below. Do NOT
  invoke the `/pr` skill (or any other skill/subagent) to do it: handing the work to
  another skill ends this turn, and the finish step then dies without ever running
  `conduct-ts finish-record`, leaving `.pipeline/finish-choice` unwritten and the
  feature complete-but-unshipped. `skills/pr/SKILL.md` remains the reference for the
  title/body contract; §5a inlines everything finish needs from it.
- **Engine Behavior — Halt-PR Rehabilitation:** After the agent creates or updates the PR,
  the conductor automatically rehabilitates any reused halt PR:
  - Removes the `needs-remediation` label (if present)
  - Rewrites the title to remove `needs-remediation:` prefix (if present)
  - Injects or updates the `Closes` reference to match the actual implementation
  - Flips the PR from draft to ready (if it was drafted)
  
  This automation runs before the completion gate checks the PR state
  (adr-2026-07-03-halt-pr-rehabilitation-at-finish), so the finish gate only
  succeeds if the PR's final title does NOT start with `needs-remediation:`.

#### 5a. Inline PR Authoring — Do This Yourself

Run all of the following in the current turn. Do not spawn a subagent and do not
invoke another skill for any of it.

1. **Gather context** (base branch, log, stat, diff):
   ```bash
   git remote show origin | grep 'HEAD branch'
   git log --oneline <base>..HEAD
   git diff --stat <base>..HEAD
   git diff <base>..HEAD
   ```
   If the diff is too large to read whole, read it by path groups with
   `git diff <base>..HEAD -- <paths>` — still inline. Also skim `.docs/specs/*.md`
   and `.docs/stories/*.md` for the "why".
2. **Pre-push checks.** Reuse the aggregate-verifier PASS from §1 — do NOT relaunch
   the project's aggregate test command here. Run the project's linter and type
   checker if it has them; fix failures before pushing.
3. **Write the title.** Under 72 characters, imperative mood, specific, no trailing
   period. Follow any `### PR Title Format` convention in the project's repo
   instruction file if one exists.
4. **Write the body** using exactly this template — nothing else:
   ```markdown
   ## Why

   1-3 sentences of motivation.

   ## What Changed

   ### [Logical area]
   - What changed and why (never a file-by-file listing)

   ## Testing

   How it was actually verified.

   ## Notes for Reviewers (optional)
   ```
   Plus the `Closes #N` reference. Never paste planning artifacts, halt narrative,
   remediation prose, or "rehabilitated from…" history into the body — that goes in a
   `gh pr comment`, and the engine posts it for you.
5. **Push**, following §1b's staleness-proof and force-with-lease rules:
   ```bash
   git push -u origin HEAD
   ```
   On a non-fast-forward rejection, prove staleness (§1b) and then
   `git push --force-with-lease -u origin HEAD`. If the staleness proof or the lease
   fails, §1b's STOP contract applies: no push, no PR, no `finish-choice`.
6. **Create or update the PR:**
   ```bash
   gh pr view --json number,url 2>&1   # does one already exist?
   gh pr create --title "<title>" --body "$(cat <<'EOF'
   <body>
   EOF
   )"
   # or, if a PR already exists (including a reused halt PR):
   gh pr edit --title "<title>" --body "$(cat <<'EOF'
   <body>
   EOF
   )"
   ```
   A reused PR always gets a freshly authored title and body — never keep halt
   boilerplate or an engine-generated floor body (`<!-- conductor:pr-body-floor -->`).
7. **Capture the PR URL** and continue straight into the STOP gate below. Do not end
   your turn between creating the PR and running `conduct-ts finish-record`.

If `gh pr create`/`gh pr edit` or the push fails for an environmental reason (no
network, sandbox write-fence, unauthenticated `gh`), that is a genuine blocker: report
it plainly, do NOT write `.pipeline/finish-choice`, and end. The absent marker is the
refusal signal.

#### STOP Gate: Verify Push + PR Before Recording Choice

Before running `finish-record` for the PR choice, verify both the PR and the push:

1. **PR exists and has a non-empty URL:**
   ```
   gh pr view --json url -q .url
   ```
   If this returns empty or fails, the PR does not exist or is inaccessible.

2. **The branch was pushed (remote-tracking ref contains HEAD):**
   ```
   git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>
   ```
   If this exits non-zero, `HEAD` is not an ancestor of the remote tracking ref —
   the push did not land, or the remote never updated locally (stale tracking ref).

**If EITHER check fails, STOP immediately.** Do NOT run `finish-record`, write
`finish-choice=pr`, or write `pr_url`.
Explain what failed and what to do next:

- **If the PR check failed:** "The PR URL is empty or inaccessible. Verify `gh pr view`
  works and the PR exists on GitHub. Then retry `/finish`."
- **If the push check failed:** "The branch was not pushed, or the remote tracking ref
  is stale. Run `git push --force-with-lease origin <branch>` to push the branch,
  then retry `/finish`."

**In daemon mode:** a missing `finish-choice` marker leaves the completion gate unsatisfied
(Story 1), routing to HALT for human review.

- **Changelog PR-link finalization (immediately after the PR/push STOP gate passes,
  before the shipped record):** on the feature branch, run
  ```
  conduct-ts finalize-changelog-pr --pr-url <PR_URL>
  ```
  using the exact PR URL confirmed by the STOP gate above. This is unconditional —
  run it for every outcome that reaches this point (auto mode and interactive Option 2
  alike), not only when you believe a placeholder is present; the command is a
  no-op when `CHANGELOG.md` has no `{{IMPLEMENTATION_PR}}` token, and this is one of
  the two valid successful outcomes:
  - **Token replaced:** `git diff --quiet -- CHANGELOG.md` is non-zero (the file
    changed). Commit and push it:
    ```
    git add CHANGELOG.md
    git commit -m "docs(changelog): link implementation PR"
    git push  # follow §1b's safe-push rules
    git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>
    ```
  - **No-op (no token present):** `git diff --quiet -- CHANGELOG.md` is zero (no
    change). Do not create a changelog commit or push; continue.
  Before moving on, verify no unsubstituted token remains:
  ```
  grep -c '{{IMPLEMENTATION_PR}}' CHANGELOG.md
  ```
  This MUST print `0` (or the file must not contain the string at all, which greps
  as exit 1 with no output — either is acceptable, a nonzero count is not). If the
  count is nonzero, or `finalize-changelog-pr` itself fails, **STOP**: do NOT run
  `conduct-ts shipped-record` or `conduct-ts finish-record`, and do NOT write
  `finish-choice` by hand. A CHANGELOG entry with a literal `{{IMPLEMENTATION_PR}}`
  token merged to the base branch is not a finishable state.
- **Shipped record (before handing the PR to the human):** on the feature
  branch, run `conduct-ts shipped-record --slug <slug> --pr <PR_URL>` (where
  `<slug>` is the plan-file stem, `.docs/plans/<slug>.md`), then push using
  §1b's safe-push rules so the record commit rides the PR branch — the human
  merge lands the code and the shipped-fact atomically. Verify both
  `git cat-file -e "HEAD:.docs/shipped/<slug>.md"` and
  `git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>` after the push.
  If either fails, STOP without running `finish-record`; ignored local markers are not a
  substitute for the durable record.
- Return the PR URL to the user
- As the final action, run:
  ```
  conduct-ts finish-record --choice pr --pr-url <PR_URL> --pipeline-dir /abs/path/to/.pipeline
  ```
  This is the only writer for `pr_url`, `finish-choice=pr`, and the terminal
  `.pipeline/DONE` marker. If it fails, do not hand-write a substitute record.

**Option 3: Keep as-is**
- No action needed
- Remind the user which branch they're on
- Write `keep` to `.pipeline/finish-choice`
- Never run `conduct-ts shipped-record` for `keep` (or `discard`) — nothing
  ships, so no `.docs/shipped/` record may exist for the slug

**Option 4: Discard**
- Require explicit confirmation: "Are you sure? This deletes all work on this branch."
- If confirmed: checkout base branch, delete feature branch, write `discard` to
  `.pipeline/finish-choice`
- If not confirmed: return to options (do NOT write the marker)

### 6. Worktree Retention Boundary

Finish is never a worktree deletion owner.
Daemon/auto Push & PR outcomes retain the feature worktree.
Finish has no worktree lifecycle authority.
Only the engine mergeable sweep owns worktree cleanup after the shipped record is proven on `origin/<default>`.

After executing the chosen option:
- Suggest next step: `/manual-test` → `/retro`

## Verification

- [ ] GATE 0: checked `git status` first — confirmed NO rebase/merge in progress and no unmerged paths (else stopped without pushing/PR/`finish-choice`)
- [ ] The configured aggregate verifier ran now — output read; success was `EXECUTED` or `REUSED`
- [ ] If the verifier exited non-zero: applicable flake-check performed; real test failures recorded in `.pipeline/test-failures.md`; NO choices presented and NO `finish-choice` written
- [ ] Git status clean (no unexpected uncommitted changes)
- [ ] Outcome recorded via `conduct-ts finish-record --choice <c> [--pr-url <url>]` — the
      completion gate reads `.pipeline/finish-choice` AND the recorded PR URL; a choice of
      `pr` without a recorded URL fails the gate
- [ ] If Option 2 (PR): the push and `gh pr create`/`gh pr edit` were performed INLINE in
      this turn (§5a) — no skill invocation or subagent was used to author or publish the
      PR, and the turn did not end between creating the PR and `conduct-ts finish-record`
- [ ] Reused halt-PR verified for engine rehabilitation: PR title does not start with
      `needs-remediation:` and does not carry the `needs-remediation` label (engine
      automatically removes/rewrites these after the PR is created/updated; if title still contains
      `needs-remediation:`, halt-PR rehabilitation failed — check conductor logs)
- [ ] HEAD pushed and present at the recorded PR's head (push evidence — the gate verifies
      `refs/remotes/origin/<branch>` contains HEAD)
- [ ] PR/merge-local shipment has `.docs/shipped/<slug>.md` committed at HEAD; PR shipment pushed that exact HEAD before `finish-record`
- [ ] If Option 2 (PR): `conduct-ts finalize-changelog-pr --pr-url <url>` ran (unconditionally, for
      every PR outcome) and `grep -c '{{IMPLEMENTATION_PR}}' CHANGELOG.md` confirms no unsubstituted
      token remains at HEAD before `shipped-record`/`finish-record` ran
- [ ] Diverged branch: staleness proven (ORIG_HEAD ancestry / reflog `rebase (finish):` entry) before `--force-with-lease` (never pulled)
- [ ] On unproven staleness (foreign commits): stopped with no force of any kind
- [ ] On lease failure: stopped with no plain `--force`, no pull, no `finish-choice`
- [ ] All story acceptance criteria verified as covered
- [ ] Changes shown to user for review before options presented
- [ ] Option presented to user and their choice executed
- [ ] `.pipeline/finish-choice` written with the chosen outcome
- [ ] If Option 2 (PR): `pr_url` written to `.pipeline/conduct-state.json`
- [ ] Daemon/auto Push & PR retained the feature worktree for the engine mergeable sweep
- [ ] Manual-test suggested as next step

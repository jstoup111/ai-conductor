---
name: pr
description: "Use when creating or updating a pull request. Analyzes the full diff against the base branch, writes a concise title and structured body, and creates or updates the PR via gh."
enforcement: advisory
phase: ship
standalone: true
requires: []
---

## Purpose

Creates high-quality pull requests by analyzing the actual changes, not parroting planning
artifacts. The PR should tell a reviewer what changed, why, and how to verify it — nothing more.

## Practices

### 1. Gather Context

Collect everything needed to understand the PR. Run these in parallel:

```bash
# Determine base branch (main or master)
git remote show origin | grep 'HEAD branch'

# Full commit log for this branch
git log --oneline <base>..HEAD

# Stat summary of all changes
git diff --stat <base>..HEAD

# Full diff for analysis (use Agent if very large)
git diff <base>..HEAD
```

Also check for harness artifacts that provide motivation context:
- `.docs/specs/*.md` — design docs (the "why")
- `.docs/stories/*.md` — acceptance criteria
- `.pipeline/conduct-state.json` — feature name if available

### 2. Analyze Changes

Read the diff carefully and categorize what changed:

- **New files** — what do they introduce?
- **Modified files** — what behavior changed?
- **Deleted files** — what was removed and why?
- **Migrations** — any schema changes?
- **Tests** — what's covered?
- **Config/infra** — docker, CI, dependencies?

Group changes by logical area (e.g., "Notifications module", "Auth projection", "Alembic migrations"),
not by file path.

### 3. Write the Title

**Check for project conventions first:**

Look for PR title format conventions in the project's `CLAUDE.md` under a
`### PR Title Format` heading (or similar). Projects may specify their preferred format
(conventional commits, ticket prefixes, etc.). If found, follow those conventions instead
of the defaults below.

**Common project convention examples:**
- Conventional Commits: `feat: add notification channel`, `fix(auth): resolve token expiry`
- Ticket prefix: `[PROJ-123] Add notification channel`
- Type/scope: `feat(notifications): add in-app channel`

**Default rules (when no project convention is defined):**
- **Under 72 characters** — hard limit, no exceptions
- **Imperative mood** — "Add notifications module" not "Added" or "Adding"
- **Specific** — "Add in-app notification channel with persistence" not "Update notifications"
- **No periods** at the end
- If the PR does multiple things, summarize at the highest useful level

Good: `Add Alembic migration baseline and register notifications router`
Bad: `Generate a full Alembic migration baseline for all existing database tables in the project...`

### 4. Write the Body

Use this structure. Every section must earn its place — omit sections that add no value.

```markdown
## Why

1-3 sentences explaining the motivation. What problem does this solve? Why now?
Link to design doc or issue if relevant.

## What Changed

Organized by logical area, not by file. Each area gets a brief explanation of what
changed and why. Use bullet points.

### [Area Name] (e.g., "Alembic Migrations")
- Created baseline migrations for all 11 modules (X tables total)
- Consolidated users + notifications into single migration for FK ordering

### [Area Name] (e.g., "Notifications Module")
- Registered notifications router in main.py (was defined but never mounted)
- Added PgInAppChannel for persistent notification storage

## Testing

How was this verified? Be specific:
- `pytest` — N tests passing, M new
- Manual verification steps taken
- Migration tested: `alembic upgrade head` on clean DB

## Notes for Reviewers (optional)

Anything a reviewer should pay attention to:
- Areas of uncertainty
- Trade-offs made
- Things intentionally left out of scope
```

**Anti-patterns to avoid:**
- Restating the title in the body
- Listing every file changed (the diff shows that)
- Pasting raw planning artifacts (stories, specs) into the body
- Generic filler ("This PR implements the feature as described in the plan")
- Bullet points that just name files without explaining what changed

### 5. Pre-Push Verification

**GATE: Do not push until all checks pass locally.**

Before pushing, run the project's full verification suite:

1. **Test suite** — `npm test`, `bundle exec rspec`, `pytest`, or equivalent. Must pass.
2. **Linter** — `npm run lint`, `standardrb`, `ruff check .`, or equivalent. Must pass.
3. **Type checker** — `npx tsc --noEmit`, `mypy .`, or equivalent (if project uses one). Must pass.

If any check fails, fix the issues and re-run. Do NOT push with known failures — this wastes CI minutes and blocks the PR.

### 6. Create or Update the PR

Check if a PR already exists for this branch:

```bash
gh pr view --json number,url 2>&1
```

**If no PR exists:**

```bash
git push -u origin HEAD
```

**Handle non-fast-forward rejection:**

If `git push -u origin HEAD` is rejected as non-fast-forward (output contains "rejected"
or "failed to push some refs"), your branch has been rebased on HEAD but
`origin/<branch>` still holds pre-rebase commits. This is a normal, intended state
after a sanctioned rebase — not a blocker.

**Before force-pushing, prove `origin/<branch>` is stale:**

1. **Fast path — merge-base proof:** Run:
   ```
   git merge-base --is-ancestor origin/<branch> ORIG_HEAD
   ```
   If this exits 0 (true), `origin/<branch>` is an ancestor of your pre-rebase HEAD.
   This proves the remote is behind and safe to overwrite.

2. **Fallback — reflog proof:** If merge-base fails, check the reflog:
   ```
   git reflog | grep -E "rebase \(finish\)"
   ```
   Note: git writes this reflog entry as `rebase (finish): returning to refs/heads/<branch>`
   — parenthesized, no colon after "rebase" — never as `"rebase: finish"`. A literal grep for
   `"rebase: finish"` never matches real git output and silently defeats this fallback proof
   (jstoup111/ai-conductor#587); use the pattern above.

   If you see a "rebase (finish):" entry, the branch was rebased as part of completion.
   The pre-rebase state exists in ORIG_HEAD and the reflog. This proves staleness.

**Once proof is obtained, reconcile with force-with-lease:**

```bash
git push --force-with-lease -u origin HEAD
```

This is safe because `--force-with-lease` aborts if the remote has new commits you
don't know about — you've already verified it only has pre-rebase ones.

**Explicitly forbidden — never do these:**
- `git pull` — pulls `origin/<branch>` and merges; creates conflicts or undoes the rebase
- `git fetch && git rebase origin/<branch>` — same effect, undoing the rebase
- `git merge origin/<branch>` — creates a merge commit that contradicts the rebase

All three corrupt the rebase and prevent the PR branch from reflecting the intended state.

**Failure handling:**
- **Staleness proof failed:** If merge-base exits non-zero and no "rebase (finish):" reflog
  entry is found, foreign commits exist on `origin/<branch>`. Stop, report the failure,
  and do NOT push (manual resolution required).
- **Lease failure:** If `--force-with-lease` fails with a rejection error, the remote
  has moved past what was proven stale. Stop and report. Never use plain `--force`.

**After successful push:**

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

**If PR already exists:**

```bash
gh pr edit --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

After creating/updating, output the PR URL.

**Engine Behavior — Halt-PR Rehabilitation (automated after PR is created/updated).**
When you create or update a PR that replaces a reused halt PR (one with title
prefixed `needs-remediation:` or the `needs-remediation` label), your job is to
generate a fresh title and body as described in §3 and §4 above. You do NOT need
to run `gh pr edit` to remove the halt signal or clear the label yourself — the
conductor's finish step automatically rehabilitates the PR after you complete:

- The engine removes the `needs-remediation` label (if present)
- The engine rewrites the title to remove `needs-remediation:` prefix (if stale)
- The engine injects or updates the `Closes` reference to match the implementation
- The engine flips the PR from draft to ready (if it was drafted)

This means your fresh title/body (from §3 and §4) and the engine's rehabilitation
happen in sequence. The finish completion gate verifies the final PR state does NOT
start with `needs-remediation:` (adr-2026-07-03-halt-pr-rehabilitation-at-finish).

### 7. Verify

- [ ] Title is under 72 characters
- [ ] Title uses imperative mood
- [ ] Body "Why" section explains motivation, not just what
- [ ] Body "What Changed" is organized by logical area
- [ ] No file-by-file listing in the body
- [ ] No pasted planning artifacts or boilerplate
- [ ] Testing section describes actual verification performed
- [ ] If `git push -u origin HEAD` was rejected as non-fast-forward: staleness proof (merge-base or reflog) ran and passed
- [ ] If proof passed and `--force-with-lease` was required: push succeeded and no plain `--force` was used
- [ ] If staleness proof failed or `--force-with-lease` failed: push was not retried, failure was reported
- [ ] PR was created/updated successfully
- [ ] PR URL displayed to user

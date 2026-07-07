# Evidence Backfill Recovery Runbook

## Overview

This runbook describes how operators can recover parked features that have partial audit-trail evidence. It applies when a feature branch has reached the evidence gate but only some tasks have audit-trail Evidence trailers recorded in their commit history.

**When to use this runbook:**
- A feature is parked because the evidence gate has unresolved tasks
- Some tasks on the branch have Evidence trailers (satisfied-by SHA), others do not
- The satisfying work for the unresolved tasks exists on the branch but lacks audit-trail documentation
- You need to backfill missing Evidence trailers to complete the audit trail

**What this runbook does:**
- Guides you through locating the commits that satisfy each unresolved task
- Provides commands to append no-op commits with proper Evidence trailers
- Explains the refusal rules and how to handle cases where work cannot be verified

---

## Per-Feature Recovery Procedure

### Step 1: Refresh Your Worktree

Update your local branch to match the remote and resolve any conflicts:

```bash
git fetch --all
git rebase origin/main
```

If rebase conflicts occur, resolve them according to your team's conflict resolution policy.

### Step 2: Run the Evidence Gate

Trigger the evidence gate to list all unresolved tasks on the feature branch:

```bash
conduct daemon build <feature-name>
```

This will output the set of unresolved tasks — tasks that lack complete Evidence trailers.

### Step 3: For Each Unresolved Task

For each task listed as unresolved, perform the following steps:

#### a. Verify the Work Exists

Search the branch history for commits related to this task. Use the task ID and related story identifiers:

```bash
git log --oneline --grep="Task: <task-id>" origin/main..<branch-name>
git log --oneline --grep="Story: <story-id>" origin/main..<branch-name>
```

Examine the commit messages to confirm which commit satisfies this task. Do not proceed unless you can clearly identify the satisfying commit.

#### b. Identify the Branch-Local SHA

Once you have identified the satisfying commit, capture its full SHA:

```bash
git log --format="%H %s" origin/main..<branch-name> | grep -E "(Task: <task-id>|Story: <story-id>)"
```

The 40-character SHA on the left is what you need for the next step. Verify this commit actually exists on your branch:

```bash
git show <sha>
```

#### c. Append a No-Op Commit with Evidence Trailer

Create an empty commit with the Evidence trailer that documents which commit satisfies this task:

```bash
git commit --allow-empty -m "chore(evidence): backfill task <task-id>" \
  -m "Task: <task-id>" \
  -m "Evidence: satisfied-by <sha>"
```

**Example:**

```bash
git commit --allow-empty -m "chore(evidence): backfill task 5" \
  -m "Task: 5" \
  -m "Evidence: satisfied-by abc1234567890def1234567890abcdef12345678"
```

Replace `<task-id>` with the numeric task ID and `<sha>` with the full branch-local SHA of the commit that satisfies the task.

### Step 4: Mark Feature as Recovery-Attempted

After backfilling all unresolved tasks, signal the daemon that recovery is complete:

```bash
conduct daemon unpark <feature-name>
```

The daemon will re-run the evidence gate with the newly added trailers.

---

## Expected Unresolved Sets

### Audit-Trail Feature

Expected unresolved tasks: **5, 9, 10** (16/19 tasks completed)

- Unresolved task 5: Infrastructure task, likely requires dedicated implementation commit
- Unresolved task 9: Documentation task, may be part of audit trail verification
- Unresolved task 10: Runbook documentation (this file) — backfill after creation

### Fix-400 Feature

Expected unresolved tasks: **3, 13 + unattributed remainder**

- Unresolved task 3: Core fix implementation
- Unresolved task 13: Related test or verification
- Unattributed remainder: Tasks without clear Evidence trailer associations

---

## Refusal Rules (Non-Negotiable)

### Refusal Rule 1: Unverifiable Work

**Scenario:** You cannot locate a commit that satisfies an unresolved task.

**Action:** **Do not guess or assume a SHA.** Refuse to backfill the Evidence trailer.

**Instead:**
1. Document the missing task ID in your recovery notes
2. Escalate to the feature author or branch maintainer
3. Ask them to confirm which commit (if any) satisfies the task
4. Do not append an Evidence trailer without explicit verification

**Example:**

```bash
# BAD: guessing at a SHA
git commit --allow-empty -m "chore(evidence): backfill task 8" \
  -m "Task: 8" \
  -m "Evidence: satisfied-by deadbeef1234567890abcdef1234567890abcdef"

# GOOD: verification first
git log --oneline --grep="Task: 8" origin/main..<branch>
# No output — cannot find the commit
# Escalate to feature author
```

### Refusal Rule 2: Unreachable SHA

**Scenario:** The `Evidence: satisfied-by <sha>` points to a commit not reachable from your branch.

**Action:** The evidence gate will reject it. Do not attempt to force through or work around the gate.

**Instead:**
1. Verify the SHA is actually on your branch: `git log --all --oneline | grep <sha>`
2. If not found, you have the wrong SHA
3. Return to Step 3.b and identify the correct branch-local SHA
4. If no branch-local SHA can be found, escalate (see Refusal Rule 1)

**Example:**

```bash
# Verify SHA is on your branch
git log --all --oneline | grep abc1234567890def1234567890abcdef12345678

# If no output, the SHA is not on this branch
# Do not commit; re-verify the correct SHA or escalate
```

---

## Debugging

### The Gate Still Shows Unresolved Tasks After Backfilling

**Possible causes:**
1. The trailer format is incorrect — check spacing and capitalization: `Evidence: satisfied-by`
2. The SHA is not on the branch — verify with `git log --all --oneline`
3. The commit message was not formatted correctly — re-run `git log -1` to verify the trailer is present

**How to fix:**
- Re-run Step 1 to refresh
- Re-run Step 3 to verify each SHA and trailer
- Re-run Step 2 to trigger the gate again

### Feature Author Cannot Locate the Work

If the feature author confirms that a task lacks satisfying work on the branch:

1. This task may need to be re-opened or split into a new feature branch
2. Document this in the feature's audit trail
3. Escalate to the team lead or project coordinator for guidance on next steps

---

## Summary

Recovery follows a simple pattern:

1. **Refresh** — ensure your branch is up to date
2. **Identify** — run the gate and list unresolved tasks
3. **Verify** — find the commit that satisfies each task
4. **Backfill** — append Evidence trailers with correct SHAs
5. **Re-run** — trigger the gate again to confirm resolution

**Remember:** Never guess at a SHA or force through an unreachable commit. When in doubt, escalate to the feature author.

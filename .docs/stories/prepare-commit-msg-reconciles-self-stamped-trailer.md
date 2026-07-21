# Stories: prepare-commit-msg reconciles a wrong agent-self-stamped `Task:` trailer

Status: Accepted

Source issue: jstoup111/ai-conductor#576

These stories specify the behavior of the `PREPARE_COMMIT_MSG_HOOK` template in
`src/conductor/src/engine/git-hook-assets.ts`. Acceptance criteria are Given/When/Then
and are the authority for this technical-track fix (no PRD).

---

## Story 1 — A disagreeing self-stamped trailer is overwritten with the engine id (happy path)

**As** the deterministic attribution engine
**I want** the prepare-commit-msg hook to override a `Task:` trailer that disagrees
with `.pipeline/current-task`
**So that** a wrong agent-typed trailer cannot survive to cause a path-corroboration
halt (#433's determinism holds even when an agent self-stamps).

### Scenario 1a: current-task present, trailer present, they disagree → engine wins

- **Given** `.pipeline/current-task` contains `10`,
- **And** the pending commit message already carries a self-stamped `Task: 12` trailer,
- **When** the prepare-commit-msg hook runs,
- **Then** the resulting message carries `Task: 10` (the engine value) and does **not**
  carry `Task: 12` — the trailer was replaced in place, not appended (a single `Task:`
  trailer remains).

### Scenario 1b: body-only reference does not matter; the trailer is corrected regardless

- **Given** `.pipeline/current-task` contains `14` and the message body prose says
  "Task 14: …" but the trailer block carries `Task: 15`,
- **When** the hook runs,
- **Then** the trailer is `Task: 14` (engine value wins independent of subject/body
  prose — the fix does not rely on scanning the subject or body).

---

## Story 2 — An agreeing trailer is a no-op (happy path / idempotence)

**As** the hook
**I want** to leave an already-correct trailer unchanged
**So that** reconciliation is idempotent and never duplicates the trailer.

### Scenario 2a: current-task equals the existing trailer

- **Given** `.pipeline/current-task` contains `10` and the message already carries
  `Task: 10`,
- **When** the hook runs,
- **Then** the message still carries exactly one `Task: 10` trailer (no duplicate, no
  churn).

---

## Story 3 — Current-task absent preserves the existing trailer (negative path)

**As** an operator making a manual commit outside a dispatched task
**I want** the hook to leave my trailer alone when there is no engine id
**So that** the reconcile never clobbers a deliberate trailer with nothing.

### Scenario 3a: no current-task, trailer present → preserved

- **Given** `.pipeline/current-task` is absent or empty,
- **And** the message carries `Task: 9`,
- **When** the hook runs,
- **Then** `Task: 9` is preserved unchanged (today's behavior for manual commits is
  retained; the engine has no authoritative id to substitute).

### Scenario 3b: no current-task, no trailer → unchanged

- **Given** `.pipeline/current-task` is absent and the message has no `Task:` trailer,
- **When** the hook runs,
- **Then** no `Task:` trailer is added (nothing to stamp; existing no-op behavior).

### Scenario 3c: current-task present, no trailer → stamped (regression of existing behavior)

- **Given** `.pipeline/current-task` contains `3` and the message has no `Task:` trailer,
- **When** the hook runs,
- **Then** the message gains `Task: 3` — the original deterministic-stamp path still
  works (the fix must not break the no-trailer-present case).

# Stories: engineer handoff pushes the spec branch before `gh pr create`

Status: Accepted

Source issue: jstoup111/ai-conductor#331

These stories specify the behavior of `openSpecPr` (the handoff primitive) and its
CLI wiring. Acceptance criteria are expressed as Given/When/Then and are the
authority for this technical-track fix (no PRD).

---

## Story 1 — First handoff on a fresh spec branch opens the PR (happy path)

**As** the engineer loop
**I want** handoff to push the spec branch to `origin` before opening the PR
**So that** the first handoff opens the spec PR with no manual `git push`.

### Scenario 1a: push then create, in order

- **Given** a target repo with an `origin` remote and a per-idea worktree checked
  out on `spec/<slug>` carrying at least one commit,
- **And** `spec/<slug>` does not yet exist on `origin`,
- **When** `openSpecPr(target, "spec/<slug>", deps)` runs,
- **Then** the git runner is invoked with `push` to `origin` for `spec/<slug>`
  (cwd = the worktree) **before** the gh runner is invoked with `pr create`,
- **And** `gh pr create --head spec/<slug> --fill` runs against the now-pushed branch,
- **And** the result is `{ kind: 'pr-opened', url }` with the URL scraped from gh stdout,
- **And** the authored key is recorded exactly once.

### Scenario 1b: CLI reports the opened PR, not local-commit

- **Given** the same fresh-branch conditions through the real `conduct-ts engineer handoff` CLI,
- **When** the push succeeds and gh returns a PR URL,
- **Then** the CLI prints `{ "kind": "pr-opened", "url": "<url>" }`,
- **And** the per-idea worktree is removed,
- **And** it does **not** fall back to `{ "kind": "local-commit" }`.

---

## Story 2 — Genuinely remote-less repo still falls back to local-commit (negative path)

**As** an operator working in a repo with no `origin`
**I want** handoff to preserve the work on the branch and report a skip
**So that** remote-less repos are unaffected by the new push step.

### Scenario 2a: push fails because there is no remote → pr-skipped

- **Given** a target repo with **no** `origin` remote,
- **When** `openSpecPr` runs and `git push -u origin <branch>` fails with a
  recognized no-remote error (e.g. "'origin' does not appear to be a git repository",
  "No configured push destination", "No such remote"),
- **Then** `openSpecPr` returns `{ kind: 'pr-skipped', reason }` (non-fatal),
- **And** `gh pr create` is **never** invoked (no PR attempt against a missing remote),
- **And** the authored key IS still recorded (authoring happened; the flywheel counts it),
- **And** the spec commit remains on `spec/<slug>` (work preserved).

### Scenario 2b: the fallback fires ONLY for a missing remote, never for a merely-unpushed branch

- **Given** a target repo that **does** have an `origin` remote,
- **When** handoff runs on a spec branch that has never been pushed,
- **Then** the push succeeds and a real PR is opened (Story 1),
- **And** the `local-commit` / `pr-skipped` fallback does **not** trigger merely
  because the branch was previously absent from the remote.

---

## Story 3 — A non-no-remote push failure is a hard error (negative path)

**As** the engineer loop
**I want** an unexpected push failure to surface, not be silently swallowed
**So that** auth/network problems are not misreported as "no remote / delivered".

### Scenario 3a: push rejected for a non-no-remote reason → throw

- **Given** a target repo with an `origin` remote,
- **When** `git push` fails with an error that is **not** a no-remote condition
  (e.g. authentication failure, non-fast-forward rejection, network timeout),
- **Then** `openSpecPr` re-throws the error (it is NOT classified as pr-skipped),
- **And** `gh pr create` is not invoked,
- **And** the CLI's handoff catch keeps the worktree for inspection and reports the
  failure (existing keep-on-failure behavior), so the operator can act.

### Scenario 3b: no merge, ever

- **Given** any handoff invocation,
- **When** the git and gh runners are exercised,
- **Then** neither runner is ever called with `merge` in its args (the engineer
  never merges — unchanged invariant, re-asserted here because a new runner is added).

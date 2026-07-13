# Reused halt PR ships with halt boilerplate body and slug title; halt signal laundered

Status: Accepted

## Context

When a halted feature ships by reusing its `needs-remediation` halt PR, the finish repair callback
(`src/conductor/src/engine/conductor.ts:639-673`) runs `rehabilitateHaltPr` (label + body-marker
removal, `Closes` injection), `retitleFloor` (`needs-remediation:` title → `feat: <branch slug>`),
and `ensureShipReady` (undraft). Nothing ever touches the halt boilerplate *body* the engine itself
authored at escalation time (`build-failure-escalation.ts:155-160`: "This PR was opened
automatically after an irrecoverable daemon HALT. …"), and the finish completion gate
(`artifacts.ts:1267`, `readStaleHaltTitle`) checks only the `needs-remediation:` title prefix —
which the engine's own retitle floor has already cleared. Because detection is stateless (title
prefix OR label, ADR 2026-07-03 Decision 4), the repair pass launders every halt signal while the
boilerplate body ships, and nothing can ever detect the residue afterward.

Observed on PR #610 (shipped 2026-07-13T11:31Z): body still "This PR was opened automatically after
an irrecoverable daemon HALT. / Manual remediation is required…", title `feat:
daemon-halts-a-build-that-is-making-forward-progre` (floor fallback), no labels. Compare fresh
implementation PR #605: descriptive title, `## Summary` + `## Test Plan` body. Same class hand-fixed
on #231, #249, #444, #575 (memory: feedback_finish_reused_pr_rehabilitation). Additionally,
`conductor.ts:647` passes no `log` into the repair steps, so partial rehabilitation outcomes are
silent. Intake: jstoup111/ai-conductor#632.

## Story 1 — the halt boilerplate body is a stateless halt signal and is floored at finish

As the finish repair step, when the recorded PR's body contains the engine-authored halt banner, I
detect the PR as a reused halt PR — even when the title prefix, label, and body marker have already
been cleared — and deterministically replace the banner with an implementation-PR floor body, so a
shipped reused PR never carries halt boilerplate.

### Happy Path

- **Given** a recorded PR whose body contains the engine-authored banner line "This PR was opened
  automatically after an irrecoverable daemon HALT." (with or without the `needs-remediation:`
  title prefix, label, or body marker),
- **When** the finish repair callback runs for that PR,
- **Then** the PR is classified as a reused halt PR, and its body is rewritten so that no banner
  line remains: the floor body contains a `## Summary` heading with the feature description, a
  deterministic test-evidence line derived from `.pipeline/task-status.json` (completed/total plan
  tasks) when that file is readable, a note that the halt history is preserved in the PR's comment
  thread, and exactly one `Closes <sourceRef>` reference when a sourceRef exists.
- **And** the rewrite is verified by re-read (verify-after-write) with bounded retries, and any
  remaining halt mechanics (label, marker, draft, `Closes`) are fixed in the same pass as today.
- **And** the PR's comment thread (halt-reason comment) is never modified.

### Negative Path — a fresh implementation PR is untouched

- **Given** a recorded PR whose body does not contain the banner and whose title/label carry no
  halt signal (a normal implementation PR, e.g. the #605 shape),
- **When** the finish repair callback runs,
- **Then** zero body/title mutation commands are issued for it (`gh pr edit` never called for body
  or title) — its skill-authored presentation is preserved byte-for-byte.

### Negative Path — a skill-authored body with banner residue loses only the banner

- **Given** a PR body where a session already prepended real content (e.g. a `## Summary` section)
  but the banner block still remains below it,
- **When** the body floor runs,
- **Then** only the banner lines are removed; the non-banner content is preserved, and a second
  `## Summary`/test-evidence block is not injected when one is already present.

## Story 2 — a ship cannot complete while the recorded PR body still carries the halt banner

As the finish completion gate, I fail the finish step while a successful read of the recorded PR
shows the banner still in its body, naming the stale facet — so skill/floor failure is loud at the
point of violation instead of shipping silently.

### Happy Path

- **Given** the recorded PR's body still contains the banner when the finish completion gate
  evaluates (floor failed or was skipped),
- **When** the gate reads the PR (`gh pr view --json …`),
- **Then** the step is not done, and the failure reason names the PR URL and the stale body facet
  (parallel to the existing stale-title reason at `artifacts.ts:1268-1273`), so retries re-enter
  the repair path.

### Negative Path — gh outage never blocks a ship

- **Given** the gate's PR read fails (gh unavailable, network error),
- **When** the gate evaluates,
- **Then** the presentation check passes with a warning (fail-open), exactly like the existing
  stale-title and draft checks — network unavailability never blocks a ship.

### Negative Path — clean body passes

- **Given** the recorded PR's body contains no banner,
- **Then** the gate's body check passes with zero additional mutations.

## Story 3 — an in-remediation halt PR keeps its halt presentation

As the daemon's halt-PR reconciliation sweep, I continue to enforce draft + `needs-remediation`
label on open PRs that carry the body marker; the new body floor never runs outside the finish
repair path.

### Negative Path

- **Given** an open halt PR mid-remediation (body marker present, not yet shipping),
- **When** the reconciliation sweep (`halt-pr-reconciliation.ts`) runs,
- **Then** its behavior is unchanged — the PR stays draft + labeled with its halt banner body; the
  body floor is not invoked by the sweep, and no floor/sweep fight occurs (the floor only runs from
  the finish repair callback, whose cleanup also removes the marker the sweep keys on).

## Story 4 — rehabilitation outcomes are visible in the daemon log

As the operator, when finish repairs a reused halt PR, I can see each repair mechanic's outcome
(`rehabilitated`/`partial`/`gh-unavailable`, floor applied or skipped) in the daemon log.

### Happy Path

- **Given** the finish repair callback runs (any outcome, including partial failure),
- **When** I inspect the daemon log,
- **Then** `[halt-pr-rehab]`-prefixed lines record what was detected and what each mechanic did —
  the callback threads a real `log` function into `rehabilitateHaltPr`, the floors, and
  `ensureShipReady` (today `conductor.ts:647` passes none, so failures are silent).

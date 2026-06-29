# Conflict Check: Daemon Supervised Hosting

**Date:** 2026-06-29
**Stories checked:** `daemon-supervised-hosting.md` against all of `.docs/stories/`
(notably `phase-9.3-engineer-redesign.md`, `phase-9.3-engineer-cleanup-followup.md`,
`phase-9.3b-github-intake-writeback.md`, `daemon-halt-reconciliation.md`).
**Result:** **No blocking conflicts.** Three findings recorded below — two compatible
overlaps (preserved by design) and one advisory implementation guard.

---

## Finding 1 — Overlap (compatible): `daemon start` layers on the existing single-winner story

**Stories involved:** "Start a repo's daemon on demand (idempotent)" (new, FR-1/FR-2) vs
"Concurrent daemon starts in one repo — exactly one wins" (`phase-9.3-engineer-redesign.md`).
**Type:** behavioral overlap
**Severity:** none (compatible)

**Description:** Both describe `daemon start` for one repo. The existing story governs the
inner **pidfile** single-winner race; the new story adds an outer **session-existence**
idempotency check. They compose: the new start no-ops when a session is already up, and the
inner pidfile lock still arbitrates any residual race. The new story explicitly preserves
"the single-owner lock still holds."

**Resolution:** None needed. The new stories are written to preserve the pidfile lock as the
source of truth for inner single-ownership; the session layer sits on top.

---

## Finding 2 — Architecture supersession (defer to ADR): launch model + ensure-running mechanism

**Stories involved:** "Engineer handoff ensures a daemon…" (new, FR-12) and the launch behavior
behind "post-authoring handoff → ensure-running" (`phase-9.3-engineer-cleanup-followup.md`).
**Type:** overlap (mechanism change under unchanged behavior)
**Severity:** none at story level — **architectural**, routed to architecture-review.

**Description:** The observable behavior is unchanged (ensure a daemon is running; no-op when
already live; never disturb a connected operator; FR-21-negative / ADR-005 preserved). What
changes is the **mechanism**: the detached `stdio:'ignore'` spawn (`launchDaemonDetached`) is
replaced by hosting a foreground daemon inside a session. That is an architectural decision, not
a story contradiction.

**Resolution:** Record the supersession in the architecture-review ADR (the swappable supervisor
port; detached-spawn launch is superseded by the foreground-in-session host). No story edits.

---

## Finding 3 — Advisory guard (degrading, accepted): keep session-start out of the engineer poll

**Stories involved:** new FR-12 (engineer ensure-running → `daemon start`) vs the static guard
"no `setInterval`/detached spawn in the poll" (`phase-9.3b-github-intake-writeback.md`).
**Type:** resource/sequencing (implementation constraint)
**Severity:** degrading (accepted as an implementation constraint)

**Description:** The 9.3b guard forbids the **engineer intake poll** from becoming an always-on
process / detached spawn. The new `daemon start` creates a detached (session-hosted) daemon. If
that call were wired into the engineer **poll loop**, it could trip the guard's intent.

**Resolution (accepted):** Constrain the new `daemon start` nudge to the **sanctioned handoff
path only** (where `ensureRunning` already lives), never the intake poll loop. The engineer
intake stays poll-on-launch with no background process of its own. The implementer and the
as-built architecture review must verify the static guard still holds.

---

## Re-check

No story edits were required, so no re-scan was needed. **Zero blocking conflicts remain.**
Findings 2 and 3 are carried into architecture-review (ADR) and the implementation constraints,
respectively.

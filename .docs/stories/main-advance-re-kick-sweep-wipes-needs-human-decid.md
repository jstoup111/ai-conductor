**Status:** Accepted

# Stories: needs-human halts survive the main-advance re-kick sweep

Source: jstoup111/ai-conductor#921 (technical track, Tier S).
Technical intent: a halt that asks for operator action must remain a stable,
operator-visible state across main-advance re-kick sweeps; transient/mechanical
halts keep today's re-kick-on-advance behavior; every sweep decision is
observable in the daemon log with the halt's class.

Pinned decisions (from `.memory/decisions/halt-class-survives-rekick.md`):

- Halt class is a machine-readable record persisted at the halt write site
  (where the halt's nature is statically known), via the shared halt-marker
  machinery — never inferred by parsing halt prose in the sweep.
- Classes: `needs-human` (operator action required; survives sweeps) and
  `mechanical` (transient: build stall, gate-loop budget; re-kicked on advance).
- Absent, unreadable, or unrecognized class → treated as `mechanical`
  (re-kick), logged as `unclassified` — preserves current behavior for legacy
  markers; all needs-human writer sites are migrated in this same change.
- A needs-human halt is released when the operator removes the HALT marker
  (the documented resume procedure) or parks/unparks explicitly; there is no
  auto-expiry.

## Story: Needs-human halt survives a main-advance re-kick sweep

**Requirement:** TR-1

As the daemon operator, I want halts that request my action to persist across
main-advance re-kick sweeps so that I actually see them and no LLM validation
cycles are burned re-reaching the same halt.

### Acceptance Criteria

#### Happy Path
- Given a worktree with a live `.pipeline/HALT` whose persisted class is
  `needs-human` (e.g. a "needs human DECIDE" validation-group halt or a
  prd-audit operator-action halt), when the re-kick sweep runs at a new base
  SHA, then the HALT marker remains byte-for-byte in place, no
  `.pipeline/REKICK` sentinel is written, the slug is reported as skipped, and
  the slug's last-rekick SHA is not advanced.
- Given the same worktree, when three further base-SHA advances occur with no
  operator action, then the halt survives every sweep (survival is
  unconditional on SHA freshness, not bounded by the per-SHA guard).
- Given a needs-human halt the operator releases by removing the HALT marker
  (the resume procedure), when the next daemon poll runs, then the feature is
  eligible for dispatch again exactly as an unhalted feature is today.

#### Negative Paths
- Given a worktree whose halt-class record exists but is unreadable or carries
  an unrecognized value, when the sweep runs at a new SHA, then the sweep
  treats the halt as unclassified, re-kicks it per current behavior, and logs
  the slug with class `unclassified` and the read failure — it never throws or
  aborts the sweep for other slugs.
- Given a worktree that is BOTH operator-parked and needs-human halted, when
  the sweep runs, then the operator-park skip still wins (checked first,
  unchanged) and the log records the park skip, not a class decision.

### Done When
- [ ] A unit test drives `rekickSweep` with an injected needs-human-classified
      halt and asserts: slug in `skipped`, not in `cleared`, no `clearMarker`
      call, no `lastRekickSha` update, and a log line naming the slug, the
      class `needs-human`, and the skip.
- [ ] A unit test asserts the same worktree is still skipped at a second,
      different SHA (survival across multiple advances).
- [ ] A unit test asserts an unreadable/unrecognized class record falls back to
      re-kick with an `unclassified` log line and does not throw.
- [ ] A unit test asserts operator-park is still checked before any class read.

## Story: Mechanical halts still re-kick on base advance

**Requirement:** TR-2

As the daemon operator, I want transient halts (build stall, gate-loop budget)
to keep being re-kicked on main advance so that useful automatic retry behavior
is not lost.

### Acceptance Criteria

#### Happy Path
- Given a worktree with a live HALT whose persisted class is `mechanical`
  (e.g. "build stalled: no task progress" or "gate selected N times without
  satisfying"), when the sweep runs at a new base SHA, then the marker is
  cleared to `.pipeline/HALT.cleared` (reason preserved), the REKICK sentinel
  is written, and the log line includes the slug, the class, and the re-kick.
- Given a legacy live HALT with no class record (written before this change),
  when the sweep runs at a new SHA, then it is re-kicked exactly as today and
  logged as `unclassified`.

#### Negative Paths
- Given a mechanical halt already re-kicked at SHA X, when the sweep runs again
  at the same SHA X, then the FR-9 per-SHA guard still skips it (class
  handling does not bypass the existing guard).
- Given a mechanical halt whose marker was cleared by a sweep, when the same
  feature later halts again for a needs-human reason, then no stale class
  record from the earlier halt survives to misclassify the new halt — the
  clear removes the class record together with the marker.

### Done When
- [ ] A unit test drives `rekickSweep` with a mechanical-classified halt and
      asserts clear + sentinel + a log line carrying class `mechanical`.
- [ ] A unit test asserts a class-less halt re-kicks unchanged and logs
      `unclassified`.
- [ ] A unit test asserts the per-SHA guard still applies to classified halts.
- [ ] A unit test asserts clearing a marker also removes its class record.

## Story: Needs-human halt writers persist the class at write time

**Requirement:** TR-3

As the harness maintainer, I want every halt write site that requests operator
action to persist the `needs-human` class through shared machinery so that
survival never depends on prose wording or sweep-side text matching.

### Acceptance Criteria

#### Happy Path
- Given each enumerated needs-human halt site — validation-group remediation
  halts ("needs human DECIDE"), prd-audit halts (needs-human DECIDE and
  un-ALIGNED FR variants), the build_review scope-FAIL disposition halt, the
  rebase-conflict halt (`writeHalt` in rebase.ts), and the self-host gate
  halts (`writeSelfHostHalt`: release-gate, version-gate, changelog/migration
  integrity) — when the site writes its HALT, then a machine-readable
  `needs-human` class is persisted alongside the marker via the shared
  halt-marker machinery (no per-site ad-hoc spelling of the class path).
- Given the build-stall and gate-loop-budget halt sites, when they write their
  HALT, then the persisted class is `mechanical` (or absent, which the sweep
  already treats as mechanical) — their re-kick behavior is unchanged.

#### Negative Paths
- Given a needs-human halt site whose class write fails (fs error), when the
  halt fires, then the HALT marker itself is still written best-effort exactly
  as today (a halt is a signal, never itself a hard failure), the failure does
  not crash the finish/halt flow, and the resulting class-less halt degrades to
  today's re-kick behavior rather than blocking.

### Done When
- [ ] The shared halt-marker machinery exposes a classified write, and every
      enumerated needs-human site above uses it (verified by tests or a grep
      gate — no needs-human site writes a bare unclassified marker).
- [ ] A unit test per funnel (validation-group/prd-audit halt path, rebase
      `writeHalt`, `writeSelfHostHalt`) asserts the persisted class is
      `needs-human`.
- [ ] A unit test asserts a failed class write still leaves the HALT marker
      written and throws nothing.
- [ ] `docs/daemon-operations.md` documents the halt classes, the sweep's
      skip/re-kick rules, and the release procedure for a needs-human halt.

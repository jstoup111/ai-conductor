**Status:** Accepted

# Stories: Engine-GC self-eviction guard

Technical track (no PRD). Acceptance criteria derive from the technical intent: the engine-version
GC (`src/conductor/src/engine/engine-store.ts` `gcVersions`) must never delete the `dist-versions/<id>`
directory that a currently-running engine/daemon process is executing from, and the daemon startup
sequence must not open a window where that protection is absent. Scope is limited to intake
`jstoup111/ai-conductor#673`, outcome (3) only.

Context the scenarios rely on (verified during discovery): `bin/conduct-ts` resolves `dist` with
`readlink -f` and execs `node dist-versions/<id>/index.js`, so a live process is pinned to its
*versioned* dir; deleting that dir makes the next lazy `import()` throw ENOENT even though the
process has been alive for a while. GC currently deletes a version only when all four hold: it is
not the just-published `currentVersionId`, not referenced by any live pidfile's `engineDir`, older
than `minAgeMsecs` (24h), and outside the newest `keepLastK` (3).

---

## Story: GC never deletes the running engine's own dist

**Requirement:** Self-eviction guard (#673 outcome 3)

As the daemon runtime, I want the engine GC to protect the exact `dist-versions/<id>` directory the
live process is running from, so that a publish+GC pass cannot pull code out from under an active
daemon.

### Acceptance Criteria

#### Happy Path
- Given a running engine whose resolved execution dir is `dist-versions/V_run`, and `V_run` is
  older than the 24h min-age AND outside the newest `keepLastK`, when a publish+GC pass runs, then
  `dist-versions/V_run` is retained (not deleted).
- Given `V_run` is retained after GC, when the daemon subsequently triggers a first-time lazy
  `import()` in a later step (e.g. `wiring_check` loading `typescript` via `wiring-probe.ts`), then
  the import resolves without ENOENT.

#### Negative Paths
- Given GC would otherwise satisfy all four existing deletion conditions for `V_run` (not
  currentVersionId, not in the live-referenced set, past min-age, outside keepLastK), when GC
  evaluates `V_run`, then `V_run` is still excluded from deletion solely on the strength of the
  self-guard — i.e. the guard holds even when every pre-existing protection has lapsed.

### Done When
- [ ] GC excludes the running engine's resolved version dir from the delete set independent of the
      pidfile/live-referenced check and independent of `currentVersionId`.
- [ ] A unit test constructs a version set where `V_run` meets all four legacy delete conditions and
      asserts `gcVersions` leaves `V_run` on disk.
- [ ] A test asserts the surviving `V_run` dir still resolves a lazy `import()` (no ENOENT) after the
      GC pass.

---

## Story: No unprotected window during daemon startup

**Requirement:** Self-eviction guard — startup ordering (#673 outcome 3)

As the daemon runtime, I want the running version protected from the very first GC pass at startup,
so that the gap between process launch and pidfile write cannot let GC evict the running version.

### Acceptance Criteria

#### Happy Path
- Given the daemon is starting and the first publish+GC pass runs before steady state, when GC
  evaluates versions, then the running engine's version is already in GC's protected set (whether or
  not the daemon pidfile has been written yet).

#### Negative Paths
- Given the daemon has NOT yet written its pidfile (the pre-`holdLock` window), when a publish+GC
  pass runs in that window, then the running version is NOT deleted — the protection does not depend
  on the pidfile's `engineDir` being enrolled at GC time.

### Done When
- [ ] Either the pidfile (`engineDir`) is written before the first publish+GC pass runs, or the
      self-guard protects the running version without relying on the pidfile — verified by test, not
      by inspection.
- [ ] A test simulates the pre-pidfile window (no live-referenced entry for `V_run`) and asserts GC
      does not delete `V_run`.

---

## Story: Genuinely-old versions are still collected

**Requirement:** Self-eviction guard — no over-retention regression (#673 outcome 3)

As the operator, I want the self-guard to protect ONLY the running version, so that adding the guard
does not leak disk by retaining versions that were previously eligible for collection.

### Acceptance Criteria

#### Happy Path
- Given several `dist-versions/<id>` dirs that are past min-age, outside keepLastK, not the running
  engine's dir, and not live-referenced, when GC runs, then all of those dirs are deleted as before.

#### Negative Paths
- Given exactly one version equals the running engine's dir and the rest are old/unreferenced, when
  GC runs, then precisely one version (the running one) is retained and every other eligible version
  is deleted — the guard does not widen to spare siblings.

### Done When
- [ ] A test with N eligible-for-deletion versions plus one running version asserts N deletions and
      exactly the running version retained.
- [ ] The `keepLastK` / `minAgeMsecs` / `currentVersionId` / live-referenced conditions retain their
      existing behavior (regression test over the pre-existing GC policy passes unchanged).

---

## Story: Fail closed when the running dir cannot be resolved

**Requirement:** Self-eviction guard — undeterminable self (#673 outcome 3)

As the daemon runtime, I want GC to refuse to delete a candidate it cannot prove is safe when the
running engine's own dir is undeterminable, so that an inability to identify "self" never results in
self-eviction.

### Acceptance Criteria

#### Happy Path
- Given the running engine's resolved dir is available, when GC runs, then it proceeds normally with
  the running dir excluded (the deterministic common case).

#### Negative Paths
- Given the running engine's own version dir cannot be resolved (e.g. the resolve throws or returns
  empty), when GC runs, then GC does not delete any version it cannot prove is non-running — it
  fails closed (retains rather than risks eviction), consistent with the existing fail-closed read
  behavior that aborts the pass on any registry/pidfile read error with zero deletions.

### Done When
- [ ] A test forces the self-dir resolution to fail and asserts `gcVersions` performs zero deletions
      (or otherwise cannot delete the running version) rather than proceeding blind.
- [ ] The fail-closed path is logged so an operator can see GC declined to collect and why.

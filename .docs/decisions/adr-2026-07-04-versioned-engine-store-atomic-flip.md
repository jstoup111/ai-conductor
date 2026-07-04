# ADR: Versioned engine store with atomic current-pointer flip (closes #215)

**Date:** 2026-07-04
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session
**Feature:** daemon-lifecycle-controls (FR-13–16)

## Context

Every repo's daemon and every `conduct-ts` invocation execute the same installed engine:
`~/.local/bin/conduct-ts` → `<harness>/bin/conduct-ts` → `src/conductor/dist/index.js`.
The build (`npm run build` = raw `tsup`) has `clean: true`, single ESM entry, hashed
chunks, and the engine performs lazy dynamic imports at runtime (e.g.
`daemon-lock.ts:482` imports `daemon-launch.js` inside `ensureRunning`, plus
step-runners). A rebuild deletes the chunk files a long-running daemon in another repo
will load next → ENOENT crash in an unrelated daemon (issue #215, confirmed live).
Current mitigation is documentation only ("never rebuild while daemons run").

PRD FR-13 requires rebuild safety to be unconditional; FR-14 requires restart to adopt
the newest version and version visibility in status; FR-15 requires bounded, safe
cleanup; FR-16 requires clear failure when the current version is broken.

## Options Considered

### Option A: Versioned engine dirs + atomic `current` symlink flip + launcher realpath pinning (chosen)
- Build publishes to `src/conductor/dist-versions/<version-id>/` (never in place);
  `src/conductor/dist` becomes a **symlink** to the current version dir, retargeted
  atomically (create-new + `rename(2)`); `bin/conduct-ts` resolves the symlink to its
  **realpath before exec**, so every process is pinned to the concrete version dir it
  started from — its lazy imports resolve inside that dir forever.
- **Pros:** unconditional fix (no operator discipline); zero copies at daemon start;
  `dist/index.js` path stays stable for every existing caller; version identity is
  first-class (dir name), enabling FR-14 status display and FR-15 GC; POSIX-atomic
  publish.
- **Cons:** build/publish flow needs a wrapper (raw `tsup` can no longer target `dist/`
  directly); GC must exist or storage grows; symlink semantics must be honored by the
  launcher (belt-and-suspenders realpath at exec time removes Node resolver ambiguity).

### Option B: Copy-on-start (each daemon copies dist/ to a private dir at boot)
- **Pros:** no build-flow change; per-process isolation.
- **Cons:** does NOT protect short-lived `conduct-ts` CLI runs racing a rebuild; copies
  ~the whole bundle per daemon (slow start, N× storage); orphaned copies need their own
  GC; version identity is per-process, harder to surface in status; the hazard window
  (copy while `clean:true` deletes) still exists.

### Option C: Stop cleaning (append-only dist, `clean: false`)
- **Pros:** trivial.
- **Cons:** unsafe, not just untidy: `index.js`, `.d.ts`, and same-name chunks are
  overwritten **in place**, so a running daemon can still load a mixed old/new module
  graph (worse than a crash: silent inconsistency); dist grows unbounded with no
  version identity; FR-14 (which version is running) unanswerable.

### Option D: Single-file bundle (no chunks → nothing to delete out from under a daemon)
- **Pros:** shrinks the lazy-import surface.
- **Cons:** dynamic imports force tsup/esbuild code-splitting or a config fight against
  it; sourcemaps/dts still swap under the process; in-place overwrite of the one file
  still yields a torn read window; provides no version identity for FR-14/15. Rejected
  as insufficient alone.

## Decision

**Option A.** Layout and flow:

- **Store:** `src/conductor/dist-versions/<version-id>/` — one immutable dir per
  published build. `<version-id>` = build timestamp + short content stamp (exact format
  is an implementation detail; must be unique for dirty-tree builds too).
- **Publish (atomic):** build into a staging dir (tsup `clean` semantics confined to
  staging) → finalize as `dist-versions/<version-id>/` → retarget the `dist` symlink
  atomically (symlink-and-rename, never edit-in-place). A published version dir is
  never written to again.
- **Pinning:** `bin/conduct-ts` resolves `dist` to its realpath and hands node the
  concrete `dist-versions/<id>/index.js`. A running process therefore keeps a fully
  self-consistent module graph until it restarts — including modules it has not yet
  lazily imported (FR-13).
- **Version visibility:** the daemon records its engine dir in its pidfile record
  (additive field; adr-010 record shape-guards tolerate additions). `daemon status`
  surfaces the version id per repo (FR-14).
- **GC (fail-closed for deletion, FR-15):** at publish time, a version dir is deleted
  only if ALL hold: not the `current` target; not referenced by any **live** pidfile
  enumerated via the registry (liveness per adr-010 semantics); older than a minimum
  age; and outside a keep-last-K window. Any enumeration/read error skips deletion
  entirely. GC never blocks a publish.
- **Broken current (FR-16):** the launcher's existing missing-dist error extends to a
  dangling/incomplete `current` target — clear actionable message; running daemons are
  unaffected by construction.
- **Migration:** first publish converts the existing real `dist/` dir into
  `dist-versions/<bootstrap-id>/` + symlink. The build wrapper refuses to run while
  `dist` is a real directory otherwise (guards against raw-tsup habits resurrecting the
  hazard). Consumer-facing paths (`bin/conduct-ts`, docs) do not change.

## Negative paths / adversarial review

- **Flip vs. mid-import race:** `rename(2)` of the symlink is atomic on POSIX; a reader
  resolves wholly-old or wholly-new, never a missing target. Old dir survives until GC
  criteria pass, so in-flight lazy imports in old processes cannot ENOENT.
- **GC vs. just-starting daemon:** window between process exec (pinned realpath) and
  pidfile write. Covered by minimum-age + keep-last-K (a just-published or recent dir is
  never eligible), plus GC runs only at publish, not continuously.
- **Repo missing from registry with a live daemon:** enumeration would miss its pidfile.
  Mitigated by min-age + keep-last-K; residual risk documented — deleting a version dir
  requires it to have been superseded ≥K times AND aged past threshold while an
  unregistered daemon runs it. Accepted (registry membership is a precondition for
  daemon operation today).
- **Raw `tsup`/`npm run build` invoked out of habit:** build script is rewired to the
  publish wrapper; the wrapper (and CI) fails loudly if `dist` is a plain dir or if
  staging would target the live store. The old one-command flow keeps working — it just
  publishes safely now.
- **Non-POSIX filesystems:** symlink+rename atomicity is guaranteed on the supported
  substrate (Linux/WSL2 ext4; EKS Linux). Windows-native is out of scope (harness
  already assumes POSIX tooling).
- **Partial publish (crash mid-build):** staging dir is not the store; a crash leaves
  `current` untouched and at worst an orphaned staging dir, cleaned by the next publish.

## Consequences

### Positive
- #215 closed by construction — rebuilds are safe with any number of running daemons.
- Restart-adopts-newest falls out of the launcher resolution (no daemon-side logic).
- Version identity enables status display, GC, and the future auto-restart-on-change.

### Negative
- A build wrapper joins the critical path of every publish; raw tsup is no longer the
  supported entry (guarded, documented).
- GC adds registry-wide enumeration to publish; conservative policy can leave a few
  stale dirs on disk (bounded by keep-last-K + age).
- Tests need an env-overridable store root to avoid touching the real install
  (established pattern: `AI_CONDUCTOR_REGISTRY` precedent).

### Follow-up Actions
- [ ] Publish wrapper + staging build; rewire `npm run build`; migration of real `dist/`.
- [ ] Launcher realpath resolution in `bin/conduct-ts` (+ dangling-target error path).
- [ ] Pidfile additive engine-dir field + status surfacing.
- [ ] GC with the four-condition policy + fail-closed deletion; publish-time hook.
- [ ] Real-binary smoke: rebuild while a daemon runs; daemon exercises a lazy import
      post-rebuild without error (the FR-13 acceptance proof).

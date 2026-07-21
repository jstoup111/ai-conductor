**Status:** Accepted

# Stories: Skip the per-dispatch engine tsup rebuild when engine source is unchanged (#715)

Technical track (no PRD). Requirements derive from issue jstoup111/ai-conductor#715 and stay within
the correctness boundary set by #625/#598: the cache key is the engine-relevant **source** content,
and the mechanism **fails open** to a full rebuild on any doubt. Stories state observable behavior of
`publish()` in `src/conductor/scripts/publish-engine.mjs` and the source-hash helper it uses from
`src/conductor/src/engine/engine-store.ts`. The build subprocess is exercised via the existing
`--tsup-cmd` / `runCommand` test seam (the real `tsup` is never invoked in tests).

---

## Story 1: Re-publishing with unchanged engine source skips the tsup build entirely

**Requirement:** Issue #715 desired outcome (cache by source-content key; skip the redundant build)

As the daemon operator, I want a re-dispatch whose engine-relevant source is byte-for-byte unchanged
to skip the ~2-3 min tsup build entirely — not merely skip the symlink flip after building — so that
re-dispatch churn stops paying full build latency for a no-op.

### Acceptance Criteria

#### Happy Path
- Given a prior successful `publish()` produced current version `V` with dist pointing at it, and
  the engine build inputs are unchanged since `V` was built, when `publish()` runs again, then the
  injected build command (tsup seam) is **not invoked at all** (invocation count 0), no new
  `.engine-staging-*` dir is created, `dist` still points at `V`, and `publish()` returns
  `{ versionId: V, ... }`.
- Given that skip occurs, when it logs, then it emits a message naming the reason as a *source*
  cache hit (distinct wording from the existing post-build `content unchanged (<sha>) — publish
  skipped` output-hash line, so the two skip paths are distinguishable in the daemon log).

#### Negative Paths
- Given the source key matches but the current version directory `dist` points at is **missing or
  not a directory** (dangling/incomplete current), when `publish()` runs, then it does **not** skip
  — it runs the full build and heals to a fresh finalized version (same fail-open discipline the
  existing output-hash guard already applies to a dangling current target).

### Done When
- [ ] A test drives a second `publish()` over an unchanged source tree with a build stub that
      records invocations, and asserts the stub was invoked 0 times, no `.engine-staging-*` dir
      remains, `dist` is unchanged, and the returned `versionId` equals the first publish's.
- [ ] A test asserts the source-cache-hit skip logs distinct wording from the output-hash
      `content unchanged` line.
- [ ] A test asserts that with a matching source key but a removed current version dir, the build
      stub **is** invoked and a fresh version is finalized.

---

## Story 2: A genuinely-changed engine source always rebuilds (no stale engine — #625/#598)

**Requirement:** Issue #715 boundary; #625/#598 staleness correctness

As the daemon operator, I want any change to engine-relevant source to force a full rebuild, so the
cache can never serve a stale engine — the failure mode #625/#598 exist to prevent.

### Acceptance Criteria

#### Happy Path
- Given a prior successful `publish()` produced current version `V`, and an engine-relevant source
  input has since changed (e.g. a byte in a hashed source file, or the dependency lockfile), when
  `publish()` runs, then the source key differs from `V`'s recorded key, the build **is** invoked,
  and a new finalized version is produced (the output-hash idempotence guard may still no-op the
  flip if the *output* is identical — that behavior is unchanged).
- Given the source key is computed, then it is derived from a **superset** of tsup's real inputs
  (the engine `src/` tree plus the build-config inputs: `package.json`, `package-lock.json`,
  `tsconfig.json`, `tsup.config.ts`, and `scripts/publish-guard.mjs`), so that no engine-relevant
  change can be silently missed (over-inclusion only ever costs an unnecessary rebuild — the safe
  direction).

#### Negative Paths
- Given only a non-input file changes (e.g. a file outside the hashed input set), when the key is
  computed, then it is unchanged — documenting that the input set is defined explicitly, not by
  hashing the whole working tree. (This is the acceptable, bounded over-/under-inclusion tradeoff;
  the input set is chosen to be a superset of what tsup actually consumes.)

### Done When
- [ ] A test mutates a byte in a hashed engine source input between two publishes and asserts the
      build stub is invoked the second time and a new version id is produced.
- [ ] A test mutates the lockfile (`package-lock.json`) between publishes and asserts a rebuild.
- [ ] A test asserts the source-key helper's hash changes when any input in the defined set changes
      and is stable (deterministic) across two computations over identical inputs.

---

## Story 3: An absent or corrupt cache rebuilds (fail open)

**Requirement:** Issue #715 boundary — fail open on any cache doubt

As the daemon operator, I want a missing, unreadable, or malformed source-key record to trigger a
normal full rebuild rather than an error or a false skip, so the cache is strictly an optimization
and never a new failure or staleness surface.

### Acceptance Criteria

#### Happy Path
- Given there is **no current version** (first-ever publish; `dist` absent or dangling), when
  `publish()` runs, then no skip is attempted and the build runs normally (today's first-publish
  behavior is unchanged).
- Given a current version exists but has **no** `.engine-source-key` sidecar (e.g. built by an older
  engine before this change), when `publish()` runs, then the absent sidecar is treated as a cache
  miss and the build runs (a rebuild also writes the sidecar, so the cache self-heals on next run).

#### Negative Paths
- Given the `.engine-source-key` sidecar exists but is **unreadable or malformed** (empty/garbage),
  when `publish()` runs, then any read/parse error is swallowed as a cache miss and the build runs —
  the publish never fails because of the cache, and never skips on a doubtful key.
- Given computing the source key itself **throws** (e.g. an input path transiently unreadable), when
  `publish()` runs, then it falls through to a full build rather than propagating the error or
  skipping.

### Done When
- [ ] A test asserts a first-ever publish (no current version) runs the build and writes an
      `.engine-source-key` sidecar into the finalized version dir.
- [ ] A test asserts a current version lacking the sidecar is a cache miss → build runs.
- [ ] A test corrupts the sidecar contents and asserts a cache miss → build runs, publish exits 0.
- [ ] A test forces the key computation to throw (unreadable input path) and asserts the build runs
      and publish exits 0 (fail open, no propagated error).

**Status:** Accepted

# Stories: Owner marker stamped at authoring; no silent dead spec — #721

**Track:** technical (no PRD — acceptance criteria live here)
**Feature area:** the two `Owner:` chokepoints in the deployed `conduct-ts` runtime —
the write path `writeIntakeMarker` (`src/conductor/src/engine/engineer/intake-marker.ts`)
with its `authoring.ts` caller, and the read path `decideSpecGate`
(`src/conductor/src/engine/owner-gate/gate.ts`) consumed by
`src/conductor/src/engine/daemon-backlog.ts`. The `other-owner` isolation decision and the
GitHub-issue criteria path (#695) are explicitly **out of scope** and a story guards the
former.

---

## Operator directive (binding — shapes every criterion)

**The Owner guarantee must be harness-native machinery, deployed with the runtime — so ANY
deployment guarantees a spec is owned, not just this repo.** Two properties: artifacts are
**born owned** at authoring time, and an artifact that still arrives un-owned is
**default-attributed + loudly logged**, never silently skipped and never rejected at merge
or dispatch time.

## Context

The owner-gate reads a spec's `Owner:` marker (`.docs/intake/<slug>.md`) and, for an
un-owned spec merged on/after the grandfather cutover, skips it **forever** (a deduped
`warnOnce`). #719 hit exactly this and the feature never built. The repo-local integrity
check added in #720 does not run in consumer deployments. This spec moves the guarantee
into the runtime: born owned at the write boundary, default-and-loud-log at the read
boundary.

---

## Story 1: Autonomous authoring is born owned from machine identity

**Requirement:** FR-1

As an operator whose autonomous `runAuthoring` path files a spec, I want its intake marker
stamped with `Owner:` from my machine identity even when no `ownerConfig` was injected, so
the spec is born owned exactly like the `land` and `conduct` paths.

### Acceptance Criteria

#### Happy Path
- Given `runAuthoring` (`authoring.ts`) resolves an empty/absent `ownerConfig`, when it
  writes the intake marker, then it falls back to `readMachineOwnerConfig()` (the
  `~/.ai-conductor/config.yml` `spec_owner` → `gh` login chain), mirroring `conductor.ts`,
  and stamps the resolved `Owner:` — no `authoring.ts` path emits an un-owned marker while
  machine identity is resolvable.
- Given identity resolves, then the written marker carries a non-blank `Owner:` line and
  (when present) preserves the existing `Source-Ref:`.

#### Negative Paths
- Given machine identity is genuinely unresolvable (no `spec_owner`, no `gh` login), when
  authoring runs, then the behavior matches the ADR's un-owned policy for the write path
  (documented, deterministic) and never writes a **blank** `Owner:` line — a blank stamp is
  the un-owned case, never a false owner.

### Done When
- [ ] An `authoring.ts` test (injected machine-config reader + `gh`) asserts the marker is
  stamped from machine identity when `ownerConfig` is empty, and that no un-owned marker is
  written while identity resolves.
- [ ] `land-spec.ts` and `conductor.ts` remain byte-for-byte unchanged in their (already
  fail-closed) owner resolution.

---

## Story 2: `writeIntakeMarker` never silently omits Owner when identity is resolvable

**Requirement:** FR-2

As every intake-marker write, I want a single deterministic guarantee that a resolvable
machine identity is always stamped, so no caller can accidentally produce an un-owned marker.

### Acceptance Criteria

#### Happy Path
- Given `writeIntakeMarker` is called with an explicit owner (land/conduct paths), then it
  stamps `Owner: <id>` exactly as today — those callers are unchanged.
- Given the born-owned contract from Story 1, then the only remaining way a conduct-ts write
  emits an un-owned marker is a genuinely unresolvable identity — a state the write-path tests
  assert and pin.

#### Negative Paths
- Given `ownerIdentity` is null/whitespace, when writing, then `Owner:` is **omitted**
  entirely (never a blank line) — preserving the exact "un-owned" semantics the read path
  and provenance parser expect.
- Given neither a valid `Source-Ref` nor an owner, then the write is a no-op (returns null) —
  non-intake, un-owned specs stay byte-for-byte unchanged.

### Done When
- [ ] `intake-marker.test.ts` continues to assert stamp-when-owned / omit-when-blank / no-op,
  and covers the Story 1 born-owned path.

---

## Story 3: An un-owned arrival is default-built and loudly logged — never silently skipped

**Requirement:** FR-3

As the operator, when a spec still reaches the daemon un-owned (hand-written, or authored on
an older harness), I want it default-attributed to my daemon's own owner and **built with a
loud, actionable log**, so it never silently dies.

### Acceptance Criteria

#### Happy Path
- Given `decideSpecGate` with an un-owned stamp and a merge time on/after the cutover, when it
  decides, then it returns a **default-build** attributed to the daemon's own resolved owner
  (reason `unowned-defaulted`) — not `{ build: false }`.
- Given an un-owned stamp with an indeterminate merge time, then it likewise returns the
  default-build (reason `unowned-defaulted`).
- Given the default-build fires in `daemon-backlog.ts`, then a **loud, actionable** line is
  emitted naming the slug, the defaulted owner, and how to make ownership explicit (add an
  `Owner:` marker on the default branch) — surfaced as a build-with-notice, not the
  deduped-forever silent skip.

#### Negative Paths
- Given the daemon owner is **unresolved**, then the gate is not consulted at all (unchanged):
  the daemon still builds nothing and logs its existing once-per-pass identity notice — Layer B
  never manufactures an owner where none is resolved.
- Given an un-owned spec merged **before** the cutover, then it stays `grandfathered` build
  (unchanged).

### Done When
- [ ] `gate.test.ts` asserts `unowned-post-cutover` and `unowned-indeterminate` now yield a
  default-build with reason `unowned-defaulted` attributed to the daemon owner, and that
  `grandfathered` and `other-owner` are unchanged.
- [ ] `daemon-backlog.test.ts` asserts the defaulted spec is placed in the buildable `items`
  (not gated-out) and that the loud escalation line is emitted.

---

## Story 4 (NEGATIVE PATH — load-bearing): Explicit cross-operator ownership still skips

**Requirement:** FR-4

As an operator in a shared repo, I want a spec explicitly stamped with a **different** owner
to still be skipped, so Layer B's default-for-un-owned never erodes the core multi-operator
isolation guarantee.

### Acceptance Criteria

#### Guarantees (assert the isolation invariant is intact)
- Given `decideSpecGate` with `stamp.present === true` and `stamp.id !== daemonOwner.id`, then
  it returns `{ build: false, reason: 'other-owner', other: stamp.id }` — **unchanged** from
  `main`. A different explicit owner is never defaulted-and-built.
- Given a stamped spec whose owner **matches**, then it builds regardless of merge time
  (the cutover is never consulted for stamped specs) — unchanged.
- Given `daemon-backlog.ts` handles an `other-owner` decision, then the spec is gated-out with
  the existing `other-owner` GATED entry + remedy — unchanged.
- Given the change set, then **no** merge-time or dispatch-time rejection/HALT is introduced
  for any un-owned spec (Layer B only ever build-with-logs).

### Done When
- [ ] `gate.test.ts` pins the `other-owner` and stamped-and-matching decisions byte-identical
  to `main` (only the two un-owned branches change).
- [ ] A test/grep asserts no new HALT/reject path was added to the claim/dispatch/CI surface
  for a missing `Owner:`.

---

## Story 5: The guarantee is documented as harness-native, not repo-local

**Requirement:** FR-5

As a consumer of the harness, I want the docs to state that Owner stamping + the no-silent-skip
default are runtime guarantees carried by `conduct-ts` (so they hold in my deployment), and
that the repo-local integrity check is a supplementary belt, not the enforcement.

### Acceptance Criteria

#### Happy Path
- Given `README.md` and `src/conductor/README.md`, then the owner-gate section documents:
  (a) intake markers are born owned from machine identity at every write path, and (b) an
  un-owned arrival is default-built under the daemon's own owner with a loud escalation
  (reason `unowned-defaulted`), superseding the prior "un-owned specs are surfaced but
  skipped" wording.
- Given `CHANGELOG.md`, then the `[Unreleased]` section records the change.

### Done When
- [ ] Both READMEs reflect the born-owned + default-and-log behavior; the stale
  "un-owned … skipped" description is updated.
- [ ] `test/test_harness_integrity.sh` stays green (its intake-Owner check is retained).

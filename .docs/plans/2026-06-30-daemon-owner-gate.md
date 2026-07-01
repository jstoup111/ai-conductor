# Implementation Plan: Daemon Owner-Gating

**Date:** 2026-06-30
**Design:** `.docs/specs/2026-06-30-daemon-owner-gate.md`
**Stories:** `.docs/stories/daemon-owner-gate.md` (FR-1 … FR-14)
**ADRs:** `adr-2026-06-30-owner-gate-identity-resolution`, `adr-2026-06-30-owner-provenance-recording`,
`adr-2026-06-30-grandfather-cutover-merge-time`
**Conflict check:** Clean as of 2026-06-30 (0 blocking; 2 degrading carried to ADRs)

## Summary

Adds an owner gate to the daemon's autonomous spec discovery: resolve the daemon's operator
identity, read each merged spec's committed owner stamp, and build only matching specs — skipping
(and logging) others, with a grandfather cutover for un-owned legacy specs. ~17 TDD tasks across
two new seam modules, one `discoverBacklog` integration, an engineer stamp write, and config wiring.

## Technical Approach

New feature namespace `src/conductor/src/engine/owner-gate/` holds four **pure, independently
testable** units behind the ADR-mandated seams:

- **`identity.ts`** — `normalizeOwnerId()` (FR-12: trim + lowercase; blank → null) and the
  `IdentityResolver` chain `resolveDaemonOwner(config, gh)` → `ConfiguredOwner` wins, else
  `GhLoginOwner` (injected `GhRunner`, `gh api user`), else `{ resolved: false }` (FR-1/2/3).
- **`provenance.ts`** — `ProvenanceReader` / `CommittedStampReader`: read the `Owner:` line from the
  committed intake marker (`git show <base>:.docs/intake/<slug>.md`) → `{ present, id }` or un-owned
  (FR-4 read side; blank → un-owned per FR-12).
- **`merge-time.ts`** — `firstAppearanceTime(git, baseBranch, planPath)` via
  `git log --diff-filter=A --format=%cI -- <path>` (last line = first introduction); empty → null
  (ADR-3).
- **`gate.ts`** — the pure decision `decideSpecGate({ daemonOwner, stamp, mergeTime, cutover })` →
  `build` | `{ skip, reason }` covering match / other-owner / un-owned±cutover (FR-5..FR-9).

These compose into **`daemon-backlog.ts`** right before the eligible-item push at line 276: the gate
runs **after** the existing content filters (never bypassing them). The daemon owner is resolved
**once per pass**; if unresolved, the gate is skipped entirely and all content-eligible specs build
with a single warn-once "gate inactive" line (FR-3 fail-open). `DiscoverBacklogOpts` gains injected
`daemonOwner`, `readStamp`, `readMergeTime`, and `cutover` so tests drive it without real git/gh.

The write side extends **`intake-marker.ts`** to add an `Owner:` line (field name coordinated with
phase-9.3b — ADR-2 condition), stamped on **every** `land-spec.ts` path including no-remote fallback
(FR-4 negative path). **Config** (`types/config.ts` + `config.ts`) gains `spec_owner` and
`owner_gate_cutover`, threaded through `daemon-cli.ts` `localWorkSource(...)` into
`DiscoverBacklogOpts`.

**Naming boundary (ADR-1):** the operator concept is `ownerIdentity` / `specOwner` / `daemonOwner`
— never bare `owner` (reserved for `daemon-lock.ts`'s lock holder). The `owner-gate/` namespace is
the operator feature; the lock is untouched.

## Prerequisites
- None beyond the existing stack. `git` and `gh` runners already exist (`makeGitRunner`,
  `GhRunner`). No migrations, no new deps.

## Tasks

### Task 1: Owner-id normalization (FR-12)
**Story:** Owner comparison tolerates cosmetic differences.
**Type:** infrastructure
**Steps:**
1. Write failing test in `test/engine/owner-gate/identity.test.ts`: `normalizeOwnerId('  Alice ')
   === normalizeOwnerId('alice')`; `'alice' !== 'alice-bot'`; `'   '` and `''` → `null`.
2. RED.
3. Implement `normalizeOwnerId(raw: string | null | undefined): string | null` in
   `src/conductor/src/engine/owner-gate/identity.ts` (trim, lowercase; empty → null; no
   substring/fuzzy matching).
4. GREEN.
5. Commit: "feat(owner-gate): owner-id normalization (case/whitespace, blank→null)".
**Files:** `src/conductor/src/engine/owner-gate/identity.ts` (new), test (new).
**Dependencies:** none.

### Task 2: ConfiguredOwner resolution (FR-1)
**Story:** Configure a daemon's owner identity.
**Type:** happy-path
**Steps:**
1. Failing test: `configuredOwner({ spec_owner: 'Alice' })` → `{ resolved: true, id: 'alice' }`;
   `spec_owner` empty/whitespace → `{ resolved: false }`.
2. RED.
3. Implement `configuredOwner(config)` in `identity.ts` using `normalizeOwnerId`.
4. GREEN.
5. Commit: "feat(owner-gate): resolve configured spec owner".
**Files:** `identity.ts`, `identity.test.ts`.
**Dependencies:** Task 1.

### Task 3: GhLoginOwner resolution (FR-2)
**Story:** Resolve owner from gh login when unconfigured.
**Type:** happy-path
**Steps:**
1. Failing test with a stub `GhRunner`: `gh api user` returns `{"login":"bob"}` →
   `{ resolved: true, id: 'bob' }`.
2. RED.
3. Implement `ghLoginOwner(gh: GhRunner, cwd)` calling `gh(['api','user','--jq','.login'], {cwd})`
   (or parse `--json login`), normalized.
4. GREEN.
5. Commit: "feat(owner-gate): resolve owner from gh login".
**Files:** `identity.ts`, `identity.test.ts`.
**Dependencies:** Task 1.

### Task 4: gh resolution failure modes → unresolved (FR-2 negative)
**Story:** Resolve owner from gh login — negative paths.
**Type:** negative-path
**Steps:**
1. Failing tests: gh non-zero exit → `{ resolved: false }`; gh throws (absent) → `{ resolved:
   false }`; blank/empty payload → `{ resolved: false }` (never a crash, never empty-string id).
2. RED.
3. Harden `ghLoginOwner` to catch/branch on exitCode, absent binary, and blank login.
4. GREEN.
5. Commit: "feat(owner-gate): gh resolution failures degrade to unresolved".
**Files:** `identity.ts`, `identity.test.ts`.
**Dependencies:** Task 3.

### Task 5: resolveDaemonOwner chain — configured→gh→unresolved (FR-1/2/3)
**Story:** Configure identity (precedence) + gate inactive.
**Type:** happy-path
**Steps:**
1. Failing tests: configured `alice` + gh `bob` → `alice` (configured wins); no config + gh `bob`
   → `bob`; neither → `{ resolved: false }`.
2. RED.
3. Implement `resolveDaemonOwner(config, gh, cwd)` composing Tasks 2–4.
4. GREEN.
5. Commit: "feat(owner-gate): daemon owner resolution chain".
**Files:** `identity.ts`, `identity.test.ts`.
**Dependencies:** Tasks 2, 4.

### Task 6: CommittedStampReader — read owner stamp (FR-4 read)
**Story:** A spec records its author's owner at authoring time (read side).
**Type:** happy-path
**Steps:**
1. Failing test in `test/engine/owner-gate/provenance.test.ts` with a stub git runner:
   `git show <base>:.docs/intake/<slug>.md` returns a body with `Owner: alice` →
   `{ present: true, id: 'alice' }`.
2. RED.
3. Implement `readSpecOwnerStamp(git, baseBranch, slug)` in
   `src/conductor/src/engine/owner-gate/provenance.ts`, parsing the `Owner:` line, normalized.
4. GREEN.
5. Commit: "feat(owner-gate): read committed owner stamp from intake marker".
**Files:** `provenance.ts` (new), `provenance.test.ts` (new).
**Dependencies:** Task 1.

### Task 7: Stamp absent/blank → un-owned (FR-4/FR-12 negative)
**Story:** Un-owned handling; whitespace stamp is un-owned.
**Type:** negative-path
**Steps:**
1. Failing tests: marker file absent (git non-zero) → `{ present: false }`; marker present but no
   `Owner:` line → `{ present: false }`; `Owner:    ` (whitespace) → `{ present: false }`.
2. RED.
3. Branch `readSpecOwnerStamp` for missing file / missing line / blank value.
4. GREEN.
5. Commit: "feat(owner-gate): absent/blank stamp reads as un-owned".
**Files:** `provenance.ts`, `provenance.test.ts`.
**Dependencies:** Task 6.

### Task 8: firstAppearanceTime for the grandfather cutover (ADR-3)
**Story:** Grandfather build/skip needs a merge time.
**Type:** infrastructure
**Steps:**
1. Failing test in `test/engine/owner-gate/merge-time.test.ts` with stub git:
   `git log --diff-filter=A --format=%cI -- .docs/plans/<slug>.md` returns two ISO lines → returns
   the **earliest** (first-appearance); empty stdout / non-zero → `null`.
2. RED.
3. Implement `firstAppearanceTime(git, baseBranch, planPath)` in
   `src/conductor/src/engine/owner-gate/merge-time.ts` (take last line of the log = first commit).
4. GREEN.
5. Commit: "feat(owner-gate): derive spec first-appearance time from git history".
**Files:** `merge-time.ts` (new), `merge-time.test.ts` (new).
**Dependencies:** none.

### Task 9: decideSpecGate — match / other / un-owned (FR-5/6/7)
**Story:** Owned builds; other-owner skips; owner match does not bypass content filters (handled at
integration).
**Type:** happy-path
**Steps:**
1. Failing tests in `test/engine/owner-gate/gate.test.ts`: match → `{ build: true }`; different id →
   `{ build: false, reason: 'other-owner', other: 'bob' }`.
2. RED.
3. Implement `decideSpecGate({ daemonOwner, stamp, mergeTime, cutover })` in
   `src/conductor/src/engine/owner-gate/gate.ts` for the stamped cases.
4. GREEN.
5. Commit: "feat(owner-gate): gate decision for matching and other-owner specs".
**Files:** `gate.ts` (new), `gate.test.ts` (new).
**Dependencies:** Task 1.

### Task 10: decideSpecGate — un-owned ± cutover + boundary (FR-8/9)
**Story:** Un-owned post-cutover skips; pre-cutover grandfathered; indeterminate → skip.
**Type:** negative-path
**Steps:**
1. Failing tests: un-owned + mergeTime `<` cutover → `{ build: true, reason: 'grandfathered' }`;
   `>=` cutover → `{ build: false, reason: 'unowned-post-cutover' }`; exact boundary (== cutover) →
   skip (on/after); mergeTime `null` (indeterminate) → skip, stable.
2. RED.
3. Extend `decideSpecGate` for the un-owned branch with the on/after boundary and indeterminate→skip.
4. GREEN.
5. Commit: "feat(owner-gate): grandfather cutover decision for un-owned specs".
**Files:** `gate.ts`, `gate.test.ts`.
**Dependencies:** Task 9.

### Task 11: Extend DiscoverBacklogOpts with gate injectables
**Story:** Enables integration + isolated tests.
**Type:** infrastructure
**Steps:**
1. Failing test: `discoverBacklog` with no gate deps behaves exactly as today (baseline unchanged).
2. RED (compile/opt-shape).
3. Add optional `daemonOwner?`, `readStamp?`, `readMergeTime?`, `cutover?` to `DiscoverBacklogOpts`
   in `daemon-backlog.ts` (all optional → backward compatible).
4. GREEN.
5. Commit: "feat(owner-gate): inject gate deps into DiscoverBacklogOpts".
**Files:** `daemon-backlog.ts`, `test/engine/daemon-backlog.test.ts`.
**Dependencies:** Tasks 5, 7, 8, 10.

### Task 12: Wire the gate into discoverBacklog after content filters (FR-5/6/7)
**Story:** Owned builds, other-owner skips+logs, content filters still short-circuit first.
**Type:** happy-path (integration point)
**Steps:**
1. Failing tests: matching spec pushed; other-owner spec NOT pushed + `log` gets a distinct
   ownership-skip line naming slug+other; a stories-not-approved spec is still skipped for the
   content reason (gate never reached).
2. RED.
3. At `daemon-backlog.ts:276`, before push: if `daemonOwner.resolved`, call `decideSpecGate` with
   `readStamp(slug)` / `readMergeTime(slug)`; on skip `continue` + `warnOnce` distinct message; on
   build push as today.
4. GREEN.
5. Commit: "feat(owner-gate): gate eligible specs by owner in discoverBacklog".
**Files:** `daemon-backlog.ts`, `daemon-backlog.test.ts`.
**Dependencies:** Task 11.

### Task 13: Un-owned cutover integration + idempotency preserved (FR-8/9, FR-5 neg)
**Story:** Grandfather pre-cutover builds, post-cutover skips; processed-set still respected.
**Type:** negative-path (integration)
**Steps:**
1. Failing tests: un-owned pre-cutover builds; un-owned post-cutover skipped+logged; a matching spec
   already in the processed set is NOT rebuilt (gate does not defeat `isProcessed`).
2. RED.
3. Ensure the gate runs only for specs that already passed `isProcessed`/content filters (it does,
   being at line 276); pass `readMergeTime` through for un-owned branch.
4. GREEN.
5. Commit: "feat(owner-gate): cutover integration preserves idempotency".
**Files:** `daemon-backlog.ts`, `daemon-backlog.test.ts`.
**Dependencies:** Task 12.

### Task 14: Fail-open gate-inactive + warn-once (FR-3, FR-11)
**Story:** Unresolved owner → build all + single warning; other-owner still builds; no per-spec spam.
**Type:** negative-path
**Steps:**
1. Failing tests: `daemonOwner.resolved === false` → every content-eligible spec pushed (today's
   set), including an other-owner-stamped one; exactly one "gate inactive" warn per pass (warn-once,
   not per-spec).
2. RED.
3. In `discoverBacklog`, short-circuit the gate when unresolved; emit one warn-once gate-inactive
   line; ensure ownership-skip logging elsewhere uses `hasWarned/markWarned` (distinct from content
   skips).
4. GREEN.
5. Commit: "feat(owner-gate): fail-open when owner unresolved (warn-once)".
**Files:** `daemon-backlog.ts`, `daemon-backlog.test.ts`.
**Dependencies:** Task 12.

### Task 15: Extend writeIntakeMarker with an Owner field (FR-4)
**Story:** Spec records its author's owner (write side); no-remote path still stamps.
**Type:** happy-path
**Steps:**
1. Failing tests in `test/engine/engineer/intake-marker.test.ts`: with `ownerIdentity='alice'` the
   marker body contains `Owner: alice`; with `null` owner the `Owner:` line is **omitted** (not
   blank); marker still written when `sourceRef` is null (owner-only marker path).
2. RED.
3. Add `ownerIdentity` param to `writeIntakeMarker` (`intake-marker.ts:39` body) — append
   `Owner: <id>` when present; **coordinate the field name with phase-9.3b** (ADR-2 condition).
4. GREEN.
5. Commit: "feat(owner-gate): stamp Owner on the intake marker".
**Files:** `src/conductor/src/engine/engineer/intake-marker.ts`, its test.
**Dependencies:** Task 1.

### Task 16: Resolve + pass authoring owner in landSpec, incl. no-remote (FR-4 neg)
**Story:** Every land path stamps a determinable owner; unresolved → un-owned (not blank).
**Type:** negative-path
**Steps:**
1. Failing tests in `land-spec` test: land as `alice` → marker has `Owner: alice`; unresolved owner
   → marker omits `Owner:` (spec is un-owned, not falsely owned); the **no-remote/local-commit
   fallback** path still calls `writeIntakeMarker` with the owner (invariant side-effect on the
   alternate branch).
2. RED.
3. In `land-spec.ts:212`, resolve owner (`resolveDaemonOwner`) and pass to `writeIntakeMarker`;
   verify no early-return before the marker write on the no-remote branch.
4. GREEN.
5. Commit: "feat(owner-gate): landSpec stamps owner on every path".
**Files:** `src/conductor/src/engine/engineer/land-spec.ts`, its test.
**Dependencies:** Tasks 5, 15.

### Task 17: Config surface — spec_owner + cutover, threaded to discovery (FR-1/FR-10)
**Story:** Configure owner + configure the grandfather cutover; malformed cutover handled.
**Type:** infrastructure + negative-path
**Steps:**
1. Failing tests: `HarnessConfig` parses `spec_owner` and `owner_gate_cutover`; a malformed cutover
   is rejected with a clear error (or documented default), never a silent misclassification; missing
   cutover → documented default.
2. RED.
3. Add `spec_owner?: string` and `owner_gate_cutover?: string` to `types/config.ts`; validate/parse
   the cutover in `config.ts`; thread both through `daemon-cli.ts` `localWorkSource(...)` into
   `DiscoverBacklogOpts` (`daemonOwner` via `resolveDaemonOwner`, `cutover`, and real
   `readStamp`/`readMergeTime` backed by `makeGitRunner`).
4. GREEN.
5. Commit: "feat(owner-gate): config surface + daemon wiring".
**Files:** `src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`,
`src/conductor/src/daemon-cli.ts`, their tests.
**Dependencies:** Tasks 5, 13, 14.

### Task 18: Rotation — transfer + change daemon identity (FR-13/FR-14)
**Story:** Ownership transfer by re-recording; change daemon configured identity.
**Type:** negative-path
**Steps:**
1. Failing tests: a re-stamped marker (`alice`→`bob`) makes the spec build under `bob` and skip
   under `alice`; a spec already processed by `alice` is not rebuilt after transfer; transfer to
   blank → un-owned path; `resolveDaemonOwner` reads **current** config each pass (reconfigured
   `alice2` used next pass; invalid new id → falls through the chain).
2. RED.
3. Confirm no per-daemon caching of the resolved owner across passes (resolve per pass); no code
   beyond Tasks 5/12/13 should be needed — add guards if a cache is found.
4. GREEN.
5. Commit: "test(owner-gate): rotation transfer + identity change".
**Files:** `daemon-backlog.test.ts`, `identity.test.ts` (+ minimal guards if needed).
**Dependencies:** Tasks 13, 17.

### Task 19: CHANGELOG + naming-boundary/phase-9.3b coordination note
**Story:** Ship hygiene + ADR conditions.
**Type:** infrastructure
**Steps:**
1. Update the existing `[Unreleased]` CHANGELOG entry from "spec" to the shipped feature.
2. Grep to assert no bare `owner` identifier was introduced for the operator concept adjacent to
   `daemon-lock.ts` (ADR-1 condition); leave a code comment on the marker field referencing
   phase-9.3b coordination (ADR-2 condition).
3. Commit: "docs(owner-gate): changelog + ADR-condition notes".
**Files:** `CHANGELOG.md`, marker/config comments.
**Dependencies:** Task 18.

## Task Dependency Graph

```
1 ─┬─ 2 ─┐
   ├─ 3 ─ 4 ─ 5 ─────────────────┬─ 11 ─ 12 ─┬─ 13 ─┐
   ├─ 6 ─ 7 ───────────┐         │           └─ 14 ─┤
   ├─ 9 ─ 10 ──────────┤         │                  │
   └─ 15 ─ 16(needs 5) │         │                  │
8 ──────────────────────┴─────────┘                  │
5,13,14 ───────────────────────────── 17 ── 18 ── 19 ┘
```
(1 seeds normalization; 5 = identity chain; 7/10/8 feed the gate injectables at 11; 12 wires it;
13/14 finish integration; 17 wires config + real runners; 18 rotation; 19 ship hygiene.)

## Integration Points
- **After Task 12:** end-to-end owner gating works in `discoverBacklog` with injected deps (match
  builds, other-owner skips+logs).
- **After Task 14:** the full decision matrix (match / other / un-owned±cutover / gate-inactive) is
  exercised with injected deps.
- **After Task 17:** real config + git/gh runners drive the gate — first true end-to-end pass.
- **After Task 16:** the authoring side stamps owners, closing the loop authoring → discovery.

## Verification
- [ ] Every happy-path criterion (FR-1,2,4,5,6,9,10,13,14) covered — Tasks 2,3,5,6,9,10,12,15,16,17,18.
- [ ] Every negative-path criterion (FR-2 fail, FR-3, FR-7, FR-8, FR-12, FR-13/14 edge, no-remote
      stamp) covered — Tasks 4,7,10,13,14,16,18.
- [ ] No task exceeds ~5 minutes; each is one RED→GREEN cycle.
- [ ] Dependencies explicit and acyclic (graph above).
- [ ] Content filters + processed-set idempotency provably preserved (Tasks 12,13).
- [ ] Naming boundary + phase-9.3b coordination honored (Task 19; ADR-1/ADR-2 conditions).
- [ ] Tests run green: `rtk proxy npx vitest run` in `src/conductor`.

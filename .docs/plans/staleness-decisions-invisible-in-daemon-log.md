# Implementation Plan: Staleness preserve-vs-invalidate decisions are visible in daemon.log

Stem: staleness-decisions-invisible-in-daemon-log
Track: technical
Tier: M
Source: jstoup111/ai-conductor#982 (desired outcome 5 only)
ADR: .docs/decisions/adr-2026-07-26-event-sink-registry-exhaustiveness.md
Completes: .docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md **D2**

## Goal

Make a staleness rejection legible to an operator reading `.daemon/daemon.log`: distinguish a
*self-inflicted* rejection (evidence stale, judged verdict still valid) from a *genuine* one
(verdict invalidated). Two defects block this today, and both are fixed here.

1. **The payload cannot express the distinction.** `verdictFreshness.fresh` is a boolean; the
   diff-preserve path (`artifacts.ts:1967`) and the genuinely-rewritten path
   (`artifacts.ts:2021`) both emit `fresh: true`, and three of four preserve paths populate
   nothing. Replaced by a discriminated `outcome`.
2. **No payload would reach a sink.** `verdict_freshness` is emitted at
   `conductor.ts:4104-4114` and consumed nowhere. This is systemic — 19 of 57 `ConductorEvent`
   types are dead in all three sinks (17 genuinely emitted) because all three sinks are
   hand-maintained `Array<ConductorEvent['type']>` literals, a type that permits silent
   omission. Replaced by a total `Record<ConductorEvent['type'], SinkDeclaration>` registry.

ADR D2 (2026-07-13) already decided the event should reach the audit trail; only the event was
built. This plan finishes it.

## Files

- `src/conductor/src/types/events.ts` — Task 2. Add the `VerdictFreshnessOutcome` union and
  the `outcome` field to the `verdict_freshness` arm (`:120-138`).
- `src/conductor/src/engine/artifacts.ts` — Task 2. Add `outcome` to the `verdictFreshness`
  facet on `CompletionResult` (`:482-492`); populate it at every return site —
  `prd_audit` (`:1811` stale, `:1830` pass, preserve `~:1786`), `architecture_review_as_built`
  (`:1901` stale, `:1931` pass, preserve `:1869` — currently a bare `{ done: true }`),
  `build_review` (`:1967` preserve, `:1987` stale, `:2021` pass), `manual_test`
  (preserve `~:1597`).
- `src/conductor/src/engine/conductor.ts` — Task 2. Pass `outcome` through the `emitTracked`
  call at `:4104-4114`. No control-flow change.
- `src/conductor/src/engine/event-sinks.ts` — **New**, Task 3. `SinkDeclaration` type and the
  total `EVENT_SINKS` registry; helpers deriving each sink's type list.
- `src/conductor/src/engine/event-persister.ts` — Task 4. Derive its subscription set from the
  registry; delete `ALL_EVENT_TYPES` (`:24-54`).
- `src/conductor/src/engine/audit-trail.ts` — Task 4. Derive `SUBSCRIBED_EVENT_TYPES`
  (`:13-20`) from the registry; add the `verdict_freshness` mapping in `toRecordInput`.
- `src/conductor/src/daemon-cli.ts` — Task 5. Add `case 'verdict_freshness':` to
  `renderDaemonEventUnsafe` (near the `step_retry` arm, `:1861-1871`).
- `src/conductor/test/…` — Tasks 1–5 RED tests (see each task).
- `docs/daemon-operations.md` — Task 6. Document the new log line and its two classes.
- `CHANGELOG.md` — Task 6. `[Unreleased] → ### Fixed`.
- `.docs/release-waivers/staleness-decisions-invisible-in-daemon-log.md` — Task 6, **only if**
  the release gate's path classifier flags a breaking surface (see Task 6).

## Non-goals

- **No change to `gate-code-validity.ts` `gateVerdictStillValid`** — the preserve/rerun
  *decision* is untouched; only its reporting changes. Do not anchor any task to that file.
- **No routing changes for any event other than `verdict_freshness`.** The registry reproduces
  today's behavior exactly for all other 56 types; Task 4 pins this with a test.
- **No extension of the preserve overlay** to `retro`, `finish`, or the generic
  `completion_artifact` path (operator decision).
- **No empty-commit / "record no-change-needed without a commit" mechanism** — its own ticket.
- **No table-driven renderer rewrite** — the registry/switch reconciliation test is the agreed
  guard for this tier (architecture review F5).
- **No revisiting** `3efb0e63` (wiring re-derivation) or `8c12993b` (retry budget); both are on
  `main` and satisfy outcomes 1–4 and 6.

## Task Dependency Graph

```
Task 1 (capture pre-refactor sink sets as a test fixture)
   └─> Task 3 (event-sinks registry, behavior-neutral)
          └─> Task 4 (persister + audit-trail derive from registry; equivalence test)
                 └─> Task 6 (docs + CHANGELOG + waiver-if-needed + full validation)

Task 2 (outcome discriminator: events.ts + artifacts.ts + conductor.ts)
   └─> Task 4  (audit-trail needs the outcome in toRecordInput)
   └─> Task 5 (daemon-cli renderer case)
          └─> Task 6
```

Task 1 and Task 2 are independent and may run in parallel. Task 6 is the join.

## Tasks

### Task 1: Pin the pre-refactor sink sets (RED first)

**Story:** 4
**Type:** happy
**Dependencies:** none.

Before any literal is deleted, capture today's subscription sets as a test fixture — the
equivalence assertion in Task 4 is meaningless if written after the thing it pins is gone
(conflict-check C5).

Add a test that snapshots the current contents of `event-persister.ts` `ALL_EVENT_TYPES` (29
entries) and `audit-trail.ts` `SUBSCRIBED_EVENT_TYPES` (6 entries) as literal arrays in the
test file, and asserts the modules' exported/derived sets equal them.

**RED tests** (new `src/conductor/test/engine/event-sinks.test.ts`):
- `persister subscribes exactly the pre-refactor 29 types` — passes today; must keep passing
  after Task 4 with `verdict_freshness` as the single addition.
- `audit trail subscribes exactly the pre-refactor 6 types` — same.

To make this assertable, `ALL_EVENT_TYPES` and `SUBSCRIBED_EVENT_TYPES` may need narrow
`export`s; that is acceptable and temporary — Task 4 replaces both with registry-derived
values behind the same test.

### Task 2: The outcome discriminator (RED first)

**Story:** 1
**Story:** 2
**Type:** happy, negative
**Dependencies:** none.

Define `export type VerdictFreshnessOutcome = 'rewritten' | 'preserved_surface_miss' |
'stale_invalidated';` in `types/events.ts` and add `outcome: VerdictFreshnessOutcome` to the
`verdict_freshness` arm. Add the same field to the `verdictFreshness` facet on
`CompletionResult` (`artifacts.ts:482-492`).

Populate it at **every** return site:

| Site | Outcome |
| --- | --- |
| `build_review` preserve `:1967` | `preserved_surface_miss` |
| `build_review` pass `:2021` | `rewritten` |
| `build_review` stale `:1987` | `stale_invalidated` |
| `prd_audit` pass `:1830` / stale `:1811` | `rewritten` / `stale_invalidated` |
| `prd_audit` preserve `~:1786` | `preserved_surface_miss` — **currently populates nothing** |
| `as_built` pass `:1931` / stale `:1901` | `rewritten` / `stale_invalidated` |
| `as_built` preserve `:1869` | `preserved_surface_miss` — **currently a bare `{ done: true }`** |
| `manual_test` preserve `~:1597` | `preserved_surface_miss` — **currently populates nothing** |

Read each preserve return exactly before editing; architecture review A4 records 80%
confidence that the `prd_audit` and `manual_test` short-circuits populate nothing, verified in
region rather than line-exact.

Keep `fresh` as a derived convenience (`outcome !== 'stale_invalidated'`) or remove it — the
implementer chooses, but no consumer may distinguish preserve from rewritten via `fresh`.

Thread `outcome` through the `emitTracked` call at `conductor.ts:4104-4114`.

**RED tests** (`artifacts.test.ts` + nearest conductor completion test):
- `build_review preserve reports preserved_surface_miss, not rewritten` — the core Story 1
  assertion; fails today because both paths emit `fresh: true`.
- `as_built preserve populates the facet instead of returning bare done:true` — fails today.
- `prd_audit preserve populates the facet` / `manual_test preserve populates the facet`.
- `a rejection populates stale_invalidated even when gate-code-validity is disabled or the
  artifact has no code stamp` — Story 2 negative path; no reject path leaves `outcome` unset.
- `conductor emits verdict_freshness carrying the outcome` — asserts the field survives the
  emit.

### Task 3: The event-sink registry (RED first)

**Story:** 3
**Type:** happy, negative
**Dependencies:** Task 1.

New `src/conductor/src/engine/event-sinks.ts`:

```ts
export type SinkDeclaration = { render: boolean; persist: boolean; audit: boolean };
export const EVENT_SINKS: Record<ConductorEvent['type'], SinkDeclaration> = { … };
export const persistedEventTypes = (): Array<ConductorEvent['type']> => …;
export const auditedEventTypes  = (): Array<ConductorEvent['type']> => …;
export const renderedEventTypes = (): Array<ConductorEvent['type']> => …;
```

Populate all 57 entries to **reproduce current behavior exactly**, with the single exception
of `verdict_freshness`, which becomes `{ render: true, persist: true, audit: true }`. Every
other type's flags mirror what it does today — including the 28 that are `persist: false`.
`false` is a deliberate, reviewable declaration, not an omission (ADR).

**RED tests** (`event-sinks.test.ts`):
- `registry is total over ConductorEvent['type']` — a type-level assertion plus a runtime
  count check (57 keys); the compile-time guarantee is the `Record` itself.
- `omitting a key fails compilation` — a `@ts-expect-error` fixture proving the totality
  contract is real and not merely conventional (Story 3 happy path).
- `persist:false is a valid declaration and compiles` — Story 3 negative path.

### Task 4: Derive the sinks from the registry (RED first)

**Story:** 4
**Story:** 5
**Type:** happy, negative
**Dependencies:** Task 1, Task 2, Task 3.

Replace `ALL_EVENT_TYPES` in `event-persister.ts` with `persistedEventTypes()` and
`SUBSCRIBED_EVENT_TYPES` in `audit-trail.ts` with `auditedEventTypes()`; delete both literals.
Add the `verdict_freshness` case to `audit-trail.ts` `toRecordInput` so the new subscription
is not silently inert, recording step, artifact and outcome.

**RED tests:**
- `derived persister set == pre-refactor set + verdict_freshness` — Story 4 happy path,
  against Task 1's fixture.
- `derived audit set == pre-refactor set + verdict_freshness` — same.
- `routing all previously-dropped types would fail the equivalence test` — Story 4 negative
  path; asserts the refactor cannot silently expand persistence (architecture review F4).
- `audit trail records a verdict_freshness event with its outcome` — Story 5 happy path.
- `an event with no toRecordInput mapping is skipped without throwing` — Story 5 negative path.

### Task 5: Render the distinction in daemon.log (RED first)

**Story:** 1
**Story:** 2
**Story:** 3
**Type:** happy, negative
**Dependencies:** Task 2.

Add `case 'verdict_freshness':` to `renderDaemonEventUnsafe` (`daemon-cli.ts`, near the
`step_retry` arm at `:1861-1871`). The line names the step, the artifact basename, and the
class in operator language — a preserved verdict and an invalidated one must be
distinguishable at a glance, and a preserved one must not read as a failure.

Note the existing constraint: `formatRetryReason` truncates at 120 characters, which is part
of why a structured event rather than a longer reason string was chosen — do not route this
through the reason string.

**RED tests** (nearest `daemon-cli` render test):
- `preserved_surface_miss renders a distinguishable, non-failure line`.
- `stale_invalidated renders as a rejection`.
- `registry render:true set == renderDaemonEventUnsafe handled-case set` — Story 3's second
  negative path and architecture review F5's agreed guard; prevents registry/switch drift.

### Task 6: Docs, changelog, release gate, full validation

**Story:** none (infrastructure: documentation, changelog and release-gate compliance supporting Stories 1-5)
**Type:** infrastructure
**Dependencies:** Task 4, Task 5.

- `docs/daemon-operations.md` — document the new log line and its two classes, so an operator
  reading `.daemon/daemon.log` knows what "preserved" means. Required by the repo's
  documentation-upkeep rule (new operational behavior).
- `CHANGELOG.md` — `[Unreleased] → ### Fixed`. This is a notable reader-visible implementation
  change, so an entry is required. **Do not bump `VERSION`.**
- **Release gate:** the change is internal-only — `ALL_EVENT_TYPES` and
  `SUBSCRIBED_EVENT_TYPES` are module-private engine consts, and nothing here alters the
  `bin/conduct` CLI, hook wiring, `settings.json` schema, or skill symlink targets
  (architecture review A1, 90%). If the path-based classifier nonetheless flags a breaking
  surface, add `.docs/release-waivers/staleness-decisions-invisible-in-daemon-log.md` in the
  **same diff**, listing every flagged canonical surface name verbatim with a non-empty
  rationale. If any real consumer-visible behavior turns out to change, write a genuine
  `bash migration` block instead — never an empty waiver.
- Run `test/test_harness_integrity.sh` and the full conductor suite; fix all failures before
  committing.

## Coverage Check (story → task)

| Story | Tasks |
| --- | --- |
| 1 | 2, 5 |
| 2 | 2, 5 |
| 3 | 3, 5 |
| 4 | 1, 4 |
| 5 | 4 |

Task 6 is infrastructure (documentation, changelog, release-gate compliance) and covers no
story directly.

## Verification

- [ ] A preserve on all four predicates emits `preserved_surface_miss`; none returns bare
      `{ done: true }`
- [ ] A genuine pass emits `rewritten`; the two are distinguishable in `daemon.log`
- [ ] Every rejection path populates `stale_invalidated`, including with gate-code-validity off
- [ ] `EVENT_SINKS` is total; omitting a key fails `tsc`
- [ ] Derived persister/audit sets equal the pre-refactor sets **plus `verdict_freshness` only**
- [ ] Registry `render:true` set reconciles with the renderer switch
- [ ] `gate-code-validity.ts` is unmodified
- [ ] `docs/daemon-operations.md` updated; `CHANGELOG.md` entry added; `VERSION` unchanged
- [ ] `test/test_harness_integrity.sh` passes

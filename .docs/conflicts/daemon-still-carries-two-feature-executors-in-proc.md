# Conflict Check: The daemon runs every feature in one executor (#3333)

**Date:** 2026-10-24
**Stories checked:** `.docs/stories/daemon-still-carries-two-feature-executors-in-proc.md` (Stories 1–4)
against the full `.docs/stories/` corpus (625 files), narrowed by subject: executor selection,
`executor_isolation`, the daemon `runFeature` seam, daemon-log slug attribution (console tee,
global subscriber), and config unknown or retired top-level keys.
**Result:** PASSED. 0 blocking. 2 degrading conflicts, both resolved by in-place story amendment
(operator decision 2026-10-24). Two pre-existing cross-spec dependencies were resolved during
`/stories`.

## Resolved before this check (during /stories, operator decisions 2026-10-24)

- **#3377 `daemon-commits-carry-no-bot-co-authored-by-trailer.md`, Story 2 (sequencing / contradiction).**
  Its criteria required in-process dispatches to write the bot co-author file. That contradicts
  Story 1 here. Resolution: this spec is blocked by #3377, which is in flight. Its in-process
  criteria and Done-When item were removed in place, and its isolation-mode wording now describes a
  daemon dispatch.
- **#2392 `engine-updates-reach-dispatched-features-only-afte.md`, Stories 1, 7, 8, 10, 12, 15, 16 (contradiction).**
  Story 15 specified the in-process rollback lever and its config values. Story 16 specified
  child-versus-in-process parity. Other criteria were phrased as "exactly as in-process". All of
  these were amended in place to describe the single child executor. Story 15 now matches Story 2
  here, and Story 16 checks against the fixture's expected results.

## Conflict: Legacy config story allows unknown top-level keys

**Stories involved:** Story 2 (retired executor key fails to load) vs ST-052 Config File Loading and Validation
**Files:** [.docs/stories/daemon-still-carries-two-feature-executors-in-proc.md] vs [.docs/stories/features/config/ST-052-config-loading.md]
**Type:** contradiction
**Severity:** degrading

**Description:** ST-052 said an unknown top-level key "warns about unrecognized keys but does not
fail". Story 2 requires `executor_isolation` to fail with the unknown-top-level-key error. The
current code and later accepted stories (`config-keys-that-validate-but-have-no-consumer-inc.md`
Story 2, `multi-child-feature-cannot-resume-after-an-operato.md`) already reject unknown top-level
keys, so ST-052 was stale. It is predecessor-era: it names `.harness/config.yml`.

**Resolution Options:**
1. Amend ST-052's unknown-key negative path and Done-When in place to match shipped rejection behavior.
2. Accept it as degrading and leave ST-052 stale.

**Resolution (selected):** Option 1. ST-052 now says an unknown top-level key fails loading with an
error naming it.

## Conflict: Concurrency attribution test relied on the in-supervisor ownership tag

**Stories involved:** Story 4 (daemon log attribution unchanged) vs enable-single-repo-daemon-concurrency, attribution story
**Files:** [.docs/stories/daemon-still-carries-two-feature-executors-in-proc.md] vs [.docs/stories/enable-single-repo-daemon-concurrency-un-clamp-the.md]
**Type:** overlap
**Severity:** degrading

**Description:** Both acceptance criteria hold together. A console warning during a build happens
in the child executor, which forwards it with its slug tag through one central seam (the broker's
`featureLogFor`). Genuinely daemon-global lines stay bare `[daemon]`. Checked both ways: fully
satisfying Story 4 keeps that story's criteria true, and fully satisfying that story's criteria
keeps Story 4 true. That story's Done-When item, however, named a test of "the warn/error tee and
the global bus subscriber" with interleaved fake in-process builds. That test exercises the
ownership tag this spec removes.

**Resolution Options:**
1. Reword the Done-When item to verify attribution of forwarded output from two concurrent child executors.
2. Accept it as degrading.

**Resolution (selected):** Option 1.

## Examined, no conflict

- `park-all-dispatch-paths.md`: criteria about `deps.runFeature(S)` being called once, or never
  when parked. The park guard runs before dispatch whatever the execution dependency is.
  Story 1's one-of scheduler dependency keeps `runFeature` as the core's unit-test injection, so
  both directions hold.
- `daemon-event-driven-wake-for-parked-halted-feature.md`: the watcher is disposed before the
  core's dispatch can tear down the worktree. The ordering is independent of the executor form.
- Matches for "in-process" in `wiring-check-retries…`, `reject-non-date-named-adrs…`,
  `ci-conductor-job-fails…`, `enforce-the-plan-task-count…`, `daemon-api-rate-limit-episode…`,
  `daemon-build-review-can-wedge…`, `audit-trail-write-completeness…`, `daemon-build-start-base-refresh`,
  `codex-safety-and-self-host-parity-907`, and `missing-session-hook-files…`: the term means "inside
  the current process" (a predicate or handler), not the executor mode. Unrelated.

## ADRs

**Examined (subject overlaps):**
- `adr-2026-10-15-per-dispatch-engine-pinned-executor`: amended 2026-10-24. D1–D10 are consistent with Stories 1–4.
- `adr-2026-08-27-daemon-dispatcher-executor-seam`: amended 2026-10-24 (D1, D8). Story 4 matches the D8 amendment.
- `adr-2026-07-13-park-all-dispatch-paths`: the guard sits before dispatch, compatible with Story 1.
- `adr-2026-07-26-event-sink-registry-exhaustiveness`: no new event types, no conflict.
- `adr-2026-09-11-github-operation-ownership`: its 2026-10-24 #3377 amendment parenthetically says
  "one per dispatch under `executor_isolation: child`". This describes the child process, which
  remains the only mode; the behavior it states still holds. No conflict, and no amendment
  (wording only).
- `adr-2026-09-10-portable-build-review-policy` and `adr-2026-10-23-slice-topology-from-sealed-plan`:
  their retired-key warn-and-ignore rules apply only to build-review rubric ids and built-in steps,
  not top-level keys. No conflict with Story 2.

**Narrowed out:** all other approved ADRs. They do not address daemon execution composition,
daemon-log attribution, or top-level config key handling.

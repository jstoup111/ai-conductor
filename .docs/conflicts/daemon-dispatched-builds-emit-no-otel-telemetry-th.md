# Conflict Check: daemon-dispatched-builds-emit-no-otel-telemetry-th

**Date:** 2026-08-26
**Stories scanned:** all of `.docs/stories/` (existing corpus) + the 5 new stories in
`daemon-dispatched-builds-emit-no-otel-telemetry-th.md`
**ADR corpus:** `repo_wide` (per `conflict_check.adr_corpus`)
**Result:** PASSED — zero blocking, zero degrading conflicts

## ADR corpus accounting (repo_wide)

- **Examined:** all 296 decision files in `.docs/decisions/` (full-pass sweep performed during
  this spec's architecture review, reused here; every title + Status read, Decision sections read
  for all subject-overlapping candidates).
- **Narrowed-in (subject overlaps these stories — telemetry/bus/visualizer/daemon lifecycle/run
  identity):** adr-014-otel-observability-exporter (as amended 2026-08-26),
  adr-2026-07-27-cold-start-within-step-retries,
  adr-2026-07-26-event-sink-registry-exhaustiveness, 003-ui-renderer-plugin-point,
  002-plugin-manifest-and-discovery, adr-2026-07-07-audit-trail-event-sink,
  adr-2026-08-08-pipeline-owned-closeout-timestamps,
  adr-2026-08-11-halt-events-ride-the-persisted-spine,
  adr-2026-07-10-intra-step-build-progress-events,
  adr-2026-07-04-kickback-event-emission-and-log-prominence,
  adr-2026-08-19-live-provider-stream-observation,
  adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope,
  adr-2026-08-12-execution-lifecycle-completeness-for-timing,
  adr-2026-07-29-engine-observed-provider-time-partition,
  adr-2026-07-11-pipeline-state-durability,
  adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity,
  adr-2026-08-09-worktree-local-provider-scratch,
  adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting,
  adr-010-pidfile-lock-daemon-liveness, adr-2026-07-03-daemon-auto-restart-stale-engine,
  adr-2026-07-07-single-generation-stale-respawn, adr-2026-07-04-pending-restart-queue,
  adr-2026-07-05-daemon-rate-limit-episode-coordinator,
  adr-2026-07-29-operator-park-scheduling-unit-boundary,
  adr-2026-08-06-honest-park-termination-boundary,
  adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation,
  adr-2026-08-12-live-provider-coverage-from-plugin-registry.
- **Narrowed-out:** the remaining decision files (subjects: build_review rubrics, intake/ledger,
  release gates, rebase/CI recovery, PRD/story gating, self-host containment, etc. — no shared
  behavior, entity, field, or gate with these stories).
- **Supersession (repo_wide parsing):** excluded as fully superseded: none in the narrowed-in
  set. Repo-wide superseded files (adr-2026-07-04-operator-park-marker,
  adr-2026-07-12-wiring-check-gate, adr-2026-07-25-content-addressed-full-suite-proof, the four
  rubric ADRs superseded by adr-2026-08-22-one-owner-per-review-question) all fall outside the
  narrowed-in subject area; the two partial supersessions
  (adr-2026-07-22-build-dispatch-json-usage-capture, 001-harness-architecture) were retained and
  compared.

## Pairwise scan (6 types, both directions)

- Story 1 vs Story 4 (emit vs unchanged-when-disabled): disjoint config states; satisfying either
  leaves the other intact. No oscillation.
- Story 1 vs Story 2 ("equivalent to interactive" vs per-dispatch traces): Story 1's happy path
  scopes equivalence to a single dispatch's run trace; Story 2 owns cross-dispatch stitching by
  durable run id. Compatible in both directions.
- Story 3 vs Story 4 (flush on end vs never-fatal degradation): bounded flush satisfies both;
  a hanging endpoint neither blocks stop (S3) nor fails the build (S4). No oscillation.
- Story 5 vs Stories 1–4: the parity guard asserts the union of the other stories' signals;
  satisfying it constrains nothing they forbid.
- ADR-vs-story: adr-2026-07-27-cold-start-within-step-retries D7 ("written only from the step
  runner's own `this.sessionId`") vs Story 2 — Story 2's negative path encodes conformance
  (read-only resolve, injected id, no write), adopted as review condition C1; no opposing
  sentences exist in the accepted story text. adr-2026-07-26 event-sink exhaustiveness vs
  Story 5 — Story 5 encodes the derivation requirement (C2). adr-014 (as amended) vs Story 1 —
  the amendment note records the shared-seam wiring the story asserts. All remaining
  narrowed-in ADRs constrain the plan's mechanism, not story-level behavior; no pair produced
  grounded opposing sentences.

## Conflicts

None.

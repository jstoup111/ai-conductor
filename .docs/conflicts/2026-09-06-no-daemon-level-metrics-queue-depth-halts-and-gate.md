# Conflict Report: Daemon-level metrics (#1937)

**Date:** 2026-09-06
**Stories checked:** `.docs/stories/no-daemon-level-metrics-queue-depth-halts-and-gate.md` (Stories 1–8)
against every story file in `.docs/stories/` sharing a telemetry, halt, backlog, timing, or config
surface (16 files, all stories), and against the repo-wide approved ADR corpus
(`conflict_check.adr_corpus: repo_wide`).
**ADR corpus:** 561 `adr-*.md` files scanned by subject; **28 examined in full** (adr-014 in its
amended worktree form, halt classification ×4, timing ×2, blocked/waiting/gated channels ×5,
event-sink exhaustiveness, config-key registry, scaffolder, conduct-state port, dispatcher–executor
seam, worktree lifecycle ×3, cost rollup ×2, kickback ×3, stall, credential gate, park boundary);
~157 keyword hits narrowed out as homonyms (PR/CI/release "gate" ADRs, authoring-isolation ADRs);
2 excluded as unambiguously fully superseded (adr-2026-07-04-operator-park-marker,
adr-2026-08-29-operator-authorized-kickback-budget-recovery — each successor examined).
**Result:** 2 blocking story-vs-story conflicts (one root cause), 3 degrading, 0 ADR-vs-story.
All resolved below.

## Conflict: Metric Resource identity — worker-scoped vs feature-scoped

**Stories involved:** Story 2 (new) vs Story 2 "The metric Resource is feature-stable…" (#1938)
**Files:** `.docs/stories/no-daemon-level-metrics-queue-depth-halts-and-gate.md` vs
`.docs/stories/every-project-reports-the-same-otel-identity-so-me.md`
**Type:** contradiction
**Severity:** blocking

**New (verbatim):** "the metric Resource carries service.name=ai-conductor, service.instance.id=P/W,
conductor.project, conductor.worker=W, and host.name equal to the OS hostname" […] "it carries no
conductor.feature and no conductor.branch attribute"
**Existing (verbatim):** "service.instance.id equals the project and feature joined by a slash, using
the same resolved project name the data-point seam uses" […] Done When: "unchanged
`conductor.feature`/`conductor.project`/`conductor.branch` on the metric Resource"

**Description:** Two-directional: if the existing story holds, one daemon-lifetime MeterProvider
cannot serve many features (Story 1 fails); if the new story holds, the existing Done-When fails
outright. Root cause is the design (adr-014 identity clause), which the approved 2026-09-06
amendment D8 revises in place — so this is a superseded shipped story, not a live design conflict.

**Resolution Options:**
1. Replace the shipped story's superseded assertions in place with the D8 contract (no amendment
   record in a story artifact, per the stories skill).
2. Keep two Resources (per-feature for per-feature instruments, per-worker for daemon ones) — contradicts D7's single meter.
3. Withdraw D8 and keep `<project>/<feature>` — reintroduces the per-dispatch meter and the counter reset defect.

**Recommendation:** Option 1. Because `landSpec`'s stem gate rejects foreign-stem story edits on a
spec branch, the replacement ships as a **companion main-based PR** opened alongside this spec PR
(precedent: PR #1928 beside #1927). Replacement text is in this report's appendix.

## Conflict: "exactly the five feature-stable attributes" on the metric Resource

**Stories involved:** Story 2 (new) vs Story 3 "Metric identity and backend series count are unchanged" (#2235)
**Files:** `.docs/stories/no-daemon-level-metrics-queue-depth-halts-and-gate.md` vs
`.docs/stories/stamp-released-harness-version-on-otel-trace-resou.md`
**Type:** contradiction
**Severity:** blocking

**New (verbatim):** "it carries no conductor.feature and no conductor.branch attribute"
**Existing (verbatim):** "then its attribute set is exactly the five feature-stable attributes and
contains no `service.version`"

**Description:** Same root as the conflict above; the five-attribute set named there includes
`conductor.feature` and `conductor.branch`, which D8 moves off the metric Resource. The story's
real intent — no `service.version` on the metric Resource, series count unchanged — survives.

**Resolution Options:**
1. Replace "exactly the five feature-stable attributes" with "exactly the worker-stable attribute
   set (service.name, service.instance.id, conductor.project, conductor.worker, host.name)" and
   keep the `service.version` exclusion — same companion PR.
2. Drop the exact-set assertion and keep only the `service.version` exclusion — weaker.

**Recommendation:** Option 1, in the same companion PR.

## Degrading: per-dispatch stop "force-flushes traces and metrics"

**Stories involved:** Story 1 (new) vs Story 3 (#1934, `daemon-dispatched-builds-emit-no-otel-telemetry-th.md`)
**Type:** behavioral overlap **Severity:** degrading
**Existing (verbatim):** "the visualizer's stop is awaited and force-flushes traces and metrics
before the scope is torn down"
**Resolution applied:** Story 1's negative path now states the per-dispatch stop force-flushes the
shared meter but never shuts it down. Both stories hold; no edit to the shipped story.

## Degrading: `daemon_dispatched` Story 2 resource wording predates the two-layer split

**Existing (verbatim):** "then its resource carries conductor.feature=S, conductor.project=P, and a
non-empty conductor.run.id" (`daemon-dispatched-builds-emit-no-otel-telemetry-th.md`)
**Resolution:** already true of the *trace* Resource under D8 (Story 2 negative path asserts exactly
that); read as trace-scoped, no conflict. Accepted as-is. Same disposition for the original
`otel-observability.md` "Run correlation via resource attributes" story, the ancestor of both.

## Degrading: halt-class enumeration incompleteness

**Stories involved:** Story 4 (new) vs `every-as-built-blocked-verdict-halts-needs-human-i.md`,
`a-halted-feature-only-re-runs-when-a-human-clears-.md` ("halts with class kickback-cap",
"needs-human, plan-gap, over-scope, or kickback-cap")
**Type:** state (coverage gap) **Severity:** degrading
**Resolution applied:** verified in source that the conductor writes `kickback-cap` and `over-scope`
to the sidecar past the `HaltClass` union (`halt-classification.ts`, `conductor.ts` writeHaltMarker
cast) and that `readHaltClass` folds them to `unclassified`. Story 4 and adr-014 D9 now name the
closed set of eight sidecar values and require the two operator-owned classes verbatim.

## ADR-vs-story

No grounded conflict. One candidate was raised and dismissed: adr-2026-07-26 (SinkDeclaration
without `otel`) and adr-2026-08-11 ("OtelVisualizer subscribes from its own hardcoded list") vs
Story 7's "subscription list derived from the registry". The mechanism Story 7 relies on shipped
in #1934 (`SinkDeclaration.otel`, `otelEventTypes()`, `otel-visualizer.ts` subscribes from it) — the
two ADRs' prose is stale relative to code, not binding against the story. Not amended here; out of
this feature's scope.

Candidates examined and clean (both directions): halt classification ADRs vs Story 4 (after the
eight-value fix); timing ADRs vs Story 6 (absence-not-zero matches verbatim); blocked-state ADRs vs
Story 3 (`backlog{state=blocked}` is their channel; `blocked_reason` is a different signal);
config-key registry + scaffolder vs Story 2 (build-time obligations, carried as review condition C4);
conduct-state port vs Story 6 (reads only); dispatcher–executor seam vs Story 3 (snapshot from the
pass that already ran); adr-014 D1–D9 vs Stories 1, 2, 7, 8 (D8 supersedes the prior identity clause
in place, as every earlier amendment in that ADR does).

## Oscillation check

Pairs sharing a gate or field were tested both ways; no pair yields two "no" answers. The nearest
candidate — Story 1 "one meter for the daemon's life" vs Story 8 "interactive visualizer shuts down
its own meter" — is resolved by the ownership flag: each holds with the other satisfied.

## Appendix: companion-PR replacement text

See `.docs/conflicts/` companion notes in the spec PR body; the replacement stories are applied on
a fresh `origin/main`-based branch, not on this spec branch.

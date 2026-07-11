# Conflict Check: emit-intra-step-build-progress-and-stall-as-events (issue #347)

**Date:** 2026-07-10
**Scope:** new stories vs full `.docs/stories/` corpus, focused on shared surfaces:
`types/events.ts` union, `ui/subscriber.ts` fan-out, `renderDaemonEvent`,
`createRenderer`, `OtelVisualizer`, `EventPersister`, plugin loader, stall breaker.
**Result:** PASSED — 1 blocking conflict found and RESOLVED in-session; 2 degrading
notes accepted; no unresolved conflicts remain.

## Conflict 1 (blocking → RESOLVED): duplicate JSON-stdout plugin

**Stories involved:** "JSON-stdout ui_renderer plugin (Wave C)" (new, as originally
drafted) vs `wave-c-json-stdout-subscriber.md` (Accepted, SHIPPED — the plugin exists
at `plugins/json-stdout-subscriber/` and its `handle()` already serializes any
`ConductorEvent` generically).
**Type:** behavioral overlap (re-implementing shipped work; two plugins racing for
the same `ui_renderer: json-stdout` selection).
**Severity:** blocking (verified: plugin source read at
`plugins/json-stdout-subscriber/index.ts` — confidence ~98%).

**Resolution applied (Option 1, least disruptive):** the new story was rewritten
in-place ("existing json-stdout ui_renderer receives the new kinds") to extend only
the UI subscription fan-out list (`ui/subscriber.ts`) so the *existing* plugin
receives `build_progress`/`build_no_progress`/`build_stall` unchanged; its Done-When
now pins an empty diff on the plugin's own source. Rejected alternatives: (2) ship a
second plugin variant — duplicate surface, selection ambiguity; (3) have the plugin
subscribe itself to the raw bus — violates the Wave C `ui_renderer` contract.

## Note A (degrading, accepted): PR #470 touches the build-completion seam

Open spec PR #470 ("unify build-completion evidence derivation") reworks the
completion-evidence area whose gate-miss outcome feeds the existing stall breaker.
This feature's story pins "existing stall-breaker tests pass unmodified", which is
merge-order sensitive: if #470 lands first, the pinned code will have moved (though
the breaker's *observable* semantics should survive). Not a contradiction — both
specs are additive at different layers. Mitigation: standard
refresh-spec-branch-base-before-build rebase; the plan notes the seam.

## Note B (degrading, accepted): OTel/persister list-pinning tests

`otel-observability.md` / `wave-c-telemetry-event-log.md` shipped tests that may pin
the exact OTel `eventTypes` subscription list and `EventPersister.ALL_EVENT_TYPES`
contents. Adding the three kinds legitimately updates those pinned lists; the plan
must update the pinning tests in the same task as the list edits (expected churn,
not a design conflict).

## Pairs examined and passed clean

- `daemon-logs-surface-kickback-steps-visibly.md` — also extends `renderDaemonEvent`;
  purely additive event kinds, no line-format contradiction, no "only step
  boundaries" invariant asserted anywhere.
- `retry-as-escalation.md` — `step_retry` semantics untouched by this feature.
- `otel-observability.md` — exporter default-off invariant preserved (new events are
  simply additional mapped kinds when enabled).
- `audit-trail-write-completeness-for-retro-under-fre.md` — events.jsonl append-only
  contract preserved; new kinds are additive lines.
- `post-rebase-build-invalidation…`, `phase-9.0-rebase-on-latest.md` — rebase-step
  scope; the watcher runs only during the build step, no interaction.
- `configurable-pr-timing` (PR #267) — separate config block, no key collision with
  the new `build_progress` config block.

No state conflicts (watcher is read-only over `task-status.json`; adr-2026-07-05
engine-owned writer boundary respected), no resource contention (per-worktree watcher
instances, no shared ports/files), no sequencing cycles.

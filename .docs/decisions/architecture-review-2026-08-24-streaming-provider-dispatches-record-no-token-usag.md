# Architecture Review: Streaming provider dispatches record no token usage or cost

**Date:** 2026-08-24
**Issue:** jstoup111/ai-conductor#1857
**Tier:** L (full review) — `.docs/complexity/streaming-provider-dispatches-record-no-token-usag.md`
**Track:** technical — `.docs/track/streaming-provider-dispatches-record-no-token-usag.md`
**Input reviewed:** the technical intent from `/explore` plus the recorded approach in
`.memory/decisions/2026-08-24-streaming-dispatch-usage-capture.md`. Stories and plan do not exist yet.
**ADR corpus swept:** repo_wide (497 ADRs, per `.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding)

From the track marker: collapse `invoke()`/`invokeInteractive()` into one dispatch path so streaming
dispatches capture usage, across BOTH providers. Reporting-honesty rework is explicitly out of scope
and was filed as jstoup111/ai-conductor#1863. This review does not widen that boundary.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. Both adapters already own a working envelope parser (`parseJsonResult`, `parseCodexJsonl`) and both already emit `onProviderStream`. The change is wiring, not new capability. |
| Prerequisites | None external. No migration, no config key, no account setup. |
| Integration surface | Two third-party CLI seams (`claude`, `codex`) plus one published plugin contract. Crosses `execution/` and `engine/` — two module boundaries, not three-plus. |
| Data implications | None. `TokenUsage`, `InvokeResult`, and the `provider_attempt` event shape are all unchanged; the change is that the field arrives populated. |
| Performance risk | Negligible on cost. NDJSON parsing per streaming dispatch replaces raw passthrough; the autonomous path has carried it since #1441 with no recorded regression. |
| Worktree isolation | Unaffected. No new port, service, database, or shared file. |

## Complexity

**High** by §3's criteria — a published interface with an external implementor contract, two
external CLI seams, and a 73-file test surface — but *not* a spike: no unknown technology and no
unclear requirement. `adr-2026-08-19-live-provider-stream-observation` already probed and shipped
the exact envelope-plus-live-stream shape this feature generalizes, so the novel-pattern risk that
would justify a time-boxed spike is absent.

## Alignment

**Approved decisions consulted (higher authority first):**

- `adr-2026-07-22-build-dispatch-json-usage-capture` — its consequence that `invokeInteractive`
  sessions are "unmetered where they occur" is falsified by this feature's evidence and has been
  **amended in place** with an additive note; the original assertion is preserved and the ADR's
  usage-capture decision is untouched.
- `adr-2026-08-19-live-provider-stream-observation` — governs and *enables* this work: it verified
  that the live stream and the parseable terminal result are the same artifact. This feature
  extends its shape to the path it did not cover; it is cited and reused, not superseded.
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state` — the three-valued metering model is
  binding and unchanged. This feature restores measurements into it and fabricates no cost.
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry` — the plugin registry stays the
  provider enumeration authority; nothing here re-introduces a maintained provider list.
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` and
  `adr-2026-07-27-codex-fresh-session-per-step-contract` — fresh-session enforcement at the adapter
  boundary (`enforceFreshSessionOptions`) is on the dispatch path being unified and must survive it
  unchanged. Recorded as a condition below.

**Convention over precedent.** The two-method shape in the current code is precedent, not decision:
no ADR ever chose it, and it has produced two defects. It is rejected as precedent per §1.

**Pattern consistency.** The chosen shape follows an established local pattern rather than inventing
one: behavior that varies per dispatch is already carried as a field on `InvokeOptions`
(`interactive`, `onProviderStream`, `dangerouslySkipPermissions`, `selfHost`, `spawnPermit`), and
adapters branch on it internally. Adding a live-render field and deleting the second method moves
this feature *onto* that pattern. The traits BUILD must preserve: the field is optional, its absence
reproduces today's buffered behavior, and the adapter — never the caller — owns how it is honored.
Variation allowed: the field's name and whether adapters branch early or late.

**State management.** No new state. The dispatch remains a straight-line classify-after-exit; the
render decision is a parameter, not a machine.

**Domain boundaries.** `engine/` continues to decide *what* to dispatch and `execution/` continues
to own *how* — this feature removes an `engine/`-side workaround (`streamingProviderRuntimes`
reaching in to swap one adapter method for another) and returns the decision to the adapter. Net
reduction in coupling.

**Security boundaries.** No new endpoint, input, or authorization surface. The codex unattended
sandbox/approval configuration is built in the same `buildArgs` the envelope flag lives in and must
be preserved exactly — recorded as a condition.

**Production DI defaults.** Not applicable; no store, in-memory or otherwise, is introduced.

**Diagram accuracy.** `.docs/architecture/streaming-provider-dispatches-record-no-token-usag.md`
was authored for this feature and both Mermaid blocks pass `render-diagrams --check`.

## Domain Integrity

| Principle | Check | Result |
|---|---|---|
| No primitive obsession | An optional **stream-consumer** field is added, deliberately not a boolean | **Pass.** The object names who receives observations rather than encoding a yes/no, so the future burn-control extension needs no further interface change. Its interaction with the existing `interactive` field is still constrained by C1. |
| Parse, don't validate | Envelope parsing stays at the adapter boundary in the existing parsers | Pass |
| Invalid states unrepresentable | See the flagged condition on `interactive` × stream consumer | **Condition** |
| Semantic types | No new type introduced | N/A |
| Exhaustive matching | No new switch over a domain state | Pass |

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| Unified dispatch member on `LLMProvider` | `step-runners.ts` for both autonomous and streaming steps (replacing the `streamingProviderRuntimes` swap at `step-runners.ts:1249-1258`), `step-runners.ts:902` and `:1551`, and `attribution-lane.ts:363-364`'s delegator |
| New optional stream-consumer field on `InvokeOptions` | Set by `step-runners.ts` at the streaming dispatch site; consumed inside each adapter's argument construction and stdio selection |
| `onProviderStream` wiring on the streaming path | Passed from the same `step-runners.ts` dispatch site that already supplies it on the autonomous path; consumed by the existing `daemon status` live surface built in #1441 |
| Loosened `llm_provider` plugin validation (`invoke` only) | `plugin-loader.ts:36-41`, reached from the plugin discovery path at startup |
| Removal of `invokeInteractive` from `LLMProvider` and `plugin-loader` | Not a new surface — a deletion. Recorded so the §12 as-built sweep reads its absence as intended rather than as a missing rung. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Observer-rendered streaming output is worse than today's raw passthrough, degrading operator visibility | Integration | Medium | High | Pin a before/after comparison in a story before the plan locks; it is an explicit assumption in `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` |
| Fresh-session enforcement or codex's unattended sandbox/approval config is dropped while merging two argument-construction bodies | Technical | Medium | High | Condition C2 below; both are on the merged path and each needs a pinned negative-path story |
| A third-party plugin's `invokeInteractive` behavior goes inert without its author noticing | Integration | Low | Medium | Non-fatal by construction — the plugin still loads and still dispatches, because `plugin-loader` requires strictly less than before. With the member removed there is no type-level notice, so the signal must come from `docs/guides/multiprovider.md`, the updated reference plugin, and a release note (C4) |
| The installed codex CLI's `exec --json` envelope has drifted since the `codex-cli 0.145.0` probe | Integration | Low | Medium | Re-probe at implementation time; recorded as an assumption in the ADR |
| 73 test files reference `invokeInteractive`; a mechanical rename leaves tests asserting the old seam and passing vacuously | Knowledge | Medium | Medium | Condition C3 |

## ADRs Created

Both were checked against the swept corpus for an existing governing decision first; neither
structural decision is covered by an existing APPROVED ADR.

1. `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` — revises the component contract
   and the external plugin integration seam: `invokeInteractive` is **removed** from `LLMProvider`
   and from `plugin-loader`'s required members, and live observation becomes a stream-consumer seam
   on the single remaining dispatch member. Amends
   `adr-2026-07-22-build-dispatch-json-usage-capture`'s interactive-path consequence.

   An earlier draft of this ADR claimed removal would hard-break third-party plugins at load time.
   That was verified false and the ADR records the corrected facts: the `LLMProvider` type is not
   published (`src/conductor/package.json` has no `types`; `index.ts` does not re-export it),
   dropping a required duck-type check is a loosening, extra class members still satisfy
   `implements`, and no third-party provider plugin exists on this machine.
2. `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` — revises the integration
   pattern at the two third-party CLI seams and relocates operator visibility onto the existing
   observation port. Extends `adr-2026-08-19-live-provider-stream-observation`.

**Amended in place:** `adr-2026-07-22-build-dispatch-json-usage-capture` (additive note; original
assertion preserved).

## Conditions

- **C1 — A REPL dispatch and a stream consumer must not be simultaneously expressible, or the
  combination must be documented as inert.** A REPL renders to the operator's terminal and supplies
  no consumer; a dispatch that claims both has no meaning. Constrain the pair in the type where
  practical rather than leaving the invalid pairing merely undocumented.
- **C2 — Fresh-session enforcement and codex's unattended sandbox/approval configuration must
  survive the merge of the two argument-construction bodies.** Both currently live on the path
  being unified. Each needs a negative-path story asserting it is still applied after unification,
  not merely that the happy path still dispatches.
- **C3 — Tests that reference `invokeInteractive` must be re-pointed at the unified path, not
  mechanically renamed.** A test that still exercises the deprecated member proves nothing about
  the path production takes. Any test deliberately retained on the deprecated member must say why.
- **C4 — The documentation named in the ADRs' follow-ups ships in the same PR.** The plugin
  contract sentence at `docs/guides/multiprovider.md:192` and `docs/contributing/extending.md` are
  canonical affected documentation under this repository's Documentation Upkeep rule.
- **C5 — The live-visibility comparison is pinned by a story before `/plan` locks the breakdown.**
  It is the one assumption in these ADRs whose failure is a user-visible regression.
- **C6 — The provider-plugin contract change carries a release note and an updated reference
  plugin.** With `invokeInteractive` removed from the type, documentation and
  `plugins/recorder-provider` are the only places an author can learn the member is gone.

## Advisory: early overlap scan

`conduct-ts overlap-scan` over the Wiring Surface paths returns a very large match set, dominated by
unmerged spec branches whose only relationship to `llm-provider.ts` is their merge base. Signal is
low. One entry is worth naming: `spec/lock-474-s-breaking-surfaces-before-v1-decide-only` (#552, a
v1 blocker) is the programme for pinning consumer-visible surfaces before the v1.0 tag. This feature
touches such a surface, and the chosen shape is deliberately backward compatible — the plugin
requirement is loosened, never tightened — so it lands as non-breaking and does not compete with
that programme. No blocking overlap found. Advisory only; this does not affect the verdict.

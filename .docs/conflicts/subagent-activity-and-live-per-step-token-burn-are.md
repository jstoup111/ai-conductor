# Conflict Check: Live subagent activity and per-step token burn (#1441)

**Date:** 2026-08-19
**Scope:** the 7 stories in `.docs/stories/subagent-activity-and-live-per-step-token-burn-are.md`
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus` in `.ai-conductor/config.yml:101`)
**Result:** PASSED CLEAN after 1 blocking conflict was resolved. Zero blocking conflicts remain.
Zero degrading conflicts accepted.

## ADR corpus: examined and narrowed out

All 294 titled ADRs in `.docs/decisions/` were enumerated. No ADR was excluded on supersession
grounds — no ADR in this repository is currently marked unambiguously fully superseded in a way
that touches this subject, so the narrowing below is by subject overlap alone.

**Examined against the stories (9):**

| ADR filename stem | Why it overlaps |
|---|---|
| `adr-2026-07-22-build-dispatch-json-usage-capture` | Owns the dispatch output format the stories change |
| `adr-2026-08-19-live-provider-stream-observation` | This feature's own decision |
| `adr-2026-07-10-intra-step-build-progress-events` | Owns intra-step event emission cadence |
| `adr-2026-07-26-event-sink-registry-exhaustiveness` | Owns how a new event variant must be declared |
| `adr-2026-07-27-cost-unmetered-is-a-first-class-state` | Owns "absence is a state, never zero" |
| `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` | Owns token-vs-cost aggregate separation |
| `adr-2026-07-29-engine-observed-provider-time-partition` | Owns the elapsed-time partition around `invoke()` |
| `adr-2026-07-30-provider-preparation-lifecycle-supervision` | Owns the callback-threading path into the adapter |
| `adr-2026-07-24-provider-aware-step-execution` | Owns provider-neutral vs provider-local behavior |

**Narrowed out (285)** — no subject overlap with these stories. The excluded set is everything
else in `.docs/decisions/`: the intake/claim/ledger family, the park/unpark and daemon-lifecycle
family, the rebase and evidence-attribution family, the build_review rubric and disposition family,
the release/version/migration-gate family, the memory-provider family, the seal/protected-artifact
family, the PR/publication family, and the engineer-loop family. None of them addresses provider
stream transport, event emission cadence, the event union's sink declarations, token accounting, or
the `daemon status` in-progress row.

## Conflicts found

### Conflict 1: The close-boundary emission rule contradicts the final-child-state guarantee

**Stories involved:** Story 2 (A running Claude step reports how many child units of work are
active) vs Story 6 (Emission is throttled so a long step does not flood the ledger)
**Files:** `.docs/stories/subagent-activity-and-live-per-step-token-burn-are.md` (both)
**Type:** oscillating
**Severity:** blocking

**Story 2 opposing sentence (verbatim):** "Given a `Task` block that is opened and the stream then
ends without its tool_result, when the dispatch completes, then the final observation still reports
the child as active rather than silently closing it, and the dispatch completes normally."

**Story 6 opposing sentence (verbatim):** "Given the dispatch ends mid-interval, when it completes,
then no further events are emitted for that step and no timer outlives the dispatch."

**Description:**
Both directions of the oscillation test fail. Satisfy Story 6 fully — no emission after the
dispatch ends, at most one per interval — and the last *persisted* record can predate the last
stream record, so a dispatch that opens a child and then ends leaves `events.jsonl` reporting
`activeChildren: 0` while a child was live at the close. Satisfy Story 2's guarantee at the
observable level — the final state reaches the operator — and Story 6's no-emission-after-close
rule is broken. Each story is individually implementable and reads as reasonable; there is no
implementation satisfying both as written, so this would surface downstream as unexplained rework
rather than as a failing build.

The stakes are exactly the misread the feature exists to prevent: an operator looking at a step
that has stopped producing output would see `children: 0` and conclude the coordinator is merely
waiting, when in fact a child was still open when the stream died.

**Resolution Options:**
1. **Throttle-exempt close-boundary flush.** One best-effort flush emission at the dispatch's close
   boundary, exempt from the minimum interval, carrying the final observation; nothing emitted for
   that step afterwards. Story 6 keeps its no-timer and bounded-volume guarantees; Story 2's final
   state reaches the ledger.
2. **Accept a degrading compromise.** Drop Story 2's final-state guarantee and accept that the last
   record may be up to one interval stale.
3. **Kick back to `architecture_review` in amendment mode** and add a close-boundary seam to the
   design before stories re-derive.

**Recommendation:** Option 1 — it costs one extra emission per dispatch, preserves every property
both stories were written to protect, and needs no new component. Option 2 reintroduces the exact
failure mode being fixed. Option 3 is disproportionate: the gap is one clause in an already-approved
emission contract, not a missing component.

**Resolution applied (operator-selected: Option 1):**
- Story 2's negative path now names the throttle-exempt close-boundary flush as what delivers the
  final state, and gains a "Done When" checkbox asserting the ledger's last record for a dispatch
  ending with an unclosed child reports that child active, not `0`.
- Story 6's negative path now requires exactly one throttle-exempt flush at the close boundary
  before the no-further-emission and no-surviving-timer rules take effect, and gains two negative
  paths: a dispatch that produced no observation flushes nothing (no empty or zero-filled event),
  and a throwing flush leaves the dispatch result and completion verdict unchanged.
- Story 6's happy path gains the guarantee that the ledger's last record for a step is that flush.
- `adr-2026-08-19-live-provider-stream-observation` decision 6 carries an additive amendment note
  recording the exemption, its rationale, and its two limits. The original assertion is preserved.

No ADR was superseded; the amendment is additive to an ADR this same feature authored.

## Pairs examined and cleared

| Pair | Both-directions verdict |
|---|---|
| Story 1 × Story 4 | Clean. The terminal-line aggregate (`step_completed.tokenUsage`) and the live observations are separate accumulations; Story 4 explicitly forbids double-counting, which Story 1 does not require. |
| Story 2 × Story 3 | Clean. `observed` + `activeChildren: 0` and `unsupported`/absent are distinct representable states, so a real zero and an unknown never collide. |
| Story 3 × Story 4 | Clean. Both apply the same absence rule — an unobserved value renders as unavailable, never as `0`. |
| Story 3 × Story 5 | **Looks like a conflict, is not.** Story 5 requires `render: false` (no `.daemon/daemon.log` line) while Story 3 requires the operator to see the count. Verified against `readDispatchActivity` in `daemon-dashboard.ts`: `daemon status` reads `.pipeline/events.jsonl` directly and never reads `daemon.log`, so `{ render: false, persist: true }` satisfies both. Recorded because the pair would otherwise be re-litigated. |
| Story 5 × Story 6 | Clean. Throttling reduces the record count; it does not change which sinks the variant is declared for. |
| Story 6 × Story 7 | Clean after the resolution above — the added flush is explicitly best-effort and cannot affect the dispatch result, so Story 7's no-authority rule still holds in both directions. |
| Story 1 × Story 7 | Clean. Story 7's "no parseable record at all" degradation and Story 1's "no result line" passthrough describe the same fallback and agree on it. |

## ADR-versus-story pairs examined and cleared

| ADR | Story | Verdict |
|---|---|---|
| `adr-2026-07-22-build-dispatch-json-usage-capture` | Story 1 | Clean **as amended**. Its `stream-json` rejection was amended additively on 2026-08-19 by this feature's ADR; every other decision in it (stdin prompt, `.result` output, `.usage.*` capture, per-invocation scope) is exactly what Story 1 asserts. Unamended, this would have been a blocking contradiction. |
| `adr-2026-07-10-intra-step-build-progress-events` | Story 6 | Clean. Story 6 copies its change-driven-plus-heartbeat cadence and its "no timer outlives the step" lifecycle rule rather than inventing a new policy. |
| `adr-2026-07-26-event-sink-registry-exhaustiveness` | Story 5 | Clean and mutually reinforcing — Story 5's negative path (compilation fails on a missing sink declaration) is that ADR's mechanism. |
| `adr-2026-07-27-cost-unmetered-is-a-first-class-state` | Stories 3, 4 | Clean. Both stories generalize its rule from absent cost to absent counts and absent token observation. |
| `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` | Story 4 | Clean. Story 4 reports tokens only and introduces no second live cost aggregate. |
| `adr-2026-07-29-engine-observed-provider-time-partition` | Story 7 | Clean. Story 7's final criterion asserts the partition is unchanged; the observer adds no second timing source. |
| `adr-2026-07-30-provider-preparation-lifecycle-supervision` | Story 7 | Clean. The new callback threads through `supervisor.supervise` exactly as `onActivity` does and grants no lifecycle authority. |
| `adr-2026-07-24-provider-aware-step-execution` | Story 6 | **Looks like a conflict, is not.** Story 6 requires one engine-owned throttle policy across providers; the ADR requires "provider-local runtime state". Its decision §2 resolves "provider-neutral step behavior once" in a shared resolver, so an emission cadence is provider-neutral behavior, not provider-local runtime state. Clean in both directions. |

## Re-check

Re-run after the resolution was applied: zero blocking conflicts, zero degrading conflicts.

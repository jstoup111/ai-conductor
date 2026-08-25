# Conflict Check: Streaming provider dispatches record no token usage or cost

**Date:** 2026-08-24
**Issue:** jstoup111/ai-conductor#1857
**Stories checked:** `.docs/stories/streaming-provider-dispatches-record-no-token-usag.md` (Stories 1-9)
**ADR corpus scope:** `repo_wide` (`.ai-conductor/config.yml` → `conflict_check.adr_corpus`)
**Result:** 1 blocking conflict found and resolved; 2 falsified decision clauses amended; 0 blocking
conflicts remain.

## Corpus selection

**Examined (full corpus):** all 497 files in `.docs/decisions/`.

**Narrowing rule.** The corpus was narrowed by a full-text scan for every subject the nine stories
touch, rather than by title inspection: provider dispatch entry points (`invoke(`,
`invokeInteractive`, `LLMProvider`), plugin loading (`plugin-loader`, `llm_provider`), usage and
metering (`tokenUsage`, `costUsd`, `unmetered`, `cost-unmetered`), stream observation
(`onProviderStream`, `stream-json`, `output-format`, `exec --json`), session enforcement
(`fresh session`, `enforceFreshSessionOptions`), codex sandbox configuration (`sandbox_mode`,
`approval_policy`), and prompt delivery (`argv`, `stdin`, `E2BIG`, `MAX_ARG_STRLEN`).

**Narrowed to:** 41 `adr-*` files matched the scan. **Narrowed out:** the remaining ADRs matched no
subject term; their decisions concern gates, halts, releases, worktrees, intake, review rubrics, and
documentation, none of which any of the nine stories addresses.

**Directly compared against stories (the subset whose decisions bear on dispatch behavior):**
`002-plugin-manifest-and-discovery`, `adr-2026-07-22-build-dispatch-json-usage-capture`,
`adr-2026-07-22-per-feature-cost-rollup-in-shipped-record`,
`adr-2026-07-22-token-liveness-probe-via-cli-invocation`,
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`,
`adr-2026-07-27-cost-unmetered-is-a-first-class-state`,
`adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`,
`adr-2026-07-27-codex-never-resumes-a-harness-minted-session`,
`adr-2026-07-27-cold-start-within-step-retries`, `adr-2026-07-03-reactive-model-fallback-ladder`,
`adr-2026-08-19-live-provider-stream-observation`,
`adr-2026-08-12-live-provider-coverage-from-plugin-registry`,
`adr-2026-08-12-per-provider-live-smoke-legs`,
`adr-2026-07-29-engine-observed-provider-time-partition`.

**Supersession handling.** Every ADR in the compared subset carries `Status: APPROVED`; none is
marked superseded, so none was excluded on that basis. No partial or ambiguous supersession was
encountered in this subset.

## Conflict 1: An approved decision scopes the envelope change away from the path this feature must change

**Stories involved:** Story 5 (Every non-REPL dispatch requests the machine envelope) vs
ADR: The autonomous provider dispatch is observed as a live stream, not only at its result
**Files:** `.docs/stories/streaming-provider-dispatches-record-no-token-usag.md` vs
`.docs/decisions/adr-2026-08-19-live-provider-stream-observation.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-19-live-provider-stream-observation
**Story ID:** 5
**ADR opposing sentence (verbatim):** "**Scope is autonomous `invoke()` only.** `invokeInteractive`
inherits stdio so a human is already watching; its format is unchanged."
**Story opposing sentence (verbatim):** "Given a non-REPL claude dispatch, when its argument list is
constructed, then it requests the stream-json envelope with the verbose flag."

**Description:**
Decision 8 of the approved ADR states as a scope boundary that the `invokeInteractive` path's output
format is unchanged, on the stated ground that a human is already watching it. Story 5 requires that
every non-REPL dispatch request the envelope, and every streaming step reaches the provider through
exactly that path. The two cannot both hold.

The ADR's ground is what fails, and it fails the same way `adr-2026-07-22-build-dispatch-json-usage-capture`'s
interactive-path consequence failed. "A human is already watching" was true when `invokeInteractive`
was the interactive path. `streamingProviderRuntimes` (`step-runners.ts:1234-1258`) routes every
streaming step through it, and those steps run unattended under the daemon with no human watching at
all. The scope boundary was drawn around a population that has since changed.

Confidence 96%, basis: verified — D8 read at `adr-2026-08-19-live-provider-stream-observation:153-154`,
the routing read at `step-runners.ts:1234-1258`, and the streaming step set at `step-runners.ts:135`.

**Resolution Options:**
1. Amend the ADR's D8 in place with an additive note recording that its premise no longer holds for
   unattended streaming dispatches, and that the format boundary now falls at the REPL rather than at
   `invokeInteractive`. Preserves the original decision text and its reasoning.
2. Supersede `adr-2026-08-19-live-provider-stream-observation` entirely with a new ADR.
3. Narrow Story 5 to leave streaming dispatches on plain text, abandoning the feature's outcome.

**Recommendation:** Option 1. The ADR's substance — that the live stream and the parseable result are
the same artifact, and that `invoke()` should request the envelope — is correct and is the very thing
this feature builds on. Only its scope clause is falsified, and only because the path it named
acquired a new population afterward. Superseding a decision that is 95% still in force would lose
that reasoning; narrowing the story would abandon the outcome.

**Resolution applied:** Option 1. `adr-2026-08-19-live-provider-stream-observation` D8 carries an
additive amendment note; the original clause is preserved verbatim above it. No story text changed.

## Falsified decision clauses (amended, not conflicts)

These are approved decision clauses whose factual assertions this feature makes untrue. They do not
contradict any story — nothing must choose between them — but leaving them standing would misdescribe
the code, so each was amended in place with an additive note.

- **`adr-2026-07-03-reactive-model-fallback-ladder` D4** asserts "both `invoke()` and
  `invokeInteractive()` call sites consult the cache first". After unification there is one call site.
  The decision's substance — that the availability cache is consulted before dispatch — is unchanged
  and now holds on the single path. Amended. This also surfaced a gap in Story 7, which enumerated the
  enforcements that must survive unification but omitted the pre-dispatch availability consult
  (`step-runners.ts:899`); Story 7 was corrected in place to include it.

- **`adr-2026-07-27-cold-start-within-step-retries` D3** records that dispatch "falls through to
  `provider.invokeInteractive`" on the branch-session path, and that `group-core.ts` feeds that same
  path via `branchSessionId`. That fall-through disappears. Its actual finding — that #1069's
  architecture review over-claimed when it said all paths funnel through the gate — is historical and
  stands. Amended to record that the named mechanism no longer exists.

## Pairwise story scan

All 36 story pairs were checked in both directions against the six conflict types. The pairs sharing
a behavior, entity, or gate, with the two-directional oscillation test applied to each:

| Pair | Shared subject | A satisfied → B holds? | B satisfied → A holds? | Verdict |
|---|---|---|---|---|
| 5 × 6 | What the argument list requests | Yes — Story 6 governs the REPL, which Story 5 explicitly excludes | Yes | Clean |
| 5 × 9 | What the operator sees during a streaming step | Yes — visibility is supplied by the consumer, not by the output format | Yes | Clean |
| 1 × 8 | Whether a dispatch carries usage | Yes — Story 8 constrains what may be recorded, Story 1 that it is recorded when real | Yes | Clean |
| 2 × 3 | The dispatch member set | Yes | Yes | Clean |
| 2 × 7 | What survives unification | Yes | Yes | Clean |
| 3 × 4 | The `LLMProvider` surface | Yes — one removes a member, the other adds an options field | Yes | Clean |
| 4 × 9 | The stream consumer | Yes | Yes | Clean |
| 6 × 8 | Unmetered classification of a REPL dispatch | Yes — both assert the REPL contributes no fabricated cost | Yes | Clean |
| 4 × 6 | Whether a REPL carries a consumer | Yes — both assert it does not | Yes | Clean |

No oscillation found: no pair produced "no" in both directions. The remaining 27 pairs share no
behavior, entity, field, or gate.

## Prior conflict reports

`.docs/conflicts/` contains no prior report for this feature area; no recurring pattern applies.

## Verdict

**Conflict check passed.** Zero blocking conflicts remain. No degrading conflicts were accepted.
